"""Three-warehouse layout.

Doc 10 defines three *trust domains*, not necessarily three databases:

1. **Candidate Repository** — read-only upstream index, candidate metadata,
   risk/license reports, SHAs. May hold L0/UNKNOWN. Never installable.
2. **Production Workspace** — isolated per-job build/test area with its own
   branch, checkpoint, logs and draft artifacts. Cannot overwrite anything
   already published.
3. **Certified Registry** — immutable released packages, signatures/hashes,
   SBOM, notices, acceptance evidence. Downloadability depends on
   ``publicationStatus`` + ``usePolicy`` + distribution license.

The layout is expressed as directories so the trust boundary is visible in the
filesystem itself. A later backend (object store + index DB) must preserve the
same three boundaries.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .jsonstore import StoreError

# An identifier that becomes a path segment. No separators, no leading dot, so
# no id can climb out of its warehouse (``../registry/x`` written from the
# workspace would cross the trust boundary the layout exists to show).
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$")


class UnsafeIdentifier(StoreError, ValueError):
    """Raised when an id cannot be used as a single path segment."""


def check_id(value: str, what: str = "identifier") -> str:
    """Return ``value`` if it is a safe single path segment, else raise."""
    if not isinstance(value, str) or not _SAFE_ID.match(value) or ".." in value:
        raise UnsafeIdentifier(
            f"unsafe {what} {value!r}: use letters, digits, '.', '_', '+', '-' "
            "(no path separators, no leading dot, no '..')"
        )
    return value


@dataclass(frozen=True)
class WarehouseLayout:
    """Resolved paths for one factory root."""

    root: Path

    @property
    def candidate(self) -> Path:
        return self.root / "candidate"

    @property
    def workspace(self) -> Path:
        return self.root / "workspace"

    @property
    def registry(self) -> Path:
        return self.root / "registry"

    @property
    def jobs(self) -> Path:
        return self.workspace / "jobs"

    @property
    def batches(self) -> Path:
        """Batch runs: the orchestrator's persisted plan and per-job status."""
        return self.workspace / "batches"

    @property
    def leases(self) -> Path:
        """One file per leased job. A file, not memory, so a crash leaves it."""
        return self.workspace / "leases"

    @property
    def journal(self) -> Path:
        """Append-only audit journal for transitions and decisions."""
        return self.root / "journal"

    def all(self) -> tuple[Path, ...]:
        return (
            self.candidate,
            self.workspace,
            self.registry,
            self.jobs,
            self.batches,
            self.leases,
            self.journal,
        )

    def ensure(self) -> "WarehouseLayout":
        for path in self.all():
            path.mkdir(parents=True, exist_ok=True)
        return self


def resource_key(resource_id: str, resource_version: str) -> str:
    """Registry key. Doc 17: ``resourceId@resourceVersion``.

    Digest is deliberately *not* part of the directory key: the same
    id@version with a different digest is a version *conflict* to be blocked,
    not a separate slot to be silently filled.
    """
    return f"{check_id(resource_id, 'resourceId')}@{check_id(resource_version, 'resourceVersion')}"


def split_key(key: str) -> tuple[str, str]:
    resource_id, _, version = key.partition("@")
    if not version:
        raise ValueError(f"malformed resource key {key!r}; expected 'id@version'")
    return resource_id, version
