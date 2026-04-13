"""Suggestions API — list, approve/apply, deny, ignore, mark done manually."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.models.suggestion import Suggestion, SuggestionStatus
from backend.services import suggestion_service

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


class ReasonBody(BaseModel):
    reason: str = Field(min_length=1)


class NoteBody(BaseModel):
    note: str | None = None


@router.get("")
async def list_suggestions(
    finding_id: str | None = None,
    node_id: str | None = None,
    status: str | None = None,
) -> list[Suggestion]:
    """List suggestions with optional filters."""
    return await suggestion_service.list_suggestions(
        finding_id=finding_id, node_id=node_id, status=status
    )


@router.get("/{suggestion_id}")
async def get_suggestion(suggestion_id: str) -> Suggestion:
    sug = await suggestion_service.get_suggestion(suggestion_id)
    if sug is None:
        raise HTTPException(status_code=404, detail=f"Suggestion '{suggestion_id}' not found")
    return sug


@router.post("/{suggestion_id}/approve")
async def approve_suggestion(suggestion_id: str) -> Suggestion:
    """Approve and push the suggestion to Canvas via MCP."""
    updated, ok, message = await suggestion_service.approve_and_apply(suggestion_id)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Suggestion '{suggestion_id}' not found")
    if not ok and updated.status == SuggestionStatus.PENDING:
        raise HTTPException(status_code=502, detail=f"Canvas apply failed: {message}")
    return updated


@router.post("/{suggestion_id}/deny")
async def deny_suggestion(suggestion_id: str, body: ReasonBody) -> Suggestion:
    updated = await suggestion_service.deny_with_reason(suggestion_id, body.reason)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Suggestion '{suggestion_id}' not found")
    return updated


@router.post("/{suggestion_id}/ignore")
async def ignore_suggestion(suggestion_id: str, body: ReasonBody) -> Suggestion:
    updated = await suggestion_service.ignore_with_reason(suggestion_id, body.reason)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Suggestion '{suggestion_id}' not found")
    return updated


@router.post("/{suggestion_id}/done-manually")
async def mark_done_manually(suggestion_id: str, body: NoteBody) -> Suggestion:
    updated = await suggestion_service.mark_done_manually(suggestion_id, body.note)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Suggestion '{suggestion_id}' not found")
    return updated


@router.post("/generate/{finding_id}")
async def generate_for_finding(finding_id: str) -> Suggestion:
    """On-demand AI suggestion generation for a finding that didn't get one."""
    from backend.services.finding_service import get_finding
    finding = await get_finding(finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail=f"Finding '{finding_id}' not found")
    sug = await suggestion_service.generate_suggestion_for_finding(finding)
    if sug is None:
        raise HTTPException(
            status_code=422,
            detail="No suggestion could be generated for this finding type or content.",
        )
    return sug
