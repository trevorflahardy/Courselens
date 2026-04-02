"""Audit finding models with lifecycle tracking."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class FindingSeverity(StrEnum):
    GAP = "gap"
    WARN = "warn"
    INFO = "info"
    OK = "ok"


class FindingType(StrEnum):
    CLARITY = "clarity"
    RUBRIC_MISMATCH = "rubric_mismatch"
    RUBRIC_DRIFT = "rubric_drift"
    ASSUMPTION_GAP = "assumption_gap"
    IMPLICIT_PREREQUISITE = "implicit_prerequisite"
    DEPENDENCY_GAP = "dependency_gap"
    FORMAT_MISMATCH = "format_mismatch"
    ORPHAN = "orphan"
    CASCADE_RISK = "cascade_risk"
    CURRICULUM_GAP = "curriculum_gap"
    BROKEN_FILE_LINK = "broken_file_link"


class FindingStatus(StrEnum):
    ACTIVE = "active"
    STALE = "stale"
    RESOLVED = "resolved"
    SUPERSEDED = "superseded"
    CONFIRMED = "confirmed"


class Finding(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    assignment_id: str
    audit_run_id: str
    severity: FindingSeverity
    finding_type: FindingType
    title: str
    body: str
    linked_node: str | None = None
    evidence: str | None = None
    pass_number: int  # 1=clarity, 2=dependencies, 3=forward_impact
    status: FindingStatus = FindingStatus.ACTIVE
    content_hash_at_creation: str | None = None
    superseded_by: str | None = None
    created_at: datetime = Field(default_factory=datetime.now)
    resolved_at: datetime | None = None


class FindingCreate(BaseModel):
    """Input model for creating a finding via emit_finding."""

    model_config = ConfigDict(strict=True)

    assignment_id: str
    audit_run_id: str
    severity: FindingSeverity
    finding_type: FindingType
    title: str
    body: str
    linked_node: str | None = None
    evidence: str | None = None
    pass_number: int
