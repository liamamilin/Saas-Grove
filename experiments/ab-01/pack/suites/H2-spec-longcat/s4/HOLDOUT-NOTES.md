# Held-out suite — what was left out, and why

The held-out tests live in `tests/s4/holdout-*.test.ts`. This file lists the points of
`brief/spec/product.md`, `architecture.md` and `decisions.md` that were **not** turned into
tests, because the documents are ambiguous, the behaviour is not observable from outside, or
the contract already states it.

## Not observable from outside

| Clause | Why it is not tested |
|---|---|
| architecture.md §4.2 — the three stage outputs are persisted in `job_stages` | The API never exposes a stage's output, only its name and status. |
| architecture.md §3 — "每一张业务表都带 `workspace_id`" | A schema convention; only its effect (isolation) is observable. |
| decisions.md T3 — chunks of ~1000 characters with 150 characters of overlap | Chunking is never exposed; only the quotes that come out of it are. |
| decisions.md T4 — the top 4 chunks per sub-question | The number of retrieved chunks is not observable, and the fake model ignores its input. |
| architecture.md §4.3 — the reservation arithmetic (`已花 + 已预留 + 本次预估`) | Only the invariant (never spending more than the budget) can be observed, and that is what the tests check. |
| architecture.md §4.2 — the backoff ("第 2 次尝试前至少等 200 ms，之后每次等待时间加倍") | Testing a lower bound on the delay would be timing luck; the attempt *count* is tested instead. |
| product.md §7 — "日志结构化，带请求 ID 和任务 ID" | Log format is not part of the contract; nothing in the API exposes request IDs. |
| product.md §8 — non-goals (no web search, no SSO, no sharing links) | Absence of a feature is not observable through a positive black-box test. |
| decisions.md T6 — 30-day sessions, sliding renewal | Cookie lifetime attributes are not part of the contract, and "sliding" needs time travel. |
| decisions.md T1/T2/T5 — Better Auth / pg-boss / argon2id | Internal choices; the contract's §9 already covers what is stored. |

## Ambiguous — a correct implementation could go either way

| Point | The ambiguity |
|---|---|
| `GET /documents` after a document is deleted | The contract says a deleted document "stops taking part in retrieval and new jobs" and product.md §7 says "删除即不可再被访问", but neither says whether a soft-deleted document is still listed. The test only asserts that the document itself and its text are 404. |
| Whether a queued (not yet running) job can be cancelled | The contract only excludes jobs that have "already finished" (409 invalid_state). Not tested. |
| Job stage statuses after a failure | The contract's enum allows `failed` and `skipped`; which one a stage gets after a failure is not stated. The tests only assert `plan` is `succeeded` and that the stage names are `plan, analyze, synthesize`. |
| `progress` of a finished job (100?) | The contract only bounds it to 0–100; nothing says a succeeded job reports 100. Not tested. |
| Order of `GET /reports/{id}/messages` | Nothing states whether messages are oldest-first or newest-first. The tests assert content and roles, not order. |
| Whether the user's own question is stored as a message | Implied by the `Message.role` enum (`user`/`assistant`) and product.md §3, but not stated. Tested (weakly) as "a message with role user and that content exists". |
| The exact date of `invitation.expiresAt` | decisions.md T8 gives 7 days as the default, and a deviation is allowed with a note in `DECISIONS.md`. The test accepts 6–8 days. |
| Whether `periodStart`/`periodEnd` are a calendar month | product.md §3 says budgets are per 自然月, but the contract only names the two fields. The test accepts any window of 27–32 days containing now. |
| The shape of a `job.canceled` audit event for a job cancelled while queued | The contract lists the event type but not the exact trigger. The audit tests only cover a running-job cancel indirectly and the four unambiguous actions (budget, invitation, role, document/export). |
| `member.invited` vs `member.joined` for an accepted invitation | Both names are in the contract's enum, but the contract does not say the invitation POST emits `member.invited`. The test asserts both; this is the softest audit assertion. |
| Whether the UI refreshes the document list by itself | testability §8 only says `document-item` contains the status value. The UI test reloads the page until the status is `ready`, so both a polling UI and a static one pass. |
| Which page the user lands on right after signup | Only `/signup` and `/login` are fixed paths. The UI test accepts either the workspace-creation page or a workspace home, and falls back to `/`. |
| Whether `spentUsd` includes embedding records | testability §5 allows `kind: "embedding"` records with `costUsd: 0`, so they cannot change the sum. The test asserts `spentUsd` equals the sum of all records' `costUsd`. |
| Whether `GET /workspaces/{ws}` and `GET /workspaces` hide a deleted workspace | "Everything in the workspace becomes unreachable" is taken to include the workspace itself and its listing. This is the most interpretive assertion in the suite. |
| The export's exact contents beyond the required keys | The contract fixes the required keys; the test only checks that this workspace's document (with its text) is present and another workspace's is not. |
| "最多同时运行 2 个任务" — at most, or exactly two at a time? | architecture.md §4.2 + decisions.md T9 give 2 as the default and "多出来的保持 queued" only makes sense if the limit is actually reached. The test requires two jobs to run at the same time and a third to wait, which a strictly sequential implementation would fail. |
| Whether `job.reportId` must be null for a job stopped by a cancel or by the budget | Only implied by the job statuses. Both tests assert it together with the absence of a report for that job. |
| Whether a `transient` fault's `times` counts call *attempts* | testability §5 says "该阶段接下来的 times 次调用尝试失败"; the retry test relies on that reading. |

## Deliberately not duplicated from the contract

Everything the contract already states is left to the visible suite: error codes and their
HTTP statuses, cross-tenant 404 vs 403, session cookies and their attributes, login rate
limiting, the outbox and single-use tokens, the fake model's five calls and streaming
guarantees, `max_tokens`/`usage` accounting in real mode, the start convention, secrets and
password hashes at rest, and the `data-testid` anchors themselves.
