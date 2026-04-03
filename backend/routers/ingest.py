"""Ingest API routes — ZIP import, Canvas live sync, and graph rebuild."""

from __future__ import annotations

import asyncio
import logging
import tempfile
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.services.ingest.canvas_zip import ingest_zip as do_ingest_zip
from backend.services.ingest.graph_builder import rebuild_graph

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

# Simple status tracking — includes stage, feed, and last_run after a sync completes
_ingest_status: dict[str, object] = {
    "status": "idle",
    "message": "No ingestion in progress",
    "feed": [],
}


@router.post("/zip")
async def ingest_zip(
    zip_filename: str = "course_files_export.zip",
    file: UploadFile | None = File(default=None),
) -> dict[str, object]:
    """Ingest from either an uploaded ZIP file or a ZIP already stored in data/."""
    global _ingest_status
    temp_zip: Path | None = None

    if file is not None:
        suffix = Path(file.filename or "upload.zip").suffix or ".zip"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        try:
            contents = await file.read()
            tmp.write(contents)
            tmp.flush()
        finally:
            tmp.close()
        temp_zip = Path(tmp.name)
        zip_path = temp_zip
        display_name = file.filename or temp_zip.name
    else:
        zip_path = Path("data") / zip_filename
        display_name = zip_filename
        if not zip_path.exists():
            raise HTTPException(status_code=404, detail=f"ZIP file not found: {zip_path}")

    _ingest_status = {"status": "running", "message": f"Ingesting {display_name}..."}

    try:
        result = await do_ingest_zip(str(zip_path))
        _ingest_status = {
            "status": "done",
            "message": f"Ingested {result.nodes_created} nodes from {result.files_extracted} files",
        }
        return asdict(result)
    except Exception as e:
        logger.exception("ZIP ingestion failed")
        _ingest_status = {"status": "error", "message": str(e)}
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if temp_zip is not None:
            try:
                temp_zip.unlink(missing_ok=True)
            except Exception:
                logger.warning("Failed to remove temporary uploaded ZIP: %s", temp_zip)


@router.post("/rebuild-graph")
async def api_rebuild_graph() -> dict[str, object]:
    """Rebuild the dependency graph from current node data."""
    try:
        result = await rebuild_graph()
        return asdict(result)
    except Exception as e:
        logger.exception("Graph rebuild failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/course")
async def ingest_course() -> dict[str, str]:
    """Trigger Canvas live sync (pure Python via canvasapi). Poll /status for progress."""
    global _ingest_status

    if _ingest_status.get("status") == "running":
        return {"status": "already_running"}

    _ingest_status = {
        "status": "running",
        "stage": "fetching_modules",
        "message": "Canvas sync starting...",
        "feed": [],
    }
    asyncio.create_task(_run_python_canvas_sync())
    return {"status": "started"}


async def _run_python_canvas_sync() -> None:
    """Background task: pure-Python Canvas sync using canvasapi library."""
    global _ingest_status
    from backend.config import settings
    from backend.db import get_db
    from backend.services.ingest.canvas_sync import run_full_sync

    course_id = settings.canvas_course_id
    if not course_id:
        logger.error("Canvas sync aborted: canvas_course_id is not set in .env")
        _ingest_status = {
            "status": "error",
            "stage": "error",
            "message": "canvas_course_id not set in .env",
        }
        return

    if not settings.canvas_api_token:
        logger.error("Canvas sync aborted: canvas_api_token is not set in .env")
        _ingest_status = {
            "status": "error",
            "stage": "error",
            "message": "canvas_api_token not set in .env",
        }
        return

    logger.info("Python Canvas sync starting for course %s", course_id)

    async def _on_progress(msg: str) -> None:
        feed = _ingest_status.get("feed")
        if isinstance(feed, list):
            feed.append(msg)
        _ingest_status["message"] = msg

    try:
        db = await get_db()
        result = await run_full_sync(
            course_id=course_id,
            canvas_base_url=settings.canvas_api_url,
            canvas_token=settings.canvas_api_token,
            db=db,
            on_progress=_on_progress,
        )
        if result.errors:
            logger.warning(
                "Canvas sync completed with %d errors: %s", len(result.errors), result.errors
            )

        await _on_progress("Building dependency graph...")
        graph_result = await rebuild_graph()
        _ingest_status.update(
            {
                "status": "done",
                "stage": "done",
                "last_run": datetime.now().isoformat(),
                "message": (
                    f"Sync complete — {result.assignments} assignments, {result.pages} pages, "
                    f"{result.files} files, {result.rubrics_fetched} rubrics, "
                    f"{graph_result.total_edges} graph edges"
                ),
            }
        )
    except Exception as exc:
        logger.exception("Python Canvas sync background task raised an unhandled exception")
        _ingest_status.update({"status": "error", "stage": "error", "message": str(exc)})


