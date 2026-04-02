# Canvas Course Audit System — Full Architecture

> **For the implementing model:** Read this entire document before writing a single line of code.
> This is a living spec. Sections marked `[PLACEHOLDER]` require assets from Trevor before
> implementation. Everything else can be scaffolded immediately. When in doubt, ask.

---

## What Trevor Needs to Provide Before Full Implementation

The following are **blockers** for specific phases. Scaffold everything else first.

| #   | What                                               | Why needed                         | Which phase |
| --- | -------------------------------------------------- | ---------------------------------- | ----------- |
| 1   | Canvas course export ZIP (IMSCC or flat file dump) | Drives bulk ingestion pipeline     | Phase 1     |
| 2   | Canvas course URL + session cookies OR API token   | Agent browser navigation           | Phase 1     |
| 3   | List of course modules and their order             | Validates graph structure          | Phase 1     |
| 4   | Confirmation of local machine OS (macOS assumed)   | MCP server paths, ChromaDB install | Setup       |
| 5   | Preferred project root directory path              | All absolute paths in config       | Setup       |

Until these arrive, implement: full project scaffold, all MCP servers with mock data, NextJS
frontend with static fixtures, bridge server, and slash commands. The system should be
fully runnable in "demo mode" with seeded fake assignments before any real Canvas data lands.

---

## System Goals

1. **Bulk ingest** an entire Canvas course — files, pages, assignments, rubrics, lectures,
   announcements — into a structured local data store, with relational context preserved.
2. **Run AI audits** per assignment (and across assignments) using Claude Code as the AI engine,
   streaming findings live to a web dashboard.
3. **Visualize** the full dependency graph of the course — assignments that build on each other,
   gaps, orphans, rubric mismatches — as an interactive force-directed graph.
4. **Never pay API costs.** Everything runs through Claude Code on the Max plan.

---

## Tech Stack

| Layer        | Choice                                         | Reason                                                                         |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| AI engine    | Claude Code CLI (`claude`)                     | Max plan, no token billing, native MCP, `--output-format stream-json`          |
| Backend      | **FastAPI** + **uvicorn** + **asyncio**        | Async-native, Pydantic v2 strict typing, SSE via `StreamingResponse`           |
| Frontend     | **Next.js 14** (App Router)                    | File-based routing handles many assignment pages cleanly, RSC for static parts |
| Vector DB    | **ChromaDB** (embedded)                        | Zero-server local RAG, Python-native                                           |
| Graph store  | **NetworkX** in-memory + `graph.json` on disk  | Simple, inspectable, no extra service                                          |
| Relational   | **SQLite** via `aiosqlite`                     | Findings log, audit runs, node metadata                                        |
| File parsing | `pypdf`, `python-docx`, `beautifulsoup4`       | PDF/DOCX/HTML extraction                                                       |
| MCP servers  | **FastMCP** (Python)                           | Minimal boilerplate, matches Claude Code's MCP protocol                        |
| Bridge       | FastAPI SSE endpoint (same process as backend) | No separate Node server needed                                                 |
| Styling      | **Tailwind CSS v4** + **shadcn/ui**            | Matches the modern Canvas aesthetic we're building toward                      |
| State        | **Zustand** (frontend)                         | Lightweight, works well with SSE-driven updates                                |
| HTTP client  | **axios** (frontend)                           | SSE via `EventSource` API natively                                             |

### Why FastAPI as both backend AND bridge

Claude Code subprocess output is just stdout lines. FastAPI can spawn subprocesses and stream
their stdout as SSE using `asyncio.create_subprocess_exec` + `StreamingResponse`. No separate
Node bridge server needed — one Python process handles everything.

---

## Project Directory Structure

```
course-audit/
│
├── CLAUDE.md                          ← Orchestrator instructions (read by `claude` on every run)
├── ARCHITECTURE.md                    ← This file (symlinked or copied here)
│
├── .claude/
│   └── commands/
│       ├── audit.md                   ← /audit <assignment_id>
│       ├── audit-all.md               ← /audit-all (parallel, all nodes)
│       ├── ingest-canvas.md           ← /ingest-canvas <zip_path>
│       ├── ingest-file.md             ← /ingest-file <file_path> <type>
│       ├── rebuild-graph.md           ← /rebuild-graph (re-derive all edges)
│       └── summarize-findings.md      ← /summarize-findings (course-level report)
│
├── backend/
│   ├── main.py                        ← FastAPI app entry point
│   ├── config.py                      ← Settings (Pydantic BaseSettings, .env)
│   ├── models/
│   │   ├── __init__.py
│   │   ├── node.py                    ← CourseNode, NodeType, NodeStatus
│   │   ├── finding.py                 ← Finding, FindingSeverity, FindingType
│   │   ├── audit.py                   ← AuditRun, AuditStatus
│   │   └── graph.py                   ← GraphEdge, EdgeType, GraphState
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── nodes.py                   ← GET /nodes, GET /nodes/{id}
│   │   ├── audit.py                   ← POST /audit/{id}, GET /audit/{id}/stream
│   │   ├── graph.py                   ← GET /graph, POST /graph/rebuild
│   │   ├── findings.py                ← GET /findings, GET /findings/{node_id}
│   │   └── ingest.py                  ← POST /ingest/zip, POST /ingest/file, GET /ingest/status
│   ├── services/
│   │   ├── __init__.py
│   │   ├── claude_runner.py           ← Spawns Claude Code subprocess, tails stream-json
│   │   ├── chroma_service.py          ← ChromaDB client, upsert, query_similar
│   │   ├── graph_service.py           ← NetworkX graph, edge derivation, serialization
│   │   ├── node_service.py            ← CRUD for nodes/ JSON files
│   │   ├── finding_service.py         ← SQLite findings CRUD via aiosqlite
│   │   └── ingest/
│   │       ├── __init__.py
│   │       ├── canvas_zip.py          ← Parses IMSCC/flat Canvas export ZIP
│   │       ├── pdf_extractor.py       ← pypdf text extraction
│   │       ├── docx_extractor.py      ← python-docx extraction
│   │       ├── html_extractor.py      ← BeautifulSoup Canvas HTML pages
│   │       └── file_linker.py         ← Matches agent-found filenames → extracted files
│   └── db.py                          ← aiosqlite setup, migrations
│
├── mcp/
│   ├── fs_mcp.py                      ← read_node, write_node, list_nodes
│   ├── chromadb_mcp.py                ← upsert_embedding, query_similar, delete_node
│   ├── graph_mcp.py                   ← add_node, add_edge, get_neighbors, get_flags
│   └── emit_mcp.py                    ← emit_finding (writes to SQLite + signals SSE)
│
├── data/
│   ├── nodes/                         ← One JSON file per course node (source of truth)
│   │   └── .gitkeep
│   ├── graph.json                     ← Derived graph (never hand-edit)
│   ├── chroma/                        ← ChromaDB persistent storage
│   │   └── .gitkeep
│   └── findings.db                    ← SQLite: findings, audit runs
│
├── frontend/                          ← Next.js 14 app
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                   ← / Dashboard overview
│   │   ├── assignments/
│   │   │   ├── page.tsx               ← /assignments List view
│   │   │   └── [id]/
│   │   │       └── page.tsx           ← /assignments/[id] Detail + recommendations
│   │   ├── graph/
│   │   │   └── page.tsx               ← /graph Force-directed dependency graph
│   │   ├── audit/
│   │   │   ├── page.tsx               ← /audit Run controls, history
│   │   │   └── [runId]/
│   │   │       └── page.tsx           ← /audit/[runId] Live stream view
│   │   └── ingest/
│   │       └── page.tsx               ← /ingest Bulk ingestion status + controls
│   ├── components/
│   │   ├── ui/                        ← shadcn/ui base components
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   └── TopBar.tsx
│   │   ├── assignments/
│   │   │   ├── AssignmentCard.tsx
│   │   │   ├── AssignmentList.tsx
│   │   │   ├── FindingCard.tsx
│   │   │   └── FindingPanel.tsx
│   │   ├── graph/
│   │   │   ├── DependencyGraph.tsx    ← D3 force layout wrapper
│   │   │   ├── GraphNode.tsx
│   │   │   └── GraphEdge.tsx
│   │   ├── audit/
│   │   │   ├── AuditButton.tsx
│   │   │   ├── AuditStream.tsx        ← SSE consumer, live finding cards
│   │   │   └── AuditHistory.tsx
│   │   └── ingest/
│   │       ├── IngestProgress.tsx
│   │       └── IngestLog.tsx
│   ├── lib/
│   │   ├── api.ts                     ← Typed API client (axios)
│   │   ├── sse.ts                     ← SSE hook (useAuditStream)
│   │   └── types.ts                   ← Shared TypeScript types (mirrors Pydantic models)
│   ├── store/
│   │   └── useAuditStore.ts           ← Zustand store
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   └── package.json
│
├── scripts/
│   ├── seed_demo.py                   ← Seeds data/ with fake assignments for dev
│   ├── setup_db.py                    ← Creates SQLite schema
│   └── check_deps.py                  ← Verifies Claude Code CLI, MCP servers, ChromaDB
│
├── .env.example
├── pyproject.toml                     ← Python deps (uv or pip)
└── README.md
```

