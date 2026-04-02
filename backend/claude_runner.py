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
        "-p", prompt,
        "--output-format", "stream-json",
    ]

    if allowed_tools:
        for tool in allowed_tools:
            cmd.extend(["--allowedTools", tool])

    state = RunState(run_id=run_id, assignment_id=assignment_id)
    _active_runs[run_id] = state

    try:
        # create_subprocess_exec passes args as a list — no shell injection risk
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        state.process = process
        logger.info("Started Claude subprocess for run %s (pid=%s)", run_id, process.pid)
    except FileNotFoundError:
        state.status = "error"
        state.events.append({"type": "error", "message": "Claude CLI not found"})
        logger.error("Claude CLI not found — is it installed and on PATH?")

    return state


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

    async for line in state.process.stdout:
        text = line.decode().strip()
        if not text:
            continue
        try:
            event = json.loads(text)
            state.events.append(event)
            yield event
        except json.JSONDecodeError:
            logger.warning("Non-JSON line from Claude: %s", text[:100])

    # Process finished
    return_code = await state.process.wait()
    state.finished_at = datetime.now().isoformat()

    if return_code == 0:
        state.status = "done"
        yield {"type": "done", "run_id": run_id}
    else:
        state.status = "error"
        stderr = ""
        if state.process.stderr:
            stderr = (await state.process.stderr.read()).decode()
        yield {"type": "error", "message": f"Claude exited with code {return_code}: {stderr[:500]}"}


def get_run_state(run_id: str) -> RunState | None:
    return _active_runs.get(run_id)


def list_active_runs() -> list[RunState]:
    return [s for s in _active_runs.values() if s.status == "running"]
