"""Ingest API routes — ZIP import, Canvas live sync, and graph rebuild."""

from __future__ import annotations

import asyncio
import logging
import tempfile
import uuid
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.services.ingest.canvas_zip import ingest_zip as do_ingest_zip
from backend.services.ingest.graph_builder import rebuild_graph

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

# Simple status tracking — includes stage and last_run after a sync completes
_ingest_status: dict[str, object] = {"status": "idle", "message": "No ingestion in progress"}


@router.post("/zip")
async def ingest_zip(
    zip_filename: str = "course_files_export.zip",
    file: UploadFile | None = File(default=None),
) -> dict[str, object]:
    """Ingest from either an uploaded ZIP file or a ZIP already stored in data/."""
    global _ingest_status
    temp_zip: Path | None = None

    if file is not None:
        suffix = Path(file.filename or "upload.zip").suffix or ".zip"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        try:
            contents = await file.read()
            tmp.write(contents)
            tmp.flush()
        finally:
            tmp.close()
        temp_zip = Path(tmp.name)
        zip_path = temp_zip
        display_name = file.filename or temp_zip.name
    else:
        zip_path = Path("data") / zip_filename
        display_name = zip_filename
        if not zip_path.exists():
            raise HTTPException(status_code=404, detail=f"ZIP file not found: {zip_path}")

    _ingest_status = {"status": "running", "message": f"Ingesting {display_name}..."}

    try:
        result = await do_ingest_zip(str(zip_path))
        _ingest_status = {
            "status": "done",
            "message": f"Ingested {result.nodes_created} nodes from {result.files_extracted} files",
        }
        return asdict(result)
    except Exception as e:
        logger.exception("ZIP ingestion failed")
        _ingest_status = {"status": "error", "message": str(e)}
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if temp_zip is not None:
            try:
                temp_zip.unlink(missing_ok=True)
            except Exception:
                logger.warning("Failed to remove temporary uploaded ZIP: %s", temp_zip)


@router.post("/rebuild-graph")
async def api_rebuild_graph() -> dict[str, object]:
    """Rebuild the dependency graph from current node data."""
    try:
        result = await rebuild_graph()
        return asdict(result)
    except Exception as e:
        logger.exception("Graph rebuild failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/course")
async def ingest_course() -> dict[str, str]:
    """Trigger Canvas live sync. Fires a background Claude subprocess; poll /status for progress."""
    global _ingest_status

    if _ingest_status.get("status") == "running":
        return {"status": "already_running"}

    _ingest_status = {
        "status": "running",
        "stage": "fetching_modules",
        "message": "Canvas sync starting...",
    }
    asyncio.create_task(_run_canvas_sync())
    return {"status": "started"}


def _build_canvas_sync_prompt(course_id: str) -> str:
    return f"""You are ingesting Canvas course {course_id} into the audit database.

Follow these steps in order:

1. Call mcp__canvas-api__get_course_structure with course_id="{course_id}" to get all modules and items.

2. For each module item, fetch full details:
   - Assignments / Quizzes: call mcp__canvas-api__get_assignment_details
   - Pages / WikiPages: call mcp__canvas-api__get_page_content
   - Files: use the title and URL as-is

3. Upsert each item using nodes_write:
   - node_id: "assignment-{{canvas_id}}", "page-{{page_url_slug}}", "file-{{canvas_id}}", "quiz-{{canvas_id}}"
   - source: "canvas_mcp"
   - week: parse from the module name (e.g. "Week 5 - Design" → week=5), else null
   - module: the full module name string
   - canvas_url: the item HTML URL
   - If re-syncing, nodes_write will upsert and overwrite existing data.

4. For each assignment that has a rubric_id, call mcp__canvas-api__get_rubric_details, upsert a rubric node (type="rubric"), then call nodes_link to connect assignment → rubric.

Process ALL modules and ALL items — do not skip any.

When finished, output exactly this JSON on its own line:
{{"status":"done","modules":N,"assignments":N,"pages":N,"files":N,"rubrics":N}}"""


