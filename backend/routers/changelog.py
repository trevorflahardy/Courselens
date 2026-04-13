"""Changelog API — list applied changes, stats, and export as Markdown."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import Response

from backend.models.applied_change import AppliedChange
from backend.services import changelog_service

router = APIRouter(prefix="/api/changelog", tags=["changelog"])


@router.get("")
async def list_changelog(
    node_id: str | None = None,
    action: str | None = None,
    since: str | None = None,
    until: str | None = None,
) -> list[AppliedChange]:
    return await changelog_service.list_changes(
        node_id=node_id, action=action, since=since, until=until,
    )


@router.get("/stats")
async def changelog_stats() -> dict[str, int]:
    return await changelog_service.get_stats()


@router.get("/export.md")
async def export_markdown() -> Response:
    """Return the full audit changelog rendered as Markdown."""
    body = await changelog_service.export_markdown()
    return Response(
        content=body,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="course-audit-changelog.md"',
        },
    )
