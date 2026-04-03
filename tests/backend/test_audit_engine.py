"""Tests for the audit engine — prompt building, progress tracking, summarization."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from backend.services.audit_engine import (
    AuditProgress,
    _build_pass1_prompt,
    _build_pass2_prompt,
    _build_pass3_prompt,
    _get_rubric_text,
    run_single_audit,
    summarize_findings,
)


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------


def test_pass1_prompt_includes_assignment_content() -> None:
    prompt = _build_pass1_prompt(
        node_id="assign-01",
        title="Test Assignment",
        description="<p>Submit a report about circuits</p>",
        points=100.0,
        submission_types=["online_upload"],
        rubric_text="Rubric: Test (100 pts)\n  1. Quality (50 pts)",
        run_id="run-abc",
    )
    assert "Test Assignment" in prompt
    assert "assign-01" in prompt
    assert "circuits" in prompt
    assert "100" in prompt
    assert "online_upload" in prompt
    assert "Rubric: Test" in prompt
    assert "run-abc" in prompt
    assert "Pass 1" in prompt
    assert "emit_finding" in prompt


def test_pass1_prompt_handles_missing_content() -> None:
    prompt = _build_pass1_prompt(
        node_id="assign-02",
        title="Empty Assignment",
        description=None,
        points=None,
        submission_types=None,
        rubric_text=None,
        run_id="run-def",
    )
    assert "no description provided" in prompt
    assert "Empty Assignment" in prompt


def test_pass2_prompt_includes_neighbors() -> None:
    prompt = _build_pass2_prompt(
        node_id="assign-03",
        title="Week 5 Lab",
        week=5,
        description="<p>Build on previous work</p>",
        neighbor_summaries="- **Week 4 Lab** (`assign-02`, assignment, week 4): Prior lab...",
        run_id="run-ghi",
    )
    assert "Week 5 Lab" in prompt
    assert "week 5" in prompt
    assert "Pass 2" in prompt
    assert "Backward Dependency" in prompt
    assert "Week 4 Lab" in prompt
    assert "implicit_prerequisite" in prompt


def test_pass2_prompt_no_neighbors() -> None:
    prompt = _build_pass2_prompt(
        node_id="assign-01",
        title="Week 1 Intro",
        week=1,
        description="<p>First assignment</p>",
        neighbor_summaries="",
        run_id="run-jkl",
    )
    assert "no related nodes found" in prompt


def test_pass3_prompt_includes_downstream() -> None:
    prompt = _build_pass3_prompt(
        node_id="assign-03",
        title="Midterm Prep",
        week=7,
        description="<p>Prepare for midterm</p>",
        downstream_summaries="- **Final Project** (`assign-10`, assignment, week 14): Depends on...",
        run_id="run-mno",
    )
    assert "Forward Impact" in prompt
    assert "Pass 3" in prompt
    assert "Final Project" in prompt
    assert "cascade_risk" in prompt


def test_pass3_prompt_terminal_assignment() -> None:
    prompt = _build_pass3_prompt(
        node_id="assign-10",
        title="Final Presentation",
        week=15,
        description="<p>Present your work</p>",
        downstream_summaries="",
        run_id="run-pqr",
    )
    assert "terminal assignment" in prompt


# ---------------------------------------------------------------------------
# AuditProgress dataclass
# ---------------------------------------------------------------------------


def test_audit_progress_defaults() -> None:
    p = AuditProgress(run_id="run-001", assignment_id="assign-01")
    assert p.current_pass == 0
    assert p.pass1_findings == 0
    assert p.pass2_findings == 0
    assert p.pass3_findings == 0
    assert p.status == "running"
    assert p.events == []


# ---------------------------------------------------------------------------
# run_single_audit — with mocked subprocess
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_single_audit_node_not_found() -> None:
    """Audit on nonexistent node should return error status."""
    with patch("backend.services.audit_engine.get_node", new_callable=AsyncMock, return_value=None):
        progress = await run_single_audit("nonexistent-node", run_id="run-test-404")

    assert progress.status == "error"
    assert any("not found" in str(e.get("message", "")) for e in progress.events)


@pytest.mark.asyncio
async def test_run_single_audit_completes_with_mocked_passes() -> None:
    """Audit with mocked _execute_pass should complete all 3 passes."""
    # Mock node lookup to return a fake node
    mock_node = AsyncMock()
    mock_node.id = "assign-01"
    mock_node.title = "Test Assignment"
    mock_node.description = "<p>Test content</p>"
    mock_node.points_possible = 100.0
    mock_node.submission_types = ["online_upload"]
    mock_node.week = 3

    with (
        patch("backend.services.audit_engine.get_node", new_callable=AsyncMock, return_value=mock_node),
        patch("backend.services.audit_engine._get_rubric_text", new_callable=AsyncMock, return_value=None),
        patch("backend.services.audit_engine._get_neighbor_summaries", new_callable=AsyncMock, return_value=""),
        patch("backend.services.audit_engine._execute_pass", new_callable=AsyncMock, return_value=2),
        patch("backend.services.audit_engine.get_db") as mock_get_db,
    ):
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        mock_cursor = AsyncMock()
        mock_cursor.fetchone.return_value = None
        mock_db.execute.return_value = mock_cursor

        progress = await run_single_audit("assign-01", run_id="run-test-ok")

    assert progress.status == "done"
    assert progress.pass1_findings == 2
    assert progress.pass2_findings == 2
    assert progress.pass3_findings == 2
    # Should have pass_start + pass_done events for each pass, plus done
    event_types = [e.get("type") for e in progress.events]
    assert event_types.count("pass_start") == 3
    assert event_types.count("pass_done") == 3
    assert "done" in event_types


# ---------------------------------------------------------------------------
# summarize_findings — against seed data
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_summarize_findings_returns_structure() -> None:
    """summarize_findings should return expected keys."""
    summary = await summarize_findings()
    assert "total_active_findings" in summary
    assert "total_audit_runs" in summary
    assert "severity_distribution" in summary
    assert "type_distribution" in summary
    assert "pass_distribution" in summary
    assert "most_problematic_nodes" in summary
    assert isinstance(summary["total_active_findings"], int)


# ---------------------------------------------------------------------------
# Rubric text helper — against seed data
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_rubric_text_no_rubric() -> None:
    """Node without rubric_id should return None."""
    # Seed node assign-01 may or may not have a rubric
    result = await _get_rubric_text("nonexistent-node")
    assert result is None
