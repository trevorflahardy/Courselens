Run a full 3-pass AI audit on a single assignment.

## Usage

```
/audit <assignment_node_id>
```

## What This Does

Runs a three-pass audit against the specified assignment node:

1. **Pass 1 — Standalone Clarity**: Can a student complete this assignment from this page alone? Checks for ambiguous instructions, missing context, submission format clarity, rubric alignment, and broken references.

2. **Pass 2 — Backward Dependencies**: Are there unstated prerequisites? Checks for implicit prerequisites, assumption gaps, format mismatches with prior assignments, and orphan detection.

3. **Pass 3 — Forward Impact**: Would issues here cascade to downstream assignments? Checks for cascade risk, format mismatches with future assignments, and curriculum gaps.

## Instructions

You are the AI audit engine for a course audit system. Execute the following steps:

### Step 1: Validate the node exists

Use `mcp__audit__nodes_read` to fetch the node with ID `$ARGUMENTS`. If it doesn't exist, report the error and stop.

### Step 2: Create an audit run record

Generate a run ID like `run-XXXXXXXX` (8 hex chars). Insert a new row into `audit_runs` via the backend database with status `running`.

### Step 3: Execute Pass 1 — Standalone Clarity

Read the full node content including description, points_possible, and submission_types. If the node has a rubric_id, fetch the rubric from the `rubrics` table.

Analyze the assignment and for EACH issue found, call `mcp__audit__emit_finding` with:
- `assignment_id`: the node ID
- `audit_run_id`: your run ID
- `pass_number`: 1
- `severity`: gap / warn / info / ok
- `finding_type`: clarity / rubric_mismatch / rubric_drift / format_mismatch / broken_file_link
- `title`: concise issue title
- `body`: detailed explanation with specific fix recommendation
- `evidence`: exact quoted text from the assignment content

**Rules:**
- EVERY finding MUST quote specific text as evidence
- NEVER say "could be clearer" without explaining exactly what is ambiguous
- Findings must be actionable — an instructor should know what to fix

### Step 4: Execute Pass 2 — Backward Dependencies

Use `mcp__audit__graph_get_neighbors` to find incoming edges (prerequisites). Use `mcp__audit__nodes_read_many` to fetch those nodes' content.

Check for implicit prerequisites, assumption gaps, and format mismatches. Emit findings with `pass_number`: 2 and types: `implicit_prerequisite`, `assumption_gap`, `format_mismatch`, `orphan`.

### Step 5: Execute Pass 3 — Forward Impact

Use `mcp__audit__graph_get_neighbors` to find outgoing edges (downstream). Fetch those nodes' content.

Check for cascade risk, format mismatches, and curriculum gaps. Emit findings with `pass_number`: 3 and types: `cascade_risk`, `format_mismatch`, `curriculum_gap`.

### Step 6: Summarize

Update the audit_runs record with final counts and status `done`. Output a summary table:

```
## Audit Complete: <assignment title>

| Pass | Findings |
|------|----------|
| 1 — Clarity | X |
| 2 — Dependencies | X |
| 3 — Forward Impact | X |
| **Total** | **X** |

### Top Issues
- [gap] <title>: <brief description>
- [warn] <title>: <brief description>
```

## Allowed Tools

- `mcp__audit__nodes_read`
- `mcp__audit__nodes_read_many`
- `mcp__audit__nodes_list`
- `mcp__audit__graph_get_neighbors`
- `mcp__audit__graph_get_flags`
- `mcp__audit__emit_finding`
- `mcp__audit__emit_resolve_stale`
