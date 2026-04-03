"""Infer module placement for documents from existing node links."""

from __future__ import annotations

from collections import Counter

import aiosqlite


def _looks_like_pdf(*values: str | None) -> bool:
    return any(bool(value and ".pdf" in value.lower()) for value in values)


async def auto_assign_pdf_modules_from_mentions(db: aiosqlite.Connection) -> dict[str, int]:
    """Assign module/week to PDF file nodes when mentions are module-consistent.

    A file is auto-assigned only if all mentions from assignments/pages point to one
    non-empty module. Conflicting existing module values are left untouched.
    """

    cursor = await db.execute(
        """
        SELECT id, title, canvas_url, file_path, module, week
        FROM nodes
        WHERE type = 'file'
        """
    )
    files = await cursor.fetchall()

    assigned = 0
    candidates = 0
    skipped_no_mentions = 0
    skipped_multi_module = 0
    skipped_with_unmapped = 0
    skipped_conflict = 0

    for row in files:
        file_id = str(row["id"])
        title = str(row["title"] or "")
        canvas_url = str(row["canvas_url"] or "")
        file_path = str(row["file_path"] or "")

        if not _looks_like_pdf(title, canvas_url, file_path):
            continue

        candidates += 1

        src_cursor = await db.execute(
            """
            SELECT n.module, n.week
            FROM node_links l
            JOIN nodes n ON n.id = l.source_id
            WHERE l.target_id = ?
              AND n.type IN ('assignment', 'page')
            """,
            (file_id,),
        )
        source_rows = await src_cursor.fetchall()

        if not source_rows:
            skipped_no_mentions += 1
            continue

        modules = {
            str(source_row["module"]).strip()
            for source_row in source_rows
            if source_row["module"] is not None and str(source_row["module"]).strip()
        }
        has_unmapped = any(
            source_row["module"] is None or not str(source_row["module"]).strip()
            for source_row in source_rows
        )

        if has_unmapped:
            skipped_with_unmapped += 1
            continue

        if len(modules) != 1:
            skipped_multi_module += 1
            continue

        inferred_module = next(iter(modules))
        existing_module = row["module"]
        existing_module_text = str(existing_module).strip() if existing_module is not None else ""

        if existing_module_text and existing_module_text != inferred_module:
            skipped_conflict += 1
            continue

        week_counter = Counter(
            int(source_row["week"])
            for source_row in source_rows
            if isinstance(source_row["week"], int)
        )
        inferred_week = week_counter.most_common(1)[0][0] if week_counter else None

        updates: dict[str, object] = {}
        if not existing_module_text:
            updates["module"] = inferred_module
        if row["week"] is None and inferred_week is not None:
            updates["week"] = inferred_week

        if not updates:
            continue

        assignments = ", ".join(f"{column} = ?" for column in updates)
        await db.execute(
            f"UPDATE nodes SET {assignments} WHERE id = ?",  # noqa: S608
            [*updates.values(), file_id],
        )
        assigned += 1

    if assigned > 0:
        await db.commit()

    return {
        "pdf_candidates": candidates,
        "modules_auto_assigned": assigned,
        "skipped_no_mentions": skipped_no_mentions,
        "skipped_multi_module": skipped_multi_module,
        "skipped_with_unmapped": skipped_with_unmapped,
        "skipped_conflict": skipped_conflict,
    }
