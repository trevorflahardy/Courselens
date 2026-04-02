"""Course node models — any piece of course content."""

from __future__ import annotations

import json
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class NodeType(StrEnum):
    ASSIGNMENT = "assignment"
    PAGE = "page"
    RUBRIC = "rubric"
    LECTURE = "lecture"
    ANNOUNCEMENT = "announcement"
    FILE = "file"


class NodeStatus(StrEnum):
    OK = "ok"
    WARN = "warn"
    GAP = "gap"
    ORPHAN = "orphan"
    UNAUDITED = "unaudited"


class RubricRating(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    label: str
    points: float
    description: str | None = None


class RubricCriterion(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    description: str
    points: float
    ratings: list[RubricRating] = Field(default_factory=list)


class CourseNode(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    type: NodeType
    title: str
    week: int | None = None
    module: str | None = None
    module_order: int | None = None
    description: str | None = None
    points_possible: float | None = None
    submission_types: list[str] | None = None
    rubric_id: str | None = None
    file_content: str | None = None
    file_path: str | None = None
    canvas_url: str | None = None
    source: str = "canvas_mcp"
    status: NodeStatus = NodeStatus.UNAUDITED
    content_hash: str | None = None
    last_audited: datetime | None = None
    finding_count: int = 0
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)

    def serialize_submission_types(self) -> str | None:
        """Serialize submission_types list to JSON string for SQLite storage."""
        if self.submission_types is None:
            return None
        return json.dumps(self.submission_types)

    @staticmethod
    def parse_submission_types(raw: str | None) -> list[str] | None:
        """Parse JSON string from SQLite back to list."""
        if raw is None:
            return None
        return json.loads(raw)


class NodeLink(BaseModel):
    model_config = ConfigDict(strict=True)

    source_id: str
    target_id: str
    link_type: str  # "file", "page", "assignment", "external"


class CourseNodeSummary(BaseModel):
    """Lightweight node for list views."""

    model_config = ConfigDict(strict=True)

    id: str
    type: NodeType
    title: str
    week: int | None = None
    module: str | None = None
    status: NodeStatus = NodeStatus.UNAUDITED
    finding_count: int = 0