---

## Data Models

### Python (Pydantic v2 — strict mode throughout)

```python
# backend/models/node.py
from __future__ import annotations
from enum import StrEnum
from typing import Annotated
from pydantic import BaseModel, Field
from datetime import datetime

class NodeType(StrEnum):
    ASSIGNMENT = "assignment"
    PAGE = "page"
    RUBRIC = "rubric"
    LECTURE = "lecture"
    ANNOUNCEMENT = "announcement"
    FILE = "file"

class NodeStatus(StrEnum):
    OK = "ok"
    WARN = "warn"
    GAP = "gap"
    ORPHAN = "orphan"
    UNAUDITED = "unaudited"

class CourseNode(BaseModel):
    model_config = {"strict": True}

    id: str
    type: NodeType
    title: str
    week: int | None = None
    module: str | None = None
    module_order: int | None = None

    # Content
    description: str | None = None          # Inline Canvas HTML stripped to text
    instructions: str | None = None         # Full instruction text
    rubric_text: str | None = None
    linked_files: list[str] = Field(default_factory=list)   # filenames
    linked_pages: list[str] = Field(default_factory=list)   # page IDs
    linked_assignments: list[str] = Field(default_factory=list)

    # Extracted from file dump
    file_content: str | None = None         # Full extracted text from PDF/DOCX
    file_path: str | None = None            # Path in data/nodes/files/

    # Audit state
    status: NodeStatus = NodeStatus.UNAUDITED
    last_audited: datetime | None = None
    finding_count: int = 0

    # Source tracking
    canvas_url: str | None = None
    source: str = "unknown"   # "agent" | "file_dump" | "merged"
    extracted_at: datetime = Field(default_factory=datetime.utcnow)
```

```python
# backend/models/finding.py
from __future__ import annotations
from enum import StrEnum
from pydantic import BaseModel, Field
from datetime import datetime
import uuid

class FindingSeverity(StrEnum):
    GAP = "gap"
    WARN = "warn"
    INFO = "info"
    OK = "ok"

class FindingType(StrEnum):
    CLARITY = "clarity"
    RUBRIC_MISMATCH = "rubric_mismatch"
    ASSUMPTION_GAP = "assumption_gap"
    DEPENDENCY_GAP = "dependency_gap"
    FORMAT_MISMATCH = "format_mismatch"
    ORPHAN = "orphan"
    CASCADE_RISK = "cascade_risk"
    CURRICULUM_GAP = "curriculum_gap"

class Finding(BaseModel):
    model_config = {"strict": True}

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    assignment_id: str
    audit_run_id: str
    severity: FindingSeverity
    finding_type: FindingType
    title: str
    body: str
    linked_node: str | None = None
    evidence: str | None = None       # Quoted text from the assignment that triggered this
    pass_number: int                   # 1=clarity, 2=dependencies, 3=forward_impact
    created_at: datetime = Field(default_factory=datetime.utcnow)
```

```python
# backend/models/graph.py
from __future__ import annotations
from enum import StrEnum
from pydantic import BaseModel, Field
from datetime import datetime

class EdgeType(StrEnum):
    EXPLICIT = "explicit"        # Assignment literally references prior
    INFERRED = "inferred"        # RAG similarity + reasoning conclusion
    GAP = "gap"                  # Should exist but doesn't / format mismatch
    ARTIFACT = "artifact"        # Produces file consumed downstream

class GraphEdge(BaseModel):
    model_config = {"strict": True}

    source: str
    target: str
    edge_type: EdgeType
    label: str
    evidence: str | None = None
    confidence: float | None = None   # 0.0–1.0 for inferred edges
    derived_at: datetime = Field(default_factory=datetime.utcnow)

class GraphState(BaseModel):
    nodes: list[str]
    edges: list[GraphEdge]
    flags: list[str]   # node IDs with active gap/orphan status
    last_rebuilt: datetime = Field(default_factory=datetime.utcnow)
```

### TypeScript (frontend/lib/types.ts)

