# Held-out suite — notes on scope and ambiguity

These tests cover clauses of `spec/product.md`, `spec/architecture.md` and
`spec/decisions.md` that are observable through the HTTP API, the browser UI or
the database, but that `brief/contract/api.yaml` and
`brief/contract/testability.md` do not already state.

## Points deliberately left out because the documents are ambiguous or contract-covered

- **Real mode** (architecture.md §5.1–§5.2): fully described in testability.md, not repeated.
- **Secrets at rest** (testability.md §9): contract states the rules.
- **CORS / Origin allowlist / no-Origin / 415 / rate limits / visitor tokens / widget disabled**: contract states all rules.
- **Role permissions, password hashing, session cookie, login rate limit, account enumeration**: contract states.
- **Handoff at most one per conversation (409), reopen, feedback rating replaces, widget key rotation**: contract states.
- **Chunking/retrieval params (T3/T4), session lifetime (T6), invitation expiry (T8)**: not observable.
- **Structured logs**: not exposed to tests.
- **Embed widget UI (widget-launcher etc. in a host page)**: requires a host page on a separate origin; the contract's anchors are exercised via the API instead.
- **Whether a member may preview**: product §4 step 4 implies it; tested via the public widget path as a member.
- **Audit coverage per action**: same ambiguity as before; only the events implied by the enum are asserted where exercised.
- **Visitor token expiry / 90-day contact retention (H11)**: no acceptance test; noted in decisions.md.
- **Budget default value (10 USD, H9)**: contract states "starts at 10", not re-tested.
- **Empty KB not calling the model**: contract states; verified in holdout-unanswered.
