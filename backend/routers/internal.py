"""Internal HTTP API — called by the Audit MCP server to write findings.

These endpoints are NOT part of the public API. They exist solely to make
FastAPI the single SQLite writer, eliminating lock contention between the
FastAPI process and the Audit MCP server process.

Not mounted under /api/ — the separate prefix signals these are not
user-facing endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from backend.db import get_db
from backend.models.finding import FindingCreate, FindingSeverity, FindingType
from backend.services import finding_service

router = APIRouter(prefix="/internal", tags=["internal"])


class _FindingPayload(BaseModel):
    assignment_id: str
    audit_run_id: str
    severity: str
    finding_type: str
    title: str
    body: str
    linked_node: str | None = None
    evidence: str | None = None
    pass_number: int


class _CheckpointPayload(BaseModel):
    audit_run_id: str
    pass_number: int
    summary: str


class _ResolveStalePayload(BaseModel):
    assignment_id: str


@router.post("/findings")
async def create_finding(payload: _FindingPayload) -> dict[str, object]:
    data = FindingCreate(
        assignment_id=payload.assignment_id,
        audit_run_id=payload.audit_run_id,
        severity=FindingSeverity(payload.severity),
        finding_type=FindingType(payload.finding_type),
        title=payload.title,
        body=payload.body,
        linked_node=payload.linked_node,
        evidence=payload.evidence,
        pass_number=payload.pass_number,
    )
    finding = await finding_service.create_finding(data)
    return finding.model_dump(mode="json")


@router.post("/checkpoints")
async def record_checkpoint(payload: _CheckpointPayload) -> dict[str, object]:
    db = await get_db()
    await db.execute(
        "UPDATE audit_runs SET completed_passes = MAX(completed_passes, ?) WHERE id = ?",
        (payload.pass_number, payload.audit_run_id),
    )
    await db.commit()
    return {
        "ok": True,
        "audit_run_id": payload.audit_run_id,
        "pass_number": payload.pass_number,
        "summary": payload.summary,
    }


@router.post("/resolve-stale")
async def resolve_stale(payload: _ResolveStalePayload) -> dict[str, int]:
    return await finding_service.resolve_stale_findings(payload.assignment_id)
