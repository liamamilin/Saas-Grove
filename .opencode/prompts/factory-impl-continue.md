Work the `factory-impl` defect queue in `PROGRESS.md`, in priority order (P1 → P2 → P3).

Start by reading `PROGRESS.md` and `docs/INDEPENDENT_REVIEW_2026-10-16.md` — the
independent review confirms three live gate bypasses (R-B, R-R, R-X) and one
failing test. Fix them with real tests, not by weakening anything.

Rules:
- Write only under `factory-impl/**`. Never modify `Source/**` or `factory-v1.2/**`.
- Reproduce each defect with a failing test first; then fix minimally; then add a
  negative test (bypass refused) and a positive test (legit path works).
- After each fix: run `python3 -m pytest -q` from `factory-impl/`, capture the real
  tail and exit code, and update `PROGRESS.md` honestly.
- Do not mark anything DONE without a recorded passing validation.
- Do not stop between defects to ask; work the queue until the stop conditions in
  your instructions are met.

Work through P1 first (FIX-1, R-G, R-B, R-C, R-X, R-R, R-D), then P2 (R-A, R-E,
R-F), then P3 (R-P8, P9 Web UI, P10 docs + dependency lock). At the end, report
the ledger state, the real test output, and every item still open.
