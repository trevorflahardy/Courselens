# Canvas Course Audit System — Architecture

> **Living spec.** Read [APP.md](./APP.md) first for the vision and problem statement.
> Sections marked `[PENDING]` require inputs from Trevor before implementation.
> Everything else can be scaffolded immediately in demo mode.

---

## Table of Contents

1. [System Goals](#system-goals)
2. [Inputs Required](#inputs-required-from-trevor)
3. [Tech Stack](#tech-stack)
4. [Architecture Overview](#architecture-overview)
5. [Directory Structure](#directory-structure)
6. [MCP Server Strategy](#mcp-server-strategy)
7. [Data Models](#data-models)
8. [Backend API](#backend-api)
9. [Canvas Ingestion Pipeline](#canvas-ingestion-pipeline)
10. [AI Audit Engine](#ai-audit-engine)
11. [Frontend Architecture](#frontend-architecture)
12. [Testing Strategy](#testing-strategy)
13. [Security Considerations](#security-considerations)
14. [Error Handling](#error-handling)
15. [Accessibility](#accessibility)
16. [Performance Considerations](#performance-considerations)
17. [Setup & Installation](#setup--installation)
18. [Implementer Notes](#notes-for-implementers)

---

## System Goals

1. **Bulk ingest** an entire Canvas LMS course (EGN 3000L at USF) — assignments, rubrics, pages, lectures, files, announcements — into a structured local data store with relational context preserved.
2. **Run AI audits** per assignment (and cross-assignment) using Claude Code as the AI engine, streaming findings live to a web dashboard.
3. **Visualize** the full dependency graph — assignments that build on each other, gaps, orphans, rubric mismatches — as an interactive force-directed graph.
4. **Enable the fix-reaudit loop.** An instructor sees a finding, fixes the content, re-runs the audit on that one assignment, and watches the node go green. Not a one-time report — a living audit layer.
5. **Zero API costs.** All AI operations run through Claude Code on the Max plan.

---

## Inputs Required from Trevor

| # | What | Why | Blocks |
|---|------|-----|--------|
| 1 | Canvas API token | Canvas MCP authentication | Phase 3 |
| 2 | Canvas course URL / course ID | Target course for ingestion | Phase 3 |
| 3 | Canvas course export ZIP (IMSCC) | Fallback ingestion if API limits arise | Phase 3 |
| 4 | Confirmation of machine OS (macOS assumed) | Path conventions, install commands | Phase 0 |

Until these arrive: scaffold everything, seed demo data, build full UI with fixtures. The system should be fully runnable in "demo mode" with seeded fake assignments before any real Canvas data lands.

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| AI Engine | **Claude Code CLI** (`claude`) | Max plan, no token billing, native MCP, `--output-format stream-json` |
| Backend | **FastAPI** + **uvicorn** + **asyncio** | Async-native, Pydantic v2 strict typing, SSE via `StreamingResponse` |
| Frontend | **Next.js 15** (App Router) | Latest stable, RSC for static parts, file-based routing |
| Vector DB | **ChromaDB** via **Chroma MCP** | Zero-server local RAG — official MCP exists, no custom wrapper needed |
| Canvas Access | **Canvas MCP** (pre-existing) | 80+ tools for courses, assignments, rubrics, modules, pages, announcements |
| Graph Compute | **NetworkX** (in-memory, on-demand) | Loaded from SQLite edges for traversal — not a storage layer |
| Primary DB | **SQLite** via `aiosqlite` | **All structured data**: nodes, findings, edges, audit runs, files, ingest log |
| File Parsing | `pypdf`, `python-docx`, `beautifulsoup4` | PDF/DOCX/HTML text extraction from IMSCC fallback |
| MCP Framework | **FastMCP** (Python) | Composable servers via `mount()`, minimal boilerplate |
| Styling | **Tailwind CSS v4** + **shadcn/ui** | Modern utility-first CSS, accessible component primitives |
| State | **Zustand** | Lightweight, SSE-friendly reactive state |
| HTTP Client | Native **`fetch`** + **`EventSource`** | Browser APIs handle REST and SSE natively — no axios needed |
| Pkg Managers | **uv** (Python) / **npm** (JS) | Fast, modern dependency resolution |
| Testing | **pytest** / **Vitest** / **Playwright** | Backend / frontend unit / e2e |

### Key Architectural Decisions

**Why official MCP servers over custom wrappers:**
The original architecture proposed 4 custom MCP servers including a ChromaDB wrapper and a filesystem server. Both ChromaDB and filesystem have official MCP implementations. Using them eliminates ~300 lines of custom code, gets upstream updates, and follows MCP best practices. We build custom MCP tools only for domain-specific operations (node CRUD with merge logic, graph traversal, finding emission).

**Why Canvas MCP over browser automation:**
The original architecture proposed agent browser navigation with session cookies. The Canvas MCP provides direct API access to all course data — more reliable, faster, no cookie management, and the user already has it.

**Why FastAPI as both backend AND SSE bridge:**
Claude Code subprocess output is stdout lines. FastAPI spawns subprocesses and streams their stdout as SSE using `asyncio.create_subprocess_exec` + `StreamingResponse`. One Python process handles everything — no separate bridge server.

**Why SQLite polling over Unix sockets for SSE:**
The original architecture used a Unix socket for real-time finding emission. This is fragile and platform-specific. Instead: the `emit_finding` tool writes findings to SQLite, and the FastAPI SSE endpoint polls with `WHERE created_at > ? AND audit_run_id = ?` every 500ms. Simpler, debuggable, works on all platforms, and 500ms latency is imperceptible for an audit dashboard.

**Why Next.js 15 over 14:**
Next.js 15 is the latest stable release with improved App Router performance, better Server Components support, and Turbopack stability. No reason to start a new project on 14.

**Why SQLite-primary over JSON files:**
The original architecture stored each course node as a separate JSON file in `data/nodes/`. This works for a read-only system but fails for the fix-reaudit loop: no ACID transactions, no change detection, no way to atomically invalidate findings when content updates, no relational queries across nodes/findings/edges, and concurrent writes from parallel audits can corrupt files. SQLite gives us all of this in a single file that's easy to back up.

**Why keep raw files on filesystem instead of SQLite blobs:**
PDFs and DOCXs are write-once reference material. SQLite can store blobs but there's no query benefit — we only need the extracted text (which goes in the `nodes` table). The filesystem is simpler for files that are just "download once, extract text, reference by path."

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                       Claude Code CLI                        │
│   (Max plan — spawned as subprocess by FastAPI)              │
│                                                              │
│   Connects to:  Canvas MCP  │  Chroma MCP  │  Audit MCP     │
│                 (courses)    │  (RAG)       │  (domain ops)  │
└─────────┬────────────────────┴──────┬───────┴───────┬────────┘
          │                           │               │
          ▼                           ▼               ▼
┌──────────────────┐  ┌────────────────┐  ┌─────────────────────┐
│   Canvas LMS     │  │   ChromaDB     │  │  Local Data Store   │
│   (remote API)   │  │  data/chroma/  │  │  data/audit.db      │
│                  │  │                │  │  (nodes, edges,     │
└──────────────────┘  └────────────────┘  │   findings, files)  │
                                          │  data/files/        │
                                          └──────────┬──────────┘
                                                     │ reads
                                          ┌──────────▼──────────┐
                                          │   FastAPI Backend    │
                                          │   localhost:8000     │
                                          │   REST + SSE         │
                                          └──────────┬──────────┘
                                                     │
                                          ┌──────────▼──────────┐
                                          │   Next.js 15        │
                                          │   localhost:3000     │
                                          │   Dashboard UI       │
                                          └─────────────────────┘
```

### Data Flow

```
1. INGEST:    Canvas MCP ──→ Claude Code ──→ Audit MCP ──→ SQLite (nodes table)
              Files: download_course_file ──→ data/files/ ──→ extract text ──→ SQLite
2. EMBED:     SQLite nodes ──→ Claude Code ──→ Chroma MCP ──→ data/chroma/
3. GRAPH:     nodes + Chroma MCP ──→ Claude Code ──→ Audit MCP ──→ SQLite (edges table)
4. AUDIT:     Audit MCP + Chroma MCP ──→ Claude Code ──→ emit_finding ──→ SQLite (findings)
5. DISPLAY:   SQLite ──→ FastAPI (REST+SSE) ──→ Next.js ──→ User
6. RE-INGEST: User fixes in Canvas ──→ re-pull node ──→ content_hash comparison
              ──→ if changed: mark findings stale ──→ mark edges stale ──→ re-embed
7. RE-AUDIT:  User triggers re-audit ──→ new findings ──→ old stale → resolved/superseded
              ──→ node status recalculated ──→ node goes green
```

---

## Directory Structure

```
course-audit/
├── APP.md                           # Vision & problem statement
├── ARCHITECTURE.md                  # This file
├── PLAN.md                          # Implementation plan (phases/streams)
├── README.md                        # Project overview & quick start
├── CLAUDE.md                        # Orchestrator instructions for Claude Code
├── Makefile                         # Common dev commands
├── pyproject.toml                   # Python deps (managed by uv)
├── .env.example                     # Environment variable template
│
├── .claude/
│   ├── settings.json                # MCP server configuration
│   └── commands/
│       ├── audit.md                 # /audit <assignment_id> <run_id>
│       ├── audit-all.md             # /audit-all
│       ├── ingest-course.md         # /ingest-course <course_id>
│       ├── embed-all.md             # /embed-all
│       ├── rebuild-graph.md         # /rebuild-graph
│       └── summarize-findings.md    # /summarize-findings
│
├── backend/
│   ├── __init__.py
│   ├── main.py                      # FastAPI app entry + lifespan
│   ├── config.py                    # Pydantic BaseSettings (.env)
│   ├── db.py                        # aiosqlite setup + migrations
│   ├── models/
│   │   ├── __init__.py
│   │   ├── node.py                  # CourseNode, NodeType, NodeStatus
│   │   ├── finding.py               # Finding, FindingSeverity, FindingType
│   │   ├── audit.py                 # AuditRun, AuditStatus
│   │   └── graph.py                 # GraphEdge, EdgeType, GraphState
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── nodes.py                 # /api/nodes CRUD
│   │   ├── audit.py                 # /api/audit + SSE stream
│   │   ├── graph.py                 # /api/graph
│   │   ├── findings.py              # /api/findings
│   │   └── ingest.py                # /api/ingest
│   └── services/
│       ├── __init__.py
│       ├── claude_runner.py         # Spawns Claude Code subprocess
│       ├── node_service.py          # Node CRUD (SQLite nodes table)
│       ├── finding_service.py       # Finding CRUD + lifecycle (stale/resolved/superseded)
│       ├── graph_service.py         # Edge CRUD + NetworkX loader for traversal
│       ├── file_service.py          # File download, text extraction, hash tracking
│       └── ingest/
│           ├── __init__.py
│           ├── canvas_zip.py        # IMSCC ZIP parser (fallback)
│           ├── pdf_extractor.py     # pypdf text extraction
│           ├── docx_extractor.py    # python-docx extraction
│           └── html_extractor.py    # BeautifulSoup Canvas HTML
│
├── mcp/
│   └── audit_mcp.py                 # Single composite FastMCP server
│                                    # Mounts: nodes, graph, emit namespaces
│
├── data/
│   ├── audit.db                     # SQLite: ALL structured data (nodes, edges,
│   │                                #   findings, files, audit runs, ingest log)
│   ├── chroma/                      # ChromaDB persistent storage (embeddings only)
│   │   └── .gitkeep
│   └── files/                       # Raw file blobs (PDFs, DOCXs) downloaded from Canvas
│       └── .gitkeep                 #   Named: {canvas_file_id}_{sanitized_name}.ext
│
├── frontend/
│   ├── app/
│   │   ├── layout.tsx               # Root layout with sidebar + top bar
│   │   ├── page.tsx                 # / — Dashboard overview
│   │   ├── assignments/
│   │   │   ├── page.tsx             # /assignments — Filterable list
│   │   │   └── [id]/
│   │   │       └── page.tsx         # /assignments/[id] — Detail + audit
│   │   ├── graph/
│   │   │   └── page.tsx             # /graph — Force-directed visualization
│   │   ├── audit/
│   │   │   ├── page.tsx             # /audit — Controls + history
│   │   │   └── [runId]/
│   │   │       └── page.tsx         # /audit/[runId] — Live stream
│   │   └── ingest/
│   │       └── page.tsx             # /ingest — Status + controls
│   ├── components/
│   │   ├── ui/                      # shadcn/ui primitives
│   │   ├── layout/                  # Sidebar.tsx, TopBar.tsx
│   │   ├── assignments/             # AssignmentCard, FindingCard, FindingPanel
│   │   ├── graph/                   # DependencyGraph (D3), GraphNode, GraphEdge
│   │   ├── audit/                   # AuditStream (SSE), AuditHistory
│   │   └── ingest/                  # IngestProgress, IngestLog
│   ├── lib/
│   │   ├── api.ts                   # Typed fetch wrapper
│   │   ├── sse.ts                   # useAuditStream hook (EventSource)
│   │   └── types.ts                 # TypeScript types (mirrors Pydantic)
│   ├── store/
│   │   └── useAuditStore.ts         # Zustand store
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   └── package.json
│
├── tests/
│   ├── backend/
│   │   ├── test_models.py           # Pydantic model validation
│   │   ├── test_services.py         # Service layer logic
│   │   └── test_routers.py          # API route integration
│   ├── mcp/
│   │   └── test_audit_mcp.py        # MCP tool contracts
│   └── e2e/
│       └── audit_flow.spec.ts       # Playwright full-flow tests
│
├── scripts/
│   ├── setup.sh                     # Full setup automation
│   ├── seed_demo.py                 # Demo data seeder (15 assignments, edges, findings)
│   ├── setup_db.py                  # SQLite schema creator
│   └── check_deps.py               # Dependency verification
│
└── .github/
    └── workflows/
        └── ci.yml                   # Lint + test on push
```

---

## MCP Server Strategy

Three MCP servers. Two are off-the-shelf. One is custom.

### 1. Canvas MCP (Pre-existing — External)

[vishalsachdev/canvas-mcp](https://github.com/vishalsachdev/canvas-mcp) — 90+ tools, v1.1.0. Key tools for our ingestion:

| Tool | What We Use It For |
|------|-------------------|
| `get_course_structure` | Full module→items tree in one call (our starting point) |
| `list_modules` / `list_module_items` | Module ordering and item membership |
| `get_assignment_details` | Full instructions, due dates, submission types, attachment refs |
| `list_all_rubrics` / `get_rubric_details` | Rubric criteria + point values (read-only — cannot create/update) |
| `list_pages` / `get_page_content` | Wiki pages with HTML body (parse for file links) |
| `list_course_files` | All files in course storage |
| `download_course_file` | Download specific files by ID |
| `create_announcement` / list | Announcements (contain "patches" to broken instructions) |

**What it cannot do**: Create/update rubrics (Canvas API bug), create/delete courses, modify course settings. Rubric creation must happen in the Canvas UI.

**File linking limitation**: `list_course_files` returns ALL files in the course — including unused ones. File→assignment linking must be **derived** by parsing assignment HTML bodies and page content for `/files/{id}` references. Claude Code handles this reasoning during ingestion.

**Rate limits**: ~700 requests/10 min. Ingestion uses batching with `max_concurrent=5`.

**Setup**: Configured in `.claude/settings.json` per Canvas MCP docs. Requires `CANVAS_API_TOKEN` and `CANVAS_BASE_URL`.

### 2. Chroma MCP (Official — `chroma-mcp`)

The [official Chroma MCP server](https://github.com/chroma-core/chroma-mcp) from the ChromaDB team. Provides all vector DB operations needed for RAG:

- Collection management (create, list, delete)
- Document operations (add, update, query, delete)
- Semantic search with metadata filtering (filter by week, type)
- Built-in embedding functions

**Install**: `pip install chroma-mcp` or use `uvx chroma-mcp`

**Config** (`.claude/settings.json`):
```json
{
  "chroma": {
    "command": "uvx",
    "args": ["chroma-mcp", "--client-type", "persistent", "--data-dir", "./data/chroma"]
  }
}
```

### 3. Audit MCP (Custom — Single Composite FastMCP Server)

One FastMCP server at `mcp/audit_mcp.py` using FastMCP's `mount()` to compose three namespaces into a single process:

**`nodes_` namespace** — Course node CRUD (all backed by SQLite `nodes` table):

| Tool | Purpose |
|------|---------|
| `nodes_read(node_id)` | Read a course node by ID |
| `nodes_write(node_id, data)` | Upsert node — inserts or merges (preserves existing fields). Auto-computes `content_hash`. |
| `nodes_list(type?, week?, status?)` | List nodes with optional filters |
| `nodes_read_many(ids)` | Batch read multiple nodes |
| `nodes_link(source_id, target_id, link_type)` | Create a node-to-node link (file, page, assignment) |
| `nodes_get_stale()` | List nodes whose content changed since last audit |

**`graph_` namespace** — Dependency graph (SQLite `edges` table + NetworkX for traversal):

| Tool | Purpose |
|------|---------|
| `graph_add_edge(source, target, type, label, ...)` | Add directed edge with metadata to SQLite |
| `graph_get_neighbors(id)` | Get upstream + downstream nodes (loads NetworkX on demand) |
| `graph_get_flags()` | All nodes with gap/orphan status |
| `graph_mark_stale(node_id)` | Mark all edges from/to this node as stale (for re-derivation) |

**`emit_` namespace** — Audit finding emission:

| Tool | Purpose |
|------|---------|
| `emit_finding(assignment_id, audit_run_id, severity, finding_type, title, body, pass_number, ...)` | Write finding to SQLite immediately. Records `content_hash_at_creation` for change detection. |
| `emit_resolve_stale(assignment_id)` | After re-audit: mark unmatched stale findings as `resolved`, matched ones as `confirmed` or `superseded`. |

**Config** (`.claude/settings.json`):
```json
{
  "audit": {
    "command": "python",
    "args": ["mcp/audit_mcp.py"],
    "env": {
      "DB_PATH": "./data/audit.db",
      "FILES_DIR": "./data/files"
    }
  }
}
```

**Why one composite server instead of three separate processes:**
FastMCP's `mount()` combines multiple tool namespaces into a single stdio process. This means one process to manage instead of three, automatic namespacing prevents tool name collisions, and startup is faster.

---

## Data Models

All Python models use **Pydantic v2 strict mode** (`model_config = {"strict": True}`). TypeScript types in `frontend/lib/types.ts` mirror them exactly — keep in sync manually or generate via `openapi-typescript`.

**Storage**: All structured data lives in **SQLite** (`data/audit.db`). Pydantic models are the Python API; SQLite tables are the persistence layer. Raw file blobs live in `data/files/`.

### CourseNode (`backend/models/node.py` → SQLite `nodes` table)

Core entity representing any piece of course content.

| Field | Type | Purpose |
|-------|------|---------|
| `id` | `str` PK | Unique identifier |
| `type` | `NodeType` | assignment, page, rubric, lecture, announcement, file |
| `title` | `str` | Display name |
| `week` | `int?` | Course week number |
| `module` | `str?` | Canvas module name |
| `module_order` | `int?` | Position within module |
| `description` | `str?` | Inline Canvas HTML stripped to text |
| `instructions` | `str?` | Full instruction text |
| `rubric_text` | `str?` | Rubric criteria as text |
| `file_content` | `str?` | Extracted text from PDF/DOCX (raw file in `data/files/`) |
| `file_path` | `str?` | Path to raw file in `data/files/` |
| `canvas_url` | `str?` | Link back to Canvas |
| `source` | `str` | "canvas_mcp", "zip_import", "merged" |
| `status` | `NodeStatus` | ok, warn, gap, orphan, unaudited |
| `content_hash` | `str` | SHA-256 of instructions + rubric_text + description — **change detection** |
| `last_audited` | `datetime?` | Timestamp of last audit |
| `finding_count` | `int` | Active finding count (computed) |
| `created_at` | `datetime` | When first ingested |
| `updated_at` | `datetime` | When last modified |

### NodeLink (`backend/models/node.py` → SQLite `node_links` table)

Replaces the old `linked_files`, `linked_pages`, `linked_assignments` arrays with a proper relational table.

| Field | Type | Purpose |
|-------|------|---------|
| `source_id` | `str` FK | Node that references another |
| `target_id` | `str` FK | Node being referenced |
| `link_type` | `str` | "file", "page", "assignment" |

Composite PK: `(source_id, target_id, link_type)`.

### CourseFile (`backend/models/file.py` → SQLite `files` table)

Tracks downloaded files with change detection.

| Field | Type | Purpose |
|-------|------|---------|
| `id` | `str` PK | Canvas file ID |
| `filename` | `str` | Original filename |
| `local_path` | `str` | `data/files/{id}_{sanitized_name}.ext` |
| `content_type` | `str?` | MIME type (application/pdf, etc.) |
| `size_bytes` | `int?` | File size |
| `extracted_text` | `str?` | Text extracted by pypdf/python-docx |
| `text_hash` | `str?` | SHA-256 of extracted text — change detection on re-pull |
| `downloaded_at` | `datetime` | When downloaded |

### Finding (`backend/models/finding.py` → SQLite `findings` table)

Audit output with **lifecycle tracking** for the fix-reaudit loop.

| Field | Type | Purpose |
|-------|------|---------|
| `id` | `str` PK | UUID |
| `assignment_id` | `str` FK | Which node this finding is about |
| `audit_run_id` | `str` FK | Which audit run produced this |
| `severity` | `FindingSeverity` | gap, warn, info, ok |
| `finding_type` | `FindingType` | See taxonomy below |
| `title` | `str` | Short finding headline |
| `body` | `str` | Full explanation |
| `linked_node` | `str?` | Related node ID (if cross-reference) |
| `evidence` | `str?` | Quoted text that triggered this |
| `pass_number` | `int` | 1=clarity, 2=dependencies, 3=forward_impact |
| `status` | `FindingStatus` | **active**, stale, resolved, superseded, confirmed |
| `content_hash_at_creation` | `str` | Node's `content_hash` when finding was created |
| `superseded_by` | `str?` FK | Finding ID that replaced this one (if superseded) |
| `created_at` | `datetime` | When emitted |
| `resolved_at` | `datetime?` | When status changed from active |

**Finding lifecycle states:**

| Status | Meaning | How it gets here |
|--------|---------|-----------------|
| `active` | Current, valid finding | Emitted by audit |
| `stale` | Node content changed since this finding was created | Auto-set when `content_hash` changes on re-ingest |
| `resolved` | Re-audit ran, finding no longer reproduced (fix worked) | Auto-set by `emit_resolve_stale` after re-audit |
| `superseded` | Re-audit produced an updated version of this finding | Auto-set, `superseded_by` points to new finding |
| `confirmed` | Re-audit ran, same issue still exists | Auto-set when re-audit produces matching finding |

### Finding Taxonomy

**Severities:**

| Severity | Meaning |
|----------|---------|
| `gap` | Critical issue requiring action |
| `warn` | Potential problem worth reviewing |
| `info` | Observation, no action needed |
| `ok` | Explicitly verified as correct |

**Types** (expanded from APP.md):

| Type | Description | Example |
|------|-------------|---------|
| `clarity` | Ambiguous or unclear instructions | "Submit your analysis" — no format specified |
| `rubric_mismatch` | Rubric criterion not in instructions or vice versa | Rubric grades "stakeholder analysis" (15pts); instructions never mention it |
| `rubric_drift` | Rubric updated but instructions weren't — they now contradict | Rubric criteria changed mid-semester, instructions still reference old criteria |
| `assumption_gap` | Unstated prerequisite knowledge | Assumes APA format knowledge; never introduced |
| `implicit_prerequisite` | Knowledge assumed from content students may have missed | Assumes vocabulary from a lecture with low attendance |
| `dependency_gap` | Missing explicit link to prior work | Uses data from Lab 3 but never says so |
| `format_mismatch` | Incompatible artifact formats between linked assignments | Week 5 produces bullet list; Week 8 expects formatted report |
| `orphan` | No prior dependencies after week 1 | Peer review with no instruction on giving feedback |
| `cascade_risk` | Failure here breaks downstream assignments | Weak data collection in Week 5 breaks analysis in Week 8 and final in Week 13 |
| `curriculum_gap` | Time gap where bridging content should exist | Nothing between Weeks 8–11 introduces iteration; Week 11 requires it |
| `broken_file_link` | References a file that doesn't exist | Assignment links to a template that's missing from course files |

### GraphEdge (`backend/models/graph.py` → SQLite `edges` table)

Directed relationship between nodes. Stored in SQLite, loaded into NetworkX on demand for traversal.

| Field | Type | Purpose |
|-------|------|---------|
| `source` | `str` FK | Source node ID |
| `target` | `str` FK | Target node ID |
| `edge_type` | `EdgeType` | explicit, inferred, artifact, gap |
| `label` | `str` | Human-readable description |
| `evidence` | `str?` | Why this edge exists |
| `confidence` | `float?` | 0.0–1.0 for inferred edges |
| `status` | `str` | active, stale (marked when source/target content changes) |
| `derived_at` | `datetime` | When this edge was created |

Composite PK: `(source, target, edge_type)`.

**Edge types** (from APP.md):

| Type | Meaning |
|------|---------|
| `explicit` | Assignment directly references a prior one |
| `inferred` | Semantic similarity + AI reasoning suggests dependency |
| `artifact` | One assignment produces output consumed by another |
| `gap` | Dependency should exist but doesn't (or format is wrong) |

### AuditRun (`backend/models/audit.py`)

Execution record. Stored in SQLite `audit_runs` table.

| Field | Type | Purpose |
|-------|------|---------|
| `id` | `str` | UUID |
| `assignment_id` | `str` | Target node |
| `status` | `str` | running, done, error |
| `pass1_findings` | `int` | Count from clarity pass |
| `pass2_findings` | `int` | Count from dependency pass |
| `pass3_findings` | `int` | Count from forward impact pass |
| `total_findings` | `int` | Sum |
| `started_at` | `datetime` | When audit began |
| `finished_at` | `datetime?` | When audit completed |
| `error_message` | `str?` | Error details if failed |

### SQLite Schema Summary

Seven tables in `data/audit.db`. Full DDL lives in `scripts/setup_db.py`.

| Table | Purpose | Key Indexes |
|-------|---------|------------|
| `nodes` | All course content | `type`, `week`, `status`, `content_hash` |
| `node_links` | Node-to-node references | Composite PK `(source_id, target_id, link_type)` |
| `files` | Downloaded file metadata + extracted text | `filename` |
| `edges` | Dependency graph | Composite PK `(source, target, edge_type)`, `status` |
| `findings` | Audit findings with lifecycle | `assignment_id`, `severity`, `audit_run_id`, `status` |
| `audit_runs` | Audit execution records | `assignment_id`, `status` |
| `ingest_log` | Ingestion event log | `node_id`, `status` |

**SQLite configuration**: WAL mode enabled for concurrent reads during SSE polling. Foreign keys enforced.

---

## Backend API

### Route Reference

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/nodes` | List nodes (query: `type`, `week`, `status`) |
| `GET` | `/api/nodes/{id}` | Get node with finding counts |
| `PATCH` | `/api/nodes/{id}` | Update node fields |
| `POST` | `/api/audit/{assignment_id}` | Start audit → returns `{run_id}` |
| `GET` | `/api/audit/{run_id}/stream` | SSE stream of live findings |
| `GET` | `/api/audit/runs` | List all audit runs |
| `GET` | `/api/audit/runs/{run_id}` | Audit run details + findings |
| `GET` | `/api/findings` | List findings (query: `assignment_id`, `severity`, `type`) |
| `GET` | `/api/findings/{assignment_id}` | All findings for one assignment |
| `GET` | `/api/graph` | Full graph state (nodes, edges, flags) |
| `POST` | `/api/graph/rebuild` | Trigger `/rebuild-graph` via Claude Code |
| `GET` | `/api/graph/node/{id}` | Node with its edges |
| `POST` | `/api/ingest/zip` | Upload + start IMSCC ZIP ingestion |
| `POST` | `/api/ingest/course` | Trigger Canvas MCP ingestion via Claude Code |
| `POST` | `/api/ingest/embed-all` | Re-embed all nodes via Chroma MCP |
| `GET` | `/api/ingest/status` | Current ingestion status + log |

### SSE Streaming Architecture

When an audit is triggered:

1. FastAPI creates an `AuditRun` record in SQLite (status: `running`)
2. Spawns Claude Code as async subprocess with `/audit` slash command and restricted `--allowedTools`
3. Returns `{run_id}` immediately to client
4. Client opens `EventSource` connection to `/api/audit/{run_id}/stream`
5. SSE generator polls SQLite every 500ms: `SELECT * FROM findings WHERE audit_run_id = ? AND created_at > ?`
6. New findings are yielded as `data: {"type": "finding", "data": {...}}` SSE events
7. Heartbeat (`{"type": "heartbeat"}`) sent every 500ms when idle — prevents connection timeout
8. When `AuditRun.status` flips to `done` or `error`, sends `{"type": "done"}` and closes

### Claude Code Runner (`backend/services/claude_runner.py`)

- Spawns `claude` CLI as async subprocess via `asyncio.create_subprocess_exec`
- Passes slash command via `-p` flag: `claude -p "/audit {id} {run_id}" --output-format stream-json --allowedTools ...`
- Restricts available tools to only what the audit needs
- Tails `stream-json` stdout for pass markers and tool call events
- Updates `AuditRun.status` when process exits (done on returncode 0, error otherwise)
- Captures stderr for error diagnostics

---

## Canvas Ingestion Pipeline

### Primary: Canvas MCP (API-driven)

Claude Code uses the Canvas MCP to walk the course. The key insight: **only download files that are actually referenced by assignments or pages** — not everything in Canvas file storage.

**Step 1 — Structure walk:**
- `get_course_structure` → full module→items tree in one call
- Record: module names, ordering, item types, item IDs

**Step 2 — Assignment extraction (batches of 5, respecting rate limits):**
- `get_assignment_details` for each → full instructions, due dates, submission types
- `get_rubric_details` for each assignment's rubric → criteria, point values, level descriptions
- Parse instruction HTML for `/files/{id}` links → build the "used files" set
- `nodes_write()` each assignment to SQLite. Set `source: "canvas_mcp"`

**Step 3 — Page extraction (batches of 5):**
- `get_page_content` for each → HTML body
- Parse for file links and assignment references → add to "used files" set
- `nodes_write()` each page, `nodes_link()` to referenced nodes

**Step 4 — File download (only referenced files):**
- From Steps 2+3, we have a set of Canvas file IDs actually used by course content
- `download_course_file` for each file in the used set only
- Save to `data/files/{id}_{name}.ext`
- Extract text (pypdf/python-docx/beautifulsoup4) → store in `files` table
- `nodes_link()` each file to its referencing assignment/page
- **Files NOT in the used set are never downloaded** — no junk, no clutter

**Step 5 — Announcement extraction:**
- Get all announcements chronologically
- Flag any that reference an assignment by name (these contain "patches" to broken instructions)
- `nodes_write()` each as announcement type

**Step 6 — Cross-linking:**
- For every node, verify `node_links` are bidirectional where appropriate
- Flag broken file links (assignment references a file ID that doesn't exist in Canvas)

### Fallback: IMSCC ZIP Parser

Kept as a backup for when Canvas API access is unavailable (token expired, institutional restrictions, offline development). Parses the Canvas export ZIP via `backend/services/ingest/canvas_zip.py`:

- `imsmanifest.xml` → resource-to-assignment mappings (actually better for file linking than the API)
- `course_settings/module_meta.xml` → module ordering
- `wiki_content/` → HTML pages
- `web_resources/` → PDF/DOCX file attachments
- `assignment_groups/` → assignment XMLs with rubric data

Only extracts files that appear in the manifest's resource list — not the full ZIP contents.

Text extraction: `pypdf` for PDFs, `python-docx` for DOCX, `beautifulsoup4` for HTML. Concurrent extraction with `asyncio.Semaphore(10)`.

### Post-Ingestion Passes

After nodes are populated (by either method):

1. **Embedding pass** (`/embed-all`) — For each node, build embedding text from `title + description + instructions[:2000]`, upsert to ChromaDB via Chroma MCP with metadata `{type, week, module, status}`. Batches of 20, skip nodes with no text content.

2. **Graph derivation** (`/rebuild-graph`) — For each assignment node ordered by week:
   - Add edges from `node_links` → `explicit` type
   - Query Chroma MCP for similar prior-week nodes → reason about dependency → add `inferred` edges with confidence scores
   - No incoming edges + week > 1 → flag as `orphan`
   - Format incompatibilities between linked nodes → add `gap` edges

### Re-Ingestion (Change Detection)

When the user clicks "Refresh from Canvas" on a node (or re-runs full ingestion):

1. Pull updated content via Canvas MCP
2. Compute new `content_hash` (SHA-256 of instructions + rubric_text + description)
3. Compare to stored hash in SQLite
4. **If unchanged** → skip, no action needed
5. **If changed** →
   - Update node content + hash + `updated_at` in SQLite
   - `UPDATE findings SET status='stale' WHERE assignment_id=? AND status='active'`
   - `UPDATE edges SET status='stale' WHERE source=? OR target=?`
   - Re-embed in ChromaDB
   - Dashboard shows: "Node updated. N findings now stale. Re-audit?"

---

## AI Audit Engine

### Three-Pass Audit

Each assignment goes through three sequential reasoning passes. Findings are emitted **immediately** via `emit_finding()` — never batched.

**Pass 1 — Standalone Clarity:**

- Is any instruction sentence ambiguous or open to multiple interpretations?
- Are assumed tools, templates, or formats never introduced?
- Is submission format (file type, naming, location) clearly specified?
- For each rubric criterion: does it appear explicitly in the instructions?
- Do any criteria use undefined language ("quality", "professionalism") without context?
- Are point weights reasonable (>60% on one criterion is flagged)?
- Could a student complete this knowing only what's on this page?
- What prior knowledge is assumed? Is that assumption stated?

**Pass 2 — Backward Dependencies (RAG):**

- Query Chroma MCP for similar nodes from prior weeks (`week_before` filter)
- For each high-similarity result (>0.65): read that node, reason whether this assignment assumes knowledge/skills/artifacts from it
- If dependency exists and is stated → healthy (note it)
- If dependency exists and is NOT stated → `assumption_gap` or `implicit_prerequisite`
- If artifact formats are incompatible → `format_mismatch`
- If no incoming graph edges and week > 1 → `orphan`

**Pass 3 — Forward Impact (Graph Traversal):**

- Get downstream nodes via `graph_get_neighbors()`
- For each: does this assignment's output match what downstream expects as input?
- If mismatch → `format_mismatch` linked to downstream node
- If poor submission here would break downstream → `cascade_risk`
- If >2 week gap with no bridging content → `curriculum_gap`

### Slash Commands

All defined in `.claude/commands/`. Key commands:

| Command | Purpose |
|---------|---------|
| `/audit <id> <run_id>` | Full 3-pass audit of one assignment |
| `/audit-all` | Audit all assignments (parallel batches of 4) |
| `/ingest-course <course_id>` | Pull entire course via Canvas MCP |
| `/embed-all` | Embed all nodes into ChromaDB |
| `/rebuild-graph` | Re-derive all dependency edges |
| `/summarize-findings` | Course-level report across all assignments |

### CLAUDE.md Orchestrator

The root `CLAUDE.md` file instructs Claude Code on:
- Available slash commands and when to use them
- Available MCP tools grouped by server
- Audit principles (emit immediately, quote evidence, be specific, link related nodes)
- Finding severity guidelines
- Confidence scoring for inferred edges

---

## Frontend Architecture

### Pages

| Route | Purpose | Key Features |
|-------|---------|-------------|
| `/` | Dashboard | Stats cards (gap/warn/clean counts), quick actions, recent findings feed, ingest status banner |
| `/assignments` | Assignment list | Left sidebar filters (type, severity, week), search bar, week-grouped cards with finding pills, click → detail panel |
| `/assignments/[id]` | Assignment detail | Metadata header, "Run Audit" button, three-column findings by pass, upstream/downstream linked nodes, rubric text |
| `/graph` | Dependency graph | Full-width D3 force layout, node color by type, ring by status, click node/edge for detail, filter bar (gaps/orphans/inferred) |
| `/audit` | Audit controls | Run on specific assignment (dropdown), run all, history table with click-through |
| `/audit/[runId]` | Live audit stream | Pass progress indicator (1 ◉ → 2 ○ → 3 ○), findings appear as animated cards via SSE, collapsible tool call log |
| `/ingest` | Ingestion | Upload ZIP, trigger API ingest, progress bars, extracted node log, re-embed/rebuild buttons |

### Component Architecture

- **Layout**: Persistent sidebar (nav + course name) + top bar (breadcrumbs + actions)
- **Assignments**: Card-based list with filter sidebar, slide-over detail panel with tabs (Recommendations, Links, Rubric)
- **Graph**: D3 force simulation — nodes positioned by week on Y axis, spread on X. Solid edges for explicit, dashed for inferred, red for gaps. Canvas rendering for >50 nodes.
- **Audit Stream**: `EventSource`-based SSE consumer (`useAuditStream` hook), findings animate in as cards, pass progress stepper
- **Ingest**: Multi-stage progress bars, scrollable log, action buttons

### State Management (Zustand)

Store with logical slices:
- `nodes` — Course node data, filtered/sorted views
- `audit` — Active runs, SSE connection state, findings cache
- `graph` — Graph state for D3 (nodes, edges, flags, selected)
- `ui` — Sidebar collapsed state, selected items, active filters

### Design System

- **Tailwind CSS v4** utility classes
- **shadcn/ui** accessible primitives: Button, Card, Badge, Dialog, Table, Tabs, Select, Progress
- **Severity colors** consistent everywhere: gap=red-500, warn=amber-500, info=blue-500, ok=green-500
- **Dark mode** from day one via Tailwind `dark:` variant
- **Responsive** desktop-first, functional on tablet (≥768px)

---

## Testing Strategy

| Layer | Tool | What to Test |
|-------|------|-------------|
| Pydantic models | **pytest** | Validation rules, serialization, edge cases, strict mode enforcement |
| Services | **pytest** + **aiosqlite** | CRUD correctness, error paths, concurrent access |
| API routes | **pytest** + **httpx** `AsyncClient` | All endpoints, status codes, response shapes, query params |
| MCP tools | **pytest** | Input/output contracts, error responses, merge logic |
| React components | **Vitest** + **React Testing Library** | Interactive components, SSE handling, filter logic |
| SSE integration | **Vitest** | Stream parsing, reconnection, heartbeat handling |
| E2E flows | **Playwright** | Full audit flow (trigger → stream → findings), graph interaction, ingestion |

### Test Data

`scripts/seed_demo.py` creates deterministic fixture data:
- 15 assignment nodes (Weeks 1–13)
- 3 page nodes, 2 rubric nodes, 1 lecture node
- 20 graph edges (explicit, inferred, gap mix)
- 8 pre-seeded findings across 4 assignments

This data is usable by all test layers and enables full demo mode.

---

## Security Considerations

This is a local-only tool running on the instructor's machine, but basic hygiene matters:

- **Canvas API token**: Stored in `.env`, covered by `.gitignore`. Never logged or displayed in UI.
- **CORS**: Restricted to `localhost:3000` only.
- **File uploads**: Validate ZIP structure before extraction. Check for zip bombs (ratio check, max file count). Reject non-IMSCC ZIPs.
- **SQL injection**: All SQLite queries use parameterized statements via aiosqlite. No string interpolation in queries.
- **Path traversal**: Node IDs sanitized to `[a-zA-Z0-9_-]` before use in filesystem paths. Reject IDs with `..` or `/`.
- **Subprocess injection**: Claude Code arguments are constructed from validated inputs, never raw user strings.
- **Student data**: If Canvas data includes student PII, it stays local. No data leaves the machine. Consider adding a `--no-student-data` flag to ingestion that strips student names/IDs.

---

## Error Handling

| Scenario | Strategy |
|----------|----------|
| MCP tool failure | Each tool returns structured `{"error": "..."}`. Claude Code handles gracefully and retries or skips. |
| Claude Code subprocess crash | `claude_runner.py` catches non-zero exit, marks AuditRun as `error`, records stderr in `error_message`. |
| SSE disconnection | Frontend `useAuditStream` hook auto-reconnects with `last_seen` timestamp, resumes from where it left off. |
| Ingestion node failure | Per-node error tracking in `ingest_log` table. Failed nodes logged but don't block others. |
| ChromaDB embedding failure | Log error, skip node. Audit Pass 2 falls back to text-only comparison if vector search returns no results. |
| Canvas MCP timeout | Retry with exponential backoff (3 attempts). If all fail, log and continue with partial data. |
| Corrupt graph.json | `graph_service.py` validates JSON structure on load. If corrupt, rebuild from nodes. |

---

## Accessibility

- All **shadcn/ui** components are WCAG 2.1 AA compliant by default (focus management, ARIA attributes, keyboard navigation)
- Severity colors **always paired** with text labels and icons — never color-only indicators
- Graph visualization has **keyboard navigation** (tab between nodes, enter to select) and screen reader descriptions for nodes/edges
- **Focus management** for modals and slide-over panels (trap focus, return on close)
- Minimum **4.5:1 contrast ratios** enforced — Tailwind config restricts palette
- All interactive elements have **visible focus rings** (Tailwind `ring` utilities)
- Finding cards have **semantic HTML** (article, heading hierarchy, landmark regions)
- **Skip navigation** link on every page

---

## Performance Considerations

- **Audit parallelism**: `/audit-all` processes assignments in batches of 4 to avoid overwhelming MCP servers. Each batch completes before next starts.
- **ChromaDB queries**: Filtered by `week < current` to minimize search space. Max 6 results per query.
- **Frontend rendering**:
  - Server Components for static content (layout, metadata, assignment text)
  - Client Components only for interactive parts (graph canvas, SSE stream, filters)
  - D3 graph switches to **canvas rendering** when node count exceeds 50
  - Finding cards use `React.memo` to avoid re-render on new findings arriving
- **SQLite performance**: Indexed on `assignment_id`, `severity`, `audit_run_id`, `created_at`. WAL mode for concurrent reads during SSE polling.
- **SSE efficiency**: 500ms poll interval balances responsiveness with DB load. Heartbeats prevent timeout without adding payload.
- **Data loading**: Assignment list uses pagination (50 per page). Graph loads in full (expected <100 nodes for a single course).

---

## Setup & Installation

### Prerequisites

- **Claude Code CLI** — authenticated, Max plan active
- **Python 3.11+** — for backend and MCP servers
- **Node.js 18+** — for Next.js frontend
- **uv** — Python package manager: `curl -LsSf https://astral.sh/uv/install.sh | sh`

### Quick Start

```bash
# 1. Python environment
uv venv && source .venv/bin/activate
uv pip install -e ".[dev]"

# 2. SQLite schema
python scripts/setup_db.py

# 3. Frontend
cd frontend && npm install && cd ..

# 4. Seed demo data
python scripts/seed_demo.py

# 5. Run (two terminals)
#    Terminal 1: uvicorn backend.main:app --reload --port 8000
#    Terminal 2: cd frontend && npm run dev
#    Open: http://localhost:3000
```

### Makefile Shortcuts

```makefile
make setup      # Full setup (venv, deps, db, seed, frontend)
make dev        # Start backend + frontend in parallel
make seed       # Re-seed demo data
make test       # Run all tests (pytest + vitest)
make lint       # Run linters (ruff + eslint)
make check      # Verify all dependencies installed
```

### Environment Variables (`.env`)

```
DB_PATH=./data/audit.db
CHROMA_DIR=./data/chroma
FILES_DIR=./data/files
CANVAS_API_TOKEN=       # [PENDING] From Trevor
CANVAS_BASE_URL=        # [PENDING] From Trevor
CANVAS_COURSE_ID=       # [PENDING] From Trevor
FRONTEND_ORIGIN=http://localhost:3000
CLAUDE_BIN=claude
```

---

## Notes for Implementers

1. **No API key needed.** Claude Code runs via `claude` CLI on the Max plan. Never import `anthropic` directly.
2. **Pydantic strict mode everywhere.** Every model: `model_config = {"strict": True}`.
3. **SQLite is the single source of truth.** All structured data (nodes, edges, findings, files) lives in `data/audit.db`. No JSON files for nodes, no `graph.json`. ChromaDB stores only embeddings.
4. **ChromaDB is accessed only via Chroma MCP.** No direct `import chromadb` in backend code.
5. **Filesystem is only for raw blobs.** `data/files/` holds PDFs/DOCXs. Extracted text goes into SQLite. Never query the filesystem for course data.
6. **Demo mode works fully offline.** Seed data populates SQLite — enables complete frontend + backend testing without Canvas access or Claude Code.
7. **Findings are emitted immediately.** Never batch until end of pass. The dashboard streams them live — that's the core UX.
8. **MCP servers are declared in `.claude/settings.json`.** Claude Code starts them automatically. FastAPI does NOT manage MCP server lifecycle.
9. **Evidence is mandatory.** Every finding must include the `evidence` field — the exact quoted text that triggered it. "Instructions could be clearer" is never acceptable.
10. **Content hashes drive the re-audit loop.** Every `nodes_write()` auto-computes `content_hash`. When it changes, findings go stale automatically. This is the foundation of: fix content → re-ingest → stale findings → re-audit → resolved/confirmed.
11. **Only download referenced files.** During Canvas MCP ingestion, parse assignment/page HTML for file references first. Never bulk-download all course files.
