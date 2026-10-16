"""The three warehouses as an addressable store.

Each domain exposes typed read/write helpers. The registry is the only domain
with immutable writes, because doc 17 makes published payloads immutable and
makes a changed payload a version conflict rather than an overwrite.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .jsonstore import (
    Journal,
    StoreError,
    file_lock,
    list_json,
    read_json,
    read_json_optional,
    write_json,
)
from .paths import WarehouseLayout, check_id, resource_key, split_key


@dataclass
class CandidateRepository:
    """Read-only upstream index and candidate metadata. Never installable."""

    root: Path

    def put(self, candidate_id: str, record: dict[str, Any]) -> Path:
        return write_json(self.root / f"{check_id(candidate_id, 'candidateId')}.json", record)

    def get(self, candidate_id: str) -> dict[str, Any] | None:
        return read_json_optional(self.root / f"{check_id(candidate_id, 'candidateId')}.json")

    def all(self) -> list[dict[str, Any]]:
        return [read_json(p) for p in list_json(self.root)]


@dataclass
class ProductionWorkspace:
    """Per-job isolated build/test area. Cannot overwrite published content."""

    root: Path

    def job_dir(self, job_id: str) -> Path:
        d = self.root / check_id(job_id, "jobId")
        d.mkdir(parents=True, exist_ok=True)
        return d

    def put_job(self, job_id: str, record: dict[str, Any]) -> Path:
        return write_json(self.job_dir(job_id) / "job.json", record)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        return read_json_optional(self.root / check_id(job_id, "jobId") / "job.json")

    def lock(self, job_id: str):
        """Exclusive lock over one job's read-modify-write (doc 11: 原子状态提交)."""
        return file_lock(self.job_dir(job_id) / ".lock")

    def put_artifact(
        self, job_id: str, name: str, record: dict[str, Any], *, immutable: bool = False
    ) -> Path:
        return write_json(
            self.job_dir(job_id) / "artifacts" / f"{name}.json", record, immutable=immutable
        )

    def list_jobs(self) -> list[str]:
        if not self.root.is_dir():
            return []
        return sorted(p.name for p in self.root.iterdir() if p.is_dir())


@dataclass
class CertifiedRegistry:
    """Released packages.

    Not everything here is immutable, and the distinction is load-bearing:

    * **`artifact-freeze`** — immutable. It is the payload's identity; a
      different digest for the same id@version is a version conflict.
    * **`deployment-eligibility-decision`** — append-only, keyed by
      ``decisionId``. A new decision is a new record; an old one is never
      rewritten (doc 19: history is not erased).
    * **`resource-state`** — **mutable**. It is the post-freeze projection /
      registry index (ADR D1), and it must change as a resource moves through
      LISTED -> DEPRECATED -> QUARANTINED -> WITHDRAWN (doc 10). Immutability
      here would make retirement impossible.

    So the registry refuses overwrites of *identity* records while allowing the
    *projection* to advance.
    """

    root: Path

    # Records that may never be rewritten once written.
    IMMUTABLE = ("artifact-freeze",)

    def _dir(self, resource_id: str, resource_version: str) -> Path:
        return self.root / resource_key(resource_id, resource_version)

    def put_immutable(
        self,
        resource_id: str,
        resource_version: str,
        name: str,
        record: dict[str, Any],
    ) -> Path:
        return write_json(
            self._dir(resource_id, resource_version) / f"{name}.json",
            record,
            immutable=True,
        )

    def put_state(self, state: dict[str, Any]) -> Path:
        """Write the resource-state projection. Overwrites by design."""
        return write_json(
            self._dir(state["resourceId"], state["resourceVersion"]) / "resource-state.json",
            state,
        )

    def put_decision(self, decision: dict[str, Any]) -> Path:
        """Append a decision, keyed by decisionId. Never rewritten."""
        return write_json(
            self._dir(decision["resourceId"], decision["resourceVersion"])
            / "decisions"
            / f"{decision['decisionId']}.json",
            decision,
            immutable=True,
        )

    def get(
        self, resource_id: str, resource_version: str, name: str
    ) -> dict[str, Any] | None:
        return read_json_optional(self._dir(resource_id, resource_version) / f"{name}.json")

    def get_decision(
        self, resource_id: str, resource_version: str, decision_id: str
    ) -> dict[str, Any] | None:
        return read_json_optional(
            self._dir(resource_id, resource_version) / "decisions" / f"{decision_id}.json"
        )

    def decisions(self, resource_id: str, resource_version: str) -> list[dict[str, Any]]:
        d = self._dir(resource_id, resource_version) / "decisions"
        return [read_json(p) for p in list_json(d)]

    def latest_decision(
        self, resource_id: str, resource_version: str
    ) -> dict[str, Any] | None:
        """Most recent decision by ``decidedAt``, or None."""
        ds = self.decisions(resource_id, resource_version)
        if not ds:
            return None
        return max(ds, key=lambda d: d.get("decidedAt", ""))

    def exists(self, resource_id: str, resource_version: str) -> bool:
        return self._dir(resource_id, resource_version).is_dir()

    def digest_recorded(self, resource_id: str, resource_version: str) -> str | None:
        freeze = self.get(resource_id, resource_version, "artifact-freeze")
        return None if freeze is None else freeze.get("artifactSha256")

    def versions(self, resource_id: str) -> list[str]:
        out = []
        for d in sorted(self.root.glob(f"{resource_id}@*")):
            if d.is_dir():
                _, version = split_key(d.name)
                out.append(version)
        return out


@dataclass
class Warehouse:
    """The three domains plus the audit journal."""

    layout: WarehouseLayout
    candidate: CandidateRepository
    workspace: ProductionWorkspace
    registry: CertifiedRegistry
    journal: Journal

    @classmethod
    def open(cls, root: Path | str, *, create: bool = True) -> "Warehouse":
        layout = WarehouseLayout(Path(root))
        if create:
            layout.ensure()
        return cls(
            layout=layout,
            candidate=CandidateRepository(layout.candidate),
            workspace=ProductionWorkspace(layout.jobs),
            registry=CertifiedRegistry(layout.registry),
            journal=Journal(layout.journal),
        )

    def record_transition(self, transition: dict[str, Any]) -> dict[str, Any]:
        """Persist a transition, honouring idempotency.

        A repeated idempotency key returns the original record untouched — the
        transition is applied once (doc 07).
        """
        key = transition.get("idempotencyKey")
        if key:
            prior = self.journal.seen_idempotency_key(key)
            if prior is not None:
                return prior
        return self.journal.append("transition", transition)


__all__ = [
    "CandidateRepository",
    "CertifiedRegistry",
    "ProductionWorkspace",
    "StoreError",
    "Warehouse",
]
