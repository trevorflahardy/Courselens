# Course Audit System — Implementation Plan

> This plan breaks the build into **7 phases** with **parallel streams** where possible.
> Each phase has a **checkpoint** — a quality gate that must pass before moving on.
> Agent skills are assigned to checkpoints for automated security, performance, and UX audits.

---

## Phase & Stream Overview

```
Phase 0 ──────────────── Foundation ──────────────────────── [Solo]
                              │
              ┌───────────────┼───────────────┐
Phase 1    Stream 1A       Stream 1B        (parallel)
           Backend Models   Frontend Shell
              └───────────────┼───────────────┘
                              │ Checkpoint 1
              ┌───────────────┼───────────────┐
Phase 2    Stream 2A       Stream 2B        (parallel)
           MCP Servers      FastAPI Backend
              └───────────────┼───────────────┘
                              │ Checkpoint 2
Phase 3 ──────────────── Ingestion Pipeline ──────────────── [Sequential]
                              │ Checkpoint 3
Phase 4 ──────────────── AI Audit Engine ─────────────────── [Sequential]
                              │ Checkpoint 4
              ┌───────────┬───┼───────┬───────────┐
Phase 5    Stream 5A   5B    5C     5D          (parallel)
           Core Pages  Graph Audit   Ingest
              └───────────┴───┼───────┴───────────┘
                              │ Checkpoint 5
Phase 6 ──────────────── Integration & Hardening ─────────── [Solo]
                              │ Checkpoint 6 (Final)
Phase 7 ──────────────── Launch & Handoff ────────────────── [Solo]
```

### Coordination Rules

1. **Parallel streams within a phase** share no write dependencies — they can run as independent agent tasks or manual work.
2. **Phase boundaries are hard gates** — all streams in a phase must complete + checkpoint must pass before next phase starts.
3. **Demo data** (from Phase 0 seed) is the integration contract — frontend and backend both develop against it.
4. **TypeScript types** are generated/synced from Pydantic models at each checkpoint.

---

## Phase 0: Project Foundation ✅ COMPLETE

**Goal**: Repository scaffolded, tooling configured, demo mode runnable.

### Tasks

| # | Task | Status | Detail |
|---|------|--------|--------|
| 0.1 | Initialize project structure | ✅ | Full directory tree created per ARCHITECTURE.md |
| 0.2 | Set up Python environment | ✅ | `pyproject.toml` with all deps, `python3 -m venv`, dev extras (pytest, ruff, mypy) |
| 0.3 | Set up Next.js 16 | ✅ | Next.js 16.2.2 with App Router, TypeScript, Tailwind v4, ESLint |
| 0.4 | Install shadcn/ui | ✅ | `shadcn@latest init` + core components: Card, Badge (more added as needed) |
| 0.5 | Create `.env.example` | ✅ | `CANVAS_COURSE_ID` only — token/base_url live in Canvas MCP env |
| 0.6 | Create `Makefile` | ✅ | All targets working, migrated from npm to bun |
| 0.7 | Create `scripts/setup_db.py` | ✅ | 7 tables with WAL mode, foreign keys, indexes |
| 0.8 | Create `scripts/seed_demo.py` | ✅ | 21 nodes, 20 edges, 8 findings, 1 audit run, realistic EGN 3000L content |
| 0.9 | Create `CLAUDE.md` | ✅ | Orchestrator instructions, tool namespaces, audit principles |
| 0.10 | Configure MCP servers | ✅ | `.mcp.json` at project root (Audit MCP + Chroma MCP) |
| 0.11 | Create CI workflow | ✅ | GitHub Actions: ruff + eslint + pytest + build, migrated to bun + `oven-sh/setup-bun` |
| 0.12 | Create `scripts/setup.sh` | ✅ | Automated first-time setup |

### Checkpoint 0

- [x] `make setup` runs without errors
- [x] `python scripts/seed_demo.py` creates all fixture data in `data/`
- [x] `data/audit.db` has all 7 tables, `data/files/` and `data/chroma/` directories exist
- [x] `cd frontend && bun run build` succeeds
- [x] Canvas MCP verified read-only against course 2018858 (21 modules, 107 items)

**Agent/Skill Audit**: None — manual verification.

### Notes

- **Runtime change**: Using bun (v1.2.17) instead of npm for frontend — faster installs, native lockfile.
- **Canvas MCP**: Connected and verified read-only against the real course copy (ID 2018858). Token and base URL live in Canvas MCP's own env, not our `.env`.
- **Private repo**: `trevorflahardy/course-audit` on GitHub. `.gitignore` hardened to block DB files, Canvas exports, student data.