async def _run_canvas_sync() -> None:
    """Background task: spawns Claude to sync Canvas data into the audit DB via MCP tools."""
    global _ingest_status
    from backend.claude_runner import get_run_state, start_audit_run, tail_run
    from backend.config import settings

    course_id = settings.canvas_course_id
    if not course_id:
        logger.error("Canvas sync aborted: canvas_course_id is not set in .env")
        _ingest_status = {
            "status": "error",
            "stage": "error",
            "message": "canvas_course_id not set in .env",
        }
        return

    run_id = f"canvas-sync-{uuid.uuid4().hex[:8]}"
    logger.info("Canvas sync starting: run_id=%s course_id=%s", run_id, course_id)

    try:
        state = await start_audit_run(
            run_id=run_id,
            assignment_id="canvas-sync",
            prompt=_build_canvas_sync_prompt(course_id),
            allowed_tools=None,  # allow all MCP tools
        )

        if state.status == "error":
            # start_audit_run already logged the cause (e.g. CLI not found)
            last_event = state.events[-1] if state.events else {}
            msg = last_event.get("message", "Failed to start Claude subprocess")
            logger.error("Canvas sync could not start subprocess: %s", msg)
            _ingest_status = {"status": "error", "stage": "error", "message": str(msg)}
            return

        logger.debug("Claude subprocess started: pid=%s", state.process.pid if state.process else "N/A")

        _KEYWORD_STAGES: dict[str, str] = {
            "rubric": "processing_rubrics",
            "assignment": "extracting_assignments",
            "page": "extracting_assignments",
            "graph": "building_graph",
            "edge": "building_graph",
        }

        event_count = 0
        async for event in tail_run(run_id):
            event_count += 1
            event_type = event.get("type", "unknown")
            logger.debug("Canvas sync event #%d: type=%s", event_count, event_type)

            if event_type == "error":
                logger.error("Claude reported error during canvas sync: %s", event.get("message", ""))

            if event_type == "assistant":
                msg = event.get("message")
                content = msg.get("content", []) if isinstance(msg, dict) else []
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            text = block.get("text", "").lower()
                            logger.debug("Claude text snippet: %.120s", text)
                            for kw, stage in _KEYWORD_STAGES.items():
                                if kw in text:
                                    logger.info("Canvas sync stage transition → %s", stage)
                                    _ingest_status = {
                                        "status": "running",
                                        "stage": stage,
                                        "message": f"Running: {stage.replace('_', ' ')}",
                                    }
                                    break

        logger.info("Canvas sync tail_run exhausted after %d events", event_count)

        run = get_run_state(run_id)
        logger.info(
            "Canvas sync final run state: status=%s events=%d",
            run.status if run else "NOT_FOUND",
            len(run.events) if run else 0,
        )
        if run and run.status == "done":
            _ingest_status = {
                "status": "done",
                "stage": "done",
                "last_run": datetime.now().isoformat(),
                "message": "Canvas sync complete",
            }
        else:
            # Collect the last error event message for a more useful status
            error_msg = "Canvas sync failed — check backend logs"
            if run:
                for ev in reversed(run.events):
                    if ev.get("type") == "error" and ev.get("message"):
                        error_msg = str(ev["message"])
                        break
            logger.error("Canvas sync did not complete successfully: %s", error_msg)
            _ingest_status = {
                "status": "error",
                "stage": "error",
                "message": error_msg,
            }
    except Exception as exc:
        logger.exception("Canvas sync background task raised an unhandled exception")
        _ingest_status = {
            "status": "error",
            "stage": "error",
            "message": str(exc),
        }


@router.get("/status")
async def ingest_status() -> dict[str, object]:
    """Get current ingestion status."""
    return _ingest_status


@router.post("/cleanup-test-data")
async def cleanup_test_data() -> dict[str, int]:
    """Remove demo/seed data that predates real Canvas ingestion.

    The cleanup targets records with source='seed' and their dependent rows.
    """
    from backend.db import get_db

    db = await get_db()

    cursor = await db.execute("SELECT id FROM nodes WHERE source = 'seed'")
    node_rows = await cursor.fetchall()
    node_ids = [str(row[0]) for row in node_rows]

    if not node_ids:
        return {
            "nodes_deleted": 0,
            "edges_deleted": 0,
            "links_deleted": 0,
            "findings_deleted": 0,
            "audit_runs_deleted": 0,
            "rubrics_deleted": 0,
        }

    placeholders = ",".join("?" for _ in node_ids)

    async def _delete_count(query: str, params: tuple[object, ...]) -> int:
        cursor_local = await db.execute(query, params)
        return cursor_local.rowcount if cursor_local.rowcount >= 0 else 0

    findings_deleted = await _delete_count(
        f"DELETE FROM findings WHERE assignment_id IN ({placeholders})",
        tuple(node_ids),
    )

    audit_runs_deleted = await _delete_count(
        f"DELETE FROM audit_runs WHERE assignment_id IN ({placeholders})",
        tuple(node_ids),
    )

    edges_deleted = await _delete_count(
        f"DELETE FROM edges WHERE source IN ({placeholders}) OR target IN ({placeholders})",
        tuple(node_ids + node_ids),
    )

    links_deleted = await _delete_count(
        f"DELETE FROM node_links WHERE source_id IN ({placeholders}) OR target_id IN ({placeholders})",
        tuple(node_ids + node_ids),
    )

    rubrics_deleted = await _delete_count(
        "DELETE FROM rubrics WHERE id IN (SELECT rubric_id FROM nodes WHERE source = 'seed' AND rubric_id IS NOT NULL) "
        "OR assignment_id IN (SELECT id FROM nodes WHERE source = 'seed')",
        (),
    )

    nodes_deleted = await _delete_count(
        f"DELETE FROM nodes WHERE id IN ({placeholders})",
        tuple(node_ids),
    )

    await db.commit()

    return {
        "nodes_deleted": nodes_deleted,
        "edges_deleted": edges_deleted,
        "links_deleted": links_deleted,
        "findings_deleted": findings_deleted,
        "audit_runs_deleted": audit_runs_deleted,
        "rubrics_deleted": rubrics_deleted,
    }
