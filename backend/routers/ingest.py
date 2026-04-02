"""Ingest API routes — stubs for Phase 3 implementation."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


@router.post("/course")
async def ingest_course() -> dict[str, str]:
    """Trigger course ingestion from Canvas via MCP. (Phase 3)"""
    raise HTTPException(status_code=501, detail="Course ingestion not yet implemented")


@router.post("/zip")
async def ingest_zip() -> dict[str, str]:
    """Ingest from an IMSCC ZIP export. (Phase 3)"""
    raise HTTPException(status_code=501, detail="ZIP ingestion not yet implemented")


@router.get("/status")
async def ingest_status() -> dict[str, str]:
    """Get current ingestion status. (Phase 3)"""
    return {"status": "idle", "message": "No ingestion in progress"}
