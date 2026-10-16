"""The uniform outcome type every engine operation returns.

Design rule: an operation never raises to signal a *policy* refusal. Refusals
are data, because the factory must be able to record *why* it refused a job and
keep going. Exceptions are reserved for genuine programming errors.

Two statuses, and the distinction matters:

* ``BLOCKED`` — the request is non-conformant. Reasons are listed. The caller
  must not proceed as if it succeeded.
* ``OK`` — no violation detected in the supplied metadata.

``OK`` never means "certified", "approved", or "safe to release". The factory
has no operation that returns a commercial certification, by construction.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Status(str, Enum):
    OK = "OK"
    BLOCKED = "BLOCKED"


@dataclass
class Outcome:
    """Result of an engine operation."""

    status: Status
    operation: str
    reasons: list[str] = field(default_factory=list)
    data: dict[str, Any] = field(default_factory=dict)
    # Human-facing caveat. Always populated; the factory never returns a bare
    # "OK" that could be misread as an authorization.
    note: str = ""

    @property
    def ok(self) -> bool:
        return self.status is Status.OK

    @property
    def blocked(self) -> bool:
        return self.status is Status.BLOCKED

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "operation": self.operation,
            "reasons": self.reasons,
            "data": self.data,
            "note": self.note or HONESTY_NOTE,
        }


# The standing caveat. Every externally-visible result carries it, so no caller
# can consume a factory result without also receiving the boundary of what it
# proves. This is doc 18's "no JSON ALLOW is a commercial release" made literal.
HONESTY_NOTE = (
    "Metadata consistency only. This is not a build, security, license or "
    "signature verification, and not a commercial certification."
)


def ok(operation: str, **data: Any) -> Outcome:
    return Outcome(Status.OK, operation, data=data, note=HONESTY_NOTE)


def blocked(operation: str, reasons: list[str], **data: Any) -> Outcome:
    return Outcome(Status.BLOCKED, operation, reasons=list(reasons), data=data,
                   note=HONESTY_NOTE)
