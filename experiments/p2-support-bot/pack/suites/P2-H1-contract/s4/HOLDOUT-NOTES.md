# Held-out notes (S4)

What the held-out suite of `blueprint/acceptance/tests/s4/` covers, and what it deliberately does
not cover. Every test names the clause of `brief/contract/api.yaml`,
`brief/contract/testability.md` or `brief/user-brief.md` it derives from.

## Left out because the documents are ambiguous

1. **The exact meaning of "Max 10 MB" for an upload.**
   The documents do not say whether that is 10,000,000 or 10,485,760 bytes. Only a file that is over
   both readings (11 MiB) is tested, and it must be answered with 413 `payload_too_large`. The
   boundary itself is not tested.

2. **The wording of the error messages.**
   The contract fixes the codes, not the messages. Only the codes are asserted (plus the shape
   `{"error": {"code", "message"}}`).

3. **The contents of an audit event's `targetType`, `targetId` and `data`.**
   The contract fixes the type and the actor, nothing else. Only those are asserted.

4. **What a restart has to recover.**
   `testability.md` §7 says the acceptance may restart the product in the middle of the run and keep
   the database, but it does not say what has to survive (a running question? the rate limiters? the
   sessions?). Nothing was tested for that.

5. **The exact budget arithmetic of the real mode (§5.2 item 4).**
   The "budget = spent + 1.5 calls" scenario depends on the size of the prompt the product builds,
   which the contract does not fix. What is tested is the hard stop itself: a budget that cannot pay
   for a call makes the product answer with the fallback without calling the model at all.

6. **The 500 questions of the analytics list.**
   "at most the latest 500" is a cap, not a behaviour; filling it would need 500 questions.

7. **The script `/widget.js` itself.**
   The contract points at `spec/architecture.md` §8 for what the script must render, and that
   document is not part of the inputs. The widget is only tested through the `data-testid` anchors
   of `testability.md` §8, in a real page of a customer.

8. **The embedding records.**
   `testability.md` §5 says the local embedding "may be recorded as `kind: "embedding"`" - it is
   optional, so the tests do not require such records; they only require that the chat records are
   exactly the documented ones.

9. **The order of the checks of the widget rules 1-3.**
   The rules are numbered (the key, then the origin, then the disabled widget), but the order is not
   stated. The tests therefore use the product's own origin whenever the disabled widget is
   checked, so that the order cannot matter.

## Readings of the contract that the tests rely on

* **The rate limit of the login** is counted per email ("After 10 failed attempts for one email
  within 15 minutes"), so the test expects 401 for the first ten attempts of one address and 429
  for the eleventh - and expects another address to be unaffected.
* **The preflight** is sent with an `Access-Control-Request-Method` header and a JSON content type,
  so that it does not depend on whether the product checks the content type of a body-less OPTIONS
  request.
* **The document type** is decided by the file extension: a `.txt` whose part claims to be a pdf is
  read as text, and a `.pdf` whose part claims to be plain text is read as a pdf.
* **The backoff of the retries** is checked on the `createdAt` of the usage records ("the time that
  attempt started"): at least 190 ms between the first and the second attempt and at least 380 ms
  between the second and the third, which leaves room for the millisecond precision of the
  timestamps.
* **The stream** is checked with a latency of 2 s: the first part has to arrive within 3.5 s and at
  least 0.8 s before the last one, so a buffered answer is caught without depending on exact
  timings.
* **The widget's key** is public ("it sits in the customer's page source"), so it may be part of the
  export; the tokens (session, visitor, invitation, reset) may not.
* **The outbox** may keep the invitation and reset tokens in plain text, but nothing else may be
  stored in plain text; the test does not require the tokens to be in the database at all, because
  §6 only says that a test mail *in the database* lives in a table named like an outbox.