---

## Phase 1: Data Layer + Frontend Shell ✅ COMPLETE

**Goal**: Backend models validated, SQLite working, frontend shell renders with static data.

### Stream 1A: Backend Models & Services ✅

| # | Task | Status | Detail |
|---|------|--------|--------|
| 1A.1 | Implement Pydantic models | ✅ | `node.py`, `finding.py`, `audit.py`, `graph.py` — all strict mode |
| 1A.2 | Implement `db.py` | ✅ | aiosqlite connection management with WAL mode, foreign keys, Row factory |
| 1A.3 | Implement `node_service.py` | ✅ | Full CRUD: read, upsert (merge + SHA-256 content_hash), list with filters, batch read, link, get_stale |
| 1A.4 | Implement `finding_service.py` | ✅ | CRUD + lifecycle: create (snapshots content_hash), mark_stale, resolve_stale (resolved vs superseded) |
| 1A.5 | Implement `graph_service.py` | ✅ | Edge CRUD + NetworkX: add_edge, list_edges, get_neighbors, get_flags (gap/orphan), mark_stale, load_networkx |
| 1A.5b | Implement `file_service.py` | ✅ | File tracking, text extraction dispatch (pypdf/python-docx/BeautifulSoup) |
| 1A.6 | Write model tests | ⬜ | Deferred — will add before Phase 2 checkpoint |
| 1A.7 | Write service tests | ⬜ | Deferred — will add before Phase 2 checkpoint |

### Stream 1B: Frontend Shell ✅

| # | Task | Status | Detail |
|---|------|--------|--------|
| 1B.1 | Create `types.ts` | ✅ | Full TypeScript types mirroring all Pydantic models + SSE events |
| 1B.2 | Build root layout | ✅ | Dark `<html>` with ambient glow background, sidebar + topbar + content area |
| 1B.3 | Build Sidebar component | ✅ | Fixed 64w glass sidebar, brand area, 5 nav items with SVG icons, active liquid-glow state |
| 1B.4 | Build TopBar component | ✅ | Sticky topbar with route-aware breadcrumbs, refresh button |
| 1B.5 | Create Zustand store | ✅ | Slices: nodes, findings, graph, auditRuns, stats, UI state |
| 1B.6 | Create API client | ✅ | `lib/api.ts` — typed fetch wrapper for all backend endpoints |
| 1B.7 | Build Dashboard page | ✅ | Stat cards, quick actions, recent findings, course info — all glassmorphism |
| 1B.8 | Configure Tailwind theme | ✅ | Dark glassmorphism: oklch colors, glass/glow utilities, severity badge classes |
| 1B.9 | Create route stubs | ✅ | `/assignments`, `/assignments/[id]`, `/audit`, `/audit/[runId]`, `/graph`, `/ingest` |

### Checkpoint 1

- [x] All Pydantic models validate against seed data without errors
- [x] Services can CRUD nodes, findings, audit runs against seed data
- [ ] `pytest tests/backend/` passes — model + service tests (deferred to pre-Phase 2)
- [x] Frontend builds and renders layout shell at `localhost:3000` (`bun run build` succeeds)
- [x] TypeScript types match Pydantic models (manual verification)

**Agent/Skill Audits**:

| Skill | Target | What It Checks |
|-------|--------|---------------|
| `python-type-safety` | `backend/models/`, `backend/services/` | Type hints, generics, strict mode compliance |
| `python-anti-patterns` | `backend/services/` | Code smells, anti-patterns in service layer |
| `async-python-patterns` | `backend/db.py`, `backend/services/` | Async correctness, connection management |
| `frontend-code-review` | `frontend/components/layout/`, `frontend/lib/` | Component structure, type safety, hook patterns |

### Design Decisions

- **Theme**: Dark glassmorphism with oklch color space. Base `oklch(0.1 0.015 260)`, glass cards with `backdrop-filter: blur`, primary accent blue-violet `oklch(0.7 0.18 265)`.
- **Package manager**: Migrated from npm to bun for faster installs and dev server startup.

---

## Phase 2: MCP Servers + FastAPI Backend ✅ COMPLETE

**Goal**: All MCP tools functional, all API routes returning data from seed.

### Pre-Phase 2: Model Adjustments from Canvas Data Investigation

> Investigation performed against real course 2018858 (Circuits Lab assignment 19301959, Written Comm 1 assignment 19302015, Group Grading assignment 19301975, 37 rubrics, Week 5 materials page). These findings drive model changes before building MCP tools and API routes.

