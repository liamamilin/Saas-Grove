"""Batch orchestration: budget, retry, leases, and stop conditions (doc 11).

Doc 11's central warnings shape this module:

* "按依赖 DAG 启动" — a batch follows a dependency graph; cycles block.
* "同一 artifact/version 的 Registry promotion 必须唯一" — a job is leased once.
* "每批和每任务设 maxSpend、maxAttempts、maxRuntime" — budgets stop work; they
  do not warn and continue.
* "不要用流水线进度百分比伪装通过度" — progress is reported as per-stage counts,
  never as a completion percentage.

What this module deliberately does NOT do: run untrusted code. It schedules
jobs and enforces budgets. Actually building a candidate is a human-approved
sandbox operation (doc 08), outside a scheduler's remit.

Failure taxonomy from doc 19 is encoded so recovery differs by kind:
``TRANSIENT`` may retry with backoff; ``DETERMINISTIC`` must be fixed first;
``POLICY`` never retries; ``ECONOMIC`` stops on cost grounds.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from ..domain import JobState
from ..store.jsonstore import StoreError, file_lock, read_json_optional, write_json
from ..store.paths import check_id
from .result import Outcome, blocked, ok


class FailureKind(str, Enum):
    TRANSIENT = "TRANSIENT"
    DETERMINISTIC = "DETERMINISTIC"
    POLICY = "POLICY"
    ECONOMIC = "ECONOMIC"


# Only transient failures are retryable. A policy block is a stop, and a
# deterministic failure just fails the same way again.
RETRYABLE = frozenset({FailureKind.TRANSIENT})


class StopReason(str, Enum):
    BUDGET_EXHAUSTED = "BUDGET_EXHAUSTED"
    ATTEMPTS_EXHAUSTED = "ATTEMPTS_EXHAUSTED"
    RUNTIME_EXHAUSTED = "RUNTIME_EXHAUSTED"
    POLICY_BLOCK = "POLICY_BLOCK"
    NON_RETRYABLE_FAILURE = "NON_RETRYABLE_FAILURE"
    UNRESOLVED_DEPENDENCY = "UNRESOLVED_DEPENDENCY"
    MANUAL_STOP = "MANUAL_STOP"


def budget_exhausted(total_usd: float, step_usd: float, ceiling_usd: float) -> bool:
    """Whether spend has used up a ceiling (R-F).

    Over the ceiling is exhausted. Reaching it exactly with a paid step leaves
    nothing for the next step, so that is exhausted too. A zero-cost step under
    a zero ceiling spends nothing and exhausts nothing.
    """
    return total_usd > ceiling_usd or (step_usd > 0 and total_usd >= ceiling_usd)


@dataclass
class Budget:
    """A batch's spend ceilings. Every exhausted ceiling is a hard stop."""

    max_usd: float
    max_attempts_per_job: int
    max_runtime_minutes: int
    max_storage_mb: int = 1024

    def to_dict(self) -> dict[str, Any]:
        return {
            "maxUsd": self.max_usd,
            "maxAttemptsPerJob": self.max_attempts_per_job,
            "maxRuntimeMinutes": self.max_runtime_minutes,
            "maxStorageMb": self.max_storage_mb,
        }


@dataclass
class JobAttempt:
    """One attempt at one job. Cost and outcome accumulate here."""

    job_id: str
    attempt: int = 1
    usd_spent: float = 0.0
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    failure: Optional[FailureKind] = None

    @property
    def elapsed_minutes(self) -> float:
        return (datetime.now(timezone.utc) - self.started_at).total_seconds() / 60.0


