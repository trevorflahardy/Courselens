"""Suggestions API — list, approve, deny, ignore AI-generated text fix suggestions."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.models.suggestion import Suggestion, SuggestionStatus
from backend.services import suggestion_service

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


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
    """Approve and apply the suggestion to Canvas."""
    sug = await suggestion_service.get_suggestion(suggestion_id)
    if sug is None:
        raise HTTPException(status_code=404, detail=f"Suggestion '{suggestion_id}' not found")
    if sug.status != SuggestionStatus.PENDING:
        raise HTTPException(status_code=409, detail=f"Suggestion is already '{sug.status}'")

    await suggestion_service.apply_suggestion(sug)
    updated = await suggestion_service.update_suggestion_status(suggestion_id, SuggestionStatus.APPROVED)
    return updated  # type: ignore[return-value]


@router.post("/{suggestion_id}/deny")
async def deny_suggestion(suggestion_id: str) -> Suggestion:
    sug = await suggestion_service.get_suggestion(suggestion_id)
    if sug is None:
        raise HTTPException(status_code=404, detail=f"Suggestion '{suggestion_id}' not found")
    updated = await suggestion_service.update_suggestion_status(suggestion_id, SuggestionStatus.DENIED)
    return updated  # type: ignore[return-value]


@router.post("/{suggestion_id}/ignore")
async def ignore_suggestion(suggestion_id: str) -> Suggestion:
    sug = await suggestion_service.get_suggestion(suggestion_id)
    if sug is None:
        raise HTTPException(status_code=404, detail=f"Suggestion '{suggestion_id}' not found")
    updated = await suggestion_service.update_suggestion_status(suggestion_id, SuggestionStatus.IGNORED)
    return updated  # type: ignore[return-value]