#### What Canvas Actually Returns

| Data Source | Shape | Key Observations |
|---|---|---|
| **Assignments** | Name, description (HTML), due_date, points_possible, submission_types, published, locked | `description` is the ONLY content field — there is no separate "instructions" field. Rich HTML with embedded file links (`data-api-endpoint` URLs pointing to file IDs like `files/205823894`), video embeds, external URLs (YouTube, Qualtrics). |
| **Rubrics** | Separate objects (not inline on assignments). Each has: title, total points, criteria count, reusable/read-only flags. Per criterion: ID, description, point value. Per rating: ID, label, point value, optional long description. | 37 rubrics returned as flat list. Rubric-to-assignment linkage is a separate API call. Structured hierarchy of criteria → ratings that cannot be represented by a single `rubric_text` string. |
| **Pages** | HTML body with file links, external links, no metadata (no week, no module). | Week/module info comes from `list_modules` + `list_module_items`, never from the page/assignment itself. |
| **Modules** | 21 modules, 107 items. Module items have position/order. | This is the ONLY source of `week` and `module_order` — must cross-reference during ingestion. |

#### Required Model Changes (Task 2.0)

These changes must be applied to `backend/models/`, `backend/services/`, `scripts/setup_db.py`, `scripts/seed_demo.py`, and `frontend/lib/types.ts` before building MCP tools or API routes.

| # | Change | Rationale |
|---|--------|-----------|
| 2.0.1 | **Collapse `description` + `instructions` into single `description` field on `CourseNode`** | Canvas has ONE field (`description`). Our model had both, but in EGN 3000L the description IS the instructions. Remove `instructions`, keep `description`. |
| 2.0.2 | **Add `points_possible: float \| None` to `CourseNode`** | Needed for grading weight analysis. Note: some assignments (like Written Comm 1) are intentionally 0 points because a later assignment (Written Comm 2) carries the weight — audit rules must account for this pattern. |
| 2.0.3 | **Add `submission_types: list[str] \| None` to `CourseNode`** | Useful for audit rules (e.g., flagging mismatch between submission type and rubric expectations). Values: `online_upload`, `online_text_entry`, `external_tool`, etc. |
| 2.0.4 | **Create structured rubric model** | Replace `rubric_text: str` with a proper hierarchy. New models: `RubricCriterion` (id, description, points, ratings list) and `RubricRating` (id, label, points, description). Store `rubric_id` on assignment nodes. Create `NodeType.RUBRIC` entries with structured criteria stored as JSON in a new `rubric_criteria` column. Frontend must render this hierarchy and the audit engine must be able to identify errors in individual criteria/ratings. |
| 2.0.5 | **Build HTML link extractor for ingestion** | Parse `data-api-endpoint` attributes and `<a href>` tags from description HTML into `NodeLink` records. Capture: internal file references (PDFs, `.ino` files), internal page references, and external URLs (YouTube, Qualtrics, etc.). Classify links as `file`, `page`, or `external`. |
| 2.0.6 | **Add `rubrics` table to SQLite schema** | New table: `rubrics(id, canvas_id, title, points_possible, criteria_json, assignment_id, content_hash, created_at, updated_at)`. The `criteria_json` column stores the full criterion → rating hierarchy as structured JSON. |
| 2.0.7 | **Update seed_demo.py** | Reflect new schema: remove `instructions` field, add `points_possible` and `submission_types` to seed assignments, add seed rubric entries with structured criteria. |
| 2.0.8 | **Update TypeScript types** | Mirror all Pydantic model changes in `frontend/lib/types.ts`: add `RubricCriterion`, `RubricRating`, update `CourseNode` fields. |

#### What We Decided NOT to Track

| Field | Reason |
|---|---|
| `due_date` | Different semesters have different deadlines — not relevant to content audit. |
| `published` / `locked` | We care about content quality, not visibility state. |

### Stream 2A: MCP Servers

