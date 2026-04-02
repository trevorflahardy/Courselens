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

## Phase 0: Project Foundation

**Goal**: Repository scaffolded, tooling configured, demo mode runnable.

### Tasks

| # | Task | Detail |
|---|------|--------|
| 0.1 | Initialize project structure | Create full directory tree per ARCHITECTURE.md |
| 0.2 | Set up Python environment | `pyproject.toml` with all deps, `uv venv`, dev extras (pytest, ruff, mypy) |
| 0.3 | Set up Next.js 15 | `npx create-next-app@latest` with App Router, TypeScript, Tailwind v4, ESLint |
| 0.4 | Install shadcn/ui | `npx shadcn@latest init` + core components: Button, Card, Badge, Dialog, Table, Tabs, Select, Progress, Input, Sheet |
| 0.5 | Create `.env.example` | All environment variables with comments |
| 0.6 | Create `Makefile` | `setup`, `dev`, `seed`, `test`, `lint`, `check` targets |
| 0.7 | Create `scripts/setup_db.py` | SQLite schema: `nodes`, `node_links`, `files`, `edges`, `findings`, `audit_runs`, `ingest_log` tables with indexes. WAL mode. |
| 0.8 | Create `scripts/seed_demo.py` | 15 assignments, 3 pages, 2 rubrics, 1 lecture, 20 edges, 8 findings |
| 0.9 | Create `CLAUDE.md` | Orchestrator instructions, tool reference, audit principles |
| 0.10 | Configure `.claude/settings.json` | MCP server declarations (Chroma MCP, Audit MCP, Canvas MCP placeholder) |
| 0.11 | Create `.github/workflows/ci.yml` | Lint (ruff + eslint) + test (pytest + vitest) on push |
| 0.12 | Create `scripts/setup.sh` | Automated full setup for first-time clone |

### Checkpoint 0

- [ ] `make setup` runs without errors
- [ ] `python scripts/seed_demo.py` creates all fixture data in `data/`
- [ ] `data/audit.db` has all 7 tables, `data/files/` and `data/chroma/` directories exist
- [ ] `cd frontend && npm run build` succeeds
- [ ] `make lint` passes

**Agent/Skill Audit**: None — manual verification.

---

## Phase 1: Data Layer + Frontend Shell

**Goal**: Backend models validated, SQLite working, frontend shell renders with static data.

### Stream 1A: Backend Models & Services

| # | Task | Detail |
|---|------|--------|
| 1A.1 | Implement Pydantic models | `node.py`, `finding.py`, `audit.py`, `graph.py` — all with strict mode |
| 1A.2 | Implement `db.py` | aiosqlite connection management, `init_db()` for migrations |
| 1A.3 | Implement `node_service.py` | SQLite CRUD for nodes — read, upsert (with merge + content_hash), list, batch read, link |
| 1A.4 | Implement `finding_service.py` | SQLite CRUD — create finding, lifecycle transitions (stale/resolved/superseded), query by assignment/severity/run |
| 1A.5 | Implement `graph_service.py` | SQLite edge CRUD + NetworkX loader on demand — get neighbors, get flags, mark stale |
| 1A.5b | Implement `file_service.py` | File download tracking, text extraction dispatch (pypdf/docx/html), hash computation |
| 1A.6 | Write model tests | `tests/backend/test_models.py` — validation, serialization, strict mode |
| 1A.7 | Write service tests | `tests/backend/test_services.py` — CRUD, merge logic, concurrent access |

### Stream 1B: Frontend Shell (parallel with 1A)

| # | Task | Detail |
|---|------|--------|
| 1B.1 | Create `types.ts` | TypeScript interfaces mirroring all Pydantic models + SSE event types |
| 1B.2 | Build root layout | `app/layout.tsx` — sidebar nav, top bar, content area |
| 1B.3 | Build Sidebar component | Navigation links with icons, course name, active state |
| 1B.4 | Build TopBar component | Breadcrumbs, quick actions area |
| 1B.5 | Create Zustand store skeleton | Slices: nodes, audit, graph, ui — with TypeScript types |
| 1B.6 | Create API client | `lib/api.ts` — typed `fetch` wrapper for all backend endpoints |
| 1B.7 | Build Dashboard page (static) | `/` — stat cards, quick action buttons, recent findings placeholder |
| 1B.8 | Configure Tailwind theme | Severity colors, dark mode, font stack, spacing scale |

