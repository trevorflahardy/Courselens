"""AI Audit Engine — three-pass audit orchestration.

Builds structured prompts for each audit pass, spawns Claude subprocesses,
parses stream-json output, and emits findings to SQLite.

Pass 1: Standalone Clarity — can a student complete this from this page alone?
Pass 2: Backward Dependencies — what prior knowledge/artifacts are assumed?
Pass 3: Forward Impact — what downstream assignments depend on this output?
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime

from backend.claude_runner import start_audit_run, tail_run
from backend.db import get_db
from backend.services.graph_service import get_neighbors
from backend.services.node_service import get_node, list_nodes

logger = logging.getLogger(__name__)

# MCP tools the audit subprocess is allowed to call
AUDIT_ALLOWED_TOOLS = [
    "mcp__audit__nodes_nodes_read",
    "mcp__audit__nodes_nodes_read_many",
    "mcp__audit__nodes_nodes_list",
    "mcp__audit__emit_emit_finding",
    "mcp__audit__emit_emit_resolve_stale",
    "mcp__audit__emit_emit_checkpoint",
]


class RateLimitError(Exception):
    """Raised when Claude subprocess reports HTTP 429 / rate limiting."""


@dataclass
class AuditProgress:
    """Tracks progress of a multi-pass audit."""

    run_id: str
    assignment_id: str
    current_pass: int = 0
    pass1_findings: int = 0
    pass2_findings: int = 0
    pass3_findings: int = 0
    status: str = "running"
    events: list[dict[str, object]] = field(default_factory=list)
    completed_passes: int = 0
    rate_limited: bool = False


def _build_pass1_prompt(
    node_id: str,
    title: str,
    description: str | None,
    points: float | None,
    submission_types: list[str] | None,
    rubric_text: str | None,
    run_id: str,
) -> str:
    """Build the Pass 1 — Standalone Clarity prompt."""
    parts = [
        f"You are auditing the course assignment **{title}** (node ID: `{node_id}`).",
        "",
        "## Assignment Content",
        "",
    ]

    if description:
        parts.append(f"**Instructions (HTML):**\n```html\n{description[:8000]}\n```")
    else:
        parts.append("**Instructions:** _(no description provided)_")

    if points is not None:
        parts.append(f"\n**Points possible:** {points}")
    if submission_types:
        parts.append(f"**Submission types:** {', '.join(submission_types)}")
    if rubric_text:
        parts.append(f"\n**Rubric:**\n```\n{rubric_text[:4000]}\n```")

    parts.extend(
        [
            "",
            "## Pass 1 — Standalone Clarity Audit",
            "",
            "Analyze this assignment as if you are a student seeing it for the first time.",
            "For EACH issue you find, call `emit_finding` with the appropriate fields.",
            "",
            "Check the following and emit a finding for each problem:",
            "",
            "1. **Ambiguous instructions** — Is any sentence open to multiple interpretations?",
            "   Quote the exact text that is ambiguous and explain why.",
            "2. **Missing context** — Are tools, templates, file formats, or software assumed",
            "   but never introduced or linked?",
            "3. **Submission format** — Is the required file type, naming convention, and",
            "   submission location clearly specified?",
            "4. **Rubric alignment** — For each rubric criterion: does it appear explicitly",
            "   in the instructions? Are any criteria using undefined terms ('quality',",
            "   'professionalism') without context for what those mean?",
            "5. **Point weight balance** — Is >60% of the grade on a single criterion?",
            "   If so, is that intentional and clear to the student?",
            "6. **Self-sufficiency** — Could a student complete this knowing ONLY what's on",
            "   this page? What prior knowledge is assumed but not stated?",
            "7. **Broken references** — Are there links to files, pages, or external",
            "   resources that appear broken or inaccessible?",
            "",
            "## Finding Emission Rules",
            "",
            "- EVERY finding MUST include `evidence`: the exact quoted text from the assignment.",
            "- NEVER say 'could be clearer' without explaining exactly what is ambiguous.",
            "- Findings must be **actionable** — an instructor should know exactly what to fix.",
            "- Use these severity levels:",
            "  - `gap`: Must fix — students will be confused or unable to complete",
            "  - `warn`: Should review — potential issue that may cause problems",
            "  - `info`: Observation — minor suggestion for improvement",
            "  - `ok`: Verified correct — explicitly noting something is well done",
            "",
            f"Use `audit_run_id`: `{run_id}` and `pass_number`: 1 for all findings.",
            f"Use `assignment_id`: `{node_id}` for all findings.",
            "",
            "After completing your analysis, call `emit_checkpoint` with `audit_run_id`:"
            f" `{run_id}`, `pass_number`: 1, and a one-sentence summary of what you found.",
            "Then output a brief human-readable summary.",
        ]
    )
    return "\n".join(parts)


def _build_pass2_prompt(
    node_id: str,
    title: str,
    week: int | None,
    description: str | None,
    neighbor_summaries: str,
    run_id: str,
) -> str:
    """Build the Pass 2 — Backward Dependencies prompt."""
    parts = [
        f"You are auditing **{title}** (node ID: `{node_id}`, week {week or 'unknown'}).",
        "",
        "## Pass 2 — Backward Dependency Audit",
        "",
        "This pass examines whether this assignment has **unstated prerequisites**.",
        "",
    ]

    if description:
        parts.append(
            f"**Assignment content (first 3000 chars):**\n```html\n{description[:3000]}\n```"
        )

    parts.extend(
        [
            "",
            "## Related Nodes (from dependency graph and prior weeks)",
            "",
            neighbor_summaries if neighbor_summaries else "_(no related nodes found)_",
            "",
            "## Check for these issues:",
            "",
            "1. **Implicit prerequisites** — Does this assignment assume knowledge or skills",
            "   taught in a prior assignment, but never states the dependency?",
            "   → `finding_type`: `implicit_prerequisite`",
            "2. **Assumption gaps** — Does this assignment assume the student has a specific",
            "   artifact (report, code, data file) from a prior week?",
            "   → `finding_type`: `assumption_gap`",
            "3. **Format mismatches** — Does a prior assignment produce output in a format",
            "   incompatible with what this assignment expects as input?",
            "   → `finding_type`: `format_mismatch`",
            "4. **Orphan check** — If this is week > 1 and has NO incoming edges in the graph,",
            "   flag it as potentially disconnected from the curriculum.",
            "   → `finding_type`: `orphan`",
            "",
            "Use `nodes_read` or `nodes_read_many` to fetch full content of related nodes if needed.",
            "Dependency graph data is provided above in 'Related Nodes' — no graph tool calls needed.",
            "",
            f"Use `audit_run_id`: `{run_id}` and `pass_number`: 2 for all findings.",
            f"Use `assignment_id`: `{node_id}` for all findings.",
            "",
            "If a dependency exists and IS properly stated, emit an `ok` finding noting the healthy link.",
            "After completing your analysis, call `emit_checkpoint` with `audit_run_id`:"
            f" `{run_id}`, `pass_number`: 2, and a one-sentence summary.",
            "Then output a brief human-readable summary.",
        ]
    )
    return "\n".join(parts)


def _build_pass3_prompt(
    node_id: str,
    title: str,
    week: int | None,
    description: str | None,
    downstream_summaries: str,
    run_id: str,
) -> str:
    """Build the Pass 3 — Forward Impact prompt."""
    parts = [
        f"You are auditing **{title}** (node ID: `{node_id}`, week {week or 'unknown'}).",
        "",
        "## Pass 3 — Forward Impact Audit",
        "",
        "This pass examines whether issues in THIS assignment would **cascade** to",
        "downstream assignments that depend on its output.",
        "",
    ]

    if description:
        parts.append(
            f"**Assignment content (first 2000 chars):**\n```html\n{description[:2000]}\n```"
        )

    parts.extend(
        [
            "",
            "## Downstream Nodes (assignments that depend on this one)",
            "",
            downstream_summaries
            if downstream_summaries
            else "_(no downstream nodes found — this may be a terminal assignment)_",
            "",
            "## Check for these issues:",
            "",
            "1. **Cascade risk** — If a student does poorly on this assignment, would it",
            "   break a downstream assignment? How severe is the impact?",
            "   → `finding_type`: `cascade_risk`",
            "2. **Format mismatch** — Does this assignment's output format NOT match what",
            "   a downstream assignment expects as input?",
            "   → `finding_type`: `format_mismatch`",
            "3. **Curriculum gap** — Is there a >2 week gap between this and the next",
            "   related assignment with no bridging content?",
            "   → `finding_type`: `curriculum_gap`",
            "",
            "Use `nodes_read` to fetch full content of downstream nodes if needed.",
            "Downstream graph data is provided above in 'Downstream Nodes' — no graph tool calls needed.",
            "",
            f"Use `audit_run_id`: `{run_id}` and `pass_number`: 3 for all findings.",
            f"Use `assignment_id`: `{node_id}` for all findings.",
            "",
            "After completing your analysis, call `emit_checkpoint` with `audit_run_id`:"
            f" `{run_id}`, `pass_number`: 3, and a one-sentence summary.",
            "Then output a brief human-readable summary.",
        ]
    )
    return "\n".join(parts)


async def _get_rubric_text(node_id: str) -> str | None:
    """Fetch rubric criteria as readable text for a node."""
    db = await get_db()
    cursor = await db.execute("SELECT rubric_id FROM nodes WHERE id = ?", (node_id,))
    row = await cursor.fetchone()
    if not row or not row[0]:
        return None

    rubric_ref = str(row[0])
    canvas_id_guess = rubric_ref[7:] if rubric_ref.startswith("rubric-") else rubric_ref

    cursor = await db.execute(
        "SELECT title, points_possible, criteria_json FROM rubrics WHERE id = ? OR canvas_id = ? LIMIT 1",
        (rubric_ref, canvas_id_guess),
    )
    rubric = await cursor.fetchone()
    if not rubric:
        return None

    parts = [f"Rubric: {rubric[0]} ({rubric[1] or 0} points)"]
    try:
        criteria = json.loads(rubric[2])
        for i, c in enumerate(criteria, 1):
            desc = c.get("description", "")
            pts = c.get("points", 0)
            parts.append(f"  {i}. {desc} ({pts} pts)")
            for r in c.get("ratings", []):
                parts.append(f"     - {r.get('description', '')} ({r.get('points', 0)} pts)")
    except (json.JSONDecodeError, TypeError):
        pass

    return "\n".join(parts)


async def _get_neighbor_summaries(node_id: str, direction: str = "incoming") -> str:
    """Get summaries of neighboring nodes for context."""
    neighbors = await get_neighbors(node_id)
    edges = neighbors.get(direction, [])
    if not edges:
        return ""

    relevant_ids: list[str] = []
    for edge in edges:
        if direction == "incoming":
            relevant_ids.append(edge.source)
        else:
            relevant_ids.append(edge.target)

    if not relevant_ids:
        return ""

    summaries = []
    for nid in relevant_ids[:10]:  # Cap at 10
        node = await get_node(nid)
        if node:
            desc_preview = (node.description or "")[:200]
            summaries.append(
                f"- **{node.title}** (`{node.id}`, {node.type}, week {node.week or '?'}): "
                f"{desc_preview}..."
            )

    return "\n".join(summaries)


async def run_single_audit(
    assignment_id: str,
    run_id: str | None = None,
    start_pass: int = 1,
    progress: AuditProgress | None = None,
) -> AuditProgress:
    """Run a full 3-pass audit on a single assignment.

    Args:
        assignment_id: Node ID to audit.
        run_id: Existing run ID (for resumes) or None to create a new one.
        start_pass: Which pass to start from (1=fresh, 2 or 3=resume after rate-limit).
        progress: Pre-created AuditProgress to mutate in-place. If provided, the caller
            can observe events being appended as the audit runs (used for SSE streaming).
    """
    if run_id is None:
        run_id = f"run-{uuid.uuid4().hex[:8]}"

    if progress is None:
        progress = AuditProgress(run_id=run_id, assignment_id=assignment_id)
    else:
        # Ensure run_id is consistent
        progress.run_id = run_id
        progress.assignment_id = assignment_id

    # Fetch the node
    node = await get_node(assignment_id)
    if node is None:
        progress.status = "error"
        progress.events.append({"type": "error", "message": f"Node '{assignment_id}' not found"})
        return progress

    db = await get_db()
    now = datetime.now().isoformat()

    if start_pass == 1:
        # Fresh run — create audit record
        await db.execute(
            """INSERT OR REPLACE INTO audit_runs
               (id, assignment_id, status, started_at)
               VALUES (?, ?, 'running', ?)""",
            (run_id, assignment_id, now),
        )
        await db.commit()
    else:
        # Resume — restore prior pass counts from DB, mark running again
        cursor = await db.execute(
            "SELECT pass1_findings, pass2_findings, pass3_findings, completed_passes FROM audit_runs WHERE id = ?",
            (run_id,),
        )
        row = await cursor.fetchone()
        if row:
            progress.pass1_findings = int(row[0] or 0)
            progress.pass2_findings = int(row[1] or 0)
            progress.pass3_findings = int(row[2] or 0)
            progress.completed_passes = int(row[3] or 0)

    # Fetch rubric text
    rubric_text = await _get_rubric_text(assignment_id)

    # === PASS 1: Standalone Clarity ===
    if start_pass <= 1:
        progress.current_pass = 1
        progress.events.append({"type": "pass_start", "pass": 1, "run_id": run_id})

        pass1_prompt = _build_pass1_prompt(
            node_id=assignment_id,
            title=node.title,
            description=node.description,
            points=node.points_possible,
            submission_types=node.submission_types,
            rubric_text=rubric_text,
            run_id=run_id,
        )

        try:
            pass1_findings = await _execute_pass(run_id, assignment_id, pass1_prompt, 1, progress)
        except RateLimitError as e:
            await _handle_rate_limit(run_id, 1, str(e), progress)
            return progress

        progress.pass1_findings = pass1_findings
        progress.completed_passes = 1
        progress.events.append({"type": "pass_done", "pass": 1, "findings": pass1_findings})
        await db.execute(
            "UPDATE audit_runs SET completed_passes = 1, pass1_findings = ? WHERE id = ?",
            (pass1_findings, run_id),
        )
        await db.commit()

    # === PASS 2: Backward Dependencies ===
    if start_pass <= 2:
        progress.current_pass = 2
        progress.events.append({"type": "pass_start", "pass": 2, "run_id": run_id})

        neighbor_summaries = await _get_neighbor_summaries(assignment_id, "incoming")
        pass2_prompt = _build_pass2_prompt(
            node_id=assignment_id,
            title=node.title,
            week=node.week,
            description=node.description,
            neighbor_summaries=neighbor_summaries,
            run_id=run_id,
        )

        try:
            pass2_findings = await _execute_pass(run_id, assignment_id, pass2_prompt, 2, progress)
        except RateLimitError as e:
            await _handle_rate_limit(run_id, 2, str(e), progress)
            return progress

        progress.pass2_findings = pass2_findings
        progress.completed_passes = 2
        progress.events.append({"type": "pass_done", "pass": 2, "findings": pass2_findings})
        await db.execute(
            "UPDATE audit_runs SET completed_passes = 2, pass2_findings = ? WHERE id = ?",
            (pass2_findings, run_id),
        )
        await db.commit()

    # === PASS 3: Forward Impact ===
    progress.current_pass = 3
    progress.events.append({"type": "pass_start", "pass": 3, "run_id": run_id})

    downstream_summaries = await _get_neighbor_summaries(assignment_id, "outgoing")
    pass3_prompt = _build_pass3_prompt(
        node_id=assignment_id,
        title=node.title,
        week=node.week,
        description=node.description,
        downstream_summaries=downstream_summaries,
        run_id=run_id,
    )

    try:
        pass3_findings = await _execute_pass(run_id, assignment_id, pass3_prompt, 3, progress)
    except RateLimitError as e:
        await _handle_rate_limit(run_id, 3, str(e), progress)
        return progress

    progress.pass3_findings = pass3_findings
    progress.completed_passes = 3
    progress.events.append({"type": "pass_done", "pass": 3, "findings": pass3_findings})

    # === Finalize ===
    total = progress.pass1_findings + progress.pass2_findings + progress.pass3_findings
    finished_at = datetime.now().isoformat()

    await db.execute(
        """UPDATE audit_runs
           SET status = 'done',
               pass1_findings = ?, pass2_findings = ?, pass3_findings = ?,
               total_findings = ?, finished_at = ?, completed_passes = 3
           WHERE id = ?""",
        (progress.pass1_findings, progress.pass2_findings, progress.pass3_findings,
         total, finished_at, run_id),
    )
    await db.commit()

    # If the audit found no active findings, mark the node clean so it no longer shows 'unaudited'
    await db.execute(
        "UPDATE nodes SET status = 'ok' WHERE id = ? AND status = 'unaudited'",
        (assignment_id,),
    )
    await db.commit()

    progress.status = "done"
    progress.events.append(
        {
            "type": "done",
            "run_id": run_id,
            "total_findings": total,
        }
    )

    logger.info(
        "Audit complete: %s — P1=%d, P2=%d, P3=%d findings",
        assignment_id,
        progress.pass1_findings,
        progress.pass2_findings,
        progress.pass3_findings,
    )
    return progress


async def _handle_rate_limit(
    run_id: str,
    failed_pass: int,
    reason: str,
    progress: AuditProgress,
) -> None:
    """Persist a rate-limited run as paused and update in-memory progress."""
    db = await get_db()
    paused_at = datetime.now().isoformat()
    await db.execute(
        """UPDATE audit_runs
           SET status = 'paused', paused_at = ?, resume_reason = ?
           WHERE id = ?""",
        (paused_at, f"Rate limited during pass {failed_pass}: {reason[:500]}", run_id),
    )
    await db.commit()
    progress.status = "paused"
    progress.rate_limited = True
    progress.events.append(
        {
            "type": "error",
            "message": f"Audit rate-limited during pass {failed_pass}. Resume via the Resume button.",
            "paused": True,
            "completed_passes": progress.completed_passes,
            "run_id": run_id,
        }
    )
    logger.warning("Audit %s paused at pass %d due to rate limit: %s", run_id, failed_pass, reason)


async def _watch_pass_exit(
    run_id: str,
    pass_number: int,
    process: asyncio.subprocess.Process,
) -> None:
    """Independent watcher for a Claude subprocess.

    Runs concurrently with tail_run(). Process.wait() is idempotent so calling
    it from both places is safe. If the subprocess exits non-zero this watcher
    marks the parent audit_run as error — a fallback for cases where
    run_single_audit()'s finalize block is never reached.
    """
    return_code = await process.wait()
    if return_code != 0:
        db = await get_db()
        await db.execute(
            "UPDATE audit_runs SET status = 'error', finished_at = datetime('now'), "
            "error_message = ? WHERE id = ? AND status = 'running'",
            (f"Pass {pass_number} subprocess exited with code {return_code}", run_id),
        )
        await db.commit()


async def _execute_pass(
    run_id: str,
    assignment_id: str,
    prompt: str,
    pass_number: int,
    progress: AuditProgress | None = None,
) -> int:
    """Execute a single audit pass via Claude subprocess.

    Returns the number of findings emitted.
    Raises RateLimitError if Claude is rate-limited.
    """
    pass_run_id = f"{run_id}-p{pass_number}"
    findings_count = 0

    try:
        state = await start_audit_run(
            run_id=pass_run_id,
            assignment_id=assignment_id,
            prompt=prompt,
            allowed_tools=AUDIT_ALLOWED_TOOLS,
        )
        # Set pass context so tail_run can tag thinking events
        state.current_pass = pass_number

        if state.status == "error":
            logger.error("Failed to start pass %d for %s", pass_number, assignment_id)
            return 0

        # Launch independent PID watcher — writes status='error' to DB if subprocess
        # exits non-zero, completely independently of the tail_run() path below.
        if state.process is not None:
            asyncio.create_task(_watch_pass_exit(run_id, pass_number, state.process))

        # Tail subprocess output: forward thinking events, detect rate-limits
        async for event in tail_run(pass_run_id):
            event_type = str(event.get("type", ""))

            # Forward thinking events up to AuditProgress for SSE streaming
            if event_type == "thinking" and progress is not None:
                progress.events.append(event)
                continue

            # Detect rate-limit errors from subprocess
            if event_type == "error" and event.get("rate_limited"):
                raise RateLimitError(str(event.get("message", "Rate limited")))

            # Count tool_use events for emit_finding (matches mcp__audit__emit_emit_finding)
            if event_type == "tool_use" and "emit_finding" in str(event.get("tool", "")):
                findings_count += 1

    except RateLimitError:
        raise  # propagate to run_single_audit
    except Exception as e:
        logger.exception("Error in pass %d for %s: %s", pass_number, assignment_id, e)
        db = await get_db()
        # Mark the run as error immediately — don't leave it stuck in 'running'.
        # The WHERE clause is idempotent: only updates if still 'running'.
        await db.execute(
            "UPDATE audit_runs SET status = 'error', finished_at = datetime('now'), "
            "error_message = ? WHERE id = ? AND status = 'running'",
            (f"Pass {pass_number} failed: {str(e)[:500]}", run_id),
        )
        await db.commit()

    # Count actual findings from DB (more reliable than counting events)
    db = await get_db()
    cursor = await db.execute(
        "SELECT COUNT(*) FROM findings WHERE audit_run_id = ? AND pass_number = ?",
        (run_id, pass_number),
    )
    row = await cursor.fetchone()
    return row[0] if row else findings_count


async def run_audit_all(
    batch_size: int = 4,
) -> dict[str, object]:
    """Run audits on all assignment nodes, in parallel batches.

    Sorted by week ascending. Batches of `batch_size` concurrent audits.
    """
    nodes = await list_nodes(node_type="assignment")
    # Sort by week
    nodes.sort(key=lambda n: (n.week or 999, n.title))

    results: list[dict[str, object]] = []
    errors: list[str] = []

    for i in range(0, len(nodes), batch_size):
        batch = nodes[i : i + batch_size]
        tasks = [run_single_audit(node.id) for node in batch]

        batch_results = await asyncio.gather(*tasks, return_exceptions=True)

        for node, result in zip(batch, batch_results):
            if isinstance(result, BaseException):
                errors.append(f"{node.id}: {result}")
                results.append({"node_id": node.id, "status": "error", "error": str(result)})
            else:
                progress: AuditProgress = result
                results.append(
                    {
                        "node_id": node.id,
                        "status": progress.status,
                        "run_id": progress.run_id,
                        "total_findings": progress.pass1_findings
                        + progress.pass2_findings
                        + progress.pass3_findings,
                    }
                )

    return {
        "total_audited": len(nodes),
        "batch_size": batch_size,
        "results": results,
        "errors": errors,
    }


async def summarize_findings() -> dict[str, object]:
    """Generate a course-level summary of all findings."""
    db = await get_db()

    # Severity distribution
    cursor = await db.execute("""
        SELECT severity, COUNT(*) as cnt
        FROM findings WHERE status = 'active'
        GROUP BY severity ORDER BY cnt DESC
    """)
    severity_dist = {row[0]: row[1] for row in await cursor.fetchall()}

    # Type distribution
    cursor = await db.execute("""
        SELECT finding_type, COUNT(*) as cnt
        FROM findings WHERE status = 'active'
        GROUP BY finding_type ORDER BY cnt DESC
    """)
    type_dist = {row[0]: row[1] for row in await cursor.fetchall()}

    # Most problematic nodes
    cursor = await db.execute("""
        SELECT n.id, n.title, n.week, COUNT(f.id) as finding_count,
               SUM(CASE WHEN f.severity = 'gap' THEN 1 ELSE 0 END) as gaps
        FROM nodes n
        JOIN findings f ON f.assignment_id = n.id AND f.status = 'active'
        GROUP BY n.id
        ORDER BY gaps DESC, finding_count DESC
        LIMIT 10
    """)
    problem_nodes = [
        {
            "id": row[0],
            "title": row[1],
            "week": row[2],
            "finding_count": row[3],
            "gap_count": row[4],
        }
        for row in await cursor.fetchall()
    ]

    # Pass distribution
    cursor = await db.execute("""
        SELECT pass_number, COUNT(*) as cnt
        FROM findings WHERE status = 'active'
        GROUP BY pass_number ORDER BY pass_number
    """)
    pass_dist = {f"pass_{row[0]}": row[1] for row in await cursor.fetchall()}

    # Total counts
    cursor = await db.execute("SELECT COUNT(*) FROM findings WHERE status = 'active'")
    total_active = (await cursor.fetchone())[0]

    cursor = await db.execute("SELECT COUNT(*) FROM audit_runs WHERE status = 'done'")
    total_runs = (await cursor.fetchone())[0]

    return {
        "total_active_findings": total_active,
        "total_audit_runs": total_runs,
        "severity_distribution": severity_dist,
        "type_distribution": type_dist,
        "pass_distribution": pass_dist,
        "most_problematic_nodes": problem_nodes,
    }
