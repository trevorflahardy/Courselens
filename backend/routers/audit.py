"""Audit run API routes with SSE streaming."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.db import get_db
from backend.models.audit import AuditRun, AuditStatus

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("/runs")
async def list_runs(
    assignment_id: str | None = None,
    status: AuditStatus | None = None,
) -> list[AuditRun]:
    db = await get_db()
    query = "SELECT * FROM audit_runs WHERE 1=1"
    params: list[object] = []

    if assignment_id is not None:
        query += " AND assignment_id = ?"
        params.append(assignment_id)
    if status is not None:
        query += " AND status = ?"
        params.append(status.value)

    query += " ORDER BY started_at DESC"
    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return [AuditRun.model_validate(dict(r), strict=False) for r in rows]


@router.get("/runs/{run_id}")
async def get_run(run_id: str) -> AuditRun:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM audit_runs WHERE id = ?", (run_id,))
    row = await cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Audit run '{run_id}' not found")
    return AuditRun.model_validate(dict(row), strict=False)


@router.post("/{assignment_id}")
async def start_audit(assignment_id: str) -> AuditRun:
    """Start an audit run for an assignment. Spawns a Claude subprocess."""
    from backend.services.node_service import get_node

    node = await get_node(assignment_id)
    if node is None:
        raise HTTPException(status_code=404, detail=f"Node '{assignment_id}' not found")

    run_id = f"run-{uuid.uuid4().hex[:8]}"
    now = datetime.now().isoformat()

    db = await get_db()
    await db.execute(
        """INSERT INTO audit_runs (id, assignment_id, status, started_at)
           VALUES (?, ?, 'running', ?)""",
        (run_id, assignment_id, now),
    )
    await db.commit()

    # TODO: Phase 2B.8 — spawn Claude subprocess via claude_runner.py
    # For now, mark as done immediately (no actual audit execution)
    await db.execute(
        "UPDATE audit_runs SET status = 'done', finished_at = ? WHERE id = ?",
        (datetime.now().isoformat(), run_id),
    )
    await db.commit()

    cursor = await db.execute("SELECT * FROM audit_runs WHERE id = ?", (run_id,))
    row = await cursor.fetchone()
    return AuditRun.model_validate(dict(row), strict=False)


@router.get("/{run_id}/stream")
async def stream_audit(run_id: str) -> StreamingResponse:
    """SSE endpoint for streaming audit progress."""
    db = await get_db()
    cursor = await db.execute("SELECT * FROM audit_runs WHERE id = ?", (run_id,))
    row = await cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Audit run '{run_id}' not found")

    async def event_generator() -> AsyncGenerator[str, None]:
        yield _sse_event("heartbeat", {"message": "connected", "run_id": run_id})

        # Poll the DB for status changes
        # In production, this will tail the Claude subprocess output
        run = AuditRun.model_validate(dict(row), strict=False)
        if run.status == AuditStatus.DONE:
            yield _sse_event("done", {"run_id": run_id, "total_findings": run.total_findings})
        elif run.status == AuditStatus.ERROR:
            yield _sse_event("error", {"message": run.error_message or "Unknown error"})
        else:
            yield _sse_event("heartbeat", {"message": "audit in progress"})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _sse_event(event_type: str, data: dict[str, object]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, default=str)}\n\n"
