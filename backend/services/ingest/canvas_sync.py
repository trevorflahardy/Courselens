"""Pure-Python Canvas sync service using canvasapi.

Replaces the Claude subprocess sync. All Canvas data fetching and DB writing
is deterministic Python — no LLM involved. Claude is reserved for audit analysis.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime

import aiosqlite

logger = logging.getLogger(__name__)


@dataclass
class SyncResult:
    modules: int = 0
    assignments: int = 0
    pages: int = 0
    files: int = 0
    links_extracted: int = 0
    rubrics_fetched: int = 0
    rubrics_linked: int = 0
    errors: list[str] = field(default_factory=list)


def _parse_week(module_name: str) -> int | None:
    """Extract week number from module name like 'Week 3 - Instrumentation'."""
    m = re.search(r"week\s*(\d+)", module_name, re.IGNORECASE)
    return int(m.group(1)) if m else None


def _normalize_submission_types(types: object) -> str | None:
    """Serialize submission_types list to JSON string for DB storage."""
    if isinstance(types, list):
        return json.dumps(types)
    return None


async def run_full_sync(
    course_id: str,
    canvas_base_url: str,
    canvas_token: str,
    db: aiosqlite.Connection,
    on_progress: Callable[[str], Awaitable[None]] | None = None,
) -> SyncResult:
    """Fetch all Canvas course content and upsert into the audit database.

    Args:
        course_id: Canvas course ID string.
        canvas_base_url: Canvas API base URL (e.g. https://usflearn.instructure.com/api/v1).
        canvas_token: Canvas API token.
        db: aiosqlite connection (from get_db()).
        on_progress: Optional async callable(message: str) for feed updates.
    """
    from canvasapi import Canvas

    result = SyncResult()
    now = datetime.now().isoformat()
    from backend.services.ingest.canvas_live import _extract_and_store_links

    async def emit(msg: str) -> None:
        logger.info("[canvas-sync] %s", msg)
        if on_progress is not None:
            await on_progress(msg)

    # canvasapi expects the base URL without /api/v1
    base = canvas_base_url.replace("/api/v1", "").rstrip("/")

    await emit("Connecting to Canvas...")
    canvas = await asyncio.to_thread(Canvas, base, canvas_token)
    course = await asyncio.to_thread(canvas.get_course, int(course_id))
    await emit(f"Connected to course: {course.name}")

    # ── Phase 1: Modules → build week/module metadata map ─────────────────────
    await emit("Fetching modules...")
    modules = await asyncio.to_thread(list, course.get_modules())
    result.modules = len(modules)

    # Map content_id → (week, module_name, module_order) for assignments
    assignment_module_map: dict[int, tuple[int | None, str, int]] = {}
    page_module_map: dict[str, tuple[int | None, str, int]] = {}

    for mod in modules:
        week = _parse_week(mod.name)
        mod_name = mod.name
        items = await asyncio.to_thread(list, mod.get_module_items())
        for order, item in enumerate(items):
            d = item.__dict__
            item_type = d.get("type", "")
            content_id = d.get("content_id")
            page_url = d.get("page_url")
            if item_type in ("Assignment", "Quiz") and content_id:
                assignment_module_map[int(content_id)] = (week, mod_name, order)
            elif item_type == "Page" and page_url:
                page_module_map[page_url] = (week, mod_name, order)

    await emit(f"Mapped {len(modules)} modules")

    # ── Phase 2: Assignments ───────────────────────────────────────────────────
    await emit("Fetching assignments...")
    assignments = await asyncio.to_thread(list, course.get_assignments())
    rubric_ids_needed: dict[str, str] = {}  # rubric_id → assignment node_id

    for a in assignments:
        d = a.__dict__
        assignment_id = f"assignment-{a.id}"
        week, mod_name, mod_order = assignment_module_map.get(a.id, (None, "", 0))
        rubric_settings = d.get("rubric_settings") or {}
        rubric_id = str(rubric_settings["id"]) if rubric_settings.get("id") else None
        rubric_ref = f"rubric-{rubric_id}" if rubric_id else None
        description = d.get("description") or None

        data: dict[str, object] = {
            "type": "assignment",
            "title": d.get("name", f"Assignment {a.id}"),
            "description": description,
            "week": week,
            "module": mod_name or None,
            "module_order": mod_order,
            "points_possible": d.get("points_possible"),
            "submission_types": _normalize_submission_types(d.get("submission_types")),
            "rubric_id": rubric_ref,
            "canvas_url": d.get("html_url"),
            "source": "canvas_api",
        }

        await _upsert_node(db, assignment_id, data, now)
        result.assignments += 1

        if rubric_id:
            rubric_ids_needed[rubric_id] = assignment_id

    await emit(f"Upserted {result.assignments} assignments ({len(rubric_ids_needed)} have rubrics)")

    # ── Phase 3: Pages ─────────────────────────────────────────────────────────
    await emit("Fetching pages...")
    pages = await asyncio.to_thread(list, course.get_pages())

    for p in pages:
        d = p.__dict__
        url_slug = d.get("url", f"page-{p.page_url if hasattr(p, 'page_url') else ''}")
        node_id = f"page-{url_slug}"
        week, mod_name, mod_order = page_module_map.get(url_slug, (None, "", 0))

        # Fetch page body (separate request)
        try:
            full_page = await asyncio.to_thread(course.get_page, url_slug)
            body = full_page.__dict__.get("body") or None
        except Exception:
            body = None

        data = {
            "type": "page",
            "title": d.get("title", url_slug),
            "description": body,
            "week": week,
            "module": mod_name or None,
            "module_order": mod_order,
            "canvas_url": d.get("html_url"),
            "source": "canvas_api",
        }

        await _upsert_node(db, node_id, data, now)
        result.pages += 1

    await emit(f"Upserted {result.pages} pages")

    # ── Phase 4: Files ─────────────────────────────────────────────────────────
    await emit("Fetching files...")
    try:
        files = await asyncio.to_thread(list, course.get_files())
        for f in files:
            d = f.__dict__
            node_id = f"file-{f.id}"
            data = {
                "type": "file",
                "title": d.get("display_name", d.get("filename", f"File {f.id}")),
                "canvas_url": d.get("url"),
                "source": "canvas_api",
            }
            await _upsert_node(db, node_id, data, now)
            result.files += 1
    except Exception as exc:
        logger.warning("File fetch failed (may not have permission): %s", exc)
        result.errors.append(f"files: {exc}")

    await emit(f"Upserted {result.files} files")

    # ── Phase 4.5: Smart link extraction from assignment/page HTML ───────────
    await emit("Extracting assignment/page links...")
    cursor = await db.execute(
        """
        SELECT id, description
        FROM nodes
        WHERE source = 'canvas_api'
          AND type IN ('assignment', 'page')
          AND description IS NOT NULL
        """
    )
    link_sources = await cursor.fetchall()
    for row in link_sources:
        description = row["description"]
        if not isinstance(description, str) or not description.strip():
            continue
        extracted = await _extract_and_store_links(str(row["id"]), description)
        result.links_extracted += extracted

    await emit(f"Extracted {result.links_extracted} links from assignment/page content")

    # ── Phase 5: Rubrics ───────────────────────────────────────────────────────
    await emit(f"Fetching {len(rubric_ids_needed)} rubrics...")

    for rubric_id, primary_assignment_id in rubric_ids_needed.items():
        rubric_node_id = f"rubric-{rubric_id}"
        try:
            rdata = await asyncio.to_thread(course.get_rubric, int(rubric_id))
            rd = rdata.__dict__
            title = rd.get("title", f"Rubric {rubric_id}")
            pts = rd.get("points_possible")
            criteria = rd.get("data") or []

            criteria_json = json.dumps(
                [
                    {
                        "id": c.get("id"),
                        "description": c.get("description", ""),
                        "long_description": html.unescape(c.get("long_description") or ""),
                        "points": c.get("points"),
                        "ratings": [
                            {
                                "id": r.get("id"),
                                "label": r.get("description") or "",
                                "description": r.get("description"),
                                "points": r.get("points"),
                            }
                            for r in c.get("ratings", [])
                        ],
                    }
                    for c in criteria
                ]
            )

            # Upsert rubrics table (structured criteria for audit engine)
            cursor = await db.execute("SELECT 1 FROM rubrics WHERE id=?", (rubric_node_id,))
            if await cursor.fetchone():
                await db.execute(
                    "UPDATE rubrics SET title=?, points_possible=?, criteria_json=?, canvas_id=?, updated_at=? WHERE id=?",
                    (title, pts, criteria_json, rubric_id, now, rubric_node_id),
                )
            else:
                await db.execute(
                    "INSERT INTO rubrics (id, canvas_id, title, points_possible, criteria_json, assignment_id, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (
                        rubric_node_id,
                        rubric_id,
                        title,
                        pts,
                        criteria_json,
                        primary_assignment_id,
                        now,
                        now,
                    ),
                )

            result.rubrics_fetched += 1

        except Exception as exc:
            logger.warning("Failed to fetch rubric %s: %s", rubric_id, exc)
            result.errors.append(f"rubric-{rubric_id}: {exc}")

    # Remove legacy rubric nodes and links so rubrics are represented only via assignments.
    await db.execute(
        "DELETE FROM node_links WHERE source_id IN (SELECT id FROM nodes WHERE type='rubric') "
        "OR target_id IN (SELECT id FROM nodes WHERE type='rubric')"
    )
    await db.execute("DELETE FROM nodes WHERE type='rubric'")

    await db.commit()
    await emit(
        f"Sync complete — {result.assignments} assignments, {result.pages} pages, "
        f"{result.files} files, {result.links_extracted} links extracted, "
        f"{result.rubrics_fetched} rubrics, "
        f"{result.rubrics_linked} rubric links"
    )
    return result


async def _upsert_node(
    db: aiosqlite.Connection, node_id: str, data: dict[str, object], now: str
) -> None:
    """Insert or merge a node directly via SQL (mirrors node_service.upsert_node logic)."""
    import hashlib

    def _hash(*parts: object) -> str:
        combined = "|".join(str(p or "") for p in parts)
        return hashlib.sha256(combined.encode()).hexdigest()[:16]

    content_hash = _hash(data.get("description"), data.get("rubric_id"))

    # Serialize submission_types if it's a list (already done upstream, but guard)
    if isinstance(data.get("submission_types"), list):
        data = {**data, "submission_types": json.dumps(data["submission_types"])}

    cursor = await db.execute("SELECT 1 FROM nodes WHERE id=?", (node_id,))
    exists = await cursor.fetchone()

    if exists:
        fields = {k: v for k, v in data.items() if v is not None}
        fields["updated_at"] = now
        fields["content_hash"] = content_hash
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        await db.execute(
            f"UPDATE nodes SET {set_clause} WHERE id = ?",  # noqa: S608
            [*fields.values(), node_id],
        )
    else:
        row = {
            "id": node_id,
            "created_at": now,
            "updated_at": now,
            "content_hash": content_hash,
            **data,
        }
        cols = ", ".join(row.keys())
        placeholders = ", ".join("?" for _ in row)
        await db.execute(
            f"INSERT INTO nodes ({cols}) VALUES ({placeholders})",  # noqa: S608
            list(row.values()),
        )