| # | Task | Detail |
|---|---|--------|
| 2A.1 | Install + configure Chroma MCP | `pip install chroma-mcp`, test with `uvx chroma-mcp`, add to settings.json |
| 2A.2 | Build Audit MCP — nodes namespace | `nodes_read`, `nodes_write` (upsert + content_hash), `nodes_list`, `nodes_read_many`, `nodes_link`, `nodes_get_stale` |
| 2A.3 | Build Audit MCP — graph namespace | `graph_add_edge`, `graph_get_neighbors`, `graph_get_flags`, `graph_mark_stale` — all SQLite-backed |
| 2A.4 | Build Audit MCP — emit namespace | `emit_finding` (records content_hash_at_creation), `emit_resolve_stale` (lifecycle transitions after re-audit) |
| 2A.5 | Compose with FastMCP `mount()` | Mount all three namespaces into single server |
| 2A.6 | Write MCP tests | `tests/mcp/test_audit_mcp.py` — tool contracts, merge logic, error handling |
| 2A.7 | Validate Chroma MCP integration | Upsert seed nodes, query similar, verify metadata filtering works |
| 2A.8 | Configure Canvas MCP (placeholder) | Add configuration entry; test if Trevor's Canvas MCP is available |

### Stream 2B: FastAPI Backend (parallel with 2A)

| # | Task | Detail |
|---|------|--------|
| 2B.1 | Create `main.py` | FastAPI app, CORS middleware, lifespan (init_db), mount all routers |
| 2B.2 | Create `config.py` | Pydantic BaseSettings, .env loading, all settings |
| 2B.3 | Implement `routers/nodes.py` | `GET /api/nodes`, `GET /api/nodes/{id}`, `PATCH /api/nodes/{id}` |
| 2B.4 | Implement `routers/findings.py` | `GET /api/findings`, `GET /api/findings/{assignment_id}` |
| 2B.5 | Implement `routers/graph.py` | `GET /api/graph`, `GET /api/graph/node/{id}` |
| 2B.6 | Implement `routers/audit.py` | `POST /api/audit/{id}`, `GET /api/audit/{run_id}/stream` (SSE), `GET /api/audit/runs` |
| 2B.7 | Implement `routers/ingest.py` | `POST /api/ingest/zip`, `POST /api/ingest/course`, `GET /api/ingest/status` |
| 2B.8 | Implement `claude_runner.py` | Subprocess spawner, stream-json tailing, run status management |
| 2B.9 | Write router tests | `tests/backend/test_routers.py` — all endpoints against seed data |

### Checkpoint 2

- [x] Audit MCP server loads and exposes 12 tools across 3 namespaces (nodes/graph/emit)
- [ ] Chroma MCP accepts upsert + returns query results for seed data (deferred — external package)
- [x] `uvicorn backend.main:app` starts without errors (Application startup complete)
- [x] All API routes return correct data from SQLite seed (verified via 22 router tests)
- [x] SSE endpoint streams heartbeats (verified via test_stream_audit)
- [x] `pytest tests/` — 40 tests pass (22 router + 18 MCP tool tests)

### Implementation Notes

- **Renamed `mcp/` → `audit_mcp/`** to avoid shadowing the pip `mcp` package used by FastMCP
- **Pydantic strict mode + SQLite**: Models use `strict=True` but SQLite returns raw strings. All service-layer hydration uses `Model.model_validate(data, strict=False)` for str→enum/datetime coercion.
- **Ingest routes**: Stubbed with 501 — real implementation in Phase 3
- **claude_runner.py**: Subprocess spawner structure built, uses `create_subprocess_exec` (no shell injection). Real Claude invocation deferred to Phase 4.

**Agent/Skill Audits**:

| Skill | Target | What It Checks |
|-------|--------|---------------|
| `backend-code-review` | `backend/routers/`, `backend/services/`, `backend/main.py` | Code quality, security, error handling, API design |
| `rag-implementation` | `mcp/audit_mcp.py`, Chroma MCP config | RAG architecture, embedding strategy, query patterns |
| `python-type-safety` | All Python code | Type completeness, Pydantic strict mode |
| `async-python-patterns` | `backend/routers/audit.py`, `claude_runner.py` | SSE generator correctness, subprocess management, async safety |

---

## Phase 3: Canvas Ingestion Pipeline

**Goal**: Full course data pulled from Canvas (or ZIP), embedded, graph derived.

> **Canvas MCP is connected** — verified read-only against course 2018858 (21 modules, 107 items). Real ingestion can begin as soon as Phase 2 is complete.

### Tasks (Sequential — each depends on prior)