```typescript
// Mirror of Pydantic models — keep in sync manually or generate with openapi-typescript

export type NodeType =
  | "assignment"
  | "page"
  | "rubric"
  | "lecture"
  | "announcement"
  | "file";
export type NodeStatus = "ok" | "warn" | "gap" | "orphan" | "unaudited";
export type FindingSeverity = "gap" | "warn" | "info" | "ok";
export type FindingType =
  | "clarity"
  | "rubric_mismatch"
  | "assumption_gap"
  | "dependency_gap"
  | "format_mismatch"
  | "orphan"
  | "cascade_risk"
  | "curriculum_gap";
export type EdgeType = "explicit" | "inferred" | "gap" | "artifact";

export interface CourseNode {
  id: string;
  type: NodeType;
  title: string;
  week: number | null;
  module: string | null;
  description: string | null;
  instructions: string | null;
  rubric_text: string | null;
  linked_files: string[];
  linked_pages: string[];
  linked_assignments: string[];
  status: NodeStatus;
  last_audited: string | null;
  finding_count: number;
  canvas_url: string | null;
}

export interface Finding {
  id: string;
  assignment_id: string;
  audit_run_id: string;
  severity: FindingSeverity;
  finding_type: FindingType;
  title: string;
  body: string;
  linked_node: string | null;
  evidence: string | null;
  pass_number: number;
  created_at: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  edge_type: EdgeType;
  label: string;
  evidence: string | null;
  confidence: number | null;
}

export interface GraphState {
  nodes: string[];
  edges: GraphEdge[];
  flags: string[];
  last_rebuilt: string;
}

// SSE event types
export type AuditStreamEvent =
  | { type: "finding"; data: Finding }
  | { type: "pass_start"; pass: number; label: string }
  | { type: "pass_done"; pass: number; finding_count: number }
  | { type: "tool_call"; tool: string; input: Record<string, unknown> }
  | { type: "done"; total_findings: number }
  | { type: "error"; message: string };
```

### SQLite Schema

```sql
-- Run via scripts/setup_db.py

CREATE TABLE IF NOT EXISTS audit_runs (
    id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',   -- running | done | error
    pass1_findings INTEGER DEFAULT 0,
    pass2_findings INTEGER DEFAULT 0,
    pass3_findings INTEGER DEFAULT 0,
    total_findings INTEGER DEFAULT 0,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL,
    audit_run_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    finding_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    linked_node TEXT,
    evidence TEXT,
    pass_number INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (audit_run_id) REFERENCES audit_runs(id)
);

CREATE TABLE IF NOT EXISTS ingest_log (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    node_id TEXT,
    status TEXT NOT NULL,   -- success | error | skipped
    error_message TEXT,
    ingested_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_findings_assignment ON findings(assignment_id);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_audit_runs_assignment ON audit_runs(assignment_id);
```

---

## Phase 1: Canvas Bulk Ingestion Pipeline

This phase runs BEFORE any audits. It populates `data/nodes/` with all course content.

### Two-track parallel approach

```
Track A: File dump extraction (runs first, fast)
  Canvas export ZIP → unzip → parse IMSCC manifest → extract all files
  → pypdf/python-docx/html for text → write to data/nodes/

Track B: Agent browser navigation (runs alongside or after)
  Claude Code with canvas-mcp → walk every module → extract inline content
  → capture relational context (module order, page links, assignment links)
  → merge with Track A output (join on filename)
```

### 1A: Canvas ZIP Parser (`backend/services/ingest/canvas_zip.py`)

```python
import asyncio
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import AsyncIterator
from ..node_service import NodeService
from .pdf_extractor import extract_pdf
from .docx_extractor import extract_docx
from .html_extractor import extract_canvas_html

async def ingest_canvas_zip(
    zip_path: Path,
    node_service: NodeService,
    progress_callback: AsyncIterator[str] | None = None
) -> dict[str, int]:
    """
    Ingests a Canvas IMSCC export ZIP.
    Returns stats: {total, success, error, skipped}

    IMSCC structure:
    - imsmanifest.xml  ← master index, all resource IDs + types
    - course_settings/ ← module order, assignment groups
    - wiki_content/    ← HTML pages (Canvas pages)
    - web_resources/   ← attached files (PDFs, DOCX, etc.)
    - assignment_groups/ ← assignment XMLs with rubrics
    """
    stats = {"total": 0, "success": 0, "error": 0, "skipped": 0}

    with zipfile.ZipFile(zip_path) as zf:
        # Parse manifest
        manifest = ET.fromstring(zf.read("imsmanifest.xml"))
        ns = {"imscc": "http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1"}

        # Parse module order from course_settings/module_meta.xml
        module_order = await _parse_module_meta(zf, ns)

        # Walk all resources in manifest
        tasks = []
        for resource in manifest.findall(".//imscc:resource", ns):
            res_type = resource.get("type", "")
            res_id = resource.get("identifier", "")
            href = resource.get("href", "")

            if "assignment" in res_type:
                tasks.append(_ingest_assignment(zf, resource, module_order, node_service))
            elif "webcontent" in res_type or "wiki" in res_type:
                tasks.append(_ingest_page(zf, resource, module_order, node_service))
            elif href.endswith(".pdf"):
                tasks.append(_ingest_pdf(zf, href, res_id, node_service))
            elif href.endswith((".docx", ".doc")):
                tasks.append(_ingest_docx(zf, href, res_id, node_service))

        # Run all ingestion concurrently, max 10 at once
        semaphore = asyncio.Semaphore(10)
        results = await asyncio.gather(*[
            _with_semaphore(semaphore, task) for task in tasks
        ], return_exceptions=True)

        for result in results:
            stats["total"] += 1
            if isinstance(result, Exception):
                stats["error"] += 1
            else:
                stats["success"] += 1

    return stats
```

**Key extraction functions:**

```python
async def _ingest_assignment(zf, resource, module_order, node_service):
    """Parse Canvas assignment XML → CourseNode."""
    # Canvas assignment XML contains: title, body (instructions), rubric, due date
    # Extract rubric criteria separately
    ...

async def _ingest_page(zf, resource, module_order, node_service):
    """Parse Canvas wiki HTML page → CourseNode."""
    # Strip Canvas-specific markup, extract links to files and other pages
    ...

async def _ingest_pdf(zf, href, res_id, node_service):
    """Extract text from PDF file in ZIP."""
    # pypdf: extract all pages, join with double newline
    # Store in node.file_content, node.file_path
    ...
```

### 1B: Slash Command for Agent-Assisted Ingestion

The agent walk happens via Claude Code. This handles:

