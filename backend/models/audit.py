"""Audit run execution models."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class AuditStatus(StrEnum):
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    PAUSED = "paused"


class AuditRun(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    assignment_id: str
    status: AuditStatus = AuditStatus.RUNNING
    pass1_findings: int = 0
    pass2_findings: int = 0
    pass3_findings: int = 0
    total_findings: int = 0
    started_at: datetime = Field(default_factory=datetime.now)
    finished_at: datetime | None = None
    error_message: str | None = None
    completed_passes: int = 0
    paused_at: datetime | None = None
    resume_reason: str | None = None
