"""Durable changelog of every terminal action taken on a suggestion."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class AppliedChangeAction(StrEnum):
    APPLIED = "applied"
    DENIED = "denied"
    IGNORED = "ignored"
    DONE_MANUALLY = "done_manually"


class AppliedChange(BaseModel):
    """One row per terminal action on a suggestion, denormalized for stability.

    Fields from the parent finding (title, severity, evidence_quote) are copied
    at write time so the changelog survives edits or deletes of the source
    records and the Markdown export is byte-stable.
    """

    model_config = ConfigDict(strict=True)

    id: str
    suggestion_id: str
    finding_id: str
    node_id: str
    action: AppliedChangeAction
    target_type: str
    field: str
    original_text: str
    new_text: str
    diff_patch: str
    finding_title: str
    finding_severity: str
    finding_pass: int | None = None
    evidence_quote: str | None = None
    reason_or_note: str | None = None
    canvas_response: str | None = None
    handled_by: str
    created_at: datetime = Field(default_factory=datetime.now)


class AppliedChangeCreate(BaseModel):
    model_config = ConfigDict(strict=True)

    suggestion_id: str
    finding_id: str
    node_id: str
    action: AppliedChangeAction
    target_type: str
    field: str
    original_text: str
    new_text: str
    diff_patch: str
    finding_title: str
    finding_severity: str
    finding_pass: int | None = None
    evidence_quote: str | None = None
    reason_or_note: str | None = None
    canvas_response: str | None = None
    handled_by: str = "trevor"
