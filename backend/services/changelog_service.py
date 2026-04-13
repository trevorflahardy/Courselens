"""Applied changes (durable audit trail) CRUD and Markdown export.

Reads/writes the `applied_changes` table. One row lands every time a
suggestion hits a terminal state (applied, denied, ignored, done_manually).

The Markdown export is rendered here (not in a template engine) so the
output is byte-stable across server versions and easy to diff in CI.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime
from io import StringIO

from backend.db import get_db
from backend.models.applied_change import (
    AppliedChange,
    AppliedChangeAction,
    AppliedChangeCreate,
)
from backend.models.assignment_note import AssignmentNote
from backend.services import assignment_note_service

_ACTION_LABELS = {
    AppliedChangeAction.APPLIED: "Applied",
    AppliedChangeAction.DENIED: "Denied",
    AppliedChangeAction.IGNORED: "Ignored",
    AppliedChangeAction.DONE_MANUALLY: "Done Manually",
}

_PASS_LABELS = {
    1: "Clarity",
    2: "Dependencies",
    3: "Forward Impact",
}


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

async def create_applied_change(data: AppliedChangeCreate) -> AppliedChange:
    db = await get_db()
    cid = f"chg-{uuid.uuid4().hex[:10]}"
    now = datetime.now().isoformat()
    await db.execute(
        """INSERT INTO applied_changes
           (id, suggestion_id, finding_id, node_id, action, target_type, field,
            original_text, new_text, diff_patch, finding_title, finding_severity,
            finding_pass, evidence_quote, reason_or_note, canvas_response,
            handled_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            cid, data.suggestion_id, data.finding_id, data.node_id,
            data.action.value, data.target_type, data.field,
            data.original_text, data.new_text, data.diff_patch,
            data.finding_title, data.finding_severity, data.finding_pass,
            data.evidence_quote, data.reason_or_note, data.canvas_response,
            data.handled_by, now,
        ),
    )
    await db.commit()
    cursor = await db.execute("SELECT * FROM applied_changes WHERE id = ?", (cid,))
    row = await cursor.fetchone()
    if row is None:
        raise RuntimeError(f"Failed to read back just-created applied_change {cid}")
    return AppliedChange.model_validate(dict(row), strict=False)


async def list_changes(
    *,
    node_id: str | None = None,
    action: str | None = None,
    since: str | None = None,
    until: str | None = None,
) -> list[AppliedChange]:
    db = await get_db()
    query = "SELECT * FROM applied_changes WHERE 1=1"
    params: list[object] = []
    if node_id is not None:
        query += " AND node_id = ?"
        params.append(node_id)
    if action is not None:
        query += " AND action = ?"
        params.append(action)
    if since is not None:
        query += " AND created_at >= ?"
        params.append(since)
    if until is not None:
        query += " AND created_at <= ?"
        params.append(until)
    query += " ORDER BY created_at DESC"
    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return [AppliedChange.model_validate(dict(r), strict=False) for r in rows]


async def get_stats() -> dict[str, int]:
    """Counts per action for the changelog summary cards + MD header table."""
    db = await get_db()
    result = {"applied": 0, "denied": 0, "ignored": 0, "done_manually": 0, "total": 0}
    cursor = await db.execute(
        "SELECT action, COUNT(*) FROM applied_changes GROUP BY action"
    )
    for action, count in await cursor.fetchall():
        result[str(action)] = int(count)
    result["total"] = sum(
        v for k, v in result.items() if k != "total"
    )
    return result


# ---------------------------------------------------------------------------
# Markdown export
# ---------------------------------------------------------------------------

