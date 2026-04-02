"""Create the SQLite database schema for the Course Audit System."""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "audit.db"

SCHEMA = """
-- Enable WAL mode for concurrent reads during SSE polling
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- All course content: assignments, pages, rubrics, lectures, announcements, files
CREATE TABLE IF NOT EXISTS nodes (
    id              TEXT PRIMARY KEY,
    type            TEXT NOT NULL CHECK(type IN ('assignment','page','rubric','lecture','announcement','file')),
    title           TEXT NOT NULL,
    week            INTEGER,
    module          TEXT,
    module_order    INTEGER,
    description     TEXT,
    instructions    TEXT,
    rubric_text     TEXT,
    file_content    TEXT,
    file_path       TEXT,
    canvas_url      TEXT,
    source          TEXT NOT NULL DEFAULT 'canvas_mcp',
    status          TEXT NOT NULL DEFAULT 'unaudited' CHECK(status IN ('ok','warn','gap','orphan','unaudited')),
    content_hash    TEXT,
    last_audited    TEXT,
    finding_count   INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_week ON nodes(week);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_content_hash ON nodes(content_hash);

-- Node-to-node references (file links, page links, assignment links)
CREATE TABLE IF NOT EXISTS node_links (
    source_id   TEXT NOT NULL REFERENCES nodes(id),
    target_id   TEXT NOT NULL REFERENCES nodes(id),
    link_type   TEXT NOT NULL CHECK(link_type IN ('file','page','assignment')),
    PRIMARY KEY (source_id, target_id, link_type)
);

-- Downloaded file metadata and extracted text
CREATE TABLE IF NOT EXISTS files (
    id              TEXT PRIMARY KEY,
    filename        TEXT NOT NULL,
    local_path      TEXT NOT NULL,
    content_type    TEXT,
    size_bytes      INTEGER,
    extracted_text  TEXT,
    text_hash       TEXT,
    downloaded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_files_filename ON files(filename);

-- Dependency graph edges
CREATE TABLE IF NOT EXISTS edges (
    source      TEXT NOT NULL REFERENCES nodes(id),
    target      TEXT NOT NULL REFERENCES nodes(id),
    edge_type   TEXT NOT NULL CHECK(edge_type IN ('explicit','inferred','artifact','gap')),
    label       TEXT,
    evidence    TEXT,
    confidence  REAL,
    status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','stale')),
    derived_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (source, target, edge_type)
);
CREATE INDEX IF NOT EXISTS idx_edges_status ON edges(status);

-- Audit execution records (must precede findings due to FK)
CREATE TABLE IF NOT EXISTS audit_runs (
    id              TEXT PRIMARY KEY,
    assignment_id   TEXT NOT NULL REFERENCES nodes(id),
    status          TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','done','error')),
    pass1_findings  INTEGER NOT NULL DEFAULT 0,
    pass2_findings  INTEGER NOT NULL DEFAULT 0,
    pass3_findings  INTEGER NOT NULL DEFAULT 0,
    total_findings  INTEGER NOT NULL DEFAULT 0,
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at     TEXT,
    error_message   TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_runs_assignment ON audit_runs(assignment_id);
CREATE INDEX IF NOT EXISTS idx_audit_runs_status ON audit_runs(status);

-- Audit findings with lifecycle tracking
CREATE TABLE IF NOT EXISTS findings (
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
CREATE INDEX IF NOT EXISTS idx_findings_assignment ON findings(assignment_id);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(audit_run_id);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);

-- Ingestion event log
CREATE TABLE IF NOT EXISTS ingest_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id     TEXT REFERENCES nodes(id),
    action      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('success','error','skipped')),
    detail      TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ingest_log_node ON ingest_log(node_id);
CREATE INDEX IF NOT EXISTS idx_ingest_log_status ON ingest_log(status);
"""


def setup_database() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(DB_PATH))
    conn.executescript(SCHEMA)
    conn.close()

    print(f"Database created at {DB_PATH}")

    # Verify tables
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [row[0] for row in cursor.fetchall()]
    conn.close()

    print(f"Tables: {', '.join(tables)}")
    print(f"Count: {len(tables)}")


if __name__ == "__main__":
    setup_database()
