"""Tests for Audit MCP tool contracts."""

from __future__ import annotations

import json

import pytest

from audit_mcp.audit_mcp import (
    emit_finding,
    emit_resolve_stale,
    graph_add_edge,
    graph_get_flags,
    graph_get_neighbors,
    graph_mark_stale,
    nodes_get_stale,
    nodes_link,
    nodes_list,
    nodes_read,
    nodes_read_many,
    nodes_write,
)


# ---------------------------------------------------------------------------
# Nodes namespace
# ---------------------------------------------------------------------------

async def test_nodes_read_existing() -> None:
    result = json.loads(await nodes_read("assign-01"))
    assert result["id"] == "assign-01"
    assert result["type"] == "assignment"
    assert "points_possible" in result


async def test_nodes_read_missing() -> None:
    result = json.loads(await nodes_read("nonexistent"))
    assert "error" in result


async def test_nodes_write_create() -> None:
    result = json.loads(await nodes_write(
        node_id="test-mcp-node",
        node_type="page",
        title="MCP Test Page",
        description="Created by MCP test",
        week=1,
    ))
    assert result["id"] == "test-mcp-node"
    assert result["type"] == "page"
    assert result["title"] == "MCP Test Page"


async def test_nodes_write_update() -> None:
    # Update the node we just created
    result = json.loads(await nodes_write(
        node_id="test-mcp-node",
        node_type="page",
        title="MCP Test Page Updated",
        description="Updated by MCP test",
    ))
    assert result["title"] == "MCP Test Page Updated"


async def test_nodes_list() -> None:
    result = json.loads(await nodes_list())
    assert isinstance(result, list)
    assert len(result) >= 15


async def test_nodes_list_filter() -> None:
    result = json.loads(await nodes_list(node_type="assignment"))
    assert all(n["type"] == "assignment" for n in result)


async def test_nodes_read_many() -> None:
    result = json.loads(await nodes_read_many('["assign-01","assign-02"]'))
    assert len(result) == 2
    ids = {n["id"] for n in result}
    assert "assign-01" in ids
    assert "assign-02" in ids


async def test_nodes_link() -> None:
    result = json.loads(await nodes_link("assign-01", "page-syllabus", "page"))
    assert result["source_id"] == "assign-01"
    assert result["target_id"] == "page-syllabus"


async def test_nodes_get_stale() -> None:
    result = json.loads(await nodes_get_stale())
    assert isinstance(result, list)


# ---------------------------------------------------------------------------
# Graph namespace
# ---------------------------------------------------------------------------

async def test_graph_add_edge() -> None:
    result = json.loads(await graph_add_edge(
        source="assign-01",
        target="assign-02",
        edge_type="inferred",
        label="Test edge",
        confidence=0.5,
    ))
    assert result["source"] == "assign-01"
    assert result["target"] == "assign-02"
    assert result["edge_type"] == "inferred"


async def test_graph_get_neighbors() -> None:
    result = json.loads(await graph_get_neighbors("assign-08"))
    assert "upstream" in result
    assert "downstream" in result
    assert len(result["upstream"]) >= 2


async def test_graph_get_flags() -> None:
    result = json.loads(await graph_get_flags())
    assert isinstance(result, list)
    # Seed data has gap and orphan status nodes
    statuses = {f["status"] for f in result}
    assert "gap" in statuses


async def test_graph_mark_stale() -> None:
    result = json.loads(await graph_mark_stale("assign-03"))
    assert result["node_id"] == "assign-03"
    assert result["edges_marked_stale"] >= 0


# ---------------------------------------------------------------------------
# Emit namespace
# ---------------------------------------------------------------------------

async def test_emit_finding() -> None:
    result = json.loads(await emit_finding(
        assignment_id="assign-01",
        audit_run_id="demo-run-001",
        severity="info",
        finding_type="clarity",
        title="Test finding from MCP",
        body="This is a test finding created via the MCP emit tool.",
        pass_number=1,
        evidence="Test evidence",
    ))
    assert result["assignment_id"] == "assign-01"
    assert result["severity"] == "info"
    assert result["status"] == "active"


async def test_emit_resolve_stale() -> None:
    result = json.loads(await emit_resolve_stale("assign-01"))
    assert "resolved" in result
    assert "superseded" in result
