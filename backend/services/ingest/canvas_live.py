"""Canvas MCP live ingestion — walks course modules and creates nodes.

Uses Canvas MCP tools (read-only) to:
1. List all modules and items (get_course_structure)
2. Fetch full content for each assignment/page
3. Fetch all rubrics and link to assignments
4. Create nodes, rubrics, and node_links in SQLite

IMPORTANT: This module is designed to be called from a service layer
that has access to the Canvas MCP tools. It does NOT call MCP tools
directly — instead it accepts pre-fetched data and processes it.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime

from backend.db import get_db
from backend.services.html_links import extract_links
from backend.services.node_service import compute_content_hash, upsert_node

logger = logging.getLogger(__name__)

# Regex to extract week number from module name
_WEEK_RE = re.compile(r"Week\s*(\d+)", re.IGNORECASE)


@dataclass
class CanvasIngestResult:
    modules_processed: int = 0
    assignments_created: int = 0
    pages_created: int = 0
    rubrics_created: int = 0
    links_extracted: int = 0
    errors: list[str] = field(default_factory=list)


def parse_week_from_module(module_name: str) -> int | None:
    """Extract week number from a module name like 'Week 5 - Design-thinking'."""
    match = _WEEK_RE.search(module_name)
    return int(match.group(1)) if match else None


def make_canvas_node_id(canvas_type: str, canvas_id: int | str) -> str:
    """Generate a stable node ID from Canvas type + ID."""
    return f"{canvas_type}-{canvas_id}"


async def ingest_assignment(
    canvas_id: int | str,
    name: str,
    description_html: str | None,
    points_possible: float | None,
    submission_types: list[str] | None,
    module_name: str | None,
    module_order: int | None,
    week: int | None,
    canvas_url: str | None = None,
) -> str:
    """Ingest a single assignment into the nodes table.

    Returns the node ID.
    """
    node_id = make_canvas_node_id("assignment", canvas_id)

    node_data: dict[str, object] = {
        "type": "assignment",
        "title": name,
        "description": description_html,
        "points_possible": points_possible,
        "source": "canvas_mcp",
        "canvas_url": canvas_url,
    }
    if submission_types:
        node_data["submission_types"] = submission_types
    if module_name:
        node_data["module"] = module_name
    if module_order is not None:
        node_data["module_order"] = module_order
    if week is not None:
        node_data["week"] = week

    await upsert_node(node_id, node_data)

    # Extract links from description HTML
    if description_html:
        await _extract_and_store_links(node_id, description_html)

    return node_id


async def ingest_page(
    page_url: str,
    title: str,
    body_html: str | None,
    module_name: str | None,
    module_order: int | None,
    week: int | None,
    canvas_url: str | None = None,
) -> str:
    """Ingest a single page into the nodes table.

    Returns the node ID.
    """
    node_id = make_canvas_node_id("page", page_url)

    node_data: dict[str, object] = {
        "type": "page",
        "title": title,
        "description": body_html,
        "source": "canvas_mcp",
        "canvas_url": canvas_url,
    }
    if module_name:
        node_data["module"] = module_name
    if module_order is not None:
        node_data["module_order"] = module_order
    if week is not None:
        node_data["week"] = week

    await upsert_node(node_id, node_data)

    # Extract links from body HTML
    if body_html:
        await _extract_and_store_links(node_id, body_html)

    return node_id


async def ingest_rubric(
    canvas_id: int | str,
    title: str,
    points_possible: float | None,
    criteria: list[dict[str, object]],
    assignment_id: str | None = None,
) -> str:
    """Ingest a rubric into the rubrics table and create a rubric node.

    Returns the rubric ID.
    """
    rubric_id = make_canvas_node_id("rubric", canvas_id)
    criteria_json = json.dumps(criteria, default=str)
    content_hash_val = hashlib.sha256(criteria_json.encode()).hexdigest()[:16]
    now = datetime.now().isoformat()

    db = await get_db()
    await db.execute(
        """INSERT OR REPLACE INTO rubrics
           (id, canvas_id, title, points_possible, criteria_json, assignment_id, content_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (rubric_id, str(canvas_id), title, points_possible, criteria_json,
         assignment_id, content_hash_val, now, now),
    )
    await db.commit()

    # Also create a rubric node for graph visibility
    node_data: dict[str, object] = {
        "type": "rubric",
        "title": title,
        "description": f"Rubric: {title}. {len(criteria)} criteria, {points_possible or 0} total points.",
        "source": "canvas_mcp",
    }
    await upsert_node(rubric_id, node_data)

    return rubric_id


async def link_rubric_to_assignment(rubric_id: str, assignment_node_id: str) -> None:
    """Link a rubric to an assignment node and set the rubric_id on the assignment."""
    db = await get_db()
    # Update assignment's rubric_id
    await db.execute(
        "UPDATE nodes SET rubric_id = ? WHERE id = ?",
        (rubric_id, assignment_node_id),
    )
    # Create node_link
    await db.execute(
        "INSERT OR IGNORE INTO node_links (source_id, target_id, link_type) VALUES (?, ?, 'assignment')",
        (assignment_node_id, rubric_id),
    )
    await db.commit()


async def _extract_and_store_links(node_id: str, html: str) -> int:
    """Extract links from HTML and store as node_links where possible."""
    links = extract_links(html)
    db = await get_db()
    count = 0

    for link in links:
        # For now, log extracted links. Full cross-referencing happens in graph rebuild.
        now = datetime.now().isoformat()
        await db.execute(
            "INSERT INTO ingest_log (node_id, action, status, detail, created_at) VALUES (?, ?, ?, ?, ?)",
            (node_id, "link_extracted", "success",
             f"{link.link_class}: {link.url}" + (f" ({link.text})" if link.text else ""), now),
        )
        count += 1

    if count > 0:
        await db.commit()
    return count
