# Held-out suite notes (s4)

This directory contains the held-out acceptance suite for stage S4. It is black-box: it talks
to the product over HTTP (plus the start script and the runner control API) and, for the
secrets-at-rest checks, reads the injected `DATABASE_URL` read-only through `psql`.

## Files and topics

| File | Tests | Topic |
|---|---|---|
| `holdout-tenant-isolation.test.ts` | 4 | Cross-workspace 404s, foreign document ids, citation isolation, usage/report isolation |
| `holdout-permissions.test.ts` | 6 | Member vs admin vs owner: read, budget, audit, workspace delete, owner removal/demotion, invite, cancel |
| `holdout-validation.test.ts` | 6 | Signup/login validation and rate limit, workspace name bounds, document/job bounds, budget bounds, upload 415/413 |
| `holdout-usage-budget.test.ts` | 5 | 5-call stage distribution and cost, 402 on zero budget, budget_exceeded mid-job, chat usage record, failed call cost 0 and retry |
| `holdout-report-citations.test.ts` | 2 | Verbatim quotes / markers / in-workspace document ids, markdown download attachment |
| `holdout-chat-sse.test.ts` | 3 | Streaming deltas and exact concatenation, 402 when budget gone, content length bounds |
| `holdout-deletion.test.ts` | 3 | Deleted document leaves new jobs, workspace delete unreachable, document delete permission |
| `holdout-security-realmode.test.ts` | 5 | Secrets hashed at rest, single-use reset that ends sessions, test routes 404 outside TEST_MODE, real mode refuses incomplete config, real mode auth/model/max_tokens/billing/budget |
| `holdout-concurrency-restart.test.ts` | 4 | Cancel stops model calls, cancel finished job 409, two concurrent jobs, restart recovery |
| `holdout-ui.test.ts` | 2 | Signup → workspace → text → research → report; login → report → chat |

Total: 40 tests. Each test creates its own users/workspaces; the suite never reuses state.

## Points deliberately not tested (ambiguous or under-specified)

- **Transient faults.** testability.md §5 says `transient` is a "retryable" error whose stage
  fails for `times` attempts, but it does not say whether the job retries automatically inside
  the same run or only via `POST /retry`. A test that assumes either would fail a correct
  implementation, so it is not asserted. Only the documented explicit `POST /retry` path (for a
  permanently failed stage) is tested.
- **Rate-limit threshold boundary.** "After 10 failed attempts for one email within 15 minutes,
  further attempts get 429" is ambiguous about whether the 10th or the 11th attempt is the first
  429. The test loops up to 11 attempts, requires every earlier one to be 401, and requires a
  429 to appear — it does not pin the exact attempt.
- **Budget check semantics.** Whether the product reserves per call or for the whole job, and
  whether it blocks on `spent >= budget` or `spent + cost > budget`, is not specified. The tests
  only assert the documented outcomes: 402 for an already-exhausted budget, a `budget_exceeded`
  terminal status, and that `spentUsd` never exceeds the budget.
- **Whether exactly 20 documents is accepted.** `maxItems: 20` is inclusive but the test only
  proves 21 ids are rejected (a 20-document fixture would be slow and brittle).
- **Member upload permission.** The documents `POST` summary states no role requirement, so the
  suite does not assert that a plain member can or cannot upload.
- **Download body equality.** The contract fixes the media type and the `.md` attachment
  filename, not that the body is byte-identical to `report.markdown`, so only the headers and
  non-emptiness are asserted.
- **Job `error.code` value.** No enum is given for `Job.error.code`; only its presence via the
  failed status is exercised.
- **Audit event `data` shape.** The event `type` enum and newest-first ordering are specified,
  but the `data` payload is not; only types are asserted.
- **Real-mode transport.** The mock model supports both one-shot JSON and streaming; the suite
  does not assert which one the product uses, only the request headers/fields and the billing.