async def _build_assignment_index() -> dict[str, dict[str, object]]:
    """Build a lookup of node_id → {title, week, module} for the MD grouping."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT id, title, week, module FROM nodes"
    )
    rows = await cursor.fetchall()
    return {
        str(r["id"]): {
            "title": r["title"],
            "week": r["week"],
            "module": r["module"],
        }
        for r in rows
    }


def _render_diff_fence(diff_patch: str, original: str, new_text: str) -> str:
    """Return a fenced ```diff block. Falls back to constructing one from the
    original/new text when the stored unified diff is empty."""
    body = (diff_patch or "").strip()
    if not body:
        old_lines = [f"- {ln}" for ln in original.splitlines() or [original]]
        new_lines = [f"+ {ln}" for ln in new_text.splitlines() or [new_text]]
        body = "\n".join([*old_lines, *new_lines])
    return f"```diff\n{body}\n```"


async def export_markdown() -> str:
    """Render the full audit changelog as a single Markdown document."""
    changes = await list_changes()
    assignments = await _build_assignment_index()
    notes_by_node = await assignment_note_service.list_all_notes()

    out = StringIO()
    now_iso = datetime.now().isoformat(timespec="seconds")
    out.write("# EGN 3000L Course Audit Changelog\n")
    out.write(f"_Generated {now_iso} by complete_course_audit_\n\n")

    if not changes and not notes_by_node:
        out.write("> No changes or notes have been recorded yet.\n")
        return out.getvalue()

    # --- Summary counts table (only rows that have changes) ---
    by_assignment: dict[str, dict[str, int]] = defaultdict(
        lambda: {"applied": 0, "denied": 0, "ignored": 0, "done_manually": 0}
    )
    for c in changes:
        by_assignment[c.node_id][c.action.value] += 1

    if by_assignment:
        out.write("## Summary\n\n")
        out.write("| Assignment | Applied | Denied | Ignored | Done Manually |\n")
        out.write("|---|---:|---:|---:|---:|\n")
        totals = {"applied": 0, "denied": 0, "ignored": 0, "done_manually": 0}
        for node_id, counts in sorted(
            by_assignment.items(),
            key=lambda kv: (
                assignments.get(kv[0], {}).get("week") or 99,
                str(assignments.get(kv[0], {}).get("title") or kv[0]),
            ),
        ):
            title = str(assignments.get(node_id, {}).get("title") or node_id)
            out.write(
                f"| {title} | {counts['applied']} | {counts['denied']} "
                f"| {counts['ignored']} | {counts['done_manually']} |\n"
            )
            for k in totals:
                totals[k] += counts[k]
        out.write(
            f"| **Total** | **{totals['applied']}** | **{totals['denied']}** "
            f"| **{totals['ignored']}** | **{totals['done_manually']}** |\n\n"
        )
        out.write("---\n\n")

    # --- Per-assignment sections (changes + notes) ---
    grouped: dict[str, list[AppliedChange]] = defaultdict(list)
    for c in changes:
        grouped[c.node_id].append(c)

    # Union of node_ids that have either changes or notes.
    all_node_ids = set(grouped) | set(notes_by_node)

    def _assignment_sort_key(node_id: str) -> tuple[int, str]:
        meta = assignments.get(node_id, {})
        week_val = meta.get("week")
        week = int(week_val) if isinstance(week_val, int) else 99
        return week, str(meta.get("title") or node_id)

    for node_id in sorted(all_node_ids, key=_assignment_sort_key):
        meta = assignments.get(node_id, {})
        title = meta.get("title") or node_id
        week = meta.get("week")
        week_label = f"Week {week} — " if week is not None else ""
        node_changes = grouped.get(node_id, [])
        node_notes: list[AssignmentNote] = notes_by_node.get(node_id, [])
        count = len(node_changes)
        note_count = len(node_notes)
        meta_parts = [f"{count} change{'s' if count != 1 else ''}"]
        if note_count:
            meta_parts.append(f"{note_count} note{'s' if note_count != 1 else ''}")
        out.write(f"## {week_label}Assignment: \"{title}\"\n")
        out.write(f"_Node id: `{node_id}` · {', '.join(meta_parts)}_\n\n")

        if node_notes:
            out.write("### Notes\n\n")
            for n in node_notes:
                ts = n.created_at.isoformat(timespec="seconds")
                out.write(f"- {n.note} _(by {n.created_by} at {ts})_\n")
            out.write("\n")

        for idx, c in enumerate(
            sorted(node_changes, key=lambda x: x.created_at),
            start=1,
        ):
            action_label = _ACTION_LABELS.get(c.action, c.action.value)
            pass_label = _PASS_LABELS.get(c.finding_pass or 0, "")
            pass_suffix = f" · {pass_label} (Pass {c.finding_pass})" if c.finding_pass else ""
            out.write(
                f"### Change {idx} — {action_label} · {c.finding_severity}{pass_suffix}\n"
            )
            out.write(f"**Finding:** {c.finding_title}\n\n")
            if c.evidence_quote:
                quoted = c.evidence_quote.strip().replace("\n", " ")
                out.write(f"**Evidence quote:** _{quoted}_\n\n")
            out.write(f"**Target:** `{c.target_type}` · field `{c.field}`\n\n")
            handled_at = c.created_at.isoformat(timespec="seconds")
            out.write(f"**Handled by {c.handled_by} at {handled_at}**\n\n")
            if c.reason_or_note:
                label = {
                    AppliedChangeAction.DENIED: "Reason for denial",
                    AppliedChangeAction.IGNORED: "Reason to ignore",
                    AppliedChangeAction.DONE_MANUALLY: "Manual note",
                }.get(c.action, "Note")
                out.write(f"**{label}:** {c.reason_or_note}\n\n")
            out.write(_render_diff_fence(c.diff_patch, c.original_text, c.new_text))
            out.write("\n\n")
        out.write("---\n\n")

    return out.getvalue()
