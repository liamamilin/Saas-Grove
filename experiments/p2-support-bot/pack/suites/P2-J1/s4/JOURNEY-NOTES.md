# Journey notes — features without a documented UI anchor

`testability.md` §8 fixes the only handles an acceptance test may use:

> 页面路径由实现决定，只有两个固定：`/signup` 和 `/login`。验收测试通过下面这些 `data-testid` 操作界面

The table that follows names every `data-testid` the product has to expose. A feature the
brief and the contract require but that this table does not reach cannot be driven in a
browser without guessing at names, routes or wording — and a test that guesses is a test
that fails for the wrong reason. Those features are listed here instead of being written as
fragile journeys.

Each entry says what the feature is, where the contract defines it, what is missing for a
journey, and what a journey would have to do once the product exposes it.

---

## A. Account and the workspace of the company

### F3 — sign out
* Contract: `POST /api/auth/logout` → 204; "the old cookie stops working".
* Missing: no anchor for a sign-out control, and no text the contract fixes (it may read
  "退出登录", "Log out", "Sign out", or anything else).
* A journey would: click the sign-out control, then reload a product page and see that the
  product asks for the sign-in again (`/login` has `login-email`).

### F4 — password reset
* Contract: `POST /api/auth/password-reset/request` → 202 (always), `POST
  /api/auth/password-reset/confirm` → 204 (single-use token, ends every session).
* Missing: no anchor for "forgot password", for the mail-address field, or for the two
  password fields of the reset form. The mail itself is only reachable through the
  test-mode outbox (`GET /api/__test__/outbox?to=…`), which is not a page.
* A journey would: ask for a reset, read the token from the outbox, set a new password,
  then sign in with it.

### F6 — colleagues, roles and members
* Contract: `POST /api/workspaces/{ws}/invitations` (admin or owner) → 201 with an
  `invitation` mail; `POST /api/invitations/accept` → 200; `PATCH
  /api/workspaces/{ws}/members/{userId}` (owner only) → 403 for a non-owner, 409
  `last_owner`; `DELETE …/members/{userId}` → 204, 403 when an admin touches an owner.
* Missing: no anchor for the member list, the invitation form, the role control or the
  remove control.
* A journey would: invite a colleague from the member list, accept the invitation as the
  invited person, change a role, and watch the last owner be protected.

### F7 — delete the workspace
* Contract: `DELETE /api/workspaces/{ws}` → 204; "everything in the workspace becomes
  unreachable".
* Missing: no anchor for the delete control or its confirmation.
* A journey would: delete the workspace and then find that its documents, conversations and
  handoffs are gone (404).

## B. The knowledge base

### F9 — upload a file
* Contract: `POST /api/workspaces/{ws}/documents` accepts `multipart/form-data` with the field
  `file` (`.txt`, `.md`, `.pdf`, `.docx`, `.html`, max 10 MB); HTML is reduced to its
  visible text.
* Missing: `testability.md` §8 documents only the *paste text* route
  (`document-text-title`, `document-text-body`, `document-text-submit`). A file input has no
  documented anchor; it may be a drop zone, a hidden `<input type=file>`, or a button that
  opens a file dialog.
* A journey would: put `fixtures/hello.pdf` or `fixtures/hours.docx` in the file input and
  see a `document-item` whose status turns to `ready` and whose text can be cited. The
  fixtures are already in `blueprint/acceptance/fixtures/`.

### F10 — delete a document
* Contract: `DELETE /api/workspaces/{ws}/documents/{id}` (uploader, admin or owner) → 204;
  "The document stops taking part in answers at once".
* Missing: no anchor for a delete control next to `document-item`.
* A journey would: delete a document, see it leave the list, and see that a later question
  is no longer answered from it.

### F11 — a document that cannot be read
* Contract: a file whose type is accepted but from which no text can be extracted "is
  accepted with 201 and ends `failed` with `error.code = "unreadable"`"; `Document.status`
  is `processing`, `ready` or `failed` and `document-item` shows that value.
* Missing: no way to make a *pasted* document fail, and no anchor for a file upload that
  could fail (F9).
* A journey would: add a corrupt or image-only file and see the status `failed` in its
  `document-item`, and see that it is not used for answers.

## C. The widget

### F20 — the visitor rates an answer
* Contract: `POST /api/widget/{key}/conversations/{id}/messages/{messageId}/feedback` with
  `{rating: "up" | "down"}` → 200; rating again replaces the rating; the rating shows up in
  `QuestionRecord.rating`.
* Missing: no anchor for a rating control in the widget (the documented widget anchors are
  the launcher, the input, the send button, the assistant messages, the citations and the
  handoff controls).
