"""Atomic JSON persistence and an append-only journal.

Two mechanisms, both deliberately boring:

* ``read_json`` / ``write_json`` — file-backed records written atomically
  (temp file + ``os.replace``) so a crash never leaves a half-written record.
  A reader either sees the previous complete record or the new one.
* ``Journal`` — append-only JSONL for transitions and decisions. Doc 07 requires
  every transition to be persisted; append-only means history cannot be edited
  by the tool, only added to.

Nothing here is a database. Doc 11 explicitly stages toward
``catalog.json + CLI + tests + human approval`` before any orchestrator.
"""

from __future__ import annotations

import fcntl
import json
import os
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


class StoreError(RuntimeError):
    """Raised when a persisted record is missing, malformed, or conflicts."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise StoreError(f"record not found: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise StoreError(f"malformed JSON at {path}: {exc}") from exc


def read_json_optional(path: Path) -> dict[str, Any] | None:
    return None if not path.is_file() else read_json(path)


def write_json(path: Path, data: dict[str, Any], *, immutable: bool = False) -> Path:
    """Write ``data`` atomically.

    With ``immutable=True`` an existing file is never overwritten — this is what
    makes a published payload genuinely immutable (doc 17): a second write to
    the same key is a version conflict, and raising is the correct response.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    if immutable and path.exists():
        raise StoreError(
            f"refusing to overwrite immutable record: {path}. "
            "A changed payload must become a new version or a controlled release."
        )

    payload = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        Path(tmp_name).unlink(missing_ok=True)
        raise
    return path


@contextmanager
def file_lock(path: Path) -> Iterator[None]:
    """Hold an exclusive advisory lock on ``path`` for the duration of the block.

    Serialises read-modify-write of one mutable record across processes
    (doc 11: "原子状态提交"). Locks are per file and never nested on the same
    file, so two callers cannot deadlock each other.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+") as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


def list_json(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(p for p in directory.glob("*.json") if not p.name.startswith("."))


@dataclass
class Journal:
    """Append-only JSONL log of transitions and decisions."""

    directory: Path
    name: str = "journal.jsonl"

    @property
    def path(self) -> Path:
        return self.directory / self.name

    def append(self, event: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.directory.mkdir(parents=True, exist_ok=True)
        record = {"at": _now(), "event": event, **payload}
        with file_lock(self.directory / ".journal.lock"), self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        return record

    def entries(self) -> Iterator[dict[str, Any]]:
        if not self.path.is_file():
            return iter(())
        return (
            json.loads(line)
            for line in self.path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )

    def find(self, event: str) -> list[dict[str, Any]]:
        return [e for e in self.entries() if e.get("event") == event]

    def seen_idempotency_key(self, key: str) -> dict[str, Any] | None:
        """Return the prior record for this idempotency key, if any.

        Doc 07: "同一转移重复请求只执行一次". This is the lookup that makes a
        retried transition a no-op that returns the original result.
        """
        for entry in self.entries():
            if entry.get("idempotencyKey") == key:
                return entry
        return None