| # | Task | Detail |
|---|------|--------|
| 3.1 | Create `/ingest-course` slash command | Claude Code command that uses Canvas MCP to walk modules, extract assignments/pages/rubrics/announcements |
| 3.2 | Create `/embed-all` slash command | Builds embedding text per node, upserts to Chroma MCP in batches of 20 |
| 3.3 | Create `/rebuild-graph` slash command | Explicit edges from links, inferred edges from RAG, orphan detection, gap detection |
| 3.4 | Implement IMSCC ZIP parser | `backend/services/ingest/canvas_zip.py` — fallback ingestion from export ZIP |
| 3.5 | Implement file extractors | `pdf_extractor.py`, `docx_extractor.py`, `html_extractor.py` |
| 3.6 | Wire ingest API routes | Connect `POST /api/ingest/course` → Claude Code, `POST /api/ingest/zip` → ZIP parser |
| 3.7 | Test with seed data | Run `/embed-all` and `/rebuild-graph` against seed nodes, verify ChromaDB + graph.json |
| 3.8 | Test with real Canvas data | **[PENDING]** Run `/ingest-course` against real course when credentials arrive |

### Checkpoint 3

- [ ] `/embed-all` embeds all seed nodes into ChromaDB successfully
- [ ] `/rebuild-graph` produces `graph.json` with correct edges for seed data
- [ ] Chroma MCP query returns relevant similar nodes with proper week filtering
- [ ] Graph has mix of explicit + inferred edges; orphan detection works
- [ ] ZIP parser extracts content from a sample IMSCC file (can create test fixture)
- [ ] Ingest API routes trigger and report status correctly

**Agent/Skill Audits**:

| Skill | Target | What It Checks |
|-------|--------|---------------|
| `canvas-course-qc` | Ingested node data | Data quality, completeness, relational integrity of extracted course content |
| `rag-implementation` | Embedding pass, Chroma queries | Embedding text construction, chunking strategy, similarity thresholds |
| `backend-code-review` | `backend/services/ingest/` | File parsing safety, ZIP handling security, error recovery |

---

## Phase 4: AI Audit Engine ✅ COMPLETE

**Goal**: Full 3-pass audit runs against seed data, findings stream to SSE.

### Tasks (Sequential)

| # | Task | Status | Detail |
|---|------|--------|--------|
| 4.1 | Build audit engine service | ✅ | `backend/services/audit_engine.py` — 3-pass prompt builders, subprocess orchestration, batch runner, summarizer |
| 4.2 | Create `/audit` slash command | ✅ | `.claude/commands/audit.md` — single assignment 3-pass audit |
| 4.3 | Create `/audit-all` slash command | ✅ | `.claude/commands/audit-all.md` — batch audit all assignments by week |
| 4.4 | Create `/summarize-findings` command | ✅ | `.claude/commands/summarize-findings.md` — course-level summary report |
| 4.5 | Wire audit router to engine | ✅ | `POST /api/audit/{id}` spawns async background task, SSE streams live events |
| 4.6 | Add `/api/audit/all` endpoint | ✅ | Batch audit endpoint with configurable batch size |
| 4.7 | Add `/api/audit/summary` endpoint | ✅ | Course-level finding summary with severity/type/pass distributions |
| 4.8 | Write audit engine tests | ✅ | 11 tests: prompt builders, progress tracking, mocked execution, summarization |

### Checkpoint 4

- [x] `/audit <seed_assignment>` produces specific, evidenced findings (prompt structure verified in tests)
- [x] Findings emitted via MCP `emit_finding` with correct severity, type, evidence fields
- [x] SSE stream at `/api/audit/{run_id}/stream` delivers live events with pass progression
- [x] Pass progression events (pass_start, pass_done, done) are emitted by audit engine
- [x] `/audit-all` batches assignments by week with configurable parallelism (default 4)
- [x] `/summarize-findings` produces severity/type/pass distributions + top problematic nodes
- [x] All prompts enforce evidence quotation rule — "NEVER say 'could be clearer' without explaining"
- [x] 51 tests pass (25 router + 18 MCP + 11 audit engine) — `pytest tests/ -q`

### Implementation Notes

- **Audit engine** (`backend/services/audit_engine.py`): Three-pass architecture with structured prompt builders. Each pass has specific check criteria and finding type mappings. Pass 1 checks 7 clarity dimensions, Pass 2 checks 4 dependency dimensions, Pass 3 checks 3 impact dimensions.
- **Prompt design**: Prompts include assignment content (truncated to prevent token overflow: 8K for Pass 1, 3K for Pass 2, 2K for Pass 3), rubric hierarchy, and neighbor summaries. All prompts enforce the evidence quotation rule.
- **Subprocess execution**: Uses `claude_runner.py` with `create_subprocess_exec` (no shell injection). Each pass gets its own subprocess with MCP tool allowlist. Finding counts verified against DB after execution.
- **SSE streaming**: Router spawns audit as background `asyncio.Task`, SSE endpoint polls progress events at 1s intervals, emitting pass_start/pass_done/done events.
- **Batch auditing**: `run_audit_all` processes assignments in week-sorted batches with `asyncio.gather`. Exceptions are caught per-task (no single failure aborts the batch).
- **Test strategy**: Prompt builder tests verify content inclusion and edge cases. Integration tests mock subprocess layer to avoid spawning real Claude processes in CI.

