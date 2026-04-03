"""FastAPI application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
from fastapi.middleware.cors import CORSMiddleware

from backend.config import settings
from backend.db import close_db, get_db, init_db
from backend.routers import audit, findings, graph, ingest, nodes


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await init_db()
    yield
    await close_db()


app = FastAPI(
    title="Course Audit System",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(nodes.router)
app.include_router(findings.router)
app.include_router(graph.router)
app.include_router(audit.router)
app.include_router(ingest.router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/stats")
async def stats() -> dict[str, int]:
    """Dashboard summary metrics used by the frontend overview page."""
    db = await get_db()

    async def _count(query: str, params: tuple[object, ...] = ()) -> int:
        cursor = await db.execute(query, params)
        row = await cursor.fetchone()
        return int(row[0]) if row else 0

    total_nodes = await _count("SELECT COUNT(*) FROM nodes")
    gap_count = await _count("SELECT COUNT(*) FROM nodes WHERE status = ?", ("gap",))
    warn_count = await _count("SELECT COUNT(*) FROM nodes WHERE status = ?", ("warn",))
    ok_count = await _count("SELECT COUNT(*) FROM nodes WHERE status = ?", ("ok",))
    unaudited_count = await _count("SELECT COUNT(*) FROM nodes WHERE status = ?", ("unaudited",))
    total_findings = await _count("SELECT COUNT(*) FROM findings WHERE status = ?", ("active",))
    total_edges = await _count("SELECT COUNT(*) FROM edges WHERE status = ?", ("active",))

    return {
        "total_nodes": total_nodes,
        "gap_count": gap_count,
        "warn_count": warn_count,
        "ok_count": ok_count,
        "unaudited_count": unaudited_count,
        "total_findings": total_findings,
        "total_edges": total_edges,
    }
