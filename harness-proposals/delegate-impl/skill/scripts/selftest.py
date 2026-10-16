#!/usr/bin/env python3
"""Self-test for the delegate-impl hooks and lock script, against a throwaway project.

    python3 selftest.py

Feeds synthetic hook payloads to the scripts exactly as Claude Code would (JSON
on stdin, CLAUDE_PROJECT_DIR in the environment) and checks each decision. It
never touches a real project.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
GUARD = SKILL / "hooks" / "guard_paths.py"
STOP = SKILL / "hooks" / "verify_on_stop.py"
LOCK = SKILL / "scripts" / "contract_lock.py"
# A fresh session id per run, so the stop gate's per-agent counters from an
# earlier run can never leak into this one.
RUN_ID = f"selftest-{uuid.uuid4().hex[:12]}"
COUNTERS = Path(tempfile.gettempdir()) / "delegate-impl-stop"

failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def make_project(test_command: str = "true") -> Path:
    root = Path(tempfile.mkdtemp(prefix="delegate-impl-selftest-"))
    (root / ".claude").mkdir()
    (root / "Source").mkdir()
    (root / "Source" / "spec.md").write_text("frozen\n")
    (root / "app" / "tests" / "contract").mkdir(parents=True)
    (root / "app" / "tests" / "contract" / "test_c.py").write_text("def test_c(): pass\n")
    (root / "app" / "tests" / "PENDING_CONTRACTS").write_text("V-1\nV-2\n")
    (root / "app" / "impl.py").write_text("x = 1\n")
    (root / ".claude" / "delegate-impl.json").write_text(json.dumps({
        "agentType": "impl-haiku",
        "testCommand": test_command,
        "testTimeoutSeconds": 30,
        "maxStopBlocks": 2,
        "protectedGlobs": ["Source/**", ".claude/**"],
        "contractGlobs": ["app/tests/contract/**"],
        "pendingFile": "app/tests/PENDING_CONTRACTS",
    }))
    return root


def run_hook(script: Path, project: Path, payload: dict) -> tuple[int, str, str]:
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(project)}
    payload = {"session_id": RUN_ID, "cwd": str(project), **payload}
    r = subprocess.run([sys.executable, str(script)], input=json.dumps(payload),
                       capture_output=True, text=True, env=env, timeout=60)
    return r.returncode, r.stdout, r.stderr


def denied(stdout: str) -> bool:
    try:
        return json.loads(stdout)["hookSpecificOutput"]["permissionDecision"] == "deny"
    except (ValueError, KeyError, TypeError):
        return False


def guard(project: Path, tool: str, tool_input: dict, agent_type: str | None = "impl-haiku") -> bool:
    payload = {"hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": tool_input}
    if agent_type:
        payload.update({"agent_type": agent_type, "agent_id": "a1"})
    code, out, err = run_hook(GUARD, project, payload)
    assert code == 0, (code, err)
    return denied(out)


def main() -> int:
    p = make_project()

    print("== PreToolUse guard ==")
    check("subagent Edit on Source/** denied", guard(p, "Edit", {"file_path": str(p / "Source/spec.md")}))
    check("subagent Write on contract test denied",
          guard(p, "Write", {"file_path": "app/tests/contract/test_c.py"}))
    check("subagent Write via ../ traversal denied",
          guard(p, "Write", {"file_path": str(p / "app" / ".." / "Source" / "x.md")}))
    check("subagent Edit on .claude config denied",
          guard(p, "Edit", {"file_path": str(p / ".claude/delegate-impl.json")}))
    check("subagent NotebookEdit on protected path denied",
          guard(p, "NotebookEdit", {"notebook_path": str(p / "Source/n.ipynb")}))
    check("subagent Edit on implementation allowed",
          not guard(p, "Edit", {"file_path": str(p / "app/impl.py")}))
    check("subagent edit of the pending list allowed",
          not guard(p, "Edit", {"file_path": str(p / "app/tests/PENDING_CONTRACTS")}))
    check("main session Edit on contract test allowed (no agent_type)",
          not guard(p, "Edit", {"file_path": str(p / "app/tests/contract/test_c.py")}, agent_type=None))
    check("other subagent types guarded too (default '*')",
          guard(p, "Edit", {"file_path": str(p / "Source/spec.md")}, agent_type="general-purpose"))
    check("path outside the project ignored",
          not guard(p, "Write", {"file_path": "/tmp/elsewhere.txt"}))

    print("== Bash heuristic ==")
    check("sed -i on Source denied", guard(p, "Bash", {"command": "sed -i '' 's/a/b/' Source/spec.md"}))
    check("redirect into contract dir denied",
          guard(p, "Bash", {"command": "echo x > app/tests/contract/test_c.py"}))
    check("rm under .claude denied", guard(p, "Bash", {"command": "rm -rf .claude/"}))
    check("reading Source allowed", not guard(p, "Bash", {"command": "cat Source/spec.md"}))
    check("grep with 2>&1 allowed",
          not guard(p, "Bash", {"command": "grep -rn foo app/tests/contract 2>&1 | head"}))
    check("running tests allowed", not guard(p, "Bash", {"command": "cd app && python -m pytest -q 2>&1 | tail -3"}))
    check("editing pending list via sed allowed",
          not guard(p, "Bash", {"command": "sed -i '' '/V-1/d' app/tests/PENDING_CONTRACTS"}))
    check("writing implementation via redirect allowed",
          not guard(p, "Bash", {"command": "printf 'x=2\\n' > app/impl.py"}))

    print("== SubagentStop gate ==")
    red = make_project("exit 1")
    stop = {"hook_event_name": "SubagentStop", "agent_type": "impl-haiku", "agent_id": "a-red"}
    blocks = []
    for _ in range(3):
        code, out, err = run_hook(STOP, red, stop)
        blocks.append(bool(out.strip()) and json.loads(out).get("decision") == "block")
    check("red suite blocks stop, capped at maxStopBlocks=2", blocks == [True, True, False], str(blocks))
    green = make_project("true")
    code, out, _ = run_hook(STOP, green, {**stop, "agent_id": "a-green"})
    check("green suite lets the subagent stop", code == 0 and not out.strip())
    code, out, _ = run_hook(STOP, red, {**stop, "agent_type": "Explore", "agent_id": "a-explore"})
    check("non-implementer subagents are not gated", code == 0 and not out.strip())

    print("== contract_lock ==")
    lock = Path(tempfile.mkdtemp()) / "lock.json"
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(p)}
    r = subprocess.run([sys.executable, str(LOCK), "lock", "--out", str(lock)], env=env, capture_output=True, text=True)
    check("lock succeeds", r.returncode == 0, r.stderr)
    (p / "app/tests/PENDING_CONTRACTS").write_text("V-2\n")
    r = subprocess.run([sys.executable, str(LOCK), "verify", "--lock", str(lock), "--expect-removed", "V-1"],
                       env=env, capture_output=True, text=True)
    check("verify ok when only the expected ID left the pending list", r.returncode == 0, r.stdout)
    (p / "app/tests/contract/test_c.py").write_text("def test_c(): assert True\n")
    r = subprocess.run([sys.executable, str(LOCK), "verify", "--lock", str(lock), "--expect-removed", "V-1"],
                       env=env, capture_output=True, text=True)
    check("verify fails when a contract test changed",
          r.returncode == 1 and "app/tests/contract/test_c.py" in r.stdout, r.stdout)

    print("== stale counter ==")
    stale_project = make_project("exit 1")
    stale = COUNTERS / f"{RUN_ID}-a-stale"
    stale.write_text("2")
    old = stale.stat().st_mtime - 2 * 3600
    os.utime(stale, (old, old))
    code, out, _ = run_hook(STOP, stale_project, {**stop, "agent_id": "a-stale"})
    check("a counter older than its TTL is ignored (red suite blocks again)",
          bool(out.strip()) and json.loads(out).get("decision") == "block", out)

    for d in (p, red, green, stale_project, lock.parent):
        shutil.rmtree(d, ignore_errors=True)
    for f in COUNTERS.glob(f"{RUN_ID}-*"):
        f.unlink(missing_ok=True)
    print(f"\n{'ALL PASSED' if not failures else f'{len(failures)} FAILED: {failures}'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