@dataclass
class JobLease:
    """An exclusive claim on a job (doc 11: promotion must be unique)."""

    job_id: str
    holder: str
    expires_at: datetime
    recovered_from_crash: bool = False

    def expired(self, now: Optional[datetime] = None) -> bool:
        return (now or datetime.now(timezone.utc)) >= self.expires_at

    def to_dict(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "holder": self.holder,
            "expiresAt": self.expires_at.astimezone(timezone.utc).isoformat(),
            "recoveredFromCrash": self.recovered_from_crash,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "JobLease":
        return cls(
            job_id=data["jobId"],
            holder=data["holder"],
            expires_at=datetime.fromisoformat(data["expiresAt"]),
            recovered_from_crash=bool(data.get("recoveredFromCrash", False)),
        )


class LeaseRegistry:
    """File-based lease bookkeeping with heartbeat and expiry recovery.

    Leases exist so a crashed worker's job can be reclaimed without a second
    worker publishing the same artifact@version. They are written to disk with
    ``O_CREAT | O_EXCL`` — the create is the atomic claim — so two processes on
    the same machine cannot both hold one job, and a crash leaves the lease file
    behind rather than losing it with the process (doc 11: "租约/心跳与超时恢复").

    Recovery is explicit: a job whose lease expired is reported as
    ``recovered_from_crash`` rather than silently reassigned.
    """

    def __init__(
        self,
        directory: Path | str | None = None,
        default_ttl: timedelta = timedelta(minutes=15),
    ):
        if directory is None:
            directory = tempfile.mkdtemp(prefix="factory-leases-")
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self._ttl = default_ttl

    def _path(self, job_id: str) -> Path:
        return self.directory / f"{check_id(job_id, 'jobId')}.json"

    def _read(self, job_id: str) -> Optional[JobLease]:
        try:
            data = read_json_optional(self._path(job_id))
        except StoreError:
            return None
        if data is None:
            return None
        try:
            return JobLease.from_dict(data)
        except (KeyError, ValueError):
            return None

    def _write(self, job_id: str, lease: JobLease) -> None:
        write_json(self._path(job_id), lease.to_dict())

    def _create(self, job_id: str, lease: JobLease) -> bool:
        """Create the lease file with its content in one step, or fail if it exists.

        The record is written to a temp file and hard-linked into place: the link
        is the atomic exclusive claim, and a reader never sees a half-written
        lease (which it might otherwise mistake for an abandoned one).
        """
        fd, tmp = tempfile.mkstemp(dir=self.directory, prefix=".tmp-lease-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(lease.to_dict(), ensure_ascii=False, sort_keys=True) + "\n")
                fh.flush()
                os.fsync(fh.fileno())
            os.link(tmp, self._path(job_id))
            return True
        except FileExistsError:
            return False
        finally:
            Path(tmp).unlink(missing_ok=True)

    def acquire(
        self,
        job_id: str,
        holder: str,
        ttl: Optional[timedelta] = None,
        *,
        now: Optional[datetime] = None,
    ) -> Optional[JobLease]:
        if not isinstance(holder, str) or not holder.strip():
            raise ValueError("a lease needs a named holder")
        now = now or datetime.now(timezone.utc)
        expires = now + (ttl or self._ttl)
        if self._create(job_id, JobLease(job_id, holder, expires)):
            return self._read(job_id)
        # A lease file exists. Reclaim it only if it has expired, under an
        # advisory lock so two reclaimers cannot race.
        with file_lock(self.directory / f".{job_id}.lock"):
            current = self._read(job_id)
            if current is not None and not current.expired(now):
                return None  # held by a live worker
            lease = JobLease(job_id, holder, expires, recovered_from_crash=current is not None)
            self._write(job_id, lease)
            return lease

    def current(self, job_id: str, *, now: Optional[datetime] = None) -> Optional[JobLease]:
        """The live lease on ``job_id``, or ``None`` if unleased or expired."""
        lease = self._read(job_id)
        if lease is None or lease.expired(now):
            return None
        return lease

    def heartbeat(
        self,
        job_id: str,
        holder: str,
        ttl: Optional[timedelta] = None,
        *,
        now: Optional[datetime] = None,
    ) -> Optional[JobLease]:
        """Extend a live lease held by ``holder``. ``None`` if not the holder."""
        now = now or datetime.now(timezone.utc)
        with file_lock(self.directory / f".{job_id}.lock"):
            current = self._read(job_id)
            if current is None or current.holder != holder or current.expired(now):
                return None
            renewed = JobLease(
                job_id=job_id,
                holder=holder,
                expires_at=now + (ttl or self._ttl),
                recovered_from_crash=current.recovered_from_crash,
            )
            self._write(job_id, renewed)
            return renewed

    def release(self, job_id: str, holder: Optional[str], *, force: bool = False) -> bool:
        """Release ``holder``'s lease; returns whether a lease was removed.

        A live lease held by someone else is left alone: one worker cannot free
        another's job (V-5). A missing holder is not a wildcard; only an
        explicit ``force`` (used by the orchestrator after it has checked the
        holder itself) releases unconditionally.
        """
        with file_lock(self.directory / f".{job_id}.lock"):
            current = self._read(job_id)
            if current is None:
                return False
            if not force and current.holder != holder and not current.expired():
                return False
            self._path(job_id).unlink(missing_ok=True)
            return True

    def held_by(self, job_id: str, *, now: Optional[datetime] = None) -> Optional[str]:
        lease = self.current(job_id, now=now)
        return lease.holder if lease else None


def detect_cycle(dependencies: list[dict[str, str]]) -> list[str]:
    """Return a cycle among ``{before, after}`` edges, or []."""
    graph: dict[str, set[str]] = {}
    for edge in dependencies:
        graph.setdefault(edge["before"], set()).add(edge["after"])

    WHITE, GREY, BLACK = 0, 1, 2
    colour: dict[str, int] = {node: WHITE for node in graph}
    stack: list[str] = []

    def visit(node: str) -> Optional[list[str]]:
        colour[node] = GREY
        stack.append(node)
        for nxt in graph.get(node, ()):  # noqa: B007
            colour.setdefault(nxt, WHITE)
            if colour[nxt] == GREY:
                return stack[stack.index(nxt):] + [nxt]
            if colour[nxt] == WHITE:
                found = visit(nxt)
                if found:
                    return found
        stack.pop()
        colour[node] = BLACK
        return None

    for node in list(graph):
        if colour[node] == WHITE:
            found = visit(node)
            if found:
                return found
    return []


def topological_order(target_ids: list[str], dependencies: list[dict[str, str]]) -> list[str]:
    """Order targets by their dependency edges. Assumes no cycle."""
    indegree = {t: 0 for t in target_ids}
    edges: dict[str, list[str]] = {t: [] for t in target_ids}
    for edge in dependencies:
        before, after = edge["before"], edge["after"]
        if before in indegree and after in indegree:
            edges[before].append(after)
            indegree[after] += 1

    ready = [t for t in target_ids if indegree[t] == 0]
    order: list[str] = []
    while ready:
        node = ready.pop(0)
        order.append(node)
        for nxt in edges[node]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                ready.append(nxt)
    return order


@dataclass
class BatchRun:
    """Outcome of planning and stepping a batch. Never a completion percentage."""

    batch_id: str
    order: list[str] = field(default_factory=list)
    completed: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    blocked: list[str] = field(default_factory=list)
    stopped: list[str] = field(default_factory=list)
    attempts: dict[str, int] = field(default_factory=dict)
    usd_spent: float = 0.0
    stop_reason: Optional[StopReason] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "batchId": self.batch_id,
            "order": self.order,
            "completed": self.completed,
            "failed": self.failed,
            "blocked": self.blocked,
            "stopped": self.stopped,
            "attempts": self.attempts,
            "usdSpent": self.usd_spent,
            "stopReason": self.stop_reason.value if self.stop_reason else None,
            "note": (
                "Per-stage counts only. A progress fraction would misrepresent "
                "which gates actually passed."
            ),
        }


class Orchestrator:
    """Schedules jobs within a budget. Does not execute untrusted code."""

    def __init__(
        self,
        budget: Budget,
        *,
        concurrency: int = 1,
        lease_dir: Path | str | None = None,
    ):
        self.budget = budget
        self.concurrency = max(1, concurrency)
        self.leases = LeaseRegistry(lease_dir)

    def plan(self, target_ids: list[str], dependencies: list[dict[str, str]]) -> Outcome:
        """Validate the dependency graph and return an execution order."""
        cycle = detect_cycle(dependencies)
        if cycle:
            return blocked("batch.plan", [f"dependency cycle: {' -> '.join(cycle)}"])
        order = topological_order(target_ids, dependencies)
        if set(order) != set(target_ids):
            return blocked(
                "batch.plan",
                ["dependency graph does not reach every target (unresolved internal dependency)"],
            )
        return ok("batch.plan", order=order, concurrency=self.concurrency)

    def charge(self, run: BatchRun, job_id: str, usd: float, attempt: JobAttempt) -> Optional[StopReason]:
        """Apply cost and check ceilings. Returns a stop reason if exhausted.

        Two boundary rules (R-F), both of which previously over-stopped:

        * ``maxUsd=0`` with a zero-cost step must **not** stop — there is no
          spend to exhaust.
        * the *last allowed* attempt must not be reported exhausted merely
          because it was billed; exhaustion is a fact about the *next* attempt.
        """
        run.usd_spent += usd
        attempt.usd_spent += usd
        if budget_exhausted(run.usd_spent, usd, self.budget.max_usd):
            return StopReason.BUDGET_EXHAUSTED
        if attempt.elapsed_minutes >= self.budget.max_runtime_minutes:
            return StopReason.RUNTIME_EXHAUSTED
        if attempt.attempt > self.budget.max_attempts_per_job:
            run.attempts[job_id] = attempt.attempt
            return StopReason.ATTEMPTS_EXHAUSTED
        return None

    def should_retry(self, attempt: JobAttempt) -> bool:
        """Only transient failures retry, and only within the attempt budget."""
        if attempt.failure not in RETRYABLE:
            return False
        return attempt.attempt < self.budget.max_attempts_per_job

    def classify_failure(self, outcome: Outcome, *, cost_bearing: bool = False) -> FailureKind:
        """Map an outcome onto doc 19's taxonomy."""
        if outcome.ok:
            raise ValueError("cannot classify a successful outcome as a failure")
        text = " | ".join(outcome.reasons).lower()
        policy_markers = ("license", "security", "blocked", "approver", "immutable")
        if any(m in text for m in policy_markers):
            return FailureKind.POLICY
        if cost_bearing and any(m in text for m in ("budget", "cost", "spend", "quota")):
            return FailureKind.ECONOMIC
        if any(m in text for m in ("transient", "timeout", "network", "rate limit")):
            return FailureKind.TRANSIENT
        return FailureKind.DETERMINISTIC
