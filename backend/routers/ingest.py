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

# Simple status tracking — includes stage, feed, and last_run after a sync completes
_ingest_status: dict[str, object] = {"status": "idle", "message": "No ingestion in progress", "feed": []}


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
        "feed": [],
    }
    asyncio.create_task(_run_canvas_sync())
    return {"status": "started"}


def _format_tool_feed(tool_name: str, tool_input: dict[str, object]) -> str | None:
    """Turn a Claude tool-use call into a human-readable feed line."""
    if "get_course_structure" in tool_name:
        return "Fetching course structure..."
    if "get_module" in tool_name:
        return f"Fetching module: {tool_input.get('module_id', '')}"
    if "list_modules" in tool_name:
        return "Listing modules..."
    if "list_module_items" in tool_name:
        return f"Listing items in module {tool_input.get('module_id', '')}"
    if "get_assignment_details" in tool_name:
        aid = tool_input.get("assignment_id", tool_input.get("id", ""))
        return f"Fetching assignment: {aid}"
    if "get_page_content" in tool_name:
        url = tool_input.get("page_url", tool_input.get("url", ""))
        return f"Fetching page: {url}"
    if "get_rubric_details" in tool_name:
        return f"Fetching rubric: {tool_input.get('rubric_id', tool_input.get('id', ''))}"
    if "download_course_file" in tool_name:
        return f"Downloading file: {tool_input.get('file_id', '')}"
    if "nodes_write" in tool_name:
        node_id = tool_input.get("node_id", "")
        title = tool_input.get("title", "")
        label = title or node_id
        return f"Saving node: {label}"
    if "nodes_link" in tool_name:
        return f"Linking {tool_input.get('source_id', '')} → {tool_input.get('target_id', '')}"
    if "nodes_read" in tool_name:
        return f"Reading node: {tool_input.get('node_id', '')}"
    return None


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
        _ingest_status["feed"] = []  # reset feed for this run

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
            _ingest_status = {"status": "error", "stage": "error", "message": str(msg), "feed": []}
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
            logger.debug("Canvas sync stream event #%d type=%s", event_count, event_type)

            if event_type == "error":
                logger.error("Canvas sync stream error: %s", event.get("message", ""))

            if event_type == "assistant":
                msg_obj = event.get("message")
                content = msg_obj.get("content", []) if isinstance(msg_obj, dict) else []
                if isinstance(content, list):
                    for block in content:
                        if not isinstance(block, dict):
                            continue

                        if block.get("type") == "tool_use":
                            tool_name = block.get("name", "")
                            tool_input = block.get("input") or {}
                            tool_input_dict = tool_input if isinstance(tool_input, dict) else {}
                            logger.debug("Canvas sync tool_use: %s input_keys=%s", tool_name, list(tool_input_dict.keys()))
                            feed_line = _format_tool_feed(tool_name, tool_input_dict)
                            if feed_line:
                                logger.info("Canvas sync feed: %s", feed_line)
                                feed = _ingest_status.get("feed")
                                if isinstance(feed, list):
                                    feed.append(feed_line)

                        if block.get("type") == "text":
                            text = block.get("text", "")
                            logger.debug("Canvas sync text: %.200s", text)
                            text_lower = text.lower()
                            for kw, stage in _KEYWORD_STAGES.items():
                                if kw in text_lower:
                                    logger.info("Canvas sync stage → %s", stage)
                                    _ingest_status.update({
                                        "status": "running",
                                        "stage": stage,
                                        "message": f"Running: {stage.replace('_', ' ')}",
                                    })
                                    break

        logger.info("Canvas sync tail_run exhausted after %d events", event_count)

        run = get_run_state(run_id)
        logger.info(
            "Canvas sync final run state: status=%s events=%d",
            run.status if run else "NOT_FOUND",
            len(run.events) if run else 0,
        )
        if run and run.status == "done":
            _ingest_status.update({
                "status": "done",
                "stage": "done",
                "last_run": datetime.now().isoformat(),
                "message": "Canvas sync complete",
            })
        else:
            # Collect the last error event message for a more useful status
            error_msg = "Canvas sync failed — check backend logs"
            if run:
                for ev in reversed(run.events):
                    if ev.get("type") == "error" and ev.get("message"):
                        error_msg = str(ev["message"])
                        break
            logger.error("Canvas sync did not complete successfully: %s", error_msg)
            _ingest_status.update({
                "status": "error",
                "stage": "error",
                "message": error_msg,
            })
    except Exception as exc:
        logger.exception("Canvas sync background task raised an unhandled exception")
        _ingest_status.update({
            "status": "error",
            "stage": "error",
            "message": str(exc),
        })