* A journey would: rate an answer up in the widget and see the rating in the analytics.

### F21 — bot name, greeting and fallback message
* Contract: `PATCH /api/workspaces/{ws}/widget` with `botName`, `greeting` and
  `fallbackMessage` (1–500 characters), admin or owner.
* Missing: no anchor for a settings page or for these three fields.
* A journey would: change the bot's name and greeting, reload the widget on a host page and
  see the new name and greeting; change the fallback message and ask a question that cannot
  be answered.

### F22 — switch the widget off, rotate its key
* Contract: `PATCH …/widget {enabled: false}` → 403 `widget_disabled` on every widget route;
  `POST …/widget/rotate-key` issues a new key and "the old key stops working at once (404 on
  every widget route)".
* Missing: no anchor for either control.
* A journey would: switch the widget off and see that the widget on the company's website
  stops answering, then rotate the key and see the old embed stop working.

### F23 — the snippet to paste into the website
* Contract: `WidgetSettings.embedSnippet` — "Exactly one script tag:
  `<script src="<APP_BASE_URL>/widget.js" data-widget-key="<widgetKey>" async></script>`".
* Missing: no anchor for a page that shows the snippet.
* A journey would: read the snippet from the settings page, paste it into a host page and
  see the widget appear.

## E. Handoffs

### F27 — resolve a handoff
* Contract: `PATCH /api/workspaces/{ws}/handoffs/{id}` with `{status: "open" | "resolved"}`
  → 200, any member; the handoff carries `resolvedAt`.
* Missing: no anchor for a resolve control next to `handoff-item`.
* A journey would: resolve a handoff from the handoff page and see it leave the open list.

## F. Usage, budget and analytics

### F31 — the budget mails
* Contract: every owner and admin gets a `budget_warning` mail when the month's spend first
  reaches 80 % of the budget, and a `budget_exhausted` mail the first time a question is
  refused for lack of budget; each kind at most once per calendar month.
* Missing: the mails are only visible through the test-mode outbox
  (`GET /api/__test__/outbox?to=…`), which is not a page, and the warning has no anchor in
  the analytics page either.
* A journey would: ask questions until 80 % of the budget is gone and read the warning in the
  outbox of the owner's address, then exhaust the budget and read the second mail.

### F32 — the counts
* Contract: `GET /api/workspaces/{ws}/analytics/summary` → `conversations`, `questions`,
  `answered`, `unanswered`, `handoffs`, `spentUsd`, `budgetUsd`.
* Missing: the analytics page documents only `analytics-unanswered-item` and `usage-spent`;
  no anchor for the counters.
* A journey would: read the counters of the month next to the list of unanswered questions.

## G. Governance

### F33 — the audit log
* Contract: `GET /api/workspaces/{ws}/audit-events` (admin or owner) → the events
  `member.invited`, `member.joined`, `member.role_changed`, `member.removed`,
  `budget.updated`, `document.deleted`, `widget.updated`, `widget.key_rotated`,
  `conversation.deleted`, `export.created`, newest first.
* Missing: no anchor for an audit page or list.
* A journey would: perform an administration action and then read it in the audit list.

### F34 — export the workspace
* Contract: `GET /api/workspaces/{ws}/export` (admin or owner) → `{exportedAt, workspace,
  members, documents, widget, conversations, handoffs, usageRecords}` and nothing secret.
* Missing: no anchor for an export control.
* A journey would: click the export control and check the file that arrives.

### F35 — delete a conversation
* Contract: `DELETE /api/workspaces/{ws}/conversations/{id}` (admin or owner) → 204; the
  conversation, its messages and its handoff disappear from every list, analytics, export and
  the widget, and its visitor token stops working.
* Missing: no anchor for a delete control next to a conversation.
* A journey would: delete a conversation as an admin and see it disappear from the
  conversation list, the analytics and the export.

---

## Two things a journey sets up through the API on purpose

* **F19, F30 (allowed origins, budget).** The contract has `PATCH
  /api/workspaces/{ws}/widget {allowedOrigins}` and `PUT /api/workspaces/{ws}/budget`, but no
  anchor for a settings page or a budget form. `journey-widget-origin.test.ts` and
  `journey-budget.test.ts` therefore set them through those endpoints and watch what the
  *browser* does with them.
* **F14, F16 (slow model, broken model).** The fake model is shared by the whole
  application, so the latency and the fault are set through the test interface
  (`testability.md` §5, §6) and taken away again before and after the journey. What the
  journey then checks is always what the *browser* shows.