### Checkpoint 1

- [ ] All Pydantic models validate against seed data without errors
- [ ] Services can CRUD nodes, findings, audit runs against seed data
- [ ] `pytest tests/backend/` passes — all model + service tests green
- [ ] Frontend builds and renders layout shell at `localhost:3000`
- [ ] TypeScript types match Pydantic models (manual check or snapshot)

**Agent/Skill Audits**:

| Skill | Target | What It Checks |
|-------|--------|---------------|
| `python-type-safety` | `backend/models/`, `backend/services/` | Type hints, generics, strict mode compliance |
| `python-anti-patterns` | `backend/services/` | Code smells, anti-patterns in service layer |
| `async-python-patterns` | `backend/db.py`, `backend/services/` | Async correctness, connection management |
| `frontend-code-review` | `frontend/components/layout/`, `frontend/lib/` | Component structure, type safety, hook patterns |

---

## Phase 2: MCP Servers + FastAPI Backend

**Goal**: All MCP tools functional, all API routes returning data from seed.

### Stream 2A: MCP Servers

| # | Task | Detail |
|---|------|--------|
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

- [ ] `claude -p "test" --allowedTools mcp__audit__nodes_read` works (Audit MCP starts + reads from SQLite)
- [ ] Chroma MCP accepts upsert + returns query results for seed data
- [ ] `uvicorn backend.main:app` starts without errors
- [ ] All API routes return correct data from SQLite seed: `curl localhost:8000/api/nodes`
- [ ] SSE endpoint streams heartbeats: `curl localhost:8000/api/audit/test-run/stream`
- [ ] `pytest tests/` — all tests pass

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

> **Blocker**: Requires Canvas API token + course ID from Trevor. Use seed data for development; swap to real data when credentials arrive.

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

## Phase 4: AI Audit Engine

**Goal**: Full 3-pass audit runs against seed data, findings stream to SSE.

### Tasks (Sequential)

| # | Task | Detail |
|---|------|--------|
| 4.1 | Create `/audit` slash command | Three-pass audit logic per ARCHITECTURE.md — clarity, dependencies, forward impact |
| 4.2 | Create `/audit-all` slash command | Parallel batches of 4, sorted by week ascending |
| 4.3 | Create `/summarize-findings` command | Course-level summary: top issues, most problematic nodes, severity distribution |
| 4.4 | Test single audit against seed | Run `/audit` on a seed assignment, verify findings emitted to SQLite via `emit_finding` |
| 4.5 | Test SSE streaming | Start audit via API, connect to SSE stream, verify findings appear in real-time |
| 4.6 | Test audit-all | Run full audit on all seed assignments, verify parallel execution and completion |
| 4.7 | Tune audit prompts | Review finding quality — adjust Pass 1/2/3 prompts for specificity, reduce false positives |
| 4.8 | Update CLAUDE.md | Finalize orchestrator instructions based on testing results |

### Checkpoint 4

- [ ] `/audit <seed_assignment>` produces specific, evidenced findings
- [ ] Findings appear in `findings.db` with correct severity, type, evidence
- [ ] SSE stream at `/api/audit/{run_id}/stream` delivers findings in real-time
- [ ] Pass progression events (pass_start, pass_done, done) are emitted
- [ ] `/audit-all` completes all seed assignments without errors
- [ ] `/summarize-findings` produces a coherent course-level report
- [ ] No finding says "could be clearer" without specific evidence

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

### Canvas Credential Independence

Phases 0–5 can all be completed with **seed data only**. Real Canvas credentials are only needed for:
- Phase 3, Task 3.8 (real ingestion test)
- Phase 7 (full launch)

This means development is **never blocked** by waiting for credentials.

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
| Canvas MCP integration | Canvas API token from Trevor | Use seed data + mock Canvas responses |
| Real course ingestion | Canvas credentials | Test with IMSCC ZIP fixture |
| Chroma MCP setup | `pip install chroma-mcp` | Use mock embeddings for frontend dev |
| Claude Code audit testing | Max plan active, CLI installed | Seed findings for frontend dev |
| D3 graph rendering | Graph data from Phase 3 | Use seed `graph.json` |
| Live audit streaming | Phases 2 + 4 complete | Use pre-seeded findings with simulated SSE |
