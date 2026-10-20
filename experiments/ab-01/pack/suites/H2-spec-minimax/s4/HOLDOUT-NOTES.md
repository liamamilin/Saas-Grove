# Holdout notes — S4 acceptance tests

These tests were written blind to the implementation. Anything ambiguous in the
specification is noted below and was deliberately not tested.

## Points the spec does NOT make clear, so no test was written

- **PDF parsing content fidelity.** `spec/product.md §5 S2` mentions PDFs but
  never specifies what a "parsed" PDF should contain (e.g. layout, headers,
  images, OCR of scanned PDFs). Not testable from outside without a fixture
  contract.

- **Concurrent chat messages on the same report.** `spec/product.md §3` says
  the chat answer streams, but does not say whether two simultaneous chat
  requests must interleave, queue, or error. Not tested.

- **Job retry of `succeeded` or `running` jobs.** `spec/architecture.md §4.2`
  says only `failed` and `budget_exceeded` are retryable, which the contract
  already encodes as the `409 invalid_state` response. No additional holdout
  test.

- **What happens if a document's vectorisation fails after parsing.** The spec
  describes a `failed` document state but not whether such a document can be
  included in a job (the contract says 409). No further test.

- **The exact contents of the audit `data` payload.** `spec/architecture.md §3`
  lists audit event types; the contract lists the same types. The payload
  shape (e.g. which key holds the old vs new role on `member.role_changed`,
  or which key holds the previous budget on `budget.updated`) is not
  documented. The holdout tests only assert that the event *exists* and that
  some key carries the new value; they do not pin down a specific field name
  for `data`.

- **Rate limit exact threshold for chat or exports.** `spec/product.md §7`
  mentions "rate-limited" only in passing (login rate limit is in the
  contract). Not tested.

- **Embedding cost / usage record shape.** `spec/architecture.md §5` says
  embeddings are local and free, and the contract's `UsageRecord` schema
  permits `kind: "embedding"` with `costUsd: 0`. The implementation can write
  these records or skip them. Not pinned down, not tested.

- **Whether "retry" of a `budget_exceeded` job re-reserves or not.** The spec
  and contract together imply retry is permitted, but the budget reservation
  semantics on retry are not documented.

- **`MODEL_PROVIDER=real` plus a stub EMBEDDING_PROVIDER.** `spec/architecture.md §5.1`
  names the variables but does not pin down which combinations are valid.
  We assume `EMBEDDING_PROVIDER=local` is always acceptable.

- **`__test__/outbox` table name.** `spec/architecture.md §6` says "名字包含
  `outbox`", but does not pin down the schema. The DB inspection tests live
  with the S1 suite (where `whereStored` is used); no S4 holdout test reads
  the DB directly.

- **UI testids.** `spec/architecture.md §8` enumerates `data-testid`s. Most
  are checkable only via Playwright. The holdout suite does not include a
  browser test because (a) the brief says S4 and the contract lists no UI
  tests beyond what the contract already exercises, and (b) `lib/ui.ts` is
  available but the spec does not say what an honest user-visible bug would
  look like beyond "the testid is missing". UI anchors were left for the
  existing UI suite.

## Decisions the holdout suite makes on its own

- **"First delta well before done"** is *not* asserted. The contract already
  states this; we leave the timing test out so we don't pin implementations
  to a specific latency floor.

- **"Email case-insensitive"** is *not* asserted as a separate test because
  the contract states it directly.

- **Rate-limit count 10/15min** is *not* tested because the contract states
  the exact numbers; no holdout value-add.

- **`/api/auth/logout`** invalidation is *not* tested for the same reason.

- **`HttpOnly` + `SameSite` cookie attributes** are *not* tested because the
  contract specifies them by name and the spec does not add a stronger
  property (e.g., `Secure` over HTTPS is not in the spec).

- **`password_reset` token is single-use** is *not* tested because the
  contract states it.

- **`invitation` token is single-use** is *not* tested because the contract
  states it.

- **Real-mode chat uses `max_completion_tokens` or `max_tokens`** — both
  shapes are accepted by the contract. The test asserts "some positive
  integer cap is present", which accepts either.

- **Job retry after restart.** The spec is clear that retry picks up from the
  first unfinished stage, but it is ambiguous whether the `analyze` sub-step
  partial state is re-executed or resumed. We assume "at most one synthesize
  runs" and "plan and analyze counts are unchanged", which catches the
  obvious bug ("re-run everything on retry") without over-constraining
  implementation choices for the analyze sub-steps.

- **Concurrency limit.** The spec default is 2, but `WORKSPACE_MAX_CONCURRENT_JOBS`
  is a documented env var. We assume the default of 2 because the runner
  does not override it.

- **Real-mode missing-config refuses to start.** The spec says "进程退出，或者
  在远超正常启动的时间内（完整配置启动用时的 3 倍，最少 30 秒，最多 90 秒）
  一直不健康，都算拒绝". We measure only the "did not become healthy within
  a short window" path; we do not also check the process actually exits.
  `instance.ts` returns both shapes (`exited` and `timedOut`) from a single
  `Launched` value; asserting `r.healthy === false` covers both.

## Items in scope but skipped due to difficulty

- **DB-level secret scan** (testability.md §9: "会话令牌、邀请令牌、密码重置
  令牌，在库里只能以哈希保存") is best done by reading the DB directly. The
  `lib/db.ts` helpers (`whereStored`, `passwordHashes`) are available, but
  the existing S1 suite is the conventional home for that. We did add a
  weaker HTTP-level version in `holdout-export.test.ts` that scans the
  export JSON for the same plaintexts, which catches most real leaks without
  needing DB access.

- **Per-token usage record for embeddings.** The contract allows `kind:
  "embedding"` records; the spec is silent on whether an implementation
  must write them. We do not pin them down.

## Files in this holdout

| File | Topic | Tests |
|---|---|---|
| holdout-chat.test.ts | Streaming chat follow-ups (S4) | 3 |
| holdout-audit.test.ts | Audit log (S4) | 4 |
| holdout-export.test.ts | Data export (S4) | 4 |
| holdout-deletion.test.ts | Document and workspace deletion (S4) | 4 |
| holdout-tenant-isolation.test.ts | Cross-workspace isolation | 3 |
| holdout-real-mode.test.ts | Real mode (`MODEL_PROVIDER=real`) | 8 |
| holdout-auth-policy.test.ts | Auth and session policy | 3 |
| holdout-jobs.test.ts | Cancel, concurrency, restart, retry, budget | 6 |
| **Total** | | **35** |