"""Finding CRUD and lifecycle transitions."""

from __future__ import annotations

import uuid
from datetime import datetime

from backend.db import get_db
from backend.models.finding import Finding, FindingCreate, FindingStatus
from backend.services.node_service import get_node


async def create_finding(data: FindingCreate) -> Finding:
    """Create a new finding, recording the node's current content_hash."""
    db = await get_db()
    finding_id = str(uuid.uuid4())[:8]
    now = datetime.now().isoformat()

    # Get the node's current content_hash for change detection
    node = await get_node(data.assignment_id)
    content_hash = node.content_hash if node else None

    await db.execute(
        """INSERT INTO findings
           (id, assignment_id, audit_run_id, severity, finding_type,
            title, body, linked_node, evidence, pass_number,
            status, content_hash_at_creation, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)""",
        (
            finding_id, data.assignment_id, data.audit_run_id,
            data.severity.value, data.finding_type.value,
            data.title, data.body, data.linked_node, data.evidence,
            data.pass_number, content_hash, now,
        ),
    )

    # Update finding count on the node
    await db.execute(
        """UPDATE nodes SET finding_count = (
            SELECT COUNT(*) FROM findings
            WHERE assignment_id = ? AND status = 'active'
        ) WHERE id = ?""",
        (data.assignment_id, data.assignment_id),
    )
    await db.commit()
    return (await get_finding(finding_id))  # type: ignore[return-value]


async def get_finding(finding_id: str) -> Finding | None:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM findings WHERE id = ?", (finding_id,))
    row = await cursor.fetchone()
    if row is None:
        return None
    return Finding(**dict(row))


async def list_findings(
    assignment_id: str | None = None,
    severity: str | None = None,
    finding_type: str | None = None,
    status: str | None = None,
    audit_run_id: str | None = None,
) -> list[Finding]:
    db = await get_db()
    query = "SELECT * FROM findings WHERE 1=1"
    params: list[object] = []

    if assignment_id is not None:
        query += " AND assignment_id = ?"
        params.append(assignment_id)
    if severity is not None:
        query += " AND severity = ?"
        params.append(severity)
    if finding_type is not None:
        query += " AND finding_type = ?"
        params.append(finding_type)
    if status is not None:
        query += " AND status = ?"
        params.append(status)
    if audit_run_id is not None:
        query += " AND audit_run_id = ?"
        params.append(audit_run_id)

    query += " ORDER BY created_at DESC"
    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return [Finding(**dict(r)) for r in rows]


async def mark_findings_stale(assignment_id: str) -> int:
    """Mark all active findings for a node as stale (content changed)."""
    db = await get_db()
    now = datetime.now().isoformat()
    cursor = await db.execute(
        """UPDATE findings SET status = 'stale', resolved_at = ?
           WHERE assignment_id = ? AND status = 'active'""",
        (now, assignment_id),
    )
    await db.commit()
    return cursor.rowcount


async def resolve_stale_findings(assignment_id: str) -> dict[str, int]:
    """After re-audit: resolve unmatched stale findings, confirm matched ones.

    Returns counts of resolved and confirmed findings.
    """
    db = await get_db()
    now = datetime.now().isoformat()

    # Stale findings with no new active finding of same type = resolved
    cursor = await db.execute(
        """UPDATE findings SET status = ?, resolved_at = ?
           WHERE assignment_id = ? AND status = ?
           AND finding_type NOT IN (
               SELECT finding_type FROM findings
               WHERE assignment_id = ? AND status = 'active'
           )""",
        (FindingStatus.RESOLVED.value, now, assignment_id,
         FindingStatus.STALE.value, assignment_id),
    )
    resolved = cursor.rowcount

    # Stale findings with matching new active finding = superseded
    cursor = await db.execute(
        """UPDATE findings SET status = ?, resolved_at = ?
           WHERE assignment_id = ? AND status = ?""",
        (FindingStatus.SUPERSEDED.value, now, assignment_id,
         FindingStatus.STALE.value),
    )
    superseded = cursor.rowcount

    # Update node finding count
    await db.execute(
        """UPDATE nodes SET finding_count = (
            SELECT COUNT(*) FROM findings
            WHERE assignment_id = ? AND status = 'active'
        ) WHERE id = ?""",
        (assignment_id, assignment_id),
    )
    await db.commit()
    return {"resolved": resolved, "superseded": superseded}
