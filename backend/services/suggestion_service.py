"""AI suggestion generation, CRUD, and Canvas apply logic."""

from __future__ import annotations

import difflib
import json
import logging
import subprocess
import uuid
from datetime import datetime

from backend.db import get_db
from backend.models.finding import Finding
from backend.models.suggestion import Suggestion, SuggestionCreate, SuggestionStatus
from backend.services.node_service import get_node

logger = logging.getLogger(__name__)

# Finding types that qualify for auto-suggestions (small text-level fixes only)
QUALIFYING_TYPES = {"clarity", "format_mismatch"}

# Canvas node types that support description updates
_ASSIGNMENT_TYPES = {"assignment"}
_PAGE_TYPES = {"page"}


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

async def create_suggestion(data: SuggestionCreate) -> Suggestion:
    db = await get_db()
    sid = f"sug-{uuid.uuid4().hex[:8]}"
    now = datetime.now().isoformat()
    await db.execute(
        """INSERT INTO suggestions
           (id, finding_id, node_id, field, original_text, suggested_text, diff_patch,
            status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
        (sid, data.finding_id, data.node_id, data.field,
         data.original_text, data.suggested_text, data.diff_patch, now),
    )
    await db.commit()
    return (await get_suggestion(sid))  # type: ignore[return-value]


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


async def update_suggestion_status(
    suggestion_id: str,
    new_status: SuggestionStatus,
) -> Suggestion | None:
    db = await get_db()
    now = datetime.now().isoformat()
    resolved_at = now if new_status != SuggestionStatus.PENDING else None
    await db.execute(
        "UPDATE suggestions SET status = ?, resolved_at = ? WHERE id = ?",
        (new_status.value, resolved_at, suggestion_id),
    )
    await db.commit()
    return await get_suggestion(suggestion_id)


# ---------------------------------------------------------------------------
# AI generation
# ---------------------------------------------------------------------------

async def generate_suggestion_for_finding(finding: Finding) -> Suggestion | None:
    """Generate a text fix suggestion for a qualifying finding using Claude."""
    if finding.finding_type.value not in QUALIFYING_TYPES:
        return None

    node = await get_node(finding.assignment_id)
    if node is None or not node.description:
        return None

    prompt = (
        f"You are a course content editor. An audit finding was recorded:\n\n"
        f"Title: {finding.title}\n"
        f"Body: {finding.body}\n"
        f"Evidence: {finding.evidence or '(none)'}\n\n"
        f"Current field: description\n"
        f"Current text (first 3000 chars):\n{node.description[:3000]}\n\n"
        "Produce a minimal correction. Return valid JSON only — no explanation, no markdown fences:\n"
        '{"field": "description", "original_text": "<verbatim excerpt, max 500 chars>", '
        '"suggested_text": "<corrected version of that excerpt>"}'
    )

    try:
        result = subprocess.run(
            ["claude", "--print", "--no-markdown", prompt],
            capture_output=True, text=True, timeout=60,
        )
        raw = result.stdout.strip()
        # Find the JSON object in the output
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start == -1 or end == 0:
            logger.warning("suggestion_service: no JSON found in Claude output for finding %s", finding.id)
            return None
        parsed = json.loads(raw[start:end])
    except Exception as exc:
        logger.warning("suggestion_service: generation failed for finding %s: %s", finding.id, exc)
        return None

    field = str(parsed.get("field", "description"))
    original = str(parsed.get("original_text", ""))
    suggested = str(parsed.get("suggested_text", ""))

    if not original or not suggested or original == suggested:
        return None

    # Build unified diff patch
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
        original_text=original,
        suggested_text=suggested,
        diff_patch=diff_patch,
    )
    return await create_suggestion(data)


# ---------------------------------------------------------------------------
# Apply to Canvas
# ---------------------------------------------------------------------------

async def apply_suggestion(suggestion: Suggestion) -> bool:
    """Push an approved suggestion to Canvas via the appropriate MCP tool."""
    node = await get_node(suggestion.node_id)
    if node is None:
        logger.warning("apply_suggestion: node %s not found", suggestion.node_id)
        return False

    # Build the updated field value by substituting the suggested text
    if suggestion.field == "description" and node.description:
        updated_value = node.description.replace(suggestion.original_text, suggestion.suggested_text, 1)
    elif suggestion.field == "title":
        updated_value = node.title.replace(suggestion.original_text, suggestion.suggested_text, 1)
    else:
        logger.warning("apply_suggestion: unsupported field %s", suggestion.field)
        return False

    canvas_id = node.id.split("-", 1)[1] if "-" in node.id else node.id

    if node.type in _ASSIGNMENT_TYPES:
        tool = "update_assignment"
        tool_input = json.dumps({
            "course_id": "$CANVAS_COURSE_ID",
            "assignment_id": canvas_id,
            "description": updated_value,
        })
    elif node.type in _PAGE_TYPES:
        tool = "edit_page_content"
        tool_input = json.dumps({
            "course_id": "$CANVAS_COURSE_ID",
            "page_url": canvas_id,
            "body": updated_value,
        })
    else:
        logger.warning("apply_suggestion: node type %s not supported for Canvas write", node.type)
        return False

    try:
        prompt = (
            f"Use the Canvas MCP tool `{tool}` with this input:\n{tool_input}\n\n"
            "Apply the change and confirm success."
        )
        subprocess.run(
            ["claude", "--print", "--no-markdown", "--allowedTools", f"mcp__canvas-api__{tool}", prompt],
            capture_output=True, text=True, timeout=120,
        )
        return True
    except Exception as exc:
        logger.warning("apply_suggestion: Canvas apply failed: %s", exc)
        return False
