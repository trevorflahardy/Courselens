"""Node CRUD operations against SQLite."""

from __future__ import annotations

import hashlib
from datetime import datetime

from backend.db import get_db
from backend.models.node import CourseNode, CourseNodeSummary, NodeLink


def compute_content_hash(
    instructions: str | None = None,
    rubric_text: str | None = None,
    description: str | None = None,
) -> str:
    combined = f"{instructions or ''}{rubric_text or ''}{description or ''}"
    return hashlib.sha256(combined.encode()).hexdigest()[:16]


async def get_node(node_id: str) -> CourseNode | None:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM nodes WHERE id = ?", (node_id,))
    row = await cursor.fetchone()
    if row is None:
        return None
    return CourseNode(**dict(row))


async def list_nodes(
    node_type: str | None = None,
    week: int | None = None,
    status: str | None = None,
) -> list[CourseNodeSummary]:
    db = await get_db()
    query = "SELECT id, type, title, week, module, status, finding_count FROM nodes WHERE 1=1"
    params: list[object] = []

    if node_type is not None:
        query += " AND type = ?"
        params.append(node_type)
    if week is not None:
        query += " AND week = ?"
        params.append(week)
    if status is not None:
        query += " AND status = ?"
        params.append(status)

    query += " ORDER BY week ASC NULLS LAST, module_order ASC"
    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return [CourseNodeSummary(**dict(r)) for r in rows]


async def upsert_node(node_id: str, data: dict[str, object]) -> CourseNode:
    """Insert or merge a node. Preserves existing fields not in data."""
    db = await get_db()
    now = datetime.now().isoformat()

    existing = await get_node(node_id)

    if existing is not None:
        # Merge: update only provided fields
        update_fields = {k: v for k, v in data.items() if v is not None}
        update_fields["updated_at"] = now

        # Recompute content_hash if content fields changed
        merged = existing.model_dump()
        merged.update(update_fields)
        update_fields["content_hash"] = compute_content_hash(
            merged.get("instructions"),
            merged.get("rubric_text"),
            merged.get("description"),
        )

        set_clause = ", ".join(f"{k} = ?" for k in update_fields)
        values = list(update_fields.values()) + [node_id]
        await db.execute(
            f"UPDATE nodes SET {set_clause} WHERE id = ?",  # noqa: S608
            values,
        )
        await db.commit()
        return (await get_node(node_id))  # type: ignore[return-value]

    # Insert new node
    data["id"] = node_id
    data.setdefault("created_at", now)
    data["updated_at"] = now
    data["content_hash"] = compute_content_hash(
        data.get("instructions"),
        data.get("rubric_text"),
        data.get("description"),
    )

    columns = ", ".join(data.keys())
    placeholders = ", ".join("?" for _ in data)
    await db.execute(
        f"INSERT INTO nodes ({columns}) VALUES ({placeholders})",  # noqa: S608
        list(data.values()),
    )
    await db.commit()
    return (await get_node(node_id))  # type: ignore[return-value]


async def get_nodes_many(ids: list[str]) -> list[CourseNode]:
    if not ids:
        return []
    db = await get_db()
    placeholders = ", ".join("?" for _ in ids)
    cursor = await db.execute(
        f"SELECT * FROM nodes WHERE id IN ({placeholders})",  # noqa: S608
        ids,
    )
    rows = await cursor.fetchall()
    return [CourseNode(**dict(r)) for r in rows]


async def link_nodes(source_id: str, target_id: str, link_type: str) -> NodeLink:
    db = await get_db()
    await db.execute(
        "INSERT OR IGNORE INTO node_links (source_id, target_id, link_type) VALUES (?, ?, ?)",
        (source_id, target_id, link_type),
    )
    await db.commit()
    return NodeLink(source_id=source_id, target_id=target_id, link_type=link_type)


async def get_node_links(node_id: str) -> list[NodeLink]:
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM node_links WHERE source_id = ? OR target_id = ?",
        (node_id, node_id),
    )
    rows = await cursor.fetchall()
    return [NodeLink(**dict(r)) for r in rows]


async def get_stale_nodes() -> list[CourseNodeSummary]:
    """Nodes whose content changed since last audit (content_hash differs)."""
    db = await get_db()
    cursor = await db.execute("""
        SELECT DISTINCT n.id, n.type, n.title, n.week, n.module, n.status, n.finding_count
        FROM nodes n
        JOIN findings f ON f.assignment_id = n.id AND f.status = 'active'
        WHERE n.content_hash != f.content_hash_at_creation
    """)
    rows = await cursor.fetchall()
    return [CourseNodeSummary(**dict(r)) for r in rows]
