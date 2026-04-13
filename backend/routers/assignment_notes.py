"""Assignment notes API — freeform notes tied to a node."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.models.assignment_note import AssignmentNote, AssignmentNoteCreate
from backend.services import assignment_note_service

router = APIRouter(prefix="/api/nodes", tags=["assignment-notes"])


@router.get("/{node_id}/notes")
async def list_notes(node_id: str) -> list[AssignmentNote]:
    return await assignment_note_service.list_notes(node_id)


@router.post("/{node_id}/notes")
async def create_note(node_id: str, body: AssignmentNoteCreate) -> AssignmentNote:
    return await assignment_note_service.create_note(node_id, body)


@router.delete("/{node_id}/notes/{note_id}")
async def delete_note(node_id: str, note_id: str) -> dict[str, bool]:
    deleted = await assignment_note_service.delete_note(note_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Note {note_id!r} not found")
    return {"deleted": True}
