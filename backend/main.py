"""FastAPI application entry point."""

from __future__ import annotations

import logging
import subprocess
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
from backend.routers import (
    audit,
    changelog,
    findings,
    graph,
    ingest,
    internal,
    nodes,
    suggestions,
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await init_db()

    # Kill any lingering audit Claude subprocesses from a previous server session.
    # They're identifiable by --allowedTools mcp__audit__ which only our audit
    # engine passes. This also releases any SQLite write locks they hold.
    _log = logging.getLogger(__name__)
    try:
        result = subprocess.run(
            ["pgrep", "-f", "mcp__audit__"],
            capture_output=True, text=True, timeout=3,
        )
        pids = [p.strip() for p in result.stdout.splitlines() if p.strip()]
        if pids:
            subprocess.run(["kill", "-TERM", *pids], timeout=3, check=False)
            _log.warning("Sent SIGTERM to %d orphaned audit subprocess(es): %s", len(pids), pids)
    except Exception as exc:  # noqa: BLE001
        _log.debug("Orphan Claude cleanup skipped: %s", exc)

    # On startup, any run still marked 'running' in the DB is an orphan from
    # a previous server session. The asyncio tasks and subprocesses are gone —
    # mark them as errored so they don't block new audits or show a false pulse.
    db = await get_db()
    cursor = await db.execute("SELECT COUNT(*) FROM audit_runs WHERE status = 'running'")
    row = await cursor.fetchone()
    orphan_count = int(row[0]) if row else 0
    if orphan_count > 0:
        await db.execute(
            """UPDATE audit_runs
               SET status = 'error',
                   finished_at = datetime('now'),
                   error_message = 'Server restarted — run interrupted'
               WHERE status = 'running'"""
        )
        await db.commit()
        logging.getLogger(__name__).warning(
            "Cleaned up %d orphaned running audit run(s) on startup", orphan_count
        )

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
app.include_router(suggestions.router)
app.include_router(changelog.router)
app.include_router(internal.router)


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
