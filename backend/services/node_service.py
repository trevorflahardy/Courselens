"""Node CRUD operations against SQLite."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from urllib.parse import unquote_plus


def _normalize_title(title: object) -> str | None:
    """Decode URL-encoded file names so 'A+B.pdf' and 'A B.pdf' don't become duplicates."""
    if not isinstance(title, str):
        return None
    return unquote_plus(title).strip()


from backend.db import get_db
from backend.models.node import CourseNode, CourseNodeSummary, NodeLink


def compute_content_hash(
    description: str | None = None,
    rubric_id: str | None = None,
) -> str:
    combined = f"{description or ''}{rubric_id or ''}"
    return hashlib.sha256(combined.encode()).hexdigest()[:16]


def _row_to_node(row: dict[str, object]) -> CourseNode:
    """Convert a SQLite row dict to a CourseNode, deserializing JSON fields."""
    data = dict(row)
    data["submission_types"] = CourseNode.parse_submission_types(data.get("submission_types"))
    return CourseNode.model_validate(data, strict=False)


async def get_node(node_id: str) -> CourseNode | None:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM nodes WHERE id = ?", (node_id,))
    row = await cursor.fetchone()
    if row is None:
        return None
    return _row_to_node(dict(row))


async def get_assignment_rubric(node_id: str) -> dict[str, object] | None:
    """Return rubric payload for an assignment node, if available."""
    db = await get_db()

    cursor = await db.execute(
        "SELECT rubric_id FROM nodes WHERE id = ? AND type = 'assignment'",
        (node_id,),
    )
    row = await cursor.fetchone()
    if row is None:
        return None

    rubric_ref = row["rubric_id"]
    if not rubric_ref:
        return None

    canvas_id_guess = rubric_ref[7:] if rubric_ref.startswith("rubric-") else rubric_ref
    cursor = await db.execute(
        "SELECT id, canvas_id, title, points_possible, criteria_json, assignment_id, content_hash, "
        "created_at, updated_at "
        "FROM rubrics WHERE id = ? OR canvas_id = ? LIMIT 1",
        (rubric_ref, canvas_id_guess),
    )
    rubric_row = await cursor.fetchone()
    if rubric_row is None:
        return None

    criteria_data: list[dict[str, object]] = []
    raw_criteria = rubric_row["criteria_json"]
    try:
        parsed = json.loads(raw_criteria) if raw_criteria else []
    except json.JSONDecodeError:
        parsed = []

    if isinstance(parsed, list):
        for idx, criterion in enumerate(parsed, start=1):
            if not isinstance(criterion, dict):
                continue
            criterion_id = str(criterion.get("id") or f"criterion-{idx}")
            description = str(
                criterion.get("long_description") or criterion.get("description") or ""
            )
            points = float(criterion.get("points") or 0)

            ratings_out: list[dict[str, object]] = []
            ratings = criterion.get("ratings")
            if isinstance(ratings, list):
                for r_idx, rating in enumerate(ratings, start=1):
                    if not isinstance(rating, dict):
                        continue
                    rating_id = str(rating.get("id") or f"{criterion_id}-rating-{r_idx}")
                    rating_description = rating.get("description")
                    ratings_out.append(
                        {
                            "id": rating_id,
                            "label": str(
                                rating.get("label") or rating_description or f"Rating {r_idx}"
                            ),
                            "points": float(rating.get("points") or 0),
                            "description": str(rating_description) if rating_description else None,
                        }
                    )

            criteria_data.append(
                {
                    "id": criterion_id,
                    "description": description,
                    "points": points,
                    "ratings": ratings_out,
                }
            )

    return {
        "id": rubric_row["id"],
        "canvas_id": rubric_row["canvas_id"],
        "title": rubric_row["title"],
        "points_possible": rubric_row["points_possible"],
        "criteria": criteria_data,
        "assignment_id": node_id,
        "content_hash": rubric_row["content_hash"],
        "created_at": rubric_row["created_at"],
        "updated_at": rubric_row["updated_at"],
    }


async def list_nodes(
    node_type: str | None = None,
    week: int | None = None,
    status: str | None = None,
) -> list[CourseNodeSummary]:
    db = await get_db()
    query = (
        "SELECT id, type, title, week, module, rubric_id, status, finding_count "
        "FROM nodes WHERE 1=1"
    )
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
    return [CourseNodeSummary.model_validate(dict(r), strict=False) for r in rows]


def _serialize_for_db(data: dict[str, object]) -> dict[str, object]:
    """Serialize Python types to SQLite-compatible values."""
    out = dict(data)
    if "submission_types" in out and isinstance(out["submission_types"], list):
        out["submission_types"] = json.dumps(out["submission_types"])
    return out


async def upsert_node(node_id: str, data: dict[str, object]) -> CourseNode:  # noqa: C901
    """Insert or merge a node. Preserves existing fields not in data."""
    # Normalize title to avoid URL-encoded duplicates ("A+B.pdf" vs "A B.pdf")
    if "title" in data:
        data = {**data, "title": _normalize_title(data["title"])}

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
            merged.get("description"),
            merged.get("rubric_id"),
        )

        db_fields = _serialize_for_db(update_fields)
        set_clause = ", ".join(f"{k} = ?" for k in db_fields)
        values = list(db_fields.values()) + [node_id]
        await db.execute(
            f"UPDATE nodes SET {set_clause} WHERE id = ?",  # noqa: S608
            values,
        )
        await db.commit()
        return await get_node(node_id)  # type: ignore[return-value]

    # Insert new node
    data["id"] = node_id
    data.setdefault("created_at", now)
    data["updated_at"] = now
    data["content_hash"] = compute_content_hash(
        data.get("description"),
        data.get("rubric_id"),
    )

    db_data = _serialize_for_db(data)
    columns = ", ".join(db_data.keys())
    placeholders = ", ".join("?" for _ in db_data)
    await db.execute(
        f"INSERT INTO nodes ({columns}) VALUES ({placeholders})",  # noqa: S608
        list(db_data.values()),
    )
    await db.commit()
    return await get_node(node_id)  # type: ignore[return-value]


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
    return [_row_to_node(dict(r)) for r in rows]


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
    return [NodeLink.model_validate(dict(r), strict=False) for r in rows]


async def list_node_links() -> list[NodeLink]:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM node_links")
    rows = await cursor.fetchall()
    return [NodeLink.model_validate(dict(r), strict=False) for r in rows]


async def get_stale_nodes() -> list[CourseNodeSummary]:
    """Nodes whose content changed since last audit (content_hash differs)."""
    db = await get_db()
    cursor = await db.execute("""
        SELECT DISTINCT
            n.id,
            n.type,
            n.title,
            n.week,
            n.module,
            n.rubric_id,
            n.status,
            n.finding_count
        FROM nodes n
        JOIN findings f ON f.assignment_id = n.id AND f.status = 'active'
        WHERE n.content_hash != f.content_hash_at_creation
    """)
    rows = await cursor.fetchall()
    return [CourseNodeSummary.model_validate(dict(r), strict=False) for r in rows]
