"""Graph API routes."""

from __future__ import annotations

from fastapi import APIRouter

from backend.models.graph import GraphEdge, GraphState
from backend.models.node import CourseNodeSummary
from backend.services import graph_service, node_service

router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("")
async def get_graph() -> GraphState:
    """Full graph state: all nodes (summary), active edges, and flagged nodes."""
    nodes = await node_service.list_nodes()
    edges = await graph_service.list_edges(status="active")
    flags_raw = await graph_service.get_flags()
    flags = [CourseNodeSummary.model_validate(f, strict=False) for f in flags_raw]
    return GraphState(
        nodes=[n.model_dump() for n in nodes],
        edges=edges,
        flags=[f.model_dump() for f in flags],
    )


@router.get("/node/{node_id}")
async def get_node_graph(node_id: str) -> dict[str, list[GraphEdge]]:
    """Get upstream and downstream edges for a specific node."""
    return await graph_service.get_neighbors(node_id)
