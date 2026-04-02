"""Graph edge CRUD and NetworkX traversal."""

from __future__ import annotations

from datetime import datetime

import networkx as nx

from backend.db import get_db
from backend.models.graph import EdgeType, GraphEdge


async def add_edge(
    source: str,
    target: str,
    edge_type: EdgeType,
    label: str | None = None,
    evidence: str | None = None,
    confidence: float | None = None,
) -> GraphEdge:
    db = await get_db()
    now = datetime.now().isoformat()
    await db.execute(
        """INSERT OR REPLACE INTO edges
           (source, target, edge_type, label, evidence, confidence, status, derived_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?)""",
        (source, target, edge_type.value, label, evidence, confidence, now),
    )
    await db.commit()
    return GraphEdge(
        source=source, target=target, edge_type=edge_type,
        label=label, evidence=evidence, confidence=confidence,
    )


async def list_edges(status: str | None = None) -> list[GraphEdge]:
    db = await get_db()
    query = "SELECT * FROM edges"
    params: list[object] = []
    if status is not None:
        query += " WHERE status = ?"
        params.append(status)
    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return [GraphEdge.model_validate(dict(r), strict=False) for r in rows]


async def get_neighbors(node_id: str) -> dict[str, list[GraphEdge]]:
    """Get upstream (incoming) and downstream (outgoing) edges for a node."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM edges WHERE source = ? AND status = 'active'",
        (node_id,),
    )
    downstream = [GraphEdge.model_validate(dict(r), strict=False) for r in await cursor.fetchall()]

    cursor = await db.execute(
        "SELECT * FROM edges WHERE target = ? AND status = 'active'",
        (node_id,),
    )
    upstream = [GraphEdge.model_validate(dict(r), strict=False) for r in await cursor.fetchall()]

    return {"upstream": upstream, "downstream": downstream}


async def get_flags() -> list[dict[str, object]]:
    """Get all nodes with gap or orphan status."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT id, type, title, week, status FROM nodes WHERE status IN ('gap', 'orphan')"
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def mark_stale(node_id: str) -> int:
    """Mark all edges from/to a node as stale for re-derivation."""
    db = await get_db()
    cursor = await db.execute(
        "UPDATE edges SET status = 'stale' WHERE source = ? OR target = ?",
        (node_id, node_id),
    )
    await db.commit()
    return cursor.rowcount


async def load_networkx() -> nx.DiGraph:
    """Load all active edges into a NetworkX DiGraph for traversal."""
    edges = await list_edges(status="active")
    g = nx.DiGraph()
    for e in edges:
        g.add_edge(
            e.source, e.target,
            edge_type=e.edge_type.value,
            label=e.label,
            confidence=e.confidence,
        )
    return g
