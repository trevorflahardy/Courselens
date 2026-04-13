"""AI suggestion generation, CRUD, and Canvas apply logic."""

from __future__ import annotations

import difflib
import json
import logging
import subprocess
import uuid
from datetime import datetime

from backend.db import get_db
from backend.models.applied_change import AppliedChangeAction, AppliedChangeCreate
from backend.models.finding import Finding, FindingStatus
from backend.models.suggestion import (
    Suggestion,
    SuggestionCreate,
    SuggestionStatus,
    SuggestionTargetType,
)
from backend.services import changelog_service
from backend.services.node_service import get_assignment_rubric, get_node

logger = logging.getLogger(__name__)

_DEFAULT_HANDLER = "trevor"


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

async def create_suggestion(data: SuggestionCreate) -> Suggestion:
    db = await get_db()
    sid = f"sug-{uuid.uuid4().hex[:8]}"
    now = datetime.now().isoformat()
    await db.execute(
        """INSERT INTO suggestions
           (id, finding_id, node_id, field, target_type, target_ref,
            original_text, suggested_text, diff_patch, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
        (
            sid, data.finding_id, data.node_id, data.field,
            data.target_type.value, data.target_ref,
            data.original_text, data.suggested_text, data.diff_patch, now,
        ),
    )
    await db.commit()
    created = await get_suggestion(sid)
    if created is None:
        raise RuntimeError(f"Failed to read back just-created suggestion {sid}")
    return created


async def get_suggestion(suggestion_id: str) -> Suggestion | None:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM suggestions WHERE id = ?", (suggestion_id,))
    row = await cursor.fetchone()
    if row is None:
        return None
    return Suggestion.model_validate(dict(row), strict=False)


async def list_suggestions(
    finding_id: str | None = None,
    node_id: str | None = None,
    status: str | None = None,
) -> list[Suggestion]:
    db = await get_db()
    query = "SELECT * FROM suggestions WHERE 1=1"
    params: list[object] = []
    if finding_id is not None:
        query += " AND finding_id = ?"
        params.append(finding_id)
    if node_id is not None:
        query += " AND node_id = ?"
        params.append(node_id)
    if status is not None:
        query += " AND status = ?"
        params.append(status)
    query += " ORDER BY created_at DESC"
    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return [Suggestion.model_validate(dict(r), strict=False) for r in rows]


async def _set_terminal_status(
    suggestion_id: str,
    new_status: SuggestionStatus,
    *,
    denial_reason: str | None = None,
    ignore_reason: str | None = None,
    manual_note: str | None = None,
    handled_by: str = _DEFAULT_HANDLER,
) -> Suggestion | None:
    """Flip a suggestion into a terminal state and record who/when/why."""
    db = await get_db()
    now = datetime.now().isoformat()
    await db.execute(
        """UPDATE suggestions
           SET status = ?, denial_reason = COALESCE(?, denial_reason),
               ignore_reason = COALESCE(?, ignore_reason),
               manual_note = COALESCE(?, manual_note),
               handled_by = ?, handled_at = ?, resolved_at = ?
           WHERE id = ?""",
        (
            new_status.value,
            denial_reason, ignore_reason, manual_note,
            handled_by, now, now,
            suggestion_id,
        ),
    )
    await db.commit()
    return await get_suggestion(suggestion_id)


# ---------------------------------------------------------------------------
# AI generation
# ---------------------------------------------------------------------------

async def generate_suggestion_for_finding(finding: Finding) -> Suggestion | None:
    """Generate a text fix suggestion for a finding using Claude."""
    node = await get_node(finding.assignment_id)
    if node is None:
        return None

    # Prefer description; fall back to file_content (e.g. page nodes with downloaded body).
    source_text = node.description or node.file_content
    if not source_text:
        return None

    # For rubric-typed findings, pass rubric JSON as source-of-truth text.
    rubric_context = ""
    target_hint = "description"
    if finding.finding_type.value in {"rubric_mismatch", "rubric_drift"}:
        rubric = await get_assignment_rubric(finding.assignment_id)
        if rubric and rubric.get("criteria"):
            rubric_context = (
                "\n\nAssociated rubric criteria (JSON):\n"
                + json.dumps(rubric["criteria"], indent=2)[:3000]
            )
            target_hint = "rubric_criterion"
    elif node.description is None and node.file_content:
        target_hint = "page_body"

    prompt = (
        f"You are a course content editor. An audit finding was recorded:\n\n"
        f"Title: {finding.title}\n"
        f"Body: {finding.body}\n"
        f"Evidence: {finding.evidence or '(none)'}\n\n"
        f"Current content (first 3000 chars):\n{source_text[:3000]}"
        f"{rubric_context}\n\n"
        "Produce a minimal, surgical correction to a single field. "
        "Quote the original text verbatim (max 500 chars). "
        f"Default target is '{target_hint}'. "
        "Return valid JSON only — no explanation, no markdown fences:\n"
        '{"target_type": "description|page_body|rubric_criterion|title", '
        '"target_ref": "<optional JSON string, e.g. {\\"criterion_id\\": \\"_1234\\"} for rubric_criterion>", '
        '"field": "description|long_description", '
        '"original_text": "<verbatim excerpt>", '
        '"suggested_text": "<corrected version>"}'
    )

    try:
        result = subprocess.run(
            ["claude", "--print", "--no-markdown", prompt],
            capture_output=True, text=True, timeout=60,
        )
        raw = result.stdout.strip()
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start == -1 or end == 0:
            logger.warning(
                "suggestion_service: no JSON found in Claude output for finding %s",
                finding.id,
            )
            return None
        parsed = json.loads(raw[start:end])
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "suggestion_service: generation failed for finding %s: %s", finding.id, exc
        )
        return None

    target_type_raw = str(parsed.get("target_type", "description"))
    try:
        target_type = SuggestionTargetType(target_type_raw)
    except ValueError:
        target_type = SuggestionTargetType.DESCRIPTION

    target_ref = parsed.get("target_ref")
    if isinstance(target_ref, dict):
        target_ref = json.dumps(target_ref)
    elif target_ref is not None:
        target_ref = str(target_ref)

    field = str(parsed.get("field", "description"))
    original = str(parsed.get("original_text", ""))
    suggested = str(parsed.get("suggested_text", ""))

    if not original or not suggested or original == suggested:
        return None

    diff_lines = list(difflib.unified_diff(
        original.splitlines(keepends=True),
        suggested.splitlines(keepends=True),
        fromfile=f"original/{field}",
        tofile=f"suggested/{field}",
        lineterm="",
    ))
    diff_patch = "\n".join(diff_lines) if diff_lines else f"-{original}\n+{suggested}"

    data = SuggestionCreate(
        finding_id=finding.id,
        node_id=finding.assignment_id,
        field=field,
        target_type=target_type,
        target_ref=target_ref,
        original_text=original,
        suggested_text=suggested,
        diff_patch=diff_patch,
    )
    return await create_suggestion(data)


# ---------------------------------------------------------------------------
# Apply to Canvas
# ---------------------------------------------------------------------------

async def _run_canvas_tool(tool: str, tool_input_json: str) -> tuple[bool, str]:
    """Invoke a Canvas MCP tool via a Claude subprocess. Returns (ok, stdout)."""
    prompt = (
        f"Use the Canvas MCP tool `{tool}` with this input:\n{tool_input_json}\n\n"
        "Apply the change and confirm success. Return a short status line."
    )
    try:
        result = subprocess.run(
            [
                "claude", "--print", "--no-markdown",
                "--allowedTools", f"mcp__canvas-api__{tool}",
                prompt,
            ],
            capture_output=True, text=True, timeout=120,
        )
        stdout = (result.stdout or "").strip()
        ok = result.returncode == 0
        if not ok:
            logger.warning(
                "canvas tool %s failed: rc=%s stderr=%s",
                tool, result.returncode, (result.stderr or "").strip()[:400],
            )
        return ok, stdout
    except Exception as exc:  # noqa: BLE001
        logger.warning("canvas tool %s raised: %s", tool, exc)
        return False, str(exc)


async def apply_suggestion(suggestion: Suggestion) -> tuple[bool, str, str]:
    """Push an approved suggestion to Canvas via the appropriate MCP tool.

    Returns (success, new_text_after_substitution, canvas_response).
    """
    node = await get_node(suggestion.node_id)
    if node is None:
        logger.warning("apply_suggestion: node %s not found", suggestion.node_id)
        return False, "", "node not found"

    canvas_id = node.id.split("-", 1)[1] if "-" in node.id else node.id
    target = suggestion.target_type

    # --- Description on an assignment ---
    if target == SuggestionTargetType.DESCRIPTION and node.description:
        new_text = node.description.replace(
            suggestion.original_text, suggestion.suggested_text, 1
        )
        tool_input = json.dumps({
            "course_id": "$CANVAS_COURSE_ID",
            "assignment_id": canvas_id,
            "description": new_text,
        })
        ok, out = await _run_canvas_tool("update_assignment", tool_input)
        return ok, new_text, out

    # --- Page body ---
    if target == SuggestionTargetType.PAGE_BODY and node.description:
        new_text = node.description.replace(
            suggestion.original_text, suggestion.suggested_text, 1
        )
        tool_input = json.dumps({
            "course_id": "$CANVAS_COURSE_ID",
            "page_url": canvas_id,
            "body": new_text,
        })
        ok, out = await _run_canvas_tool("edit_page_content", tool_input)
        return ok, new_text, out

    # --- Rubric criterion description / long_description ---
    if target == SuggestionTargetType.RUBRIC_CRITERION:
        rubric = await get_assignment_rubric(suggestion.node_id)
        if rubric is None:
            return False, "", "rubric not found on assignment"

        ref_criterion_id: str | None = None
        if suggestion.target_ref:
            try:
                ref_criterion_id = str(json.loads(suggestion.target_ref).get("criterion_id"))
            except json.JSONDecodeError:
                ref_criterion_id = None

        criteria = list(rubric.get("criteria") or [])  # type: ignore[arg-type]
        patched = False
        for crit in criteria:
            if not isinstance(crit, dict):
                continue
            if ref_criterion_id and str(crit.get("id")) != ref_criterion_id:
                continue
            current = str(crit.get(suggestion.field, crit.get("description", "")))
            if suggestion.original_text not in current:
                continue
            new_text = current.replace(
                suggestion.original_text, suggestion.suggested_text, 1
            )
            crit[suggestion.field] = new_text
            patched = True
            break

        if not patched:
            return False, "", "rubric criterion did not match original_text"

        rubric_canvas_id = str(rubric.get("canvas_id") or rubric.get("id"))
        tool_input = json.dumps({
            "course_id": "$CANVAS_COURSE_ID",
            "rubric_id": rubric_canvas_id,
            "criteria": criteria,
        })
        ok, out = await _run_canvas_tool("update_rubric", tool_input)
        return ok, suggestion.suggested_text, out

    # --- Module item ---
    if target == SuggestionTargetType.MODULE_ITEM:
        ref: dict[str, object] = {}
        if suggestion.target_ref:
            try:
                ref = json.loads(suggestion.target_ref)
            except json.JSONDecodeError:
                ref = {}
        tool_input = json.dumps({
            "course_id": "$CANVAS_COURSE_ID",
            "module_id": ref.get("module_id"),
            "module_item_id": ref.get("module_item_id"),
            suggestion.field: suggestion.suggested_text,
        })
        ok, out = await _run_canvas_tool("update_module_item", tool_input)
        return ok, suggestion.suggested_text, out

    # --- Title on an assignment ---
    if target == SuggestionTargetType.TITLE:
        new_title = node.title.replace(
            suggestion.original_text, suggestion.suggested_text, 1
        )
        tool_input = json.dumps({
            "course_id": "$CANVAS_COURSE_ID",
            "assignment_id": canvas_id,
            "name": new_title,
        })
        ok, out = await _run_canvas_tool("update_assignment", tool_input)
        return ok, new_title, out

    logger.warning("apply_suggestion: unsupported target_type %s", target)
    return False, "", f"unsupported target_type {target}"


# ---------------------------------------------------------------------------
# Terminal actions — approve / deny / ignore / done manually
# ---------------------------------------------------------------------------

async def _load_finding(finding_id: str) -> Finding | None:
    from backend.services.finding_service import get_finding
    return await get_finding(finding_id)


async def _set_finding_status(finding_id: str, new_status: FindingStatus) -> None:
    db = await get_db()
    now = datetime.now().isoformat()
    await db.execute(
        "UPDATE findings SET status = ?, resolved_at = ? WHERE id = ?",
        (new_status.value, now, finding_id),
    )
    # Refresh the parent node's finding_count + worst-severity status.
    cursor = await db.execute("SELECT assignment_id FROM findings WHERE id = ?", (finding_id,))
    row = await cursor.fetchone()
    if row:
        assignment_id = row[0]
        await db.execute(
            """UPDATE nodes SET finding_count = (
                SELECT COUNT(*) FROM findings
                WHERE assignment_id = ? AND status = 'active'
            ) WHERE id = ?""",
            (assignment_id, assignment_id),
        )
    await db.commit()
    if row:
        from backend.services.finding_service import _refresh_node_status
        await _refresh_node_status(row[0])


async def _write_change_log(
    *,
    suggestion: Suggestion,
    action: AppliedChangeAction,
    new_text: str,
    reason_or_note: str | None,
    canvas_response: str | None,
    handled_by: str,
) -> None:
    finding = await _load_finding(suggestion.finding_id)
    await changelog_service.create_applied_change(AppliedChangeCreate(
        suggestion_id=suggestion.id,
        finding_id=suggestion.finding_id,
        node_id=suggestion.node_id,
        action=action,
        target_type=suggestion.target_type.value,
        field=suggestion.field,
        original_text=suggestion.original_text,
        new_text=new_text,
        diff_patch=suggestion.diff_patch,
        finding_title=finding.title if finding else "(finding unavailable)",
        finding_severity=finding.severity.value if finding else "info",
        finding_pass=finding.pass_number if finding else None,
        evidence_quote=finding.evidence if finding else None,
        reason_or_note=reason_or_note,
        canvas_response=canvas_response,
        handled_by=handled_by,
    ))


async def approve_and_apply(
    suggestion_id: str,
    *,
    handled_by: str = _DEFAULT_HANDLER,
) -> tuple[Suggestion | None, bool, str]:
    sug = await get_suggestion(suggestion_id)
    if sug is None:
        return None, False, "suggestion not found"
    if sug.status != SuggestionStatus.PENDING:
        return sug, False, f"suggestion is already '{sug.status.value}'"

    ok, new_text, canvas_response = await apply_suggestion(sug)
    if not ok:
        return sug, False, canvas_response

    updated = await _set_terminal_status(
        suggestion_id, SuggestionStatus.APPROVED, handled_by=handled_by,
    )
    if updated is not None:
        await _write_change_log(
            suggestion=updated,
            action=AppliedChangeAction.APPLIED,
            new_text=new_text,
            reason_or_note=None,
            canvas_response=canvas_response,
            handled_by=handled_by,
        )
        await _set_finding_status(updated.finding_id, FindingStatus.RESOLVED)
    return updated, True, canvas_response


async def deny_with_reason(
    suggestion_id: str,
    reason: str,
    *,
    handled_by: str = _DEFAULT_HANDLER,
) -> Suggestion | None:
    sug = await get_suggestion(suggestion_id)
    if sug is None:
        return None
    updated = await _set_terminal_status(
        suggestion_id, SuggestionStatus.DENIED,
        denial_reason=reason, handled_by=handled_by,
    )
    if updated is not None:
        await _write_change_log(
            suggestion=updated,
            action=AppliedChangeAction.DENIED,
            new_text=updated.suggested_text,
            reason_or_note=reason,
            canvas_response=None,
            handled_by=handled_by,
        )
        # Denied = "intentional, not a gap" — confirm the finding.
        await _set_finding_status(updated.finding_id, FindingStatus.CONFIRMED)
    return updated


async def ignore_with_reason(
    suggestion_id: str,
    reason: str,
    *,
    handled_by: str = _DEFAULT_HANDLER,
) -> Suggestion | None:
    sug = await get_suggestion(suggestion_id)
    if sug is None:
        return None
    updated = await _set_terminal_status(
        suggestion_id, SuggestionStatus.IGNORED,
        ignore_reason=reason, handled_by=handled_by,
    )
    if updated is not None:
        await _write_change_log(
            suggestion=updated,
            action=AppliedChangeAction.IGNORED,
            new_text=updated.suggested_text,
            reason_or_note=reason,
            canvas_response=None,
            handled_by=handled_by,
        )
        # Ignore is a soft-defer — finding stays 'active' so it can resurface.
    return updated


async def mark_done_manually(
    suggestion_id: str,
    note: str | None,
    *,
    handled_by: str = _DEFAULT_HANDLER,
) -> Suggestion | None:
    sug = await get_suggestion(suggestion_id)
    if sug is None:
        return None
    updated = await _set_terminal_status(
        suggestion_id, SuggestionStatus.DONE_MANUALLY,
        manual_note=note, handled_by=handled_by,
    )
    if updated is not None:
        await _write_change_log(
            suggestion=updated,
            action=AppliedChangeAction.DONE_MANUALLY,
            new_text=updated.suggested_text,
            reason_or_note=note,
            canvas_response=None,
            handled_by=handled_by,
        )
        await _set_finding_status(updated.finding_id, FindingStatus.RESOLVED)
    return updated
