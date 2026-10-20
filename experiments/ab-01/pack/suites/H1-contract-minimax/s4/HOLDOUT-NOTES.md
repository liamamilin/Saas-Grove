# Held-out test notes (stage S4)

This document lists behaviours the contract mentions but that the suite
deliberately does not test, because the contract is ambiguous on the
point or because every reasonable implementation must obey it implicitly
without a separate test adding value.

## Real-mode subtleties left to other tests

* **§5.1 — `EMBEDDING_PROVIDER=openai-compatible`**: the contract says
  "以后有了向量接口，再改成 openai-compatible". Today's acceptance covers
  `EMBEDDING_PROVIDER=local` only; the openai variant is forward-looking.
* **§5.2 step 4 — small-budget behaviour**: I test that the call shape
  carries max_tokens (step 3). The exact dollar/accounting match between
  the mock's `usage` and the recorded `costUsd` is verified at a coarse
  level; per-record arithmetic is exercised in stage S3 of the public
  suite, so I do not duplicate it here at the per-record level.
* **§5.2 step 2 — missing each of MODEL_API_KEY, MODEL_INPUT_USD_PER_MTOK,
  MODEL_OUTPUT_USD_PER_MTOK**: I rotate only one of the four required
  env vars (the contract calls them required but the contract names
  `MODEL_BASE_URL` first and the others just say "上面五项"). The four
  other variants are mechanically identical; one sufficiently covers the
  rule.

## Ambiguities in the contract that I deliberately do not assert

* **PATCH role to "owner"**: the `Role` schema is `enum: [owner, admin,
  member]`, but `§members/{userId} PATCH` says only "Change a role.
  Owner only." It does not say what happens when a non-owner is *promoted
  to* owner. I assert the obviously-bad case (an invalid role string
  outside the enum) but skip the "promote to owner" case because both
  behaviours (accept and refuse) would be defensible.
* **Document deletion by the uploader**: the rule "Uploader, admin or
  owner" is unambiguous, but the data model is — there is no
  `uploadedBy` field on the upload response, just `uploadedBy` on the
  document list. I exercise the admin/owner/member case which the test
  can observe through the API; the "uploader" axis is implicitly covered
  because the owner of the document is also the uploader in the same
  workspace.
* **Email case-insensitivity on login**: the contract says email is
  case-insensitive on signup and on invitations. Login is not explicitly
  stated to be case-insensitive, but a coherent implementation will
  inherit that from how the user is looked up. I do not test
  case-insensitivity on login since the contract does not say so
  explicitly.
* **Pagination on lists (documents/reports/messages/usage)**: the
  contract describes list endpoints but never specifies page size or
  pagination cursors. I assert the data the test directly creates is
  present, but I do not test for pagination correctness.
* **Job retries and stage re-runs after a transient fault**:
  testability.md §5 mentions "transient faults are retried", and §retry
  lets the caller resume from the first unfinished stage. The exact
  number of retries the fakes perform is not specified; I keep the
  cancellation test loose enough to allow at most one call to land after
  a cancel, which is the only behaviour the contract explicitly fixes.
* **Audit event targetType / targetId shape**: the contract specifies
  those fields as `type: string` without listing allowed values for each
  event type. I assert that the `type` and the actors match what the
  contract names, but not the `targetId` format.
* **Concurrency limits, request timeouts, body size limit on the
  document upload**: 10 MB is the only documented limit; I do not probe
  the boundary exhaustively because a true concurrent-upload race is
  out of scope for a black-box test that must remain independent of the
  upload implementation (multipart vs. streamed).
* **Citation quotes' source for chat follow-ups**: chat messages carry
  citations but the contract does not strictly say "every chat message
  must carry a citation". The §5 chat table mentions "回答中至少包含 1
  处引用"; the test asserts ≥1 citation per chat but does not assert
  every quote is in the cited document (the verbatim check IS in the
  report-citation tests of earlier stages; the chat test only verifies
  ≥1 cites in-scope).
* **Out-of-test-mode behaviour of §5.1 token controls**: §5.2 step 4
  asks the product to never issue a request that the budget cannot
  cover. The check that the impl refuses rather than silently dropping
  per-token mid-call is verified by the fake-model + budget interaction
  in stage S3; my real-mode call-shape test simply checks the request
  contains `max_tokens`, not the call-counter-vs-budget interplay.

## Things that are deliberately strict

* **Cancellation plateau**: `after ≤ before + 1`. Tighter than "no calls
  after cancel" because the contract carves an exception for in-flight
  calls; loosen this if a correct implementation is reported failing.
