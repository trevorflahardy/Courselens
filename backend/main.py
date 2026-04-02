"""FastAPI application entry point."""

from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import settings
from backend.db import close_db, init_db
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
