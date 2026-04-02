"""Ingest API routes — ZIP import and graph rebuild."""

from __future__ import annotations

import logging
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, HTTPException

from backend.services.ingest.canvas_zip import ingest_zip as do_ingest_zip
from backend.services.ingest.graph_builder import rebuild_graph

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

# Simple status tracking
_ingest_status: dict[str, object] = {"status": "idle", "message": "No ingestion in progress"}


@router.post("/zip")
async def ingest_zip(zip_filename: str = "course_files_export.zip") -> dict[str, object]:
    """Ingest from a Canvas course files ZIP export in data/."""
    global _ingest_status
    zip_path = Path("data") / zip_filename

    if not zip_path.exists():
        raise HTTPException(status_code=404, detail=f"ZIP file not found: {zip_path}")

    _ingest_status = {"status": "running", "message": f"Ingesting {zip_filename}..."}

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
