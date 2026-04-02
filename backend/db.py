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
    """Initialize the database — run schema if tables don't exist."""
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
        await get_db()
