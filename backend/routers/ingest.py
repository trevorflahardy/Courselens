"""Ingest API routes — ZIP import and graph rebuild."""

from __future__ import annotations

import logging
import tempfile
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.services.ingest.canvas_zip import ingest_zip as do_ingest_zip
from backend.services.ingest.graph_builder import rebuild_graph

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

# Simple status tracking
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
    """Trigger course ingestion from Canvas via MCP.

    Note: Canvas MCP ingestion is orchestrated by Claude Code subprocess,
    not directly by this API. This endpoint will trigger that process.
    """
    raise HTTPException(
        status_code=501,
        detail="Canvas live ingestion is orchestrated via Claude Code CLI. Use /ingest-course slash command.",
    )


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