@router.get("/status")
async def ingest_status() -> dict[str, object]:
    """Get current ingestion status."""
    return _ingest_status


@router.get("/processes")
async def list_processes() -> list[dict[str, object]]:
    """Return all tracked Claude subprocesses and whether they are still alive."""
    from backend.claude_runner import _active_runs

    result = []
    for run in _active_runs.values():
        proc = run.process
        alive = proc is not None and proc.returncode is None
        result.append({
            "run_id": run.run_id,
            "assignment_id": run.assignment_id,
            "status": run.status,
            "pid": proc.pid if proc else None,
            "alive": alive,
            "started_at": run.started_at,
            "finished_at": run.finished_at,
        })
    return result


@router.post("/dedup-files")
async def dedup_files() -> dict[str, int]:
    """Find file nodes whose titles are duplicates after URL-decoding, keep the best one, delete the rest."""
    from urllib.parse import unquote_plus
    from backend.db import get_db

    db = await get_db()

    cursor = await db.execute("SELECT id, title, canvas_url, week, module, updated_at FROM nodes WHERE type = 'file'")
    rows = await cursor.fetchall()

    # Group by normalized title
    groups: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        normalized = unquote_plus(str(row["title"] or "")).strip()
        groups.setdefault(normalized, []).append(dict(row))

    merged = 0
    deleted = 0

    for _title, nodes in groups.items():
        if len(nodes) < 2:
            continue

        # Pick the "best" node: prefer one with canvas_url, then week, then most recently updated
        def _score(n: dict[str, object]) -> tuple[int, int, str]:
            return (
                1 if n.get("canvas_url") else 0,
                1 if n.get("week") is not None else 0,
                str(n.get("updated_at") or ""),
            )

        nodes.sort(key=_score, reverse=True)
        keeper_id = str(nodes[0]["id"])
        duplicate_ids = [str(n["id"]) for n in nodes[1:]]

        logger.info("Dedup: keeping %s, removing %s", keeper_id, duplicate_ids)

        for dup_id in duplicate_ids:
            # Re-point node_links
            await db.execute("UPDATE node_links SET source_id = ? WHERE source_id = ?", (keeper_id, dup_id))
            await db.execute("UPDATE node_links SET target_id = ? WHERE target_id = ?", (keeper_id, dup_id))
            # Re-point findings and audit_runs
            await db.execute("UPDATE findings SET assignment_id = ? WHERE assignment_id = ?", (keeper_id, dup_id))
            await db.execute("UPDATE audit_runs SET assignment_id = ? WHERE assignment_id = ?", (keeper_id, dup_id))
            # Re-point edges
            await db.execute("UPDATE edges SET source = ? WHERE source = ?", (keeper_id, dup_id))
            await db.execute("UPDATE edges SET target = ? WHERE target = ?", (keeper_id, dup_id))
            # Delete duplicate (node_links with both ends == keeper become duplicates; ignore constraint)
            await db.execute("DELETE FROM node_links WHERE source_id = target_id")
            await db.execute("DELETE FROM nodes WHERE id = ?", (dup_id,))
            deleted += 1

        merged += 1

    await db.commit()
    return {"groups_merged": merged, "nodes_deleted": deleted}


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
