#!/usr/bin/env python3
"""SubagentStop gate: an implementer may not stop while the test suite is red.

Only acts on subagents whose ``agent_type`` is in ``verifyAgentTypes``
(default: the config's ``agentType``, i.e. ``impl-haiku``). Runs the project's
``testCommand``; if it fails, blocks the stop with the tail of the output so the
subagent keeps working. Blocks at most ``maxStopBlocks`` times per subagent —
after that it lets the subagent stop, and the main session's review decides.

A green suite here is a precondition, not a verdict: the main session still
runs ``contract_lock.py verify``, reads the diff and probes the gates.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def main() -> None:
    payload = json.load(sys.stdin)
    agent_type = payload.get("agent_type")
    if not agent_type:
        return

    project = Path(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or ".")
    try:
        cfg = json.loads((project / ".claude" / "delegate-impl.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return
    if agent_type not in cfg.get("verifyAgentTypes", [cfg.get("agentType", "impl-haiku")]):
        return
    command = cfg.get("testCommand")
    if not command:
        return

    counter_dir = Path(tempfile.gettempdir()) / "delegate-impl-stop"
    counter_dir.mkdir(parents=True, exist_ok=True)
    counter = counter_dir / f"{payload.get('session_id', 'session')}-{payload.get('agent_id', agent_type)}"
    blocks = int(counter.read_text()) if counter.is_file() else 0
    # Counters left behind by an earlier run (or a long-finished round) must not
    # pre-spend this round's blocks.
    ttl = 60 * int(cfg.get("counterTtlMinutes", 60))
    if blocks and time.time() - counter.stat().st_mtime > ttl:
        blocks = 0
    if blocks >= int(cfg.get("maxStopBlocks", 2)):
        print(f"delegate-impl: stop allowed after {blocks} blocks; main session will review",
              file=sys.stderr)
        return

    try:
        result = subprocess.run(
            command, shell=True, cwd=project, capture_output=True, text=True,
            timeout=int(cfg.get("testTimeoutSeconds", 240)),
        )
        code, output = result.returncode, (result.stdout + result.stderr)
    except subprocess.TimeoutExpired:
        code, output = -1, f"test command timed out after {cfg.get('testTimeoutSeconds', 240)}s"

    if code == 0:
        counter.unlink(missing_ok=True)
        return

    counter.write_text(str(blocks + 1))
    tail = "\n".join(output.strip().splitlines()[-40:])
    print(json.dumps({
        "decision": "block",
        "reason": (
            f"The test suite is red (exit {code}); you may not stop yet "
            f"(block {blocks + 1}/{cfg.get('maxStopBlocks', 2)}).\n"
            f"Command: {command}\n--- last lines ---\n{tail}\n---\n"
            "Fix the implementation. Do not edit contract tests or weaken assertions. "
            "If the failure is outside your work item or you believe a contract test is wrong, "
            "stop and say so explicitly in your report."
        ),
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # never wedge the session
        print(f"delegate-impl stop-gate error (allowing stop): {exc!r}", file=sys.stderr)
        sys.exit(0)