- Pages that only exist as Canvas HTML (no file equivalent)
- Relational context (module membership, ordering, page-to-assignment links)
- Announcement text

```markdown
<!-- .claude/commands/ingest-canvas.md -->

Ingest the Canvas course at $ARGUMENTS.

You have tools: canvas_navigate, canvas_extract_page, canvas_list_module_items,
fs_write_node, fs_read_node.

## Step 1 — Module walk (parallel)

List all modules with canvas_list_module_items for each module ID.
For each item, record: title, URL, type, module_name, module_order, item_order.

## Step 2 — Page extraction (parallel, batches of 8)

For each page URL found in Step 1:

- canvas_extract_page → get title, full HTML text, all hrefs
- Strip HTML to plain text
- Note all linked filenames and linked assignment IDs
- fs_write_node with type="page", source="agent"

## Step 3 — Assignment extraction (parallel, batches of 8)

For each assignment URL:

- canvas_extract_page → description, instructions, due date
- Note rubric link if present; extract rubric criteria text
- Note linked files (handouts, templates)
- Check if existing node exists (from ZIP ingest) and MERGE, don't overwrite
  - Merge: add relational fields (module, order, links) to existing node
  - Do not overwrite file_content already extracted from ZIP

## Step 4 — Announcement extraction

Extract all announcements in chronological order.
These often contain corrections to broken instructions — flag any that
reference an assignment by name.

## Step 5 — File linking

For every node with linked_files, check if a matching node exists in nodes/.
If yes, add cross-reference. If no match → flag as "broken file link".

Report final counts: pages, assignments, announcements, broken links.
```

### 1C: Embedding Pass (after ingestion)

After nodes are written, embed all content into ChromaDB:

```markdown
<!-- .claude/commands/embed-all.md -->

Embed all nodes from data/nodes/ into ChromaDB for RAG queries.

For each node in data/nodes/:

1. Build embedding text = title + " | " + (description or "") + " | " + (instructions or "")[:2000]
2. Call chromadb_upsert with id=node.id, text=embedding_text, metadata={type, week, module, status}
3. Report: total embedded, errors

Run in batches of 20. Skip nodes where file_content is null AND instructions is null.
```

### 1D: Graph Derivation Pass

After embedding:

```markdown
<!-- .claude/commands/rebuild-graph.md -->

Derive the dependency graph for all course nodes.

You have tools: fs_list_nodes, fs_read_node, chromadb_query_similar, graph_add_node,
graph_add_edge, graph_get_neighbors.

For each assignment node (type="assignment"), ordered by week ascending:

1. Add to graph with graph_add_node
2. Check node.linked_assignments → add EXPLICIT edges for each
3. Check node.linked_pages → add EXPLICIT edges for each page
4. Call chromadb_query_similar with assignment description, filter week < this.week
   - For each result above 0.7 similarity: reason about whether this actually
     depends on it. If yes → add INFERRED edge with confidence score
5. Check if this assignment has NO incoming edges at all → flag as ORPHAN

After all nodes processed:

- Find pairs (A → B) where A produces an artifact and B expects one
  but descriptions suggest incompatible formats → add GAP edge
- Write final graph to graph.json via graph_serialize

Report: node_count, edge_count, orphan_count, gap_count.
```

---

## Phase 2: MCP Servers

All four MCP servers run as persistent local processes. Claude Code connects to them
via the `.claude/settings.json` MCP configuration.

### MCP Configuration (`.claude/settings.json`)

```json
{
  "mcpServers": {
    "fs": {
      "command": "python",
      "args": ["mcp/fs_mcp.py"],
      "env": { "NODES_DIR": "./data/nodes" }
    },
    "chromadb": {
      "command": "python",
      "args": ["mcp/chromadb_mcp.py"],
      "env": { "CHROMA_DIR": "./data/chroma" }
    },
    "graph": {
      "command": "python",
      "args": ["mcp/graph_mcp.py"],
      "env": { "GRAPH_PATH": "./data/graph.json" }
    },
    "emit": {
      "command": "python",
      "args": ["mcp/emit_mcp.py"],
      "env": {
        "DB_PATH": "./data/findings.db",
        "EMIT_SOCKET": "/tmp/audit_emit.sock"
      }
    }
  }
}
```

### `mcp/fs_mcp.py`

```python
import os, json
from pathlib import Path
import fastmcp

NODES_DIR = Path(os.environ["NODES_DIR"])
mcp = fastmcp.FastMCP("fs")

@mcp.tool()
def read_node(node_id: str) -> dict:
    """Read a course node by ID. Returns full node JSON."""
    path = NODES_DIR / f"{node_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Node {node_id} not found")
    return json.loads(path.read_text())

@mcp.tool()
def write_node(node_id: str, data: dict) -> dict:
    """Write or update a course node. Merges with existing if present."""
    path = NODES_DIR / f"{node_id}.json"
    if path.exists():
        existing = json.loads(path.read_text())
        existing.update({k: v for k, v in data.items() if v is not None})
        data = existing
    data["id"] = node_id
    path.write_text(json.dumps(data, indent=2, default=str))
    return {"written": node_id}

@mcp.tool()
def list_nodes(node_type: str | None = None, week: int | None = None) -> list[str]:
    """List all node IDs, optionally filtered by type or week."""
    nodes = []
    for path in NODES_DIR.glob("*.json"):
        node = json.loads(path.read_text())
        if node_type and node.get("type") != node_type:
            continue
        if week is not None and node.get("week") != week:
            continue
        nodes.append(path.stem)
    return sorted(nodes)

@mcp.tool()
def read_many_nodes(node_ids: list[str]) -> list[dict]:
    """Read multiple nodes at once. Missing IDs are skipped."""
    return [json.loads((NODES_DIR / f"{nid}.json").read_text())
            for nid in node_ids
            if (NODES_DIR / f"{nid}.json").exists()]

if __name__ == "__main__":
    mcp.run()
```

### `mcp/chromadb_mcp.py`

