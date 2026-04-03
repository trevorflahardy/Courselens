"""
One-shot Canvas ingestion script for course 2018858.
Fetches assignments, pages, files; upserts to data/audit.db.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

CANVAS_TOKEN = "13~UuDJw4F7G8T69kHLzcYhyXeEtRuLcnmWCh2a6T9QkmzRRVUZ6ECxBCDTJKy6FcaL"
CANVAS_BASE = "https://usflearn.instructure.com/api/v1"
COURSE_ID = 2018858
COURSE_URL = f"https://usflearn.instructure.com/courses/{COURSE_ID}"

DB_PATH = Path(__file__).parent.parent / "data" / "audit.db"

HEADERS = {
    "Authorization": f"Bearer {CANVAS_TOKEN}",
    "Accept": "application/json",
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


def get(path: str, params: dict | None = None) -> Any:
    url = f"{CANVAS_BASE}{path}"
    resp = SESSION.get(url, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def sha256_prefix(text: str) -> str:
    return hashlib.sha256((text or "").encode()).hexdigest()[:16]


def week_from_module(name: str) -> int | None:
    m = re.search(r"\bWeek\s+(\d+)\b", name, re.IGNORECASE)
    return int(m.group(1)) if m else None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def upsert_node(cur: sqlite3.Cursor, node: dict) -> None:
    cur.execute(
        """
        INSERT INTO nodes (
            id, type, title, week, module, module_order, description,
            points_possible, submission_types, rubric_id,
            canvas_url, source, status, content_hash, created_at, updated_at
        ) VALUES (
            :id, :type, :title, :week, :module, :module_order, :description,
            :points_possible, :submission_types, :rubric_id,
            :canvas_url, :source, :status, :content_hash, :created_at, :updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
            title        = excluded.title,
            week         = excluded.week,
            module       = excluded.module,
            module_order = excluded.module_order,
            description  = excluded.description,
            points_possible = excluded.points_possible,
            submission_types = excluded.submission_types,
            rubric_id    = excluded.rubric_id,
            canvas_url   = excluded.canvas_url,
            source       = excluded.source,
            content_hash = excluded.content_hash,
            updated_at   = excluded.updated_at
        """,
        node,
    )


def upsert_rubric(cur: sqlite3.Cursor, rubric: dict) -> None:
    cur.execute(
        """
        INSERT INTO rubrics (
            id, canvas_id, title, points_possible, criteria_json,
            assignment_id, content_hash, created_at, updated_at
        ) VALUES (
            :id, :canvas_id, :title, :points_possible, :criteria_json,
            :assignment_id, :content_hash, :created_at, :updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
            title          = excluded.title,
            points_possible = excluded.points_possible,
            criteria_json  = excluded.criteria_json,
            assignment_id  = excluded.assignment_id,
            content_hash   = excluded.content_hash,
            updated_at     = excluded.updated_at
        """,
        rubric,
    )


def upsert_link(cur: sqlite3.Cursor, source_id: str, target_id: str, link_type: str) -> None:
    cur.execute(
        """
        INSERT OR IGNORE INTO node_links (source_id, target_id, link_type)
        VALUES (?, ?, ?)
        """,
        (source_id, target_id, link_type),
    )


def main() -> None:
    ts = now_iso()
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    cur = conn.cursor()

    # ── Fetch full course structure ───────────────────────────────────────────
    print("Fetching course modules...", flush=True)
    modules_raw = get(f"/courses/{COURSE_ID}/modules", {"include[]": "items", "per_page": 100})

    counts = {"assignments": 0, "pages": 0, "files": 0, "rubrics": 0}
    seen_files: set[int] = set()

    for mod in modules_raw:
        mod_name: str = mod["name"]
        mod_week = week_from_module(mod_name)
        items = mod.get("items", [])

        for item in items:
            itype = item.get("type")
            if itype in ("SubHeader", "ExternalTool", "ExternalUrl"):
                continue

            pos = item.get("position", 0)
            pub = item.get("published", True)

            # ── ASSIGNMENT ──────────────────────────────────────────────────
            if itype == "Assignment":
                content_id = item["content_id"]
                print(f"  Fetching assignment {content_id}: {item['title']}", flush=True)
                try:
                    det = get(f"/courses/{COURSE_ID}/assignments/{content_id}")
                except Exception as e:
                    print(f"    ERROR: {e}", flush=True)
                    det = {}

                desc = det.get("description") or ""
                points = det.get("points_possible")
                sub_types = json.dumps(det.get("submission_types", []))
                rubric_id_ref = det.get("rubric_settings", {}).get("id") if det.get("rubric_settings") else None
                # Canvas sometimes puts rubric directly
                rubric_id_canvas = det.get("rubric_settings", {}).get("id") if det.get("rubric_settings") else None

                node_id = f"assignment-{content_id}"
                upsert_node(cur, {
                    "id": node_id,
                    "type": "assignment",
                    "title": item["title"],
                    "week": mod_week,
                    "module": mod_name,
                    "module_order": pos,
                    "description": desc,
                    "points_possible": points,
                    "submission_types": sub_types,
                    "rubric_id": str(rubric_id_canvas) if rubric_id_canvas else None,
                    "canvas_url": f"{COURSE_URL}/assignments/{content_id}",
                    "source": "canvas_mcp",
                    "status": "unaudited",
                    "content_hash": sha256_prefix(desc),
                    "created_at": ts,
                    "updated_at": ts,
                })
                counts["assignments"] += 1

                # ── Rubric ──────────────────────────────────────────────────
                rubric_data = det.get("rubric")
                rubric_settings = det.get("rubric_settings")
                if rubric_data and rubric_settings:
                    r_canvas_id = rubric_settings.get("id")
                    r_title = rubric_settings.get("title", "Rubric")
                    r_points = rubric_settings.get("points_possible")
                    criteria_json = json.dumps(rubric_data)
                    rubric_node_id = f"rubric-{r_canvas_id}"

                    upsert_rubric(cur, {
                        "id": rubric_node_id,
                        "canvas_id": str(r_canvas_id),
                        "title": r_title,
                        "points_possible": r_points,
                        "criteria_json": criteria_json,
                        "assignment_id": node_id,
                        "content_hash": sha256_prefix(criteria_json),
                        "created_at": ts,
                        "updated_at": ts,
                    })
                    upsert_link(cur, node_id, rubric_node_id, "has_rubric")
                    counts["rubrics"] += 1
                    print(f"    Rubric: {r_title} ({r_canvas_id})", flush=True)

                time.sleep(0.1)

            # ── PAGE ────────────────────────────────────────────────────────
            elif itype in ("Page", "WikiPage"):
                page_url_slug = item.get("page_url") or ""
                print(f"  Fetching page: {page_url_slug}", flush=True)
                try:
                    det = get(f"/courses/{COURSE_ID}/pages/{page_url_slug}")
                    body = det.get("body") or ""
                except Exception as e:
                    print(f"    ERROR: {e}", flush=True)
                    body = ""

                node_id = f"page-{page_url_slug}"
                upsert_node(cur, {
                    "id": node_id,
                    "type": "page",
                    "title": item["title"],
                    "week": mod_week,
                    "module": mod_name,
                    "module_order": pos,
                    "description": body,
                    "points_possible": None,
                    "submission_types": None,
                    "rubric_id": None,
                    "canvas_url": f"{COURSE_URL}/pages/{page_url_slug}",
                    "source": "canvas_mcp",
                    "status": "unaudited",
                    "content_hash": sha256_prefix(body),
                    "created_at": ts,
                    "updated_at": ts,
                })
                counts["pages"] += 1
                time.sleep(0.1)

            # ── FILE ────────────────────────────────────────────────────────
            elif itype == "File":
                content_id = item["content_id"]
                if content_id in seen_files:
                    continue
                seen_files.add(content_id)

                node_id = f"file-{content_id}"
                upsert_node(cur, {
                    "id": node_id,
                    "type": "file",
                    "title": item["title"],
                    "week": mod_week,
                    "module": mod_name,
                    "module_order": pos,
                    "description": None,
                    "points_possible": None,
                    "submission_types": None,
                    "rubric_id": None,
                    "canvas_url": f"{COURSE_URL}/files/{content_id}",
                    "source": "canvas_mcp",
                    "status": "unaudited",
                    "content_hash": sha256_prefix(item["title"]),
                    "created_at": ts,
                    "updated_at": ts,
                })
                counts["files"] += 1
                print(f"  File: {item['title']} ({content_id})", flush=True)

    conn.commit()
    conn.close()

    result = {
        "status": "done",
        "modules": len(modules_raw),
        "assignments": counts["assignments"],
        "pages": counts["pages"],
        "files": counts["files"],
        "rubrics": counts["rubrics"],
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
