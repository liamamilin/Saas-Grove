"""Engine layer: factory operations, digests, and uniform outcomes."""

from . import digest
from .digest import (
    CANONICALISATION,
    PLACEHOLDERS,
    UnhashableContent,
    artifact_digest_from_files,
    assert_real_content,
    build_file_list,
    hash_file,
    hash_object,
    payload_manifest_digest,
    sha256_hex,
)
from .batch import BatchRunner
from .factory import Factory
from .orchestrator import (
    RETRYABLE,
    BatchRun,
    Budget,
    FailureKind,
    JobAttempt,
    JobLease,
    LeaseRegistry,
    Orchestrator,
    StopReason,
    budget_exhausted,
    detect_cycle,
    topological_order,
)
from .result import HONESTY_NOTE, Outcome, Status, blocked, ok

__all__ = [
    "CANONICALISATION",
    "HONESTY_NOTE",
    "PLACEHOLDERS",
    "RETRYABLE",
    "BatchRun",
    "BatchRunner",
    "Budget",
    "Factory",
    "FailureKind",
    "JobAttempt",
    "JobLease",
    "LeaseRegistry",
    "Orchestrator",
    "Outcome",
    "Status",
    "StopReason",
    "UnhashableContent",
    "artifact_digest_from_files",
    "assert_real_content",
    "blocked",
    "budget_exhausted",
    "build_file_list",
    "detect_cycle",
    "digest",
    "hash_file",
    "hash_object",
    "ok",
    "payload_manifest_digest",
    "sha256_hex",
    "topological_order",
]