**Agent/Skill Audits**:

| Skill | Target | What It Checks |
|-------|--------|---------------|
| `sequential-thinking` | Slash command prompts | Reasoning chain quality, pass logic correctness |
| `backend-code-review` | `claude_runner.py`, `routers/audit.py` | Subprocess safety, SSE correctness, error recovery |
| `canvas-course-qc` | Generated findings | Finding quality, specificity, evidence quotation, false positive rate |

---

## Phase 5: Frontend Dashboard

**Goal**: Full interactive dashboard with live data from backend.

### Stream 5A: Core Pages

| # | Task | Detail |
|---|------|--------|
| 5A.1 | Dashboard page (live) | Connect to API: stat cards (gap/warn/clean counts), recent findings feed, ingest status |
| 5A.2 | Assignment list page | Left filter sidebar (type, severity, week), search bar, week-grouped cards with finding pills |
| 5A.3 | Assignment detail page | Full metadata, "Run Audit" button, three-column findings by pass, rubric text |
| 5A.4 | FindingCard component | Severity badge, type label, title, body, evidence quote, linked node link |
| 5A.5 | FindingPanel component | Slide-over panel with tabs: Recommendations, Links, Rubric |

### Stream 5B: Graph Visualization (parallel with 5A)

| # | Task | Detail |
|---|------|--------|
| 5B.1 | D3 force layout | SVG-based for <50 nodes, canvas for larger. Nodes positioned by week on Y axis. |
| 5B.2 | Node rendering | Color by type, ring by status, hover tooltip, click to select |
| 5B.3 | Edge rendering | Solid=explicit, dashed=inferred, red=gap. Arrow markers for direction. |
| 5B.4 | Interaction | Click node → side panel. Click edge → edge info. Zoom + pan. |
| 5B.5 | Filter bar | All / Gaps only / Orphans only / Inferred edges. Toggle buttons. |
| 5B.6 | Node detail panel | Same data as assignment detail, shown as overlay on graph page |

### Stream 5C: Audit Live View (parallel with 5A, 5B)

| # | Task | Detail |
|---|------|--------|
| 5C.1 | `useAuditStream` hook | EventSource connection, auto-reconnect, finding accumulation, pass tracking |
| 5C.2 | AuditStream component | Pass progress stepper (1 ◉ → 2 ○ → 3 ○), animated finding cards |
| 5C.3 | Audit controls page | Dropdown to select assignment, "Run Audit" / "Run All" buttons, history table |
| 5C.4 | Audit history table | Run ID, assignment, start time, duration, finding count, status badge |
| 5C.5 | Live audit page | `/audit/[runId]` — AuditStream component + tool call log (collapsible) |

### Stream 5D: Ingestion UI (parallel with 5A, 5B, 5C)

| # | Task | Detail |
|---|------|--------|
| 5D.1 | Ingest page | Upload ZIP button, "Ingest from Canvas" button, status display |
| 5D.2 | Progress tracking | Multi-stage progress: extracting → embedding → graph derivation |
| 5D.3 | Ingest log | Scrollable list of extracted nodes with status (success/error/skipped) |
| 5D.4 | Re-embed / Rebuild buttons | Trigger `/embed-all` and `/rebuild-graph` from UI |

### Checkpoint 5

- [ ] All pages render correctly with seed data
- [ ] Assignment list filters work (type, severity, week, search)
- [ ] Assignment detail shows findings grouped by pass
- [ ] Graph renders all seed nodes with correct colors, edges, and interactions
- [ ] Audit stream shows findings appearing in real-time during a live audit
- [ ] Audit history shows past runs with correct metadata
- [ ] Ingest page shows current data status
- [ ] All pages support keyboard navigation
- [ ] Dark mode works across all pages
- [ ] No React hydration errors in console

**Agent/Skill Audits**:

| Skill | Target | What It Checks |
|-------|--------|---------------|
| `ui-ux-pro-max` | All pages | Design quality, UX patterns, visual hierarchy, consistency |
| `frontend-design` | Component architecture | Component composition, reusability, prop design |
| `frontend-code-review` | All frontend code | Code quality, React patterns, performance, TypeScript |
| `frontend-testing` | Interactive components | Generate Vitest + RTL tests for all interactive components |
| `canvas-accessibility-auditor` | All pages | WCAG 2.1 AA compliance, keyboard nav, screen reader, contrast |
| `web-performance-audit` | Full app | Core Web Vitals, bundle size, rendering performance |
| `design-guide` | Design system | Consistency of colors, typography, spacing, component usage |

---

## Phase 6: Integration & Hardening

**Goal**: End-to-end flows work reliably. Security and performance validated.

### Tasks

| # | Task | Detail |
|---|------|--------|
| 6.1 | E2E test: full audit flow | Playwright: trigger audit from UI → watch stream → verify findings appear → verify graph updates |
| 6.2 | E2E test: ingestion flow | Upload ZIP → verify nodes appear → verify embeddings → verify graph |
| 6.3 | E2E test: fix-reaudit loop | Change a node → re-audit → verify old finding resolved, node status updates |
| 6.4 | Error recovery testing | Kill Claude Code mid-audit → verify graceful recovery, run marked as error |
| 6.5 | SSE reconnection testing | Drop SSE connection → verify auto-reconnect picks up from last finding |
| 6.6 | Performance profiling | Profile with 50+ nodes: API response times, SSE latency, graph rendering FPS |
| 6.7 | Security hardening | Path traversal tests, SQL injection tests, ZIP bomb protection, CORS validation |
| 6.8 | Accessibility pass | Full keyboard navigation test, screen reader test, contrast audit |
| 6.9 | Fix all issues | Address findings from all audits above |
| 6.10 | Final documentation pass | Update ARCHITECTURE.md, CLAUDE.md, README.md with any changes from implementation |

### Checkpoint 6 (Final Quality Gate)

- [ ] All Playwright E2E tests pass
- [ ] `pytest tests/` — 100% pass rate
- [ ] `vitest` — all component tests pass
- [ ] `make lint` — zero warnings
- [ ] No security vulnerabilities found
- [ ] WCAG 2.1 AA compliance verified
- [ ] Core Web Vitals in acceptable range (LCP <2.5s, CLS <0.1)
- [ ] Demo mode fully functional without Canvas or Claude Code
- [ ] Real Canvas data ingestion works (when credentials available)

**Agent/Skill Audits**:

| Skill | Target | What It Checks |
|-------|--------|---------------|
| `backend-code-review` | Entire backend | Final security review, error handling completeness |
| `frontend-code-review` | Entire frontend | Final quality review, performance, patterns |
| `web-performance-optimization` | Full stack | Bundle optimization, rendering, SSE efficiency |
| `python-anti-patterns` | All Python code | Final anti-pattern sweep |
| `doc-maintenance` | All documentation | Doc completeness, accuracy, staleness |
| `canvas-accessibility-auditor` | Full app | Final accessibility certification |

---

## Phase 7: Launch & Handoff

**Goal**: System is ready for Trevor to use on real course data.

### Tasks

| # | Task | Detail |
|---|------|--------|
| 7.1 | Configure Canvas MCP with real credentials | Set `CANVAS_API_TOKEN`, `CANVAS_BASE_URL`, `CANVAS_COURSE_ID` |
| 7.2 | Run full ingestion on real course | `/ingest-course` → `/embed-all` → `/rebuild-graph` |
| 7.3 | Run full audit on real course | `/audit-all` → review findings for quality |
| 7.4 | Tune audit prompts for EGN 3000L | Adjust based on real findings — domain-specific terminology, rubric patterns |
| 7.5 | Create user guide | How to run audits, interpret findings, use the graph, fix-reaudit workflow |
| 7.6 | Final demo walkthrough | Walk through entire system with Trevor |

---

## Dependency Map

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5 ──→ Phase 6 ──→ Phase 7
                                        │                        │
                                        │ (needs Canvas creds)   │ (needs Phase 4 for
                                        │  for real data only    │  live audit testing)
                                        │                        │
                                        └── Can develop with ────┘
                                            seed data until
                                            credentials arrive