```python
import os
from pathlib import Path
import chromadb
import fastmcp

CHROMA_DIR = Path(os.environ["CHROMA_DIR"])
client = chromadb.PersistentClient(path=str(CHROMA_DIR))
collection = client.get_or_create_collection(
    name="course_nodes",
    metadata={"hnsw:space": "cosine"}
)
mcp = fastmcp.FastMCP("chromadb")

@mcp.tool()
def upsert_embedding(node_id: str, text: str, metadata: dict) -> dict:
    """Embed and store a course node. Replaces existing entry if present."""
    collection.upsert(
        ids=[node_id],
        documents=[text],
        metadatas=[metadata]
    )
    return {"upserted": node_id}

@mcp.tool()
def query_similar(
    text: str,
    n_results: int = 5,
    week_before: int | None = None,
    node_type: str | None = None
) -> list[dict]:
    """
    Find semantically similar course nodes via RAG.

    - week_before: only return nodes from weeks strictly before this value
    - node_type: filter by assignment/page/rubric/lecture

    Returns list of {id, score, metadata} sorted by similarity descending.
    """
    where: dict = {}
    if week_before is not None:
        where["week"] = {"$lt": week_before}
    if node_type:
        where["type"] = {"$eq": node_type}

    results = collection.query(
        query_texts=[text],
        n_results=n_results,
        where=where if where else None
    )

    return [
        {"id": rid, "score": 1 - dist, "metadata": meta}
        for rid, dist, meta in zip(
            results["ids"][0],
            results["distances"][0],
            results["metadatas"][0]
        )
    ]

@mcp.tool()
def delete_node(node_id: str) -> dict:
    """Remove a node from the vector store."""
    collection.delete(ids=[node_id])
    return {"deleted": node_id}

if __name__ == "__main__":
    mcp.run()
```

### `mcp/graph_mcp.py`

```python
import os, json
from pathlib import Path
from datetime import datetime, timezone
import networkx as nx
import fastmcp

GRAPH_PATH = Path(os.environ["GRAPH_PATH"])
mcp = fastmcp.FastMCP("graph")

def _load_graph() -> nx.DiGraph:
    if not GRAPH_PATH.exists():
        return nx.DiGraph()
    data = json.loads(GRAPH_PATH.read_text())
    G = nx.DiGraph()
    for node_id in data.get("nodes", []):
        G.add_node(node_id)
    for edge in data.get("edges", []):
        G.add_edge(edge["source"], edge["target"], **edge)
    return G

def _save_graph(G: nx.DiGraph) -> None:
    edges = [dict(G.edges[u, v]) for u, v in G.edges()]
    data = {
        "nodes": list(G.nodes()),
        "edges": edges,
        "flags": [n for n in G.nodes() if G.nodes[n].get("status") in ("gap", "orphan")],
        "last_rebuilt": datetime.now(timezone.utc).isoformat()
    }
    GRAPH_PATH.write_text(json.dumps(data, indent=2, default=str))

@mcp.tool()
def add_node(node_id: str, attrs: dict) -> dict:
    G = _load_graph()
    G.add_node(node_id, **attrs)
    _save_graph(G)
    return {"added": node_id}

@mcp.tool()
def add_edge(
    source: str, target: str, edge_type: str,
    label: str, evidence: str | None = None,
    confidence: float | None = None
) -> dict:
    G = _load_graph()
    G.add_edge(source, target,
        source=source, target=target,
        edge_type=edge_type, label=label,
        evidence=evidence, confidence=confidence,
        derived_at=datetime.now(timezone.utc).isoformat()
    )
    _save_graph(G)
    return {"added_edge": f"{source} → {target}"}

@mcp.tool()
def get_neighbors(node_id: str) -> dict:
    """Return upstream (predecessors) and downstream (successors) node IDs."""
    G = _load_graph()
    if node_id not in G:
        return {"upstream": [], "downstream": [], "error": "node not found"}
    return {
        "upstream": [
            {"id": n, "edge": dict(G.edges[n, node_id])}
            for n in G.predecessors(node_id)
        ],
        "downstream": [
            {"id": n, "edge": dict(G.edges[node_id, n])}
            for n in G.successors(node_id)
        ]
    }

@mcp.tool()
def get_flags() -> list[dict]:
    """Return all flagged nodes (gap/orphan) with their edge context."""
    G = _load_graph()
    flags = []
    for n in G.nodes():
        status = G.nodes[n].get("status")
        if status in ("gap", "orphan"):
            flags.append({"id": n, "status": status, **G.nodes[n]})
    return flags

@mcp.tool()
def serialize_graph() -> dict:
    """Return full graph as dict for writing to graph.json."""
    G = _load_graph()
    _save_graph(G)
    return {"nodes": len(G.nodes()), "edges": len(G.edges())}

if __name__ == "__main__":
    mcp.run()
```

### `mcp/emit_mcp.py`

The most important MCP tool. When Claude calls `emit_finding`, it:

1. Writes the finding to SQLite
2. Writes a signal to a Unix socket that the FastAPI SSE handler is listening on
3. Returns immediately so Claude can keep reasoning

```python
import os, json, sqlite3, socket
from pathlib import Path
from datetime import datetime, timezone
import uuid
import fastmcp

DB_PATH = Path(os.environ["DB_PATH"])
EMIT_SOCKET = os.environ["EMIT_SOCKET"]   # /tmp/audit_emit.sock
mcp = fastmcp.FastMCP("emit")

def _write_to_db(finding: dict) -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        INSERT INTO findings
        (id, assignment_id, audit_run_id, severity, finding_type,
         title, body, linked_node, evidence, pass_number, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
    """, [
        finding["id"], finding["assignment_id"], finding["audit_run_id"],
        finding["severity"], finding["finding_type"],
        finding["title"], finding["body"],
        finding.get("linked_node"), finding.get("evidence"),
        finding["pass_number"], finding["created_at"]
    ])
    conn.commit()
    conn.close()

def _signal_sse(finding: dict) -> None:
    """Push finding to FastAPI SSE handler via Unix socket."""
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.connect(EMIT_SOCKET)
            s.sendall(json.dumps(finding).encode() + b"\n")
    except Exception:
        pass   # SSE handler may not be listening; finding is already in DB

@mcp.tool()
def emit_finding(
    assignment_id: str,
    audit_run_id: str,
    severity: str,
    finding_type: str,
    title: str,
    body: str,
    pass_number: int,
    linked_node: str | None = None,
    evidence: str | None = None
) -> dict:
    """
    Record an audit finding immediately when discovered.

    Call this as soon as you identify an issue — do not batch findings
    until the end of a pass. The dashboard streams them live.

    severity: "gap" | "warn" | "info"
    finding_type: "clarity" | "rubric_mismatch" | "assumption_gap" |
                  "dependency_gap" | "format_mismatch" | "orphan" |
                  "cascade_risk" | "curriculum_gap"
    evidence: Quote the exact text from the assignment that triggered this finding.
    pass_number: 1 (clarity) | 2 (dependencies) | 3 (forward_impact)
    """
    finding = {
        "id": str(uuid.uuid4()),
        "assignment_id": assignment_id,
        "audit_run_id": audit_run_id,
        "severity": severity,
        "finding_type": finding_type,
        "title": title,
        "body": body,
        "linked_node": linked_node,
        "evidence": evidence,
        "pass_number": pass_number,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    _write_to_db(finding)
    _signal_sse(finding)
    return {"emitted": True, "finding_id": finding["id"]}

if __name__ == "__main__":
    mcp.run()
```

