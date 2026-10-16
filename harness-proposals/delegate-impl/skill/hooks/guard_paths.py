#!/usr/bin/env python3
"""PreToolUse guard: subagents may not write protected or contract paths.

Reads the hook payload on stdin and the project's ``.claude/delegate-impl.json``.
Only acts on calls made *inside a subagent* (the payload carries ``agent_type``)
whose type is listed in ``guardAgentTypes`` (default ``["*"]`` = every
subagent). Main-session calls pass through untouched: the main session is the
one that writes contracts.

Edit / Write / MultiEdit / NotebookEdit are checked by path. Bash is checked by
a heuristic (a protected path mentioned together with a write-like operation).
The heuristic can be fooled; ``contract_lock.py verify`` is the backstop.

Denies with the documented JSON form (``hookSpecificOutput.permissionDecision``)
and exit 0. Any internal error allows the call and logs to stderr, so a broken
guard never wedges a session — the lock check still catches the damage.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
import sys
from pathlib import Path

PATH_KEYS = ("file_path", "notebook_path", "path")
WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
# Redirections that never write a project file.
HARMLESS_REDIRECTS = re.compile(r"(\d?>&\d|&?>\s*/dev/null|\d?>>?\s*/dev/null)")
WRITE_LIKE = re.compile(
    r"(>|\btee\b|\bsed\s+(-[a-zA-Z]*\s+)*-i|\bperl\s+-[a-zA-Z]*i|\brm\b|\bmv\b|\bcp\b|"
    r"\btruncate\b|\bchmod\b|\bchown\b|\btouch\b|\bln\b|\brsync\b|\bdd\b|\bpatch\b|\bunlink\b|"
    r"\bgit\s+(checkout|restore|reset|apply|stash|clean)\b|open\(|\.write|shutil|os\.remove|os\.replace)"
)


def load_config(project: Path) -> dict | None:
    path = project / ".claude" / "delegate-impl.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def rel_to_project(raw: str, cwd: Path, project: Path) -> str | None:
    """Project-relative POSIX path, or None if the path is outside the project."""
    p = Path(raw)
    if not p.is_absolute():
        p = cwd / p
    # realpath on both sides: resolves ``..``, symlinks and macOS /tmp -> /private/tmp.
    real, root = Path(os.path.realpath(p)), Path(os.path.realpath(project))
    try:
        return real.relative_to(root).as_posix()
    except ValueError:
        return None


def matches(rel: str, pattern: str) -> bool:
    if pattern.endswith("/**"):
        return rel == pattern[:-3] or rel.startswith(pattern[:-3] + "/")
    if any(ch in pattern for ch in "*?["):
        return fnmatch.fnmatch(rel, pattern)
    return rel == pattern


def literal_prefix(pattern: str) -> str:
    """The fixed leading part of a glob, used to spot it inside a shell command."""
    if pattern.endswith("/**"):
        return pattern[:-3] + "/"
    cut = min((pattern.index(ch) for ch in "*?[" if ch in pattern), default=len(pattern))
    return pattern[:cut]


def deny(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }, ensure_ascii=False))
    sys.exit(0)


def main() -> None:
    payload = json.load(sys.stdin)
    agent_type = payload.get("agent_type")
    if not agent_type:
        return  # main session: never guarded here

    project = Path(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or ".")
    cfg = load_config(project)
    if cfg is None:
        return
    guarded = cfg.get("guardAgentTypes", ["*"])
    if "*" not in guarded and agent_type not in guarded:
        return

    protected = cfg.get("protectedGlobs", []) + cfg.get("contractGlobs", [])
    allowed = {cfg["pendingFile"]} if cfg.get("pendingFile") else set()
    cwd = Path(payload.get("cwd") or project)
    tool = payload.get("tool_name", "")
    tool_input = payload.get("tool_input") or {}

    if tool in WRITE_TOOLS:
        for key in PATH_KEYS:
            raw = tool_input.get(key)
            if not isinstance(raw, str):
                continue
            rel = rel_to_project(raw, cwd, project)
            if rel is None or rel in allowed:
                continue
            hit = next((g for g in protected if matches(rel, g)), None)
            if hit:
                deny(
                    f"delegate-impl guard: subagent '{agent_type}' may not write {rel} "
                    f"(protected by '{hit}'). Contracts and frozen baselines are owned by the "
                    "main session. If this file really must change, stop and report why."
                )
        return

    if tool == "Bash":
        command = str(tool_input.get("command", ""))
        scrubbed = HARMLESS_REDIRECTS.sub(" ", command)
        if not WRITE_LIKE.search(scrubbed):
            return
        for allow in allowed:
            scrubbed = scrubbed.replace(allow, " ")
        for pattern in protected:
            prefix = literal_prefix(pattern)
            if not prefix:
                continue
            if re.search(r"(^|[\s'\"=/(])" + re.escape(prefix), scrubbed):
                deny(
                    f"delegate-impl guard: this shell command mentions a protected path "
                    f"('{pattern}') together with a write-like operation. Subagents may only "
                    "read protected files. If you were only reading, split the read into a "
                    "command without redirection or file-modifying tools."
                )


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # never wedge the session; the lock check is the backstop
        print(f"delegate-impl guard error (allowing call): {exc!r}", file=sys.stderr)
        sys.exit(0)