@router.get("/status")
async def ingest_status() -> dict[str, object]:
    """Get current ingestion status."""
    return _ingest_status


@router.get("/processes")
async def list_processes() -> list[dict[str, object]]:
    """Return all tracked Claude subprocesses and whether they are still alive."""
    from backend.claude_runner import _active_runs

    result = []
    for run in _active_runs.values():
        proc = run.process
        alive = proc is not None and proc.returncode is None
        result.append(
            {
                "run_id": run.run_id,
                "assignment_id": run.assignment_id,
                "status": run.status,
                "pid": proc.pid if proc else None,
                "alive": alive,
                "started_at": run.started_at,
                "finished_at": run.finished_at,
            }
        )
    return result


@router.post("/dedup-files")
async def dedup_files() -> dict[str, int]:
    """Find file nodes whose titles are duplicates after URL-decoding, keep the best one, delete the rest."""
    from urllib.parse import unquote_plus
    from backend.db import get_db

    db = await get_db()

    cursor = await db.execute(
        "SELECT id, title, canvas_url, week, module, updated_at FROM nodes WHERE type = 'file'"
    )
    rows = await cursor.fetchall()

    # Group by normalized title
    groups: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        normalized = unquote_plus(str(row["title"] or "")).strip()
        groups.setdefault(normalized, []).append(dict(row))

    merged = 0
    deleted = 0

    for _title, nodes in groups.items():
        if len(nodes) < 2:
            continue

        # Pick the "best" node: prefer one with canvas_url, then week, then most recently updated
        def _score(n: dict[str, object]) -> tuple[int, int, str]:
            return (
                1 if n.get("canvas_url") else 0,
                1 if n.get("week") is not None else 0,
                str(n.get("updated_at") or ""),
            )

        nodes.sort(key=_score, reverse=True)
        keeper_id = str(nodes[0]["id"])
        duplicate_ids = [str(n["id"]) for n in nodes[1:]]

        logger.info("Dedup: keeping %s, removing %s", keeper_id, duplicate_ids)

        for dup_id in duplicate_ids:
            # Re-point node_links
            await db.execute(
                "UPDATE node_links SET source_id = ? WHERE source_id = ?", (keeper_id, dup_id)
            )
            await db.execute(
                "UPDATE node_links SET target_id = ? WHERE target_id = ?", (keeper_id, dup_id)
            )
            # Re-point findings and audit_runs
            await db.execute(
                "UPDATE findings SET assignment_id = ? WHERE assignment_id = ?", (keeper_id, dup_id)
            )
            await db.execute(
                "UPDATE audit_runs SET assignment_id = ? WHERE assignment_id = ?",
                (keeper_id, dup_id),
            )
            # Re-point edges
            await db.execute("UPDATE edges SET source = ? WHERE source = ?", (keeper_id, dup_id))
            await db.execute("UPDATE edges SET target = ? WHERE target = ?", (keeper_id, dup_id))
            # Delete duplicate (node_links with both ends == keeper become duplicates; ignore constraint)
            await db.execute("DELETE FROM node_links WHERE source_id = target_id")
            await db.execute("DELETE FROM nodes WHERE id = ?", (dup_id,))
            deleted += 1

        merged += 1

    await db.commit()
    return {"groups_merged": merged, "nodes_deleted": deleted}


@router.post("/link-rubrics")
async def link_rubrics() -> dict[str, object]:
    """Normalize assignment rubric references and validate rubric table rows.

    Rubrics are represented through assignment.rubric_id + the rubrics table,
    not as standalone graph nodes.
    """
    from backend.db import get_db

    db = await get_db()

    cursor = await db.execute(
        "SELECT id, rubric_id FROM nodes WHERE type='assignment' AND rubric_id IS NOT NULL"
    )
    assignments = await cursor.fetchall()

    linked = 0
    already_linked = 0
    missing: list[dict[str, str]] = []

    for row in assignments:
        aid: str = row["id"]
        rid: str = row["rubric_id"]
        rubric_ref = rid if rid.startswith("rubric-") else f"rubric-{rid}"
        canvas_id = rubric_ref[7:]

        if rubric_ref != rid:
            await db.execute("UPDATE nodes SET rubric_id=? WHERE id=?", (rubric_ref, aid))
            linked += 1
        else:
            already_linked += 1

        c = await db.execute(
            "SELECT 1 FROM rubrics WHERE id = ? OR canvas_id = ?",
            (rubric_ref, canvas_id),
        )
        if await c.fetchone() is None:
            missing.append({"assignment_id": aid, "rubric_id": rubric_ref})

    await db.execute(
        "DELETE FROM node_links WHERE source_id IN (SELECT id FROM nodes WHERE type='rubric') "
        "OR target_id IN (SELECT id FROM nodes WHERE type='rubric')"
    )
    await db.execute("DELETE FROM nodes WHERE type='rubric'")

    await db.commit()
    return {"linked": linked, "already_linked": already_linked, "missing_rubric_nodes": missing}