---

## Phase 3: FastAPI Backend

### `backend/main.py`

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .db import init_db
from .routers import nodes, audit, graph, findings, ingest

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(title="Course Audit API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"]
)

app.include_router(nodes.router, prefix="/api/nodes")
app.include_router(audit.router, prefix="/api/audit")
app.include_router(graph.router, prefix="/api/graph")
app.include_router(findings.router, prefix="/api/findings")
app.include_router(ingest.router, prefix="/api/ingest")
```

### `backend/routers/audit.py` — The SSE + Claude Code Runner

```python
import asyncio, json, socket, os
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from ..services.claude_runner import run_claude_audit
from ..services.finding_service import FindingService

router = APIRouter()

@router.post("/{assignment_id}")
async def start_audit(assignment_id: str) -> dict:
    """Start an audit. Returns run_id immediately. Poll /stream for results."""
    run_id = await FindingService.create_run(assignment_id)
    # Fire and forget — SSE stream is how client tracks progress
    asyncio.create_task(run_claude_audit(assignment_id, run_id))
    return {"run_id": run_id, "assignment_id": assignment_id}

@router.get("/{run_id}/stream")
async def audit_stream(run_id: str):
    """
    SSE endpoint. Streams Finding events as Claude Code discovers them.
    Also streams pass_start, pass_done, tool_call, done events.
    """
    async def event_generator():
        # Listen on Unix socket for findings from emit-mcp
        sock_path = "/tmp/audit_emit.sock"
        server = await asyncio.start_unix_server(
            lambda r, w: None, path=sock_path
        )

        queue: asyncio.Queue = asyncio.Queue()

        async def handle_connection(reader, writer):
            data = await reader.readline()
            if data:
                await queue.put(json.loads(data.decode()))

        async with server:
            # Also tail Claude Code subprocess stdout for pass events
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=0.5)
                    yield f"data: {json.dumps({'type': 'finding', 'data': event})}\n\n"
                except asyncio.TimeoutError:
                    # Check if run is complete
                    run = await FindingService.get_run(run_id)
                    if run["status"] in ("done", "error"):
                        yield f"data: {json.dumps({'type': 'done', 'total_findings': run['total_findings']})}\n\n"
                        break
                    yield "data: {\"type\": \"heartbeat\"}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

### `backend/services/claude_runner.py`

```python
import asyncio, json
from pathlib import Path

COMMANDS_DIR = Path(".claude/commands")

async def run_claude_audit(assignment_id: str, run_id: str) -> None:
    """
    Spawn Claude Code as a subprocess with the /audit slash command.
    Claude Code's stream-json output is logged but findings come via emit-mcp.
    """
    prompt = f"/audit {assignment_id} {run_id}"

    proc = await asyncio.create_subprocess_exec(
        "claude",
        "--output-format", "stream-json",
        "--allowedTools",
        "mcp__fs__read_node,mcp__fs__list_nodes,mcp__chromadb__query_similar,"
        "mcp__graph__get_neighbors,mcp__emit__emit_finding",
        "-p", prompt,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(Path.cwd())
    )

    # Tail stdout for stream-json events (pass markers, tool calls)
    async for line in proc.stdout:
        try:
            event = json.loads(line.decode().strip())
            # Log or forward pass_start/pass_done events to a separate queue
            # These could also be written to findings.db as audit_run metadata
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass

    await proc.wait()

    # Mark run complete in DB
    from .finding_service import FindingService
    status = "done" if proc.returncode == 0 else "error"
    await FindingService.complete_run(run_id, status)
```

---

## Phase 4: Claude Code Slash Commands

### `CLAUDE.md` (root)

```markdown
# Course Audit — Claude Code Orchestrator

You are auditing a Foundations of Engineering Lab course (EGN 3000L) at USF.
Your goal is to identify clarity problems, curriculum gaps, dependency mismatches,
and rubric inconsistencies across all course assignments and pages.

## Available slash commands

- /audit <assignment_id> <run_id> — Audit a single assignment (3 passes)
- /audit-all — Audit all assignments in parallel
- /ingest-canvas <zip_path> — Ingest Canvas export ZIP
- /embed-all — Embed all nodes into ChromaDB
- /rebuild-graph — Re-derive all dependency edges
- /summarize-findings — Course-level audit summary report

## MCP tools available

| Tool             | Server   | Purpose                                             |
| ---------------- | -------- | --------------------------------------------------- |
| read_node        | fs       | Read a course node JSON by ID                       |
| write_node       | fs       | Write/merge a course node JSON                      |
| list_nodes       | fs       | List node IDs, filtered by type/week                |
| read_many_nodes  | fs       | Batch read multiple nodes                           |
| upsert_embedding | chromadb | Embed and store a node                              |
| query_similar    | chromadb | RAG: find semantically similar prior nodes          |
| add_node         | graph    | Add node to dependency graph                        |
| add_edge         | graph    | Add directed edge to dependency graph               |
| get_neighbors    | graph    | Get upstream/downstream nodes for a node            |
| emit_finding     | emit     | Record an audit finding (streams to dashboard live) |

## Principles

1. Always emit findings immediately when discovered — never batch until end of pass
2. Quote the exact text that triggered each finding (evidence field)
3. Be specific: "The rubric criterion 'stakeholder analysis' (15pts) does not appear
   in the instructions" is good. "Instructions could be clearer" is not.
4. Link findings to related nodes when relevant (linked_node field)
5. Inferred edges need confidence scores (0.0–1.0) based on reasoning quality
```

### `.claude/commands/audit.md`

