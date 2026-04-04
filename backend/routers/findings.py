"""Findings API routes."""

from __future__ import annotations

from fastapi import APIRouter

from backend.db import get_db
from backend.models.finding import Finding, FindingSeverity, FindingStatus, FindingType
from backend.services import finding_service

router = APIRouter(prefix="/api/findings", tags=["findings"])


@router.get("")
async def list_findings(
    assignment_id: str | None = None,
    severity: FindingSeverity | None = None,
    finding_type: FindingType | None = None,
    status: FindingStatus | None = None,
    audit_run_id: str | None = None,
) -> list[Finding]:
    return await finding_service.list_findings(
        assignment_id=assignment_id,
        severity=severity.value if severity else None,
        finding_type=finding_type.value if finding_type else None,
        status=status.value if status else None,
        audit_run_id=audit_run_id,
    )


@router.get("/by-node/{assignment_id}")
async def list_findings_for_node(assignment_id: str) -> list[Finding]:
    return await finding_service.list_findings(assignment_id=assignment_id)


@router.delete("")
async def delete_findings(assignment_id: str | None = None) -> dict[str, int]:
    """Delete findings (and their suggestions) for one assignment or all.

    Resets nodes.status back to 'unaudited' and clears finding_count.
    """
    db = await get_db()
    if assignment_id:
        await db.execute(
            "DELETE FROM suggestions WHERE finding_id IN "
            "(SELECT id FROM findings WHERE assignment_id = ?)",
            (assignment_id,),
        )
        cursor = await db.execute(
            "DELETE FROM findings WHERE assignment_id = ?", (assignment_id,)
        )
        await db.execute(
            "UPDATE nodes SET status = 'unaudited', finding_count = 0 WHERE id = ?",
            (assignment_id,),
        )
    else:
        await db.execute("DELETE FROM suggestions")
        cursor = await db.execute("DELETE FROM findings")
        await db.execute("UPDATE nodes SET status = 'unaudited', finding_count = 0")
    await db.commit()
    return {"deleted": cursor.rowcount}