@router.post("/sync-rubrics")
async def sync_rubrics() -> dict[str, object]:
    """Pure-Python Canvas REST sync for rubrics.

    1. Fetches all assignments from Canvas to get authoritative rubric_id values.
    2. Updates nodes.rubric_id for every assignment.
    3. Fetches full rubric details (criteria, ratings) for every rubric_id found.
    4. Populates the rubrics table (structured criteria + ratings).
    5. Removes legacy rubric nodes so rubrics are represented via assignments only.

    No Claude subprocess needed — deterministic and always correct.
    """
    import html as _html
    import json as _json
    import urllib.error
    import urllib.request
    from datetime import datetime

    from backend.config import settings
    from backend.db import get_db

    if not settings.canvas_api_token:
        raise HTTPException(status_code=500, detail="CANVAS_API_TOKEN not set in .env")

    base = settings.canvas_api_url.rstrip("/")
    course_id = settings.canvas_course_id
    headers = {"Authorization": f"Bearer {settings.canvas_api_token}"}

    def _get(url: str) -> object:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as r:
            return _json.load(r)

    now = datetime.now().isoformat()
    db = await get_db()

    # Step 1 — fetch all assignments from Canvas
    assignments_data = await asyncio.to_thread(
        _get, f"{base}/courses/{course_id}/assignments?per_page=100"
    )
    if not isinstance(assignments_data, list):
        raise HTTPException(status_code=502, detail="Unexpected Canvas response for assignments")

    rubric_ids_to_fetch: dict[str, str] = {}  # rubric_id → assignment_id
    assignment_updates = 0

    for a in assignments_data:
        assignment_id = f"assignment-{a['id']}"
        rubric_id = str(a["rubric_settings"]["id"]) if a.get("rubric_settings") else None
        rubric_ref = f"rubric-{rubric_id}" if rubric_id else None

        # Check node exists in DB
        cursor = await db.execute("SELECT 1 FROM nodes WHERE id=?", (assignment_id,))
        if await cursor.fetchone() is None:
            continue

        # Update rubric_id on assignment node
        await db.execute(
            "UPDATE nodes SET rubric_id=?, updated_at=? WHERE id=?",
            (rubric_ref, now, assignment_id),
        )
        assignment_updates += 1

        if rubric_id:
            rubric_ids_to_fetch[rubric_id] = assignment_id

    await db.commit()

    # Step 2 — fetch and upsert each unique rubric
    rubric_nodes_upserted = 0
    links_created = 0
    errors: list[str] = []

    for rubric_id, primary_assignment_id in rubric_ids_to_fetch.items():
        rubric_node_id = f"rubric-{rubric_id}"
        try:
            rdata = await asyncio.to_thread(_get, f"{base}/courses/{course_id}/rubrics/{rubric_id}")
            if not isinstance(rdata, dict):
                raise ValueError("non-dict rubric response")

            title = rdata.get("title", f"Rubric {rubric_id}")
            pts = rdata.get("points_possible")
            criteria = rdata.get("data") or []

            criteria_json = _json.dumps(
                [
                    {
                        "id": c.get("id"),
                        "description": c.get("description", ""),
                        "long_description": _html.unescape(c.get("long_description") or ""),
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
            rubric_nodes_upserted += 1

            # Upsert rubrics table (structured criteria)
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

        except Exception as exc:
            errors.append(f"rubric-{rubric_id}: {exc}")
            logger.warning("sync-rubrics error for rubric %s: %s", rubric_id, exc)

    await db.execute(
        "DELETE FROM node_links WHERE source_id IN (SELECT id FROM nodes WHERE type='rubric') "
        "OR target_id IN (SELECT id FROM nodes WHERE type='rubric')"
    )
    await db.execute("DELETE FROM nodes WHERE type='rubric'")

    await db.commit()

    return {
        "assignment_nodes_updated": assignment_updates,
        "rubrics_upserted": rubric_nodes_upserted,
        "links_created": links_created,
        "errors": errors,
    }


@router.post("/relink-content")
async def relink_content() -> dict[str, int]:
    """Re-extract assignment/page HTML links into node_links and rebuild graph edges."""
    from backend.db import get_db
    from backend.services.ingest.canvas_live import _extract_and_store_links

    db = await get_db()
    cursor = await db.execute(
        """
        SELECT id, description
        FROM nodes
        WHERE type IN ('assignment', 'page')
          AND description IS NOT NULL
        """
    )
    sources = await cursor.fetchall()

    links_extracted = 0
    nodes_processed = 0
    for row in sources:
        description = row["description"]
        if not isinstance(description, str) or not description.strip():
            continue
        links_extracted += await _extract_and_store_links(str(row["id"]), description)
        nodes_processed += 1

    graph_result = await rebuild_graph()
    return {
        "nodes_processed": nodes_processed,
        "links_extracted": links_extracted,
        "edges_total": graph_result.total_edges,
    }


@router.post("/clear-all")
async def clear_all() -> dict[str, int]:
    """Wipe every table so the user can start a fresh ingest from scratch."""
    from backend.db import get_db

    db = await get_db()

    counts: dict[str, int] = {}
    try:
        await db.execute("PRAGMA foreign_keys=OFF")
        # Delete in FK-safe order. ingest_log references nodes(node_id), so it must be cleared first.
        for table in (
            "findings",
            "audit_runs",
            "edges",
            "node_links",
            "files",
            "rubrics",
            "ingest_log",
            "nodes",
        ):
            cursor = await db.execute(f"DELETE FROM {table}")  # noqa: S608
            counts[f"{table}_deleted"] = cursor.rowcount
        await db.commit()
        return counts
    finally:
        await db.execute("PRAGMA foreign_keys=ON")


@router.post("/cleanup-test-data")
async def cleanup_test_data() -> dict[str, int]:
    """Remove demo/seed data that predates real Canvas ingestion.

    The cleanup targets records with source='seed' and their dependent rows.
    """
    from backend.db import get_db

    db = await get_db()

    cursor = await db.execute("SELECT id FROM nodes WHERE source = 'seed'")
    node_rows = await cursor.fetchall()
    node_ids = [str(row[0]) for row in node_rows]

    if not node_ids:
        return {
            "nodes_deleted": 0,
            "edges_deleted": 0,
            "links_deleted": 0,
            "findings_deleted": 0,
            "audit_runs_deleted": 0,
            "rubrics_deleted": 0,
        }

    placeholders = ",".join("?" for _ in node_ids)

    async def _delete_count(query: str, params: tuple[object, ...]) -> int:
        cursor_local = await db.execute(query, params)
        return cursor_local.rowcount if cursor_local.rowcount >= 0 else 0

    findings_deleted = await _delete_count(
        f"DELETE FROM findings WHERE assignment_id IN ({placeholders})",
        tuple(node_ids),
    )

    audit_runs_deleted = await _delete_count(
        f"DELETE FROM audit_runs WHERE assignment_id IN ({placeholders})",
        tuple(node_ids),
    )

    edges_deleted = await _delete_count(
        f"DELETE FROM edges WHERE source IN ({placeholders}) OR target IN ({placeholders})",
        tuple(node_ids + node_ids),
    )

    links_deleted = await _delete_count(
        f"DELETE FROM node_links WHERE source_id IN ({placeholders}) OR target_id IN ({placeholders})",
        tuple(node_ids + node_ids),
    )

    rubrics_deleted = await _delete_count(
        "DELETE FROM rubrics WHERE id IN (SELECT rubric_id FROM nodes WHERE source = 'seed' AND rubric_id IS NOT NULL) "
        "OR assignment_id IN (SELECT id FROM nodes WHERE source = 'seed')",
        (),
    )

    nodes_deleted = await _delete_count(
        f"DELETE FROM nodes WHERE id IN ({placeholders})",
        tuple(node_ids),
    )

    await db.commit()

    return {
        "nodes_deleted": nodes_deleted,
        "edges_deleted": edges_deleted,
        "links_deleted": links_deleted,
        "findings_deleted": findings_deleted,
        "audit_runs_deleted": audit_runs_deleted,
        "rubrics_deleted": rubrics_deleted,
    }
