"""Pydantic models for AI-generated fix suggestions."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class SuggestionStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    IGNORED = "ignored"
    DONE_MANUALLY = "done_manually"


class SuggestionTargetType(StrEnum):
    DESCRIPTION = "description"
    PAGE_BODY = "page_body"
    RUBRIC_CRITERION = "rubric_criterion"
    MODULE_ITEM = "module_item"
    TITLE = "title"


class Suggestion(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    finding_id: str
    node_id: str
    field: str
    target_type: SuggestionTargetType = SuggestionTargetType.DESCRIPTION
    target_ref: str | None = None  # JSON blob — rubric_id/criterion_id/module_item_id
    original_text: str
    suggested_text: str
    diff_patch: str
    status: SuggestionStatus = SuggestionStatus.PENDING
    denial_reason: str | None = None
    ignore_reason: str | None = None
    manual_note: str | None = None
    handled_by: str | None = None
    handled_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.now)
    resolved_at: datetime | None = None


class SuggestionCreate(BaseModel):
    finding_id: str
    node_id: str
    field: str
    target_type: SuggestionTargetType = SuggestionTargetType.DESCRIPTION
    target_ref: str | None = None
    original_text: str
    suggested_text: str
    diff_patch: str
