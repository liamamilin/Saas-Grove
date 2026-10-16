"""Template Factory — runnable implementation of the v1.2 specification.

This package implements the *process* mechanics described by ADR-Factory-001
(D1–D9). It deliberately does not, and cannot, certify anything: every
acceptance decision it produces is metadata consistency plus recorded human
review, never a real security, license or build result.

Three honesty rules are structural, not advisory:

1. ``UNKNOWN`` never becomes ``PASS``.
2. A schema-valid object is never a commercial certification.
3. A frozen payload is never written back to; certification data travels in a
   detached envelope.
"""

__version__ = "1.2.0"
