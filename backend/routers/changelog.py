"""Changelog API — list applied changes, stats, and export as Markdown."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from backend.models.applied_change import AppliedChange, AppliedChangeAction, AppliedChangeCreate
from backend.services import changelog_service, finding_service

router = APIRouter(prefix="/api/changelog", tags=["changelog"])


class ManualEntryRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    note: str | None = None


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


@router.post("/manual/{finding_id}")
async def add_manual_entry(finding_id: str, body: ManualEntryRequest) -> AppliedChange:
    """Create a manual changelog entry for a finding without an AI suggestion.

    Useful for recording fixes done outside the system, or marking a related
    item as resolved. The finding itself is not modified.
    """
    finding = await finding_service.get_finding(finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail=f"Finding {finding_id!r} not found")

    data = AppliedChangeCreate(
        suggestion_id=None,
        finding_id=finding.id,
        node_id=finding.assignment_id,
        action=AppliedChangeAction.DONE_MANUALLY,
        target_type="manual",
        field="manual",
        original_text="",
        new_text="",
        diff_patch="",
        finding_title=finding.title,
        finding_severity=finding.severity.value,
        finding_pass=finding.pass_number,
        evidence_quote=finding.evidence,
        reason_or_note=body.note,
        handled_by="trevor",
    )
    return await changelog_service.create_applied_change(data)


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
