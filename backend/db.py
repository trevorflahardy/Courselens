"""Async SQLite connection management."""

from __future__ import annotations

import aiosqlite
from pathlib import Path

DB_PATH = Path("data/audit.db")

_db: aiosqlite.Connection | None = None


async def get_db() -> aiosqlite.Connection:
    """Get or create the shared database connection."""
    global _db  # noqa: PLW0603
    if _db is None:
        _db = await aiosqlite.connect(str(DB_PATH))
        _db.row_factory = aiosqlite.Row
        await _db.execute("PRAGMA journal_mode=WAL")
        await _db.execute("PRAGMA foreign_keys=ON")
    return _db


async def close_db() -> None:
    """Close the database connection."""
    global _db  # noqa: PLW0603
    if _db is not None:
        await _db.close()
        _db = None


async def init_db() -> None:
    """Initialize the database — run schema if tables don't exist, then run migrations."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='nodes'"
    )
    row = await cursor.fetchone()
    if row is None:
        # Run the schema script
        import scripts.setup_db as setup
        setup.setup_database()
        # Reconnect after schema creation
        await close_db()
        db = await get_db()

    # Idempotent migration: add suggestions table if missing
    cursor = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='suggestions'"
    )
    if await cursor.fetchone() is None:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS suggestions (
                id              TEXT PRIMARY KEY,
                finding_id      TEXT NOT NULL REFERENCES findings(id),
                node_id         TEXT NOT NULL REFERENCES nodes(id),
                field           TEXT NOT NULL,
                original_text   TEXT NOT NULL,
                suggested_text  TEXT NOT NULL,
                diff_patch      TEXT NOT NULL,
                status          TEXT NOT NULL DEFAULT 'pending'
                                CHECK(status IN ('pending','approved','denied','ignored')),
                created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                resolved_at     TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_suggestions_finding ON suggestions(finding_id);
            CREATE INDEX IF NOT EXISTS idx_suggestions_node    ON suggestions(node_id);
            CREATE INDEX IF NOT EXISTS idx_suggestions_status  ON suggestions(status);
        """)
        await db.commit()