```markdown
Audit assignment $1 with run ID $2.

Read the assignment: read_node($1)
Read course context: list_nodes(type="assignment") then read nearby week nodes.

---

## Pass 1 — Standalone clarity audit

Announce: "Starting Pass 1: Clarity audit for $1"

For every instruction sentence, rubric criterion, and submission requirement:

A) Instructions clarity

- Is any instruction sentence ambiguous or open to multiple interpretations?
- Are any assumed tools, templates, or formats never introduced?
- Is the submission format (file type, naming, location) clearly specified?
  → emit_finding for each issue found

B) Rubric alignment

- For each rubric criterion, does it appear explicitly in the instructions?
- Does any criterion use language (e.g. "quality", "professionalism") without
  defining what that means in context?
- Are point weights reasonable? (e.g. >60% on one criterion is worth flagging)
  → emit_finding for each mismatch

C) Standalone completeness

- Could a student complete this assignment knowing only the instructions on this page?
- If not, what prior knowledge is assumed? Is that assumption stated?
  → emit_finding for each unstated assumption

---

## Pass 2 — Backward dependency check (RAG)

Announce: "Starting Pass 2: Dependency check for $1"

Get this assignment's week from the node data.
Call query_similar(text=instructions, week_before=this_week, n_results=6)

For each similar result above 0.65 similarity score:

- Read that node: read_node(result.id)
- Reason: Does assignment $1 assume knowledge, skills, or artifacts that this
  prior node produces or teaches?
- If yes and it's explicitly stated in $1 → note as healthy dependency
- If yes and it's NOT stated → emit_finding (assumption_gap, link to that node)
- Does $1 expect an artifact (dataset, doc, sketch) from that node?
  If yes, are the format expectations compatible? If not → emit_finding (format_mismatch)

Also check: does $1 have ANY prior-week incoming edges in the graph?
get_neighbors($1) → if upstream is empty and week > 1 → emit_finding (orphan)

---

## Pass 3 — Forward impact check (graph traversal)

Announce: "Starting Pass 3: Forward impact for $1"

get_neighbors($1) → get downstream nodes
For each downstream node: read_node(downstream_id)

- Does what $1 asks students to produce match what downstream expects as input?
  Check format, depth, naming conventions.
  If mismatch → emit_finding (format_mismatch, link downstream node)

- If $1 were submitted poorly or incompletely, which downstream assignments
  would be most affected? If critical → emit_finding (cascade_risk)

- Is there a week gap between $1 and its dependent (>2 weeks with no bridging content)?
  If yes → emit_finding (curriculum_gap)

---

Announce: "Audit complete for $1. All findings emitted."
```

### `.claude/commands/audit-all.md`

```markdown
Run a full audit of all assignment nodes in the course.

Step 1: list_nodes(type="assignment") → get all assignment IDs
Step 2: Sort by week ascending
Step 3: Audit in parallel batches of 4 (to avoid overwhelming MCP servers)
For each batch: spawn /audit <id> <new_run_id> concurrently
Step 4: After all complete, run /summarize-findings

Report total: assignments audited, findings by severity, top 5 most problematic nodes.
```

---

## Phase 5: Next.js Frontend

### Page Structure

**`/` — Dashboard**

- Summary stats: total assignments, gap count, warn count, clean count, last audit date
- Quick-action cards: "Run full audit", "View graph", "Re-ingest course"
- Recent findings feed (last 10 across all assignments)
- Ingest status banner if ingestion is in progress

**`/assignments` — Assignment list**

- Left sidebar: filter by type, severity, week
- Search bar
- Week-grouped list of assignment cards (Canvas-style rows but cleaner)
- Each card: type icon, name, week, finding pills (gap/warn/info counts)
- Right panel opens on click: tabs for Recommendations, Links, Rubric

**`/assignments/[id]` — Assignment detail**

- Full page view (not panel) for deep dives
- Top section: assignment metadata, Canvas URL link, last audited date
- "Run audit" button → triggers SSE stream, findings appear live below
- Three-column findings by pass (Pass 1 / Pass 2 / Pass 3)
- Linked nodes section: upstream and downstream, with edge type badges
- Rubric text rendered cleanly

**`/graph` — Dependency graph**

- Full-width D3 force-directed graph
- Node color by type, ring color by status
- Click node → side panel (same as assignment detail panel)
- Click edge → edge info (type, evidence, confidence)
- Filter bar: All | Gaps | Orphans | Inferred edges
- Zoom + pan (D3 zoom behavior)

**`/audit` — Audit controls**

- Run audit on specific assignment (dropdown)
- Run audit on all assignments
- Audit history table: run ID, assignment, started, duration, findings count, status
- Click history row → `/audit/[runId]`

**`/audit/[runId]` — Live audit stream**

- Real-time view of a running or completed audit
- Pass progress indicator (Pass 1 ◉ → Pass 2 ○ → Pass 3 ○)
- Findings appear as cards in real-time via SSE
- Tool call log (collapsible): shows each MCP tool call Claude made

**`/ingest` — Ingestion controls**

- Upload Canvas ZIP button
- Ingestion progress: nodes parsed, embedded, graph edges derived
- Log of extracted nodes (filterable)
- "Re-embed all" and "Rebuild graph" action buttons

### Key Frontend Components

**`AuditStream.tsx`** — SSE consumer

```typescript
// frontend/components/audit/AuditStream.tsx
'use client'
import { useEffect, useState } from 'react'
import { Finding, AuditStreamEvent } from '@/lib/types'
import FindingCard from '../assignments/FindingCard'

interface AuditStreamProps {
  runId: string
}

export default function AuditStream({ runId }: AuditStreamProps) {
  const [findings, setFindings] = useState<Finding[]>([])
  const [currentPass, setCurrentPass] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const es = new EventSource(`/api/audit/${runId}/stream`)

    es.onmessage = (e) => {
      const event: AuditStreamEvent = JSON.parse(e.data)

      if (event.type === 'finding') {
        setFindings(prev => [event.data, ...prev])
      } else if (event.type === 'pass_start') {
        setCurrentPass(event.pass)
      } else if (event.type === 'done') {
        setDone(true)
        es.close()
      }
    }

    return () => es.close()
  }, [runId])

  return (
    <div>
      <PassProgress current={currentPass} done={done} />
      <div className="space-y-3 mt-4">
        {findings.map(f => <FindingCard key={f.id} finding={f} />)}
      </div>
    </div>
  )
}
```

**`DependencyGraph.tsx`** — D3 force layout

```typescript
// frontend/components/graph/DependencyGraph.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { GraphState, CourseNode } from '@/lib/types'

const NODE_COLOR: Record<string, string> = {
  assignment: '#7F77DD',
  lecture: '#1D9E75',
  page: '#378ADD',
  rubric: '#BA7517',
}
const STATUS_RING: Record<string, string> = {
  gap: '#E24B4A',
  orphan: '#EF9F27',
  warn: '#BA7517',
  ok: 'transparent',
  unaudited: 'transparent',
}

export default function DependencyGraph({
  graphState,
  nodes
}: {
  graphState: GraphState
  nodes: CourseNode[]
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!svgRef.current) return
    // D3 force simulation setup
    // Nodes positioned by week on Y axis, spread on X
    // Click handlers → setSelected
    // Zoom + pan behavior
    // Edge stroke-dasharray by type (solid/dashed/dotted)
  }, [graphState, nodes])

  return (
    <div className="relative w-full h-full">
      <svg ref={svgRef} className="w-full h-full" />
      {selected && <NodeDetailPanel nodeId={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
```

