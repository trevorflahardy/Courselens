"""CRUD for assignment-level notes."""

from __future__ import annotations

import uuid
from datetime import datetime

from backend.db import get_db
from backend.models.assignment_note import AssignmentNote, AssignmentNoteCreate


async def create_note(node_id: str, data: AssignmentNoteCreate) -> AssignmentNote:
    db = await get_db()
    nid = f"anote-{uuid.uuid4().hex[:10]}"
    now = datetime.now().isoformat()
    await db.execute(
        "INSERT INTO assignment_notes (id, node_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
        (nid, node_id, data.note, data.created_by, now),
    )
    await db.commit()
    cursor = await db.execute("SELECT * FROM assignment_notes WHERE id = ?", (nid,))
    row = await cursor.fetchone()
    if row is None:
        raise RuntimeError(f"Failed to read back just-created assignment_note {nid}")
    return AssignmentNote.model_validate(dict(row), strict=False)


async def list_notes(node_id: str) -> list[AssignmentNote]:
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM assignment_notes WHERE node_id = ? ORDER BY created_at ASC",
        (node_id,),
    )
    rows = await cursor.fetchall()
    return [AssignmentNote.model_validate(dict(r), strict=False) for r in rows]


async def delete_note(note_id: str) -> bool:
    db = await get_db()
    cursor = await db.execute("DELETE FROM assignment_notes WHERE id = ?", (note_id,))
    await db.commit()
    return cursor.rowcount > 0


async def list_all_notes() -> dict[str, list[AssignmentNote]]:
    """Return all notes grouped by node_id — used by the markdown export."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM assignment_notes ORDER BY node_id, created_at ASC"
    )
    rows = await cursor.fetchall()
    result: dict[str, list[AssignmentNote]] = {}
    for r in rows:
        note = AssignmentNote.model_validate(dict(r), strict=False)
        result.setdefault(note.node_id, []).append(note)
    return result
