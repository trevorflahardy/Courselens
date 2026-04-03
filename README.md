# Course Audit System

An AI-powered course audit tool that gives instructors a **holistic view** of their entire course at once — finding clarity issues, dependency gaps, rubric mismatches, and curriculum holes that are invisible when reviewing assignments in isolation.

Built for **EGN 3000L: Foundations of Engineering Lab** at the University of South Florida.

<img width="1265" height="760" alt="image" src="https://github.com/user-attachments/assets/633c5d4e-5aaf-48e2-8205-01a5e7157650" />
<img width="1268" height="754" alt="image" src="https://github.com/user-attachments/assets/f7fccd56-a7b2-43bf-ad17-48f02163144f" />

---

## The Problem

Course design happens incrementally. An instructor writes an assignment, links a rubric, adds a handout, moves on. Over 15+ assignments and dozens of pages, things break down:

- An assignment assumes knowledge that was never taught
- A rubric grades on criteria not mentioned in the instructions
- Week 5 produces data in one format; Week 8 expects a completely different one
- A three-week curriculum gap exists where a critical skill should have been introduced

The instructor sees each assignment in isolation. Students experience them in sequence. **No one has a holistic view of the entire course — until now.**

> See [APP.md](./APP.md) for the full vision and problem statement.

---

## How It Works

### 1. Ingest Everything

Pull the entire course from Canvas LMS via the Canvas MCP — assignments, rubrics, pages, lectures, announcements, files. Each becomes a structured node in a local database.

### 2. Build the Dependency Graph

The AI derives a dependency graph across all course content. Explicit references, inferred dependencies via semantic search, artifact chains, and detected gaps — all visualized as an interactive force-directed graph.

### 3. Run Deep AI Audits

For each assignment, three reasoning passes:

| Pass | Focus | Finds |
|------|-------|-------|
| **Pass 1** | Standalone clarity | Ambiguous instructions, rubric-instruction mismatches, undefined terms |
| **Pass 2** | Backward dependencies | Unstated prerequisites, format mismatches with prior work, orphan assignments |
| **Pass 3** | Forward impact | Cascade risks, curriculum gaps, output/input incompatibilities |

Findings stream live to the dashboard as the AI reasons — you watch issues materialize in real-time.

### 4. Fix and Re-Audit

See a finding. Fix the content. Re-run the audit on that assignment. Watch the node go green. **A living audit layer, not a one-time report.**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| AI Engine | Claude Code CLI (Max plan — zero API costs) |
| Backend | FastAPI + uvicorn + aiosqlite |
| Frontend | Next.js 15 (App Router) + Tailwind CSS v4 + shadcn/ui |
| Vector DB | ChromaDB (via official Chroma MCP) |
| Graph | NetworkX + interactive D3 visualization |
| Canvas | Canvas MCP (80+ tools for course data) |
| State | Zustand |
| Testing | pytest + Vitest + Playwright |

---

## Quick Start

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — authenticated, Max plan
- Python 3.11+
- Node.js 18+
- [uv](https://github.com/astral-sh/uv) — `curl -LsSf https://astral.sh/uv/install.sh | sh`

### Setup

```bash
# Clone the project
cd course-audit

# Full automated setup
make setup

# Or manual steps:
uv venv && source .venv/bin/activate
uv pip install -e ".[dev]"
python scripts/setup_db.py
cd frontend && npm install && cd ..
python scripts/seed_demo.py
```

### Run

```bash
# Start both backend and frontend
make dev

# Or manually (two terminals):
# Terminal 1:
uvicorn backend.main:app --reload --port 8000

# Terminal 2:
cd frontend && npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Demo Mode

The system ships with seed data — 15 assignments, 21 course nodes, 20 graph edges, and 8 pre-seeded findings. Everything works in demo mode without Canvas credentials or Claude Code.

---

## Dashboard Pages

| Page | URL | Purpose |
|------|-----|---------|
| Dashboard | `/` | Overview stats, quick actions, recent findings |
| Assignments | `/assignments` | Filterable list with severity indicators |
| Assignment Detail | `/assignments/[id]` | Full detail, "Run Audit" button, findings by pass |
| Dependency Graph | `/graph` | Interactive force-directed course visualization |
| Audit Controls | `/audit` | Run audits, view history |
| Live Audit | `/audit/[runId]` | Real-time finding stream |
| Ingestion | `/ingest` | Upload data, trigger ingestion, monitor progress |

---

## Project Structure

```
course-audit/
├── APP.md              # Vision & problem statement
├── ARCHITECTURE.md     # Full technical architecture
├── PLAN.md             # Implementation plan (phases & streams)
├── CLAUDE.md           # AI orchestrator instructions
├── backend/            # FastAPI + services + models
├── frontend/           # Next.js 15 dashboard
├── mcp/                # Custom Audit MCP server (FastMCP)
├── data/               # SQLite DB, ChromaDB embeddings, raw file blobs
├── scripts/            # Setup, seed, utilities
└── tests/              # pytest + Vitest + Playwright
```

> See [ARCHITECTURE.md](./ARCHITECTURE.md) for complete directory tree, data models, API routes, and design decisions.

> See [PLAN.md](./PLAN.md) for the phased implementation plan with parallel streams and quality gates.

---

## MCP Servers

The system uses three MCP servers — two off-the-shelf, one custom:

| Server | Source | Purpose |
|--------|--------|---------|
| **Canvas MCP** | Pre-existing | Course data access (assignments, rubrics, modules, pages) |
| **Chroma MCP** | Official (`chroma-mcp`) | Vector database for semantic search (RAG) |
| **Audit MCP** | Custom (FastMCP) | Domain operations: node CRUD, graph traversal, finding emission |

---

## Common Commands

```bash
make setup          # Full first-time setup
make dev            # Start backend + frontend
make seed           # Re-seed demo data
make test           # Run all tests (pytest + vitest)
make lint           # Run linters (ruff + eslint)
make check          # Verify dependencies installed
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```
CANVAS_API_TOKEN=       # Your Canvas API token
CANVAS_BASE_URL=        # Your Canvas instance URL
CANVAS_COURSE_ID=       # Target course ID
```

All other variables have sensible defaults for local development.

---

## Architecture Highlights

- **Zero API costs** — All AI runs through Claude Code on the Max plan
- **Official MCPs** — Uses battle-tested Chroma MCP and Canvas MCP instead of custom wrappers
- **Single custom MCP** — One FastMCP composite server handles all domain-specific tools
- **SQLite-primary storage** — All structured data in one DB file with change detection and finding lifecycle
- **Live streaming** — Findings stream via SSE as the AI discovers them
- **Smart file ingestion** — Only downloads files actually referenced by assignments, not the entire Canvas file dump
- **Fix-reaudit loop** — Content hash tracking detects changes, auto-marks findings stale, re-audit resolves or confirms
- **Demo mode** — Fully functional without Canvas credentials or Claude Code

---

## Documentation

| Document | Purpose |
|----------|---------|
| [APP.md](./APP.md) | Vision, problem statement, what gets caught |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Technical architecture, data models, API design, all decisions |
| [PLAN.md](./PLAN.md) | Implementation phases, parallel streams, agent/skill assignments |
| [CLAUDE.md](./CLAUDE.md) | Instructions for Claude Code AI orchestrator |

---

## License

Private — USF internal use only.
