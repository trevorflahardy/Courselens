"""Audit MCP Server — exposes course audit tools via FastMCP.

Two namespaces mounted into a single composite server:
  - nodes: Course node CRUD (read, write/upsert, list, read_many, link, get_stale)
  - emit:  Finding emission (emit_finding, emit_resolve_stale)

Graph logic lives in backend/services/graph_service.py and is called
internally by FastAPI routes and the audit engine — not exposed as MCP tools.

Run standalone:  python -m audit_mcp.audit_mcp
Or mount into Claude Code via settings.json.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
from fastmcp import FastMCP

# Ensure project root is importable
_project_root = str(Path(__file__).parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from backend.db import init_db  # noqa: E402
from backend.services import node_service  # noqa: E402

# FastAPI base URL — emit_* tools POST here instead of writing to SQLite directly.
# This makes FastAPI the single DB writer, eliminating cross-process lock contention.
_API_BASE = os.getenv("AUDIT_API_URL", "http://localhost:8000")

# ---------------------------------------------------------------------------
# Namespace: nodes
# ---------------------------------------------------------------------------
nodes_mcp = FastMCP("audit-nodes")


@nodes_mcp.tool()
async def nodes_read(node_id: str) -> str:
    """Read a single course node by ID. Returns full node data as JSON."""
    await _ensure_db()
    node = await node_service.get_node(node_id)
    if node is None:
        return json.dumps({"error": f"Node '{node_id}' not found"})
    return node.model_dump_json()


@nodes_mcp.tool()
async def nodes_write(
    node_id: str,
    node_type: str,
    title: str,
    description: str | None = None,
    week: int | None = None,
    module: str | None = None,
    module_order: int | None = None,
    points_possible: float | None = None,
    submission_types: str | None = None,
    rubric_id: str | None = None,
    canvas_url: str | None = None,
    source: str = "canvas_mcp",
) -> str:
    """Upsert a course node. Creates if new, merges if existing.

    Args:
        submission_types: JSON array string, e.g. '["online_upload"]'
    """
    await _ensure_db()
    data: dict[str, object] = {
        "type": node_type,
        "title": title,
        "source": source,
    }
    if description is not None:
        data["description"] = description
    if week is not None:
        data["week"] = week
    if module is not None:
        data["module"] = module
    if module_order is not None:
        data["module_order"] = module_order
    if points_possible is not None:
        data["points_possible"] = points_possible
    if submission_types is not None:
        data["submission_types"] = json.loads(submission_types)
    if rubric_id is not None:
        data["rubric_id"] = rubric_id
    if canvas_url is not None:
        data["canvas_url"] = canvas_url

    node = await node_service.upsert_node(node_id, data)
    return node.model_dump_json()


@nodes_mcp.tool()
async def nodes_list(
    node_type: str | None = None,
    week: int | None = None,
    status: str | None = None,
) -> str:
    """List course nodes with optional filters. Returns array of node summaries."""
    await _ensure_db()
    nodes = await node_service.list_nodes(node_type=node_type, week=week, status=status)
    return json.dumps([n.model_dump() for n in nodes], default=str)


@nodes_mcp.tool()
async def nodes_read_many(node_ids: str) -> str:
    """Read multiple nodes by ID. node_ids is a JSON array string, e.g. '["id1","id2"]'."""
    await _ensure_db()
    ids = json.loads(node_ids)
    nodes = await node_service.get_nodes_many(ids)
    return json.dumps([n.model_dump() for n in nodes], default=str)


@nodes_mcp.tool()
async def nodes_link(source_id: str, target_id: str, link_type: str) -> str:
    """Create a node-to-node link (file, page, assignment, external)."""
    await _ensure_db()
    link = await node_service.link_nodes(source_id, target_id, link_type)
    return link.model_dump_json()


@nodes_mcp.tool()
async def nodes_get_stale() -> str:
    """Get nodes whose content changed since their last audit."""
    await _ensure_db()
    stale = await node_service.get_stale_nodes()
    return json.dumps([n.model_dump() for n in stale], default=str)


# ---------------------------------------------------------------------------
# Namespace: emit
# ---------------------------------------------------------------------------
emit_mcp = FastMCP("audit-emit")


@emit_mcp.tool()
async def emit_finding(
    assignment_id: str,
    audit_run_id: str,
    severity: str,
    finding_type: str,
    title: str,
    body: str,
    pass_number: int,
    linked_node: str | None = None,
    evidence: str | None = None,
) -> str:
    """Emit an audit finding. Records the node's current content_hash for change detection."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{_API_BASE}/internal/findings",
                json={
                    "assignment_id": assignment_id,
                    "audit_run_id": audit_run_id,
                    "severity": severity,
                    "finding_type": finding_type,
                    "title": title,
                    "body": body,
                    "pass_number": pass_number,
                    "linked_node": linked_node,
                    "evidence": evidence,
                },
                timeout=30,
            )
            r.raise_for_status()
            return r.text
    except httpx.HTTPError as e:
        return json.dumps({"error": f"emit_finding failed: {e}"})


@emit_mcp.tool()
async def emit_checkpoint(
    audit_run_id: str,
    pass_number: int,
    summary: str,
) -> str:
    """Record that a pass is complete. Called by Claude at the end of each audit pass.

    Idempotent — uses MAX so a re-call never decrements completed_passes.
    """
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{_API_BASE}/internal/checkpoints",
                json={"audit_run_id": audit_run_id, "pass_number": pass_number, "summary": summary},
                timeout=10,
            )
            r.raise_for_status()
            return r.text
    except httpx.HTTPError as e:
        return json.dumps({"error": f"emit_checkpoint failed: {e}"})


@emit_mcp.tool()
async def emit_resolve_stale(assignment_id: str) -> str:
    """After re-audit: resolve unmatched stale findings, confirm matched ones."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{_API_BASE}/internal/resolve-stale",
                json={"assignment_id": assignment_id},
                timeout=10,
            )
            r.raise_for_status()
            return r.text
    except httpx.HTTPError as e:
        return json.dumps({"error": f"emit_resolve_stale failed: {e}"})


# ---------------------------------------------------------------------------
# Composite server
# ---------------------------------------------------------------------------
mcp = FastMCP("course-audit")
mcp.mount(nodes_mcp, namespace="nodes")
mcp.mount(emit_mcp, namespace="emit")

# DB initialization flag
_db_ready = False


async def _ensure_db() -> None:
    global _db_ready  # noqa: PLW0603
    if not _db_ready:
        await init_db()
        _db_ready = True


if __name__ == "__main__":
    mcp.run()
