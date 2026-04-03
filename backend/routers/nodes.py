"""Node API routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from backend.models.node import CourseNode, CourseNodeSummary, NodeLink, NodeStatus, NodeType
from backend.services import node_service

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


class NodeUpdate(BaseModel):
    """API input model — no strict mode so JSON strings coerce to enums."""

    title: str | None = None
    description: str | None = None
    week: int | None = None
    module: str | None = None
    module_order: int | None = None
    points_possible: float | None = None
    submission_types: list[str] | None = None
    rubric_id: str | None = None
    status: NodeStatus | None = None
    canvas_url: str | None = None


class NodeLinkCreate(BaseModel):
    """Create a directed link between two existing nodes."""

    target_id: str
    link_type: str


@router.get("")
async def list_nodes(
    type: NodeType | None = None,
    week: int | None = None,
    status: NodeStatus | None = None,
) -> list[CourseNodeSummary]:
    return await node_service.list_nodes(
        node_type=type.value if type else None,
        week=week,
        status=status.value if status else None,
    )


@router.get("/stale")
async def get_stale_nodes() -> list[CourseNodeSummary]:
    return await node_service.get_stale_nodes()


@router.get("/all-links")
async def list_all_node_links() -> list[NodeLink]:
    return await node_service.list_node_links()


@router.get("/{node_id}")
async def get_node(node_id: str) -> CourseNode:
    node = await node_service.get_node(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    return node


@router.patch("/{node_id}")
async def update_node(node_id: str, body: NodeUpdate) -> CourseNode:
    existing = await node_service.get_node(node_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    data = body.model_dump(exclude_none=True)
    if not data:
        return existing

    node = await node_service.upsert_node(node_id, data)
    return node


@router.post("/{node_id}/links")
async def create_node_link(node_id: str, body: NodeLinkCreate) -> dict[str, str]:
    source = await node_service.get_node(node_id)
    if source is None:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    target = await node_service.get_node(body.target_id)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Node '{body.target_id}' not found")

    link = await node_service.link_nodes(node_id, body.target_id, body.link_type)
    return {
        "source_id": link.source_id,
        "target_id": link.target_id,
        "link_type": link.link_type,
    }


@router.get("/{node_id}/links")
async def list_node_links(node_id: str) -> list[NodeLink]:
    node = await node_service.get_node(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    return await node_service.get_node_links(node_id)
