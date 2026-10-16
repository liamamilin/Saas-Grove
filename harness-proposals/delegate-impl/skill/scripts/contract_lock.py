#!/usr/bin/env python3
"""Snapshot and verify the files a delegated implementer must not touch.

    contract_lock.py lock   --out LOCK.json            [--project DIR] [--config CFG]
    contract_lock.py verify --lock LOCK.json [--expect-removed ID] [--project DIR] [--config CFG]

`lock` hashes every file under the config's ``protectedGlobs`` and
``contractGlobs`` and records the pending-contract list. `verify` recomputes and
reports any change. It is the backstop for the PreToolUse guard: the guard
only sees tool calls it can parse, this sees the files themselves.

Exit codes: 0 = untouched (and, with --expect-removed, exactly that ID left the
pending list); 1 = something changed; 2 = usage/config error.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import sys
from pathlib import Path

SKIP_DIRS = {".git", "node_modules", "__pycache__", ".pytest_cache"}
SKIP_FILES = {".DS_Store"}


def load_config(project: Path, config: Path | None) -> dict:
    path = config or project / ".claude" / "delegate-impl.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        sys.exit(f"config not found: {path}")
    except json.JSONDecodeError as exc:
        sys.exit(f"config is not valid JSON: {path}: {exc}")


def walk(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name not in SKIP_FILES:
                yield Path(dirpath) / name


def expand(project: Path, pattern: str) -> set[Path]:
    """Files matched by one glob. ``dir/**`` means everything under ``dir``."""
    if pattern.endswith("/**"):
        base = project / pattern[:-3]
        return set(walk(base)) if base.is_dir() else set()
    if any(ch in pattern for ch in "*?["):
        return {p for p in walk(project) if fnmatch.fnmatch(p.relative_to(project).as_posix(), pattern)}
    path = project / pattern
    return {path} if path.is_file() else set()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def read_pending(project: Path, cfg: dict) -> list[str]:
    rel = cfg.get("pendingFile")
    if not rel or not (project / rel).is_file():
        return []
    lines = (project / rel).read_text(encoding="utf-8").splitlines()
    return sorted({l.strip() for l in lines if l.strip() and not l.strip().startswith("#")})


def snapshot(project: Path, cfg: dict) -> dict:
    files: set[Path] = set()
    for pattern in cfg.get("protectedGlobs", []) + cfg.get("contractGlobs", []):
        files |= expand(project, pattern)
    pending = cfg.get("pendingFile")
    if pending:
        files.discard(project / pending)  # the implementer is allowed to edit this one
    return {
        "files": {p.relative_to(project).as_posix(): sha256(p) for p in sorted(files)},
        "pending": read_pending(project, cfg),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["lock", "verify"])
    ap.add_argument("--project", type=Path, default=Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")))
    ap.add_argument("--config", type=Path)
    ap.add_argument("--out", type=Path, help="lock: where to write the lock file")
    ap.add_argument("--lock", type=Path, help="verify: lock file written by `lock`")
    ap.add_argument("--expect-removed", action="append", default=[],
                    help="verify: pending IDs the implementer was allowed to remove")
    args = ap.parse_args()

    project = args.project.resolve()
    cfg = load_config(project, args.config)
    current = snapshot(project, cfg)

    if args.command == "lock":
        if not args.out:
            ap.error("lock needs --out")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(json.dumps({"locked": len(current["files"]), "pending": current["pending"], "out": str(args.out)},
                         ensure_ascii=False))
        return 0

    if not args.lock:
        ap.error("verify needs --lock")
    before = json.loads(args.lock.read_text(encoding="utf-8"))
    old, new = before["files"], current["files"]
    report = {
        "changed": sorted(p for p in old.keys() & new.keys() if old[p] != new[p]),
        "added": sorted(new.keys() - old.keys()),
        "removed": sorted(old.keys() - new.keys()),
        "pendingRemoved": sorted(set(before["pending"]) - set(current["pending"])),
        "pendingAdded": sorted(set(current["pending"]) - set(before["pending"])),
    }
    unexpected_pending = set(report["pendingRemoved"]) - set(args.expect_removed)
    missing_pending = set(args.expect_removed) - set(report["pendingRemoved"])
    report["ok"] = not (report["changed"] or report["added"] or report["removed"]
                        or report["pendingAdded"] or unexpected_pending or missing_pending)
    if unexpected_pending:
        report["unexpectedPendingRemoved"] = sorted(unexpected_pending)
    if missing_pending:
        report["expectedButStillPending"] = sorted(missing_pending)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
