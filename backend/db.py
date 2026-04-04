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
        # Wait up to 10s for a write lock instead of failing immediately.
        # Needed when the audit MCP subprocess (separate process) has a transaction open.
        await _db.execute("PRAGMA busy_timeout=10000")
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

    # Idempotent migration: fix findings FK broken by the audit_runs rename.
    # SQLite auto-rewrites FK references on RENAME, so findings ended up pointing
    # at audit_runs_old (which was then dropped). Rebuild findings with the correct FK.
    cursor = await db.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='findings'"
    )
    row = await cursor.fetchone()
    if row and "audit_runs_old" in str(row[0]):
        await db.executescript("""
            PRAGMA foreign_keys=OFF;
            ALTER TABLE findings RENAME TO findings_old;
            CREATE TABLE findings (
                id                      TEXT PRIMARY KEY,
                assignment_id           TEXT NOT NULL REFERENCES nodes(id),
                audit_run_id            TEXT NOT NULL REFERENCES audit_runs(id),
                severity                TEXT NOT NULL CHECK(severity IN ('gap','warn','info','ok')),
                finding_type            TEXT NOT NULL CHECK(finding_type IN (
                    'clarity','rubric_mismatch','rubric_drift','assumption_gap',
                    'implicit_prerequisite','dependency_gap','format_mismatch',
                    'orphan','cascade_risk','curriculum_gap','broken_file_link'
                )),
                title                   TEXT NOT NULL,
                body                    TEXT NOT NULL,
                linked_node             TEXT,
                evidence                TEXT,
                pass_number             INTEGER NOT NULL CHECK(pass_number IN (1,2,3)),
                status                  TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','stale','resolved','superseded','confirmed')),
                content_hash_at_creation TEXT,
                superseded_by           TEXT REFERENCES findings(id),
                created_at              TEXT NOT NULL DEFAULT (datetime('now')),
                resolved_at             TEXT
            );
            INSERT INTO findings SELECT * FROM findings_old;
            DROP TABLE findings_old;
            CREATE INDEX IF NOT EXISTS idx_findings_assignment ON findings(assignment_id);
            CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
            CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(audit_run_id);
            CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
            PRAGMA foreign_keys=ON;
        """)
        await db.commit()

    # Idempotent migration: upgrade audit_runs to add checkpoint/resume support
    # Must use rename-create-copy-drop because SQLite can't ALTER a CHECK constraint.
    cursor = await db.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_runs'"
    )
    row = await cursor.fetchone()
    if row and "'paused'" not in str(row[0]):
        await db.executescript("""
            PRAGMA foreign_keys=OFF;
            ALTER TABLE audit_runs RENAME TO audit_runs_old;
            CREATE TABLE audit_runs (
                id               TEXT PRIMARY KEY,
                assignment_id    TEXT NOT NULL REFERENCES nodes(id),
                status           TEXT NOT NULL DEFAULT 'running'
                                 CHECK(status IN ('running','done','error','paused')),
                pass1_findings   INTEGER NOT NULL DEFAULT 0,
                pass2_findings   INTEGER NOT NULL DEFAULT 0,
                pass3_findings   INTEGER NOT NULL DEFAULT 0,
                total_findings   INTEGER NOT NULL DEFAULT 0,
                started_at       TEXT NOT NULL DEFAULT (datetime('now')),
                finished_at      TEXT,
                error_message    TEXT,
                completed_passes INTEGER NOT NULL DEFAULT 0,
                paused_at        TEXT,
                resume_reason    TEXT
            );
            INSERT INTO audit_runs
                SELECT id, assignment_id, status, pass1_findings, pass2_findings,
                       pass3_findings, total_findings, started_at, finished_at,
                       error_message, 0, NULL, NULL
                FROM audit_runs_old;
            DROP TABLE audit_runs_old;
            CREATE INDEX IF NOT EXISTS idx_audit_runs_assignment ON audit_runs(assignment_id);
            CREATE INDEX IF NOT EXISTS idx_audit_runs_status ON audit_runs(status);
            PRAGMA foreign_keys=ON;
        """)
        await db.commit()