---

## Setup & Installation

### Prerequisites

```bash
# Verify Claude Code CLI is installed and authenticated
claude --version
claude -p "Say hello"   # Should respond without API key prompt

# Python 3.11+
python --version

# Node 18+
node --version
```

### Installation Script (`scripts/setup.sh`)

```bash
#!/bin/bash
set -e

echo "→ Creating Python virtual environment"
python -m venv .venv
source .venv/bin/activate

echo "→ Installing Python dependencies"
pip install fastapi uvicorn[standard] aiosqlite pydantic-settings \
            chromadb fastmcp networkx pypdf python-docx beautifulsoup4 \
            python-multipart

echo "→ Setting up SQLite database"
python scripts/setup_db.py

echo "→ Installing frontend dependencies"
cd frontend && npm install && cd ..

echo "→ Seeding demo data (placeholder assignments)"
python scripts/seed_demo.py

echo ""
echo "✓ Setup complete"
echo ""
echo "To start:"
echo "  Terminal 1: source .venv/bin/activate && uvicorn backend.main:app --reload"
echo "  Terminal 2: cd frontend && npm run dev"
echo "  Open: http://localhost:3000"
```

### `pyproject.toml`

```toml
[project]
name = "course-audit"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.111.0",
    "uvicorn[standard]>=0.29.0",
    "aiosqlite>=0.20.0",
    "pydantic>=2.7.0",
    "pydantic-settings>=2.3.0",
    "chromadb>=0.5.0",
    "fastmcp>=0.1.0",
    "networkx>=3.3",
    "pypdf>=4.2.0",
    "python-docx>=1.1.0",
    "beautifulsoup4>=4.12.0",
    "python-multipart>=0.0.9",
]

[tool.pyright]
strict = true
pythonVersion = "3.11"
```

### `backend/config.py`

```python
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", strict=True)

    # Paths
    nodes_dir: Path = Path("data/nodes")
    chroma_dir: Path = Path("data/chroma")
    graph_path: Path = Path("data/graph.json")
    db_path: Path = Path("data/findings.db")
    emit_socket: str = "/tmp/audit_emit.sock"

    # Frontend
    frontend_origin: str = "http://localhost:3000"

    # Claude Code
    claude_bin: str = "claude"
    claude_allowed_tools: str = (
        "mcp__fs__read_node,mcp__fs__list_nodes,mcp__fs__read_many_nodes,"
        "mcp__chromadb__query_similar,"
        "mcp__graph__get_neighbors,"
        "mcp__emit__emit_finding"
    )

settings = Settings()
```

---

## Demo Mode (No Canvas Data Yet)

Run `scripts/seed_demo.py` to populate `data/nodes/` with placeholder assignments
matching a typical Foundations of Engineering lab structure. This gives the frontend
and audit pipeline something real to work with before the actual course files arrive.

The seed script creates:

- 15 assignment nodes (Weeks 1–13)
- 3 page nodes (lab safety, rubric page, template page)
- 2 rubric nodes
- 1 lecture node
- 20 graph edges (mix of explicit, inferred, gap)
- 8 pre-seeded findings across 4 assignments

Everything the dashboard, graph viewer, and audit stream need to run in full demo mode.

---

## What to Build First (Implementation Order)

1. **`scripts/setup_db.py`** — SQLite schema, nothing works without this
2. **`scripts/seed_demo.py`** — Demo data, lets frontend dev start immediately
3. **`mcp/fs_mcp.py`** — Every other MCP and all slash commands depend on this
4. **`mcp/emit_mcp.py`** — Core of the live streaming architecture
5. **`backend/main.py` + routers** — FastAPI app skeleton with all routes stubbed
6. **`backend/routers/audit.py`** — SSE stream (most complex backend piece)
7. **`backend/services/claude_runner.py`** — Claude Code subprocess spawner
8. **`mcp/chromadb_mcp.py`** — Needed for Pass 2 of audits
9. **`mcp/graph_mcp.py`** — Needed for Pass 3 of audits
10. **`.claude/commands/audit.md`** — Core slash command
11. **`CLAUDE.md`** — Orchestrator instructions
12. **Next.js frontend** — All pages, starting with `/assignments` (most used)
13. **`backend/services/ingest/`** — Canvas ZIP parser (needs real data from Trevor)
14. **`.claude/commands/ingest-canvas.md`** — Agent browser walk (needs Canvas URL)

---

## API Routes Reference

```
GET  /api/nodes                          List all nodes (query: type, week, status)
GET  /api/nodes/{id}                     Get single node with findings
PATCH /api/nodes/{id}                    Update node fields

POST /api/audit/{assignment_id}          Start audit → returns {run_id}
GET  /api/audit/{run_id}/stream          SSE stream of findings
GET  /api/audit/runs                     List all audit runs
GET  /api/audit/runs/{run_id}            Get audit run details

GET  /api/findings                       List findings (query: assignment_id, severity, type)
GET  /api/findings/{assignment_id}       Get all findings for one assignment

GET  /api/graph                          Get full graph.json
POST /api/graph/rebuild                  Trigger /rebuild-graph slash command
GET  /api/graph/node/{id}                Get node with its edges

POST /api/ingest/zip                     Upload + start Canvas ZIP ingestion
POST /api/ingest/embed-all               Re-embed all nodes
GET  /api/ingest/status                  Current ingestion status + log
```

---

## Notes for the Implementing Model

- **Do not use any API key.** Claude Code runs via `claude` CLI using the Max plan session.
  The `--output-format stream-json` flag is what makes subprocess output parseable.
- **Pydantic strict mode is required everywhere.** Every model has `model_config = {"strict": True}`.
  Never use `dict` where a typed model should be used.
- **ChromaDB runs embedded.** `chromadb.PersistentClient(path=str(CHROMA_DIR))` — no server process.
- **The emit socket is ephemeral.** Delete `/tmp/audit_emit.sock` on startup if it exists.
- **graph.json is never hand-edited.** It is always written by `graph-mcp` or `rebuild-graph`.
- **Demo mode must work offline.** `seed_demo.py` creates all fixture data locally.
  The frontend should render correctly with seeded data before any Claude Code runs.
- **SSE heartbeats prevent connection timeout.** The SSE generator sends a heartbeat
  every 500ms when no finding is queued. Without this, connections drop after ~30s.
- **Slash commands use positional args.** `$1`, `$2` etc. as shown in the audit command.
  Claude Code substitutes these from the prompt string passed with `-p`.
- **MCP servers must be running before `claude` is spawned.** FastAPI lifespan should
  start all four MCP servers as subprocesses on startup, and shut them down on close.
