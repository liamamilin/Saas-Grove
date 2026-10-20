# Holdout test notes

Ambiguous points deliberately not asserted (documents do not specify them precisely):

1. Document processing may be synchronous or asynchronous; the 409 "not ready" path for research jobs is not tested because a correct implementation can return `ready` immediately.
2. Transient model faults are described as retryable, but the contract does not state whether the product retries them automatically or requires a manual retry; only permanent faults + manual retry are asserted.
3. Page routes beyond `/signup` and `/login` are implementation-defined (§8); UI tests assume a conventional post-login redirect and the documented `data-testid` anchors.
4. A research job started with zero budget may surface as a `402` at creation or as a job in `budget_exceeded` status; the test accepts both.
5. Citation placement in chat replies (inline `[n]` vs. `citations` array) is not pinned down; the test accepts either.
6. Restart recovery of in-flight jobs is unspecified; only completed data persistence is checked.
7. Rate-limit window expiry (15 minutes) is not tested.
8. Real-mode handling of `max_tokens` (fail vs. lower it) is unspecified; only `spentUsd <= budget` is asserted.
9. PDF text extraction quality is not asserted beyond a successful `ready` status.
10. Embedding usage recording is optional in shape (`kind: "embedding"`, `costUsd: 0`); not asserted.
11. Audit-event generation for every action is asserted only where the type is enumerated; ordering beyond "newest first" is not pinned.
12. Deletion of a workspace's effect on in-flight jobs is unspecified and not tested.
''