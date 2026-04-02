"""Dependency graph models."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class EdgeType(StrEnum):
    EXPLICIT = "explicit"
    INFERRED = "inferred"
    ARTIFACT = "artifact"
    GAP = "gap"


class EdgeStatus(StrEnum):
    ACTIVE = "active"
    STALE = "stale"


class GraphEdge(BaseModel):
    model_config = ConfigDict(strict=True)

    source: str
    target: str
    edge_type: EdgeType
    label: str | None = None
    evidence: str | None = None
    confidence: float | None = None
    status: EdgeStatus = EdgeStatus.ACTIVE
    derived_at: datetime = Field(default_factory=datetime.now)


class GraphState(BaseModel):
    """Full graph snapshot for the frontend."""

    model_config = ConfigDict(strict=True)

    nodes: list[dict[str, object]]
    edges: list[GraphEdge]
    flags: list[dict[str, object]]  # Nodes with gap/orphan status
