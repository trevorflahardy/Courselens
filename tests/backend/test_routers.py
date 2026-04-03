"""Tests for all FastAPI routes against seed data."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from backend.main import app
from backend.services.audit_engine import AuditProgress


@pytest.fixture()
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

async def test_health(client: AsyncClient) -> None:
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------

async def test_list_nodes(client: AsyncClient) -> None:
    r = await client.get("/api/nodes")
    assert r.status_code == 200
    nodes = r.json()
    assert isinstance(nodes, list)
    assert len(nodes) >= 15  # 15 assignments + pages + rubrics + lecture


async def test_list_nodes_filter_type(client: AsyncClient) -> None:
    r = await client.get("/api/nodes", params={"type": "assignment"})
    assert r.status_code == 200
    nodes = r.json()
    assert all(n["type"] == "assignment" for n in nodes)


async def test_list_nodes_filter_week(client: AsyncClient) -> None:
    r = await client.get("/api/nodes", params={"week": 1})
    assert r.status_code == 200
    nodes = r.json()
    assert all(n["week"] == 1 for n in nodes)


async def test_get_node(client: AsyncClient) -> None:
    r = await client.get("/api/nodes/assign-01")
    assert r.status_code == 200
    node = r.json()
    assert node["id"] == "assign-01"
    assert node["type"] == "assignment"
    assert node["points_possible"] == 25.0
    assert isinstance(node["submission_types"], list)
    assert "description" in node
    # Removed fields should not be present
    assert "instructions" not in node
    assert "rubric_text" not in node


async def test_get_node_with_rubric_id(client: AsyncClient) -> None:
    r = await client.get("/api/nodes/assign-09")
    assert r.status_code == 200
    node = r.json()
    assert node["rubric_id"] == "rubric-peer-review"


async def test_get_node_404(client: AsyncClient) -> None:
    r = await client.get("/api/nodes/nonexistent")
    assert r.status_code == 404


async def test_patch_node(client: AsyncClient) -> None:
    r = await client.patch("/api/nodes/assign-01", json={"status": "warn"})
    assert r.status_code == 200
    assert r.json()["status"] == "warn"

    # Restore
    await client.patch("/api/nodes/assign-01", json={"status": "ok"})


async def test_patch_node_404(client: AsyncClient) -> None:
    r = await client.patch("/api/nodes/nonexistent", json={"status": "ok"})
    assert r.status_code == 404


async def test_stale_nodes(client: AsyncClient) -> None:
    r = await client.get("/api/nodes/stale")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------

async def test_list_findings(client: AsyncClient) -> None:
    r = await client.get("/api/findings")
    assert r.status_code == 200
    findings = r.json()
    assert isinstance(findings, list)
    assert len(findings) >= 8  # Seed has 8; MCP tests may add more


async def test_list_findings_filter_severity(client: AsyncClient) -> None:
    r = await client.get("/api/findings", params={"severity": "gap"})
    assert r.status_code == 200
    findings = r.json()
    assert all(f["severity"] == "gap" for f in findings)


async def test_list_findings_by_node(client: AsyncClient) -> None:
    r = await client.get("/api/findings/by-node/assign-06")
    assert r.status_code == 200
    findings = r.json()
    assert len(findings) >= 2
    assert all(f["assignment_id"] == "assign-06" for f in findings)


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------

async def test_get_graph(client: AsyncClient) -> None:
    r = await client.get("/api/graph")
    assert r.status_code == 200
    graph = r.json()
    assert "nodes" in graph
    assert "edges" in graph
    assert "flags" in graph
    assert len(graph["edges"]) >= 18  # Seed has 20; some may be marked stale by MCP tests


async def test_get_node_graph(client: AsyncClient) -> None:
    r = await client.get("/api/graph/node/assign-08")
    assert r.status_code == 200
    data = r.json()
    assert "upstream" in data
    assert "downstream" in data
    # assign-08 has upstream edges from assign-06, assign-07, assign-04
    assert len(data["upstream"]) >= 2


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

async def test_list_audit_runs(client: AsyncClient) -> None:
    r = await client.get("/api/audit/runs")
    assert r.status_code == 200
    runs = r.json()
    assert isinstance(runs, list)
    assert len(runs) >= 1


async def test_get_audit_run(client: AsyncClient) -> None:
    r = await client.get("/api/audit/runs/demo-run-001")
    assert r.status_code == 200
    run = r.json()
    assert run["status"] == "done"
    assert run["total_findings"] == 8


async def test_get_audit_run_404(client: AsyncClient) -> None:
    r = await client.get("/api/audit/runs/nonexistent")
    assert r.status_code == 404


async def test_start_audit(client: AsyncClient) -> None:
    mock_progress = AuditProgress(
        run_id="test-run", assignment_id="assign-01", status="done",
        pass1_findings=1, pass2_findings=0, pass3_findings=0,
    )

    async def _mock_run(assignment_id: str, run_id: str | None = None) -> AuditProgress:
        return mock_progress

    with patch("backend.routers.audit.run_single_audit", side_effect=_mock_run):
        r = await client.post("/api/audit/assign-01")
    assert r.status_code == 200
    run = r.json()
    assert run["assignment_id"] == "assign-01"
    assert run["status"] in ("running", "done")


async def test_start_audit_404(client: AsyncClient) -> None:
    r = await client.post("/api/audit/nonexistent")
    assert r.status_code == 404


async def test_stream_audit(client: AsyncClient) -> None:
    r = await client.get("/api/audit/demo-run-001/stream")
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]
    assert "event:" in r.text


async def test_stream_audit_404(client: AsyncClient) -> None:
    r = await client.get("/api/audit/nonexistent/stream")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Ingest (stubs)
# ---------------------------------------------------------------------------

async def test_ingest_course_501(client: AsyncClient) -> None:
    r = await client.post("/api/ingest/course")
    assert r.status_code == 501


async def test_ingest_zip(client: AsyncClient) -> None:
    """ZIP ingest returns 200 if data/course_files_export.zip exists, 404 otherwise."""
    r = await client.post("/api/ingest/zip")
    assert r.status_code in (200, 404)


async def test_ingest_status(client: AsyncClient) -> None:
    r = await client.get("/api/ingest/status")
    assert r.status_code == 200
    assert r.json()["status"] in ("idle", "done", "running", "error")