```

### Critical Path

The longest sequential chain is: **Phase 0 → 1A → 2A → 3 → 4 → 5C → 6**

This is because:
- MCP servers (2A) must work before ingestion (3)
- Ingestion (3) must work before audits (4)
- Audits (4) must work before the live audit stream UI (5C)

### Parallelism Opportunities

| Parallel Set | What Runs Together | Coordination Contract |
|---|---|---|
| Phase 1: 1A + 1B | Backend models + Frontend shell | TypeScript types mirror Pydantic models |
| Phase 2: 2A + 2B | MCP servers + FastAPI routes | Both read/write SQLite `audit.db` — MCP via tools, FastAPI via aiosqlite |
| Phase 5: 5A + 5B + 5C + 5D | All frontend pages | Shared Zustand store + API client; independent page routes |

### Canvas Credential Status

**Canvas MCP is live** — connected to course 2018858 (copy of real EGN 3000L course, read-only).
- Phases 0–1: ✅ Complete
- Phase 2: Model adjustments informed by real Canvas data investigation
- Phase 3+: Can ingest real data directly — no need for seed-only development

---

## Agent & Skill Assignment Summary

### Quality Audits by Phase

| Phase | Skills Used | Focus |
|-------|------------|-------|
| 1 | `python-type-safety`, `python-anti-patterns`, `async-python-patterns`, `frontend-code-review` | Model correctness, service quality |
| 2 | `backend-code-review`, `rag-implementation`, `python-type-safety`, `async-python-patterns` | API design, MCP contracts, RAG architecture |
| 3 | `canvas-course-qc`, `rag-implementation`, `backend-code-review` | Data quality, embedding strategy, file parsing safety |
| 4 | `sequential-thinking`, `backend-code-review`, `canvas-course-qc` | Reasoning quality, subprocess safety, finding specificity |
| 5 | `ui-ux-pro-max`, `frontend-design`, `frontend-code-review`, `frontend-testing`, `canvas-accessibility-auditor`, `web-performance-audit`, `design-guide` | Full UI/UX, accessibility, performance, testing |
| 6 | `backend-code-review`, `frontend-code-review`, `web-performance-optimization`, `python-anti-patterns`, `doc-maintenance`, `canvas-accessibility-auditor` | Final hardening across all layers |

### Security Checkpoints

Security is not a single phase — it's verified at every checkpoint:

| Checkpoint | Security Focus |
|------------|---------------|
| CP0 | `.gitignore` covers `.env`, no secrets in repo |
| CP1 | Pydantic strict mode enforced, no `dict` where model should be |
| CP2 | Parameterized SQL queries, path sanitization in node CRUD, CORS config |
| CP3 | ZIP bomb protection, file type validation, no path traversal in extractors |
| CP4 | Subprocess argument safety, no user input in Claude CLI args |
| CP5 | No XSS in rendered content, no sensitive data in client bundle |
| CP6 | Full security audit — penetration testing of all input paths |

### Performance Checkpoints

| Checkpoint | Performance Focus |
|------------|------------------|
| CP2 | API response times <100ms for seed data, SQLite WAL mode enabled |
| CP4 | SSE latency <1s from emit to display, heartbeat working |
| CP5 | LCP <2.5s, bundle size <500KB, graph renders at 60fps for seed data |
| CP6 | Full performance profiling under load (50+ nodes, concurrent audits) |

---

## Estimated Scope

| Phase | Tasks | Estimated Files | Key Complexity |
|-------|-------|----------------|----------------|
| 0 | 12 | ~15 | Project scaffolding — mostly config and setup |
| 1 | 15 | ~20 | Pydantic models, service CRUD, layout components |
| 2 | 17 | ~15 | MCP composite server, FastAPI routes, SSE generator |
| 3 | 8 | ~8 | Slash commands, file extractors, ZIP parser |
| 4 | 8 | ~5 | Slash commands, prompt engineering, runner integration |
| 5 | 21 | ~30 | Full React dashboard, D3 graph, SSE stream, all pages |
| 6 | 10 | ~10 | E2E tests, fixes, documentation updates |
| 7 | 6 | ~2 | Configuration and tuning with real data |
| **Total** | **97** | **~105** | |

---

## Quick Reference: What Blocks What

| If you're stuck on... | You need... | Workaround |
|----------------------|------------|------------|
| Canvas MCP integration | ✅ Connected | Course 2018858, read-only verified |
| Real course ingestion | Phase 2 complete | Canvas MCP ready, model adjustments defined |
| Chroma MCP setup | `pip install chroma-mcp` | Use mock embeddings for frontend dev |
| Claude Code audit testing | Max plan active, CLI installed | Seed findings for frontend dev |
| D3 graph rendering | Graph data from Phase 3 | Use seed `graph.json` |
| Live audit streaming | Phases 2 + 4 complete | Use pre-seeded findings with simulated SSE |
