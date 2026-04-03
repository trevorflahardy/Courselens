"""Claude Code subprocess spawner for audit execution.

Manages spawning `claude -p` subprocesses with stream-json output,
tailing their output for SSE forwarding, and tracking run status.

Security note: Uses asyncio.create_subprocess_exec (not shell=True)
to prevent command injection. All arguments are passed as a list.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# Project root — where .mcp.json lives. Claude subprocess must run here so it
# auto-discovers .mcp.json and loads the audit MCP alongside canvas-api.
_PROJECT_ROOT = str(Path(__file__).parent.parent)

logger = logging.getLogger(__name__)


@dataclass
class RunState:
    run_id: str
    assignment_id: str
    process: asyncio.subprocess.Process | None = None
    status: str = "running"
    events: list[dict[str, object]] = field(default_factory=list)
    started_at: str = field(default_factory=lambda: datetime.now().isoformat())
    finished_at: str | None = None


# Active runs keyed by run_id
_active_runs: dict[str, RunState] = {}


async def start_audit_run(
    run_id: str,
    assignment_id: str,
    prompt: str,
    allowed_tools: list[str] | None = None,
) -> RunState:
    """Spawn a Claude subprocess to audit an assignment.

    Args:
        run_id: Unique identifier for this audit run.
        assignment_id: The node ID being audited.
        prompt: The full audit prompt to send to Claude.
        allowed_tools: MCP tool allowlist (e.g. ["mcp__audit__nodes_read"]).

    Returns:
        RunState tracking the subprocess.
    """
    cmd = [
        "claude",
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
    ]

    if allowed_tools:
        for tool in allowed_tools:
            cmd.extend(["--allowedTools", tool])

    state = RunState(run_id=run_id, assignment_id=assignment_id)
    _active_runs[run_id] = state

    try:
        # cwd=_PROJECT_ROOT so Claude auto-discovers .mcp.json and loads both
        # the audit MCP and canvas-api in the subprocess session.
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=_PROJECT_ROOT,
            limit=16 * 1024 * 1024,  # 16 MB — Claude JSON lines can be large
        )
        state.process = process
        logger.info("Started Claude subprocess for run %s (pid=%s)", run_id, process.pid)
    except FileNotFoundError:
        state.status = "error"
        state.events.append({"type": "error", "message": "Claude CLI not found"})
        logger.error("Claude CLI not found — is it installed and on PATH?")

    return state


async def cancel_run(run_id: str) -> bool:
    """Cancel a running Claude subprocess for a specific run ID.

    Returns True when a process was found and a cancel signal was sent.
    """
    state = _active_runs.get(run_id)
    if state is None or state.process is None:
        return False

    process = state.process
    if process.returncode is not None:
        return False

    process.terminate()
    try:
        await asyncio.wait_for(process.wait(), timeout=2)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()

    state.status = "error"
    state.finished_at = datetime.now().isoformat()
    state.events.append({"type": "error", "message": "Run cancelled by user"})
    return True


async def cancel_runs_with_prefix(prefix: str) -> int:
    """Cancel all in-flight subprocess runs whose IDs start with a prefix."""
    run_ids = [rid for rid in _active_runs if rid == prefix or rid.startswith(prefix)]
    cancelled = 0
    for rid in run_ids:
        if await cancel_run(rid):
            cancelled += 1
    return cancelled


async def tail_run(run_id: str) -> AsyncGenerator[dict[str, object], None]:
    """Yield parsed JSON events from a running Claude subprocess."""
    state = _active_runs.get(run_id)
    if state is None:
        yield {"type": "error", "message": f"Run '{run_id}' not found"}
        return

    if state.process is None or state.process.stdout is None:
        # Return buffered events for non-subprocess runs
        for event in state.events:
            yield event
        return

    # Drain stderr in the background so it never blocks stdout and logs in real time
    stderr_lines: list[str] = []

    async def _drain_stderr() -> None:
        if state.process is None or state.process.stderr is None:
            return
        async for raw in state.process.stderr:
            line = raw.decode().rstrip()
            if line:
                stderr_lines.append(line)
                logger.warning("Claude stderr [%s]: %s", run_id, line)

    stderr_task = asyncio.create_task(_drain_stderr())

    async for line in state.process.stdout:
        text = line.decode().strip()
        if not text:
            continue
        try:
            event = json.loads(text)
            state.events.append(event)
            yield event
        except json.JSONDecodeError:
            logger.warning("Claude non-JSON stdout [%s]: %s", run_id, text[:200])

    await stderr_task  # ensure stderr is fully drained before reading exit code

    # Process finished
    return_code = await state.process.wait()
    state.finished_at = datetime.now().isoformat()
    logger.info("Claude process [%s] exited with code %d", run_id, return_code)

    if return_code == 0:
        state.status = "done"
        yield {"type": "done", "run_id": run_id}
    else:
        state.status = "error"
        stderr_summary = " | ".join(stderr_lines[-10:]) if stderr_lines else "(no stderr)"
        yield {
            "type": "error",
            "message": f"Claude exited with code {return_code}: {stderr_summary[:500]}",
        }


def get_run_state(run_id: str) -> RunState | None:
    return _active_runs.get(run_id)


def list_active_runs() -> list[RunState]:
    return [s for s in _active_runs.values() if s.status == "running"]
