Generate a course-level summary report of all audit findings.

## Usage

```
/summarize-findings
```

## What This Does

Reads all active findings from the database and produces a structured summary report showing severity distribution, most problematic assignments, finding type breakdown, and actionable recommendations.

## Instructions

You are generating a course audit summary report. Execute the following steps:

### Step 1: Gather findings data

Use `mcp__audit__nodes_list` to get all nodes, then query findings for each. Alternatively, use the backend API at `GET /api/findings` to fetch all active findings.

### Step 2: Compute statistics

Calculate:
- Total active findings by severity (gap, warn, info, ok)
- Findings by type (clarity, rubric_mismatch, implicit_prerequisite, etc.)
- Findings by pass number (1=clarity, 2=dependencies, 3=forward impact)
- Findings per assignment, ranked by severity

### Step 3: Identify patterns

Look for systemic issues:
- Are rubric problems concentrated in certain weeks?
- Do dependency issues cluster around specific transitions (e.g., week 3→4)?
- Are there recurring clarity issues that suggest a template problem?

### Step 4: Generate the report

Output a structured report:

```
# Course Audit Summary Report
Generated: <date>

## Overview
- **Total active findings:** X
- **Audit runs completed:** X
- **Assignments with issues:** X / Y total

## Severity Breakdown

| Severity | Count | % of Total |
|----------|-------|------------|
| gap (must fix) | X | X% |
| warn (should review) | X | X% |
| info (observation) | X | X% |
| ok (verified) | X | X% |

## Top Priority Fixes

These assignments have the most critical issues:

### 1. [Week X] <Assignment Title>
- **Gaps:** X | **Warnings:** X
- Key issues:
  - <finding title>: <brief description>
  - <finding title>: <brief description>

### 2. [Week X] <Assignment Title>
...

## Finding Types Analysis

| Type | Count | Most Affected |
|------|-------|---------------|
| clarity | X | <assignment> |
| rubric_mismatch | X | <assignment> |
| ... | ... | ... |

## Pass Analysis

| Pass | Focus | Findings |
|------|-------|----------|
| 1 | Standalone Clarity | X |
| 2 | Backward Dependencies | X |
| 3 | Forward Impact | X |

## Systemic Patterns

<Describe any patterns found in Step 3>

## Recommended Action Plan

1. **Immediate (gaps):** <prioritized list of must-fix items>
2. **Short-term (warnings):** <items to review soon>
3. **Optional (info):** <minor improvements>
```

## Allowed Tools

- `mcp__audit__nodes_read`
- `mcp__audit__nodes_read_many`
- `mcp__audit__nodes_list`
- `mcp__audit__graph_get_neighbors`
- `mcp__audit__graph_get_flags`
