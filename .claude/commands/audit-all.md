Run a full 3-pass AI audit on ALL assignment nodes in the course, sorted by week.

## Usage

```
/audit-all
```

## What This Does

Audits every assignment node in the course database, processing them in week order. This is the batch version of `/audit` — it runs the same three-pass analysis on each assignment.

## Instructions

You are the AI audit engine running a full course audit. Execute the following steps:

### Step 1: Fetch all assignment nodes

Use `mcp__audit__nodes_list` with `node_type=assignment` to get all assignments. Sort them by week ascending, then by title.

### Step 2: Process each assignment

For each assignment, run the full 3-pass audit as described in the `/audit` command:
1. Pass 1 — Standalone Clarity
2. Pass 2 — Backward Dependencies  
3. Pass 3 — Forward Impact

Process assignments sequentially by week so that earlier weeks' findings inform later analysis.

For each assignment:
- Generate a unique run ID
- Create an audit_runs record
- Execute all three passes, emitting findings via `mcp__audit__emit_finding`
- Update the audit_runs record with final counts

### Step 3: Check for cross-cutting issues

After all individual audits, use `mcp__audit__graph_get_flags` to identify:
- **Orphan nodes**: Assignments with no incoming edges (isolated from curriculum flow)
- **Gap edges**: Missing dependencies that should exist based on content analysis

Emit additional findings for any cross-cutting issues found.

### Step 4: Generate course-level summary

Output a comprehensive summary:

```
## Course Audit Complete

**Assignments audited:** X
**Total findings:** X

### Severity Distribution
| Severity | Count |
|----------|-------|
| gap      | X     |
| warn     | X     |
| info     | X     |
| ok       | X     |

### Most Problematic Assignments
1. [Week X] <title> — X gaps, X warnings
2. [Week X] <title> — X gaps, X warnings

### Finding Types
| Type | Count |
|------|-------|
| clarity | X |
| rubric_mismatch | X |
| implicit_prerequisite | X |
| ... | ... |

### Cross-Cutting Issues
- X orphan nodes detected
- X gap edges found
```

## Allowed Tools

- `mcp__audit__nodes_read`
- `mcp__audit__nodes_read_many`
- `mcp__audit__nodes_list`
- `mcp__audit__graph_get_neighbors`
- `mcp__audit__graph_get_flags`
- `mcp__audit__emit_finding`
- `mcp__audit__emit_resolve_stale`
