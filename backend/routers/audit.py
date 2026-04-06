"""Audit run API routes with SSE streaming."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.db import get_db
from backend.models.audit import AuditRun, AuditStatus
from backend.services.audit_engine import (
    AuditProgress,
    run_audit_all,
    run_single_audit,
    summarize_findings,
)
from backend.claude_runner import cancel_runs_with_prefix

router = APIRouter(prefix="/api/audit", tags=["audit"])

# Track in-flight audit tasks for SSE streaming
_audit_tasks: dict[str, asyncio.Task[AuditProgress]] = {}
_audit_progress: dict[str, AuditProgress] = {}
_batch_audit_active: bool = False


async def _mark_run_error(run_id: str, message: str) -> None:
    """Write status='error' to DB for a run that is still 'running'. Idempotent."""
    db = await get_db()
    await db.execute(
        "UPDATE audit_runs SET status = 'error', finished_at = datetime('now'), "
        "error_message = ? WHERE id = ? AND status = 'running'",
        (message[:500], run_id),
    )
    await db.commit()


def _make_audit_done_callback(run_id: str):  # type: ignore[return]
    """Return a Task done-callback that reconciles DB when a task ends unexpectedly.

    This fires unconditionally when the asyncio Task completes (success, exception,
    or cancellation), giving us a belt-and-suspenders guarantee that no run stays
    stuck in 'running' due to an unhandled exception or task cancellation.
    """
    def _callback(task: asyncio.Task[AuditProgress]) -> None:
        if task.cancelled():
            asyncio.ensure_future(_mark_run_error(run_id, "Audit task was cancelled"))
        elif task.exception() is not None:
            exc = task.exception()
            asyncio.ensure_future(_mark_run_error(run_id, f"Audit task raised: {exc}"))
        # Success path: run_single_audit's finalize block already wrote status='done'
    return _callback


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


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str) -> AuditRun:
    """Cancel a running audit run and mark it as errored/cancelled."""
    db = await get_db()
    cursor = await db.execute("SELECT * FROM audit_runs WHERE id = ?", (run_id,))
    row = await cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Audit run '{run_id}' not found")

    run = AuditRun.model_validate(dict(row), strict=False)
    if run.status != AuditStatus.RUNNING:
        return run

    task = _audit_tasks.get(run_id)
    if task is not None and not task.done():
        task.cancel()

    # Cancel any in-flight per-pass subprocesses linked to this run.
    await cancel_runs_with_prefix(run_id)

    progress = _audit_progress.get(run_id)
    if progress is not None:
        progress.status = "error"
        progress.events.append(
            {"type": "error", "message": "Run cancelled by user", "run_id": run_id}
        )

    finished_at = datetime.now().isoformat()
    await db.execute(
        """UPDATE audit_runs
           SET status = 'error',
               finished_at = ?,
               error_message = ?
           WHERE id = ?""",
        (finished_at, "Run cancelled by user", run_id),
    )
    await db.commit()

    # Ensure completed/cancelled tasks are no longer tracked as in-flight.
    _audit_tasks.pop(run_id, None)

    cursor = await db.execute("SELECT * FROM audit_runs WHERE id = ?", (run_id,))
    updated = await cursor.fetchone()
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Audit run '{run_id}' not found after cancel")
    return AuditRun.model_validate(dict(updated), strict=False)


@router.post("/runs/{run_id}/resume")
async def resume_audit(run_id: str) -> AuditRun:
    """Resume a paused audit run from where it left off."""
    db = await get_db()
    cursor = await db.execute("SELECT * FROM audit_runs WHERE id = ?", (run_id,))
    row = await cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Audit run '{run_id}' not found")

    run = AuditRun.model_validate(dict(row), strict=False)
    if run.status != AuditStatus.PAUSED:
        raise HTTPException(
            status_code=409,
            detail=f"Run '{run_id}' is not paused (status: {run.status}). Only paused runs can be resumed.",
        )

    start_pass = (run.completed_passes or 0) + 1
    if start_pass > 3:
        raise HTTPException(status_code=409, detail="All passes already completed — nothing to resume.")

    # Mark as running again
    await db.execute(
        "UPDATE audit_runs SET status = 'running', paused_at = NULL WHERE id = ?",
        (run_id,),
    )
    await db.commit()

    # Re-register progress tracker so SSE can stream the resumed run
    _audit_progress[run_id] = AuditProgress(
        run_id=run_id,
        assignment_id=run.assignment_id,
        completed_passes=run.completed_passes or 0,
    )

    async def _resume() -> AuditProgress:
        progress = await run_single_audit(run.assignment_id, run_id=run_id, start_pass=start_pass)
        _audit_progress[run_id] = progress
        _audit_tasks.pop(run_id, None)
        return progress

    task = asyncio.create_task(_resume())
    task.add_done_callback(_make_audit_done_callback(run_id))
    _audit_tasks[run_id] = task

    await asyncio.sleep(0.1)

    cursor = await db.execute("SELECT * FROM audit_runs WHERE id = ?", (run_id,))
    updated = await cursor.fetchone()
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Audit run '{run_id}' not found after resume")
    return AuditRun.model_validate(dict(updated), strict=False)


@router.post("/all")
async def start_audit_all(batch_size: int = 4) -> dict[str, object]:
    """Run audits on all assignment nodes in parallel batches."""
    global _batch_audit_active

    if _batch_audit_active:
        raise HTTPException(status_code=409, detail="A full-course audit is already running.")

    db = await get_db()
    cursor = await db.execute("SELECT COUNT(*) FROM audit_runs WHERE status = 'running'")
    running_count_row = await cursor.fetchone()
    running_count = int(running_count_row[0]) if running_count_row and running_count_row[0] else 0
    if running_count > 0:
        raise HTTPException(
            status_code=409,
            detail="One or more audits are already running. Stop them before running Audit All.",
        )

    _batch_audit_active = True
    try:
        return await run_audit_all(batch_size=batch_size)
    finally:
        _batch_audit_active = False


@router.post("/{assignment_id}")
async def start_audit(assignment_id: str) -> AuditRun:
    """Start an audit run for an assignment. Spawns a Claude subprocess."""
    from backend.services.node_service import get_node

    node = await get_node(assignment_id)
    if node is None:
        raise HTTPException(status_code=404, detail=f"Node '{assignment_id}' not found")

    if _batch_audit_active:
        raise HTTPException(
            status_code=409,
            detail="A full-course audit is currently running. Wait for it to finish.",
        )

    db = await get_db()
    cursor = await db.execute(
        "SELECT id, status FROM audit_runs WHERE assignment_id = ? AND status IN ('running','paused') LIMIT 1",
        (assignment_id,),
    )
    existing = await cursor.fetchone()
    if existing is not None:
        existing_status = str(existing[1])
        if existing_status == "paused":
            raise HTTPException(
                status_code=409,
                detail=(
                    f"A paused audit exists for '{assignment_id}' (run: {existing[0]}). "
                    "Resume it via POST /api/audit/runs/{run_id}/resume or cancel it first."
                ),
            )
        raise HTTPException(
            status_code=409,
            detail=f"An audit is already running for '{assignment_id}'.",
        )

    run_id = f"run-{uuid.uuid4().hex[:8]}"

    # Launch the audit in the background so the POST returns immediately
    # Pre-create progress so SSE can stream events as they arrive
    _audit_progress[run_id] = AuditProgress(run_id=run_id, assignment_id=assignment_id)

    async def _run() -> AuditProgress:
        progress = await run_single_audit(assignment_id, run_id=run_id)
        _audit_progress[run_id] = progress
        _audit_tasks.pop(run_id, None)
        return progress

    task = asyncio.create_task(_run())
    task.add_done_callback(_make_audit_done_callback(run_id))
    _audit_tasks[run_id] = task

    # Wait briefly for the run record to be inserted by run_single_audit
    await asyncio.sleep(0.1)

    cursor = await db.execute("SELECT * FROM audit_runs WHERE id = ?", (run_id,))
    row = await cursor.fetchone()
    if row is None:
        # run_single_audit creates the record; if not yet, return a synthetic one
        now = datetime.now().isoformat()
        return AuditRun(
            id=run_id,
            assignment_id=assignment_id,
            status=AuditStatus.RUNNING,
            started_at=datetime.fromisoformat(now),
        )
    return AuditRun.model_validate(dict(row), strict=False)


@router.get("/state")
async def get_audit_runtime_state() -> dict[str, object]:
    """Return aggregate runtime state for frontend lock/disable behavior."""
    db = await get_db()
    cursor = await db.execute("SELECT assignment_id FROM audit_runs WHERE status = 'running'")
    running_rows = await cursor.fetchall()
    running_assignment_ids = sorted({str(row[0]) for row in running_rows})
    return {
        "batch_active": _batch_audit_active,
        "running_count": len(running_assignment_ids),
        "running_assignment_ids": running_assignment_ids,
    }


@router.get("/summary")
async def get_summary() -> dict[str, object]:
    """Get a course-level summary of all findings."""
    return await summarize_findings()


@router.get("/{run_id}/stream")
async def stream_audit(run_id: str) -> StreamingResponse:
    """SSE endpoint for streaming audit progress.

    If the audit is in-flight (tracked in _audit_progress or _audit_tasks),
    streams live events. Otherwise, polls the DB for final status.
    """
    db = await get_db()
    cursor = await db.execute("SELECT * FROM audit_runs WHERE id = ?", (run_id,))
    row = await cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Audit run '{run_id}' not found")

    async def event_generator() -> AsyncGenerator[str, None]:
        yield _sse_event("heartbeat", {"message": "connected", "run_id": run_id})

        # If there's an in-flight task, stream its events
        seen_events = 0
        task = _audit_tasks.get(run_id)
        if task is not None:
            while not task.done():
                progress = _audit_progress.get(run_id)
                if progress and len(progress.events) > seen_events:
                    for event in progress.events[seen_events:]:
                        yield _sse_event(
                            str(event.get("type", "heartbeat")),
                            event,
                        )
                    seen_events = len(progress.events)
                else:
                    yield _sse_event("heartbeat", {"message": "audit in progress"})
                await asyncio.sleep(0.25)

            # Emit any remaining events after task completes
            progress = _audit_progress.get(run_id)
            if progress:
                for event in progress.events[seen_events:]:
                    yield _sse_event(str(event.get("type", "heartbeat")), event)
                if progress.status == "error":
                    yield _sse_event(
                        "error",
                        {
                            "message": "Run cancelled by user"
                            if any(
                                event.get("message") == "Run cancelled by user"
                                for event in progress.events
                            )
                            else "Audit run failed",
                            "run_id": run_id,
                        },
                    )
                else:
                    yield _sse_event(
                        "done",
                        {
                            "run_id": run_id,
                            "total_findings": (
                                progress.pass1_findings
                                + progress.pass2_findings
                                + progress.pass3_findings
                            ),
                        },
                    )
                return

        # No in-flight task — check DB for completed/errored run
        db2 = await get_db()
        cursor2 = await db2.execute("SELECT * FROM audit_runs WHERE id = ?", (run_id,))
        row2 = await cursor2.fetchone()
        if row2:
            run = AuditRun.model_validate(dict(row2), strict=False)
            if run.status == AuditStatus.DONE:
                yield _sse_event(
                    "done",
                    {
                        "run_id": run_id,
                        "total_findings": run.total_findings,
                    },
                )
            elif run.status == AuditStatus.ERROR:
                yield _sse_event(
                    "error",
                    {
                        "message": run.error_message or "Unknown error",
                    },
                )
            elif run.status == AuditStatus.PAUSED:
                yield _sse_event(
                    "error",
                    {
                        "message": f"Audit paused (rate limited after pass {run.completed_passes}). "
                                   f"Resume via POST /api/audit/runs/{run_id}/resume",
                        "paused": True,
                        "completed_passes": run.completed_passes,
                    },
                )
            else:
                # Run is 'running' in DB but has no in-flight asyncio task.
                # This is a mid-session zombie — it will never complete on its own.
                # The task done-callback or startup cleanup should have caught this,
                # but we emit error here as a defensive fallback for the SSE client.
                yield _sse_event("error", {
                    "message": "Audit run has no active task — likely interrupted",
                    "orphaned": True,
                })

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _sse_event(event_type: str, data: dict[str, object]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, default=str)}\n\n"
