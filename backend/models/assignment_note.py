"""Assignment-level notes — freeform text tied to a node, not a finding."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AssignmentNote(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    node_id: str
    note: str
    created_by: str
    created_at: datetime = Field(default_factory=datetime.now)


class AssignmentNoteCreate(BaseModel):
    model_config = ConfigDict(strict=True)

    note: str
    created_by: str = "trevor"
