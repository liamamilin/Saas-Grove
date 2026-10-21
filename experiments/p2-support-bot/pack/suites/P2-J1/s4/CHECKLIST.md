# Feature checklist — AI Support Bot (S4)

Derived **only** from `brief/user-brief.md`, `brief/contract/api.yaml` and
`brief/contract/testability.md`. One line per user-visible feature.

Legend

* **[J]** — a scripted browser journey exists: `tests/s4/journey-<feature>.test.ts`.
* **[N]** — no journey: the contract defines the feature but the documented UI anchors
  (`testability.md` §8) do not reach it, so it is listed in `tests/s4/JOURNEY-NOTES.md`
  instead of a fragile test.

35 features: 18 with a journey, 17 without.

---

## A. Account and the workspace of the company

* **F1 [J]** A visitor creates an account with a name, an e-mail and a password and is signed in at once. — `api.yaml` `POST /api/auth/signup` → 201 + session cookie; anchors `signup-name|email|password|submit`.
* **F2 [J]** A team member signs in with e-mail and password; a wrong password opens no session. — `api.yaml` `POST /api/auth/login` → 200 / 401 `invalid_credentials`; anchors `login-email|password|submit`.
* **F3 [N]** A user ends the session and the old cookie stops working. — `api.yaml` `POST /api/auth/logout` → 204.
* **F4 [N]** A user asks for a password-reset mail and sets a new password with the token in it. — `api.yaml` `POST /api/auth/password-reset/request|confirm`.
* **F5 [J]** The first-run page creates the company's workspace; the home page shows its name and the way into the knowledge base, the handoffs and the analytics. — `api.yaml` `POST /api/workspaces`; anchors `workspace-create-name|submit`, `workspace-name`, `nav-knowledge`, `nav-handoffs`, `nav-analytics`.
* **F6 [N]** The owner invites a colleague, the colleague joins with a role, roles are changed and members are removed. — `api.yaml` `/invitations`, `/members/{userId}` → 403 / 409 `last_owner`.
* **F7 [N]** The owner deletes the workspace and everything in it becomes unreachable. — `api.yaml` `DELETE /api/workspaces/{ws}` → 204.

## B. The knowledge base: the product documents and FAQs

* **F8 [J]** A member pastes a document into the knowledge base; the list shows it and its status refreshes to `ready` on its own, without a manual page reload. — `api.yaml` `POST /api/workspaces/{ws}/documents`; anchors `document-text-title|body|submit`, `document-item`; `testability.md` §8 "状态要自动刷新".
* **F9 [N]** A member uploads a `.txt` / `.md` / `.pdf` / `.docx` / `.html` file as material. — `api.yaml` `POST /api/workspaces/{ws}/documents` (multipart).
* **F10 [N]** A member deletes a document and it stops taking part in the answers. — `api.yaml` `DELETE /api/workspaces/{ws}/documents/{id}` → 204.
* **F11 [N]** A document whose text cannot be extracted ends `failed` with `error.code = "unreadable"`. — `api.yaml` `Document.status`, `Document.error`.

## C. The widget on the company's own website (the customer-facing path)

* **F12 [J]** The company puts the widget on its own website: the script renders a launcher there, and the launcher opens the chat panel. — `api.yaml` `GET /widget.js`; anchors `widget-launcher`, `widget-input`.
* **F13 [J]** A visitor asks a question and the widget answers it from the knowledge base, with a citation that names the document the answer came from. — brief: "客户提问就按资料回答，而且要说清楚答案是从哪段资料来的"; anchors `widget-input`, `widget-send`, `widget-message-assistant`, `widget-citation`.
* **F14 [J]** The answer appears progressively while it is produced. — `api.yaml` SSE `event: delta` … `event: done`; `testability.md` §5 "至少 2 段增量流式返回".
* **F15 [J]** A question the knowledge base cannot answer gets the fallback answer — not an invented one. — brief: "我最担心的是它瞎编答案"; `api.yaml` "unanswered: `outcome: "unanswered"`, `citations: []`, `content` is exactly the widget's `fallbackMessage`".
* **F16 [J]** When the model fails, the visitor gets the fallback answer as well — never an error page and never a made-up answer. — brief: "我最担心的是它瞎编答案"; `api.yaml` "when the model still fails after its retries".
* **F17 [J]** A visitor asks for a person, leaves a contact address, and gets a confirmation. — brief: "能转人工，最好能留个联系方式"; anchors `widget-handoff`, `widget-contact-email`, `widget-handoff-submit`, `widget-handoff-done`.
* **F18 [J]** The bot keeps answering questions in a conversation that was handed off to a person. — `api.yaml` handoff: "The bot keeps answering questions in a handed-off conversation."
* **F19 [J]** The widget answers only on the websites the company allowed. — `api.yaml` widget rules 2 and 4 (`allowedOrigins`, `origin_not_allowed`).
* **F20 [N]** A visitor rates an answer up or down. — `api.yaml` `POST .../messages/{messageId}/feedback`.
* **F21 [N]** The company changes the bot's name, its greeting and its fallback message. — `api.yaml` `PATCH /api/workspaces/{ws}/widget`.
* **F22 [N]** The company turns the widget off and can rotate its public key. — `api.yaml` `PATCH .../widget {enabled}`, `POST .../widget/rotate-key`.
* **F23 [N]** The company gets the snippet to paste into its website. — `api.yaml` `WidgetSettings.embedSnippet`.

## D. The team's own preview

* **F24 [J]** On the knowledge page the team can try the bot and see the answer with the documents it cites. — `testability.md` §8 "后台预览"; anchors `preview-input`, `preview-submit`, `preview-answer`, `preview-citation`.
* **F25 [J]** The preview shows the fallback answer for a question the knowledge base cannot answer. — `testability.md` §8; `api.yaml` `fallbackMessage`.

## E. Handoffs, on the team's side

* **F26 [J]** The handoff page lists the requests for a person, with the contact details the visitor left. — brief: "记录下来"; `api.yaml` `GET /api/workspaces/{ws}/handoffs`; anchor `handoff-item`.
* **F27 [N]** A member marks a handoff as resolved and can open it again. — `api.yaml` `PATCH /api/workspaces/{ws}/handoffs/{id}`.

## F. Usage, budget and analytics

* **F28 [J]** The analytics page shows how much this month has cost. — brief: "我看到这个月用了多少"; `api.yaml` `GET .../usage` → `spentUsd`; anchor `usage-spent`.
* **F29 [J]** The analytics page lists the questions the bot could not answer, with the question itself. — brief: "都问了什么、哪些问题没答上来"; `api.yaml` `GET .../analytics/questions?outcome=unanswered`; anchor `analytics-unanswered-item`.
* **F30 [J]** The monthly budget is a hard stop: a question that does not fit the budget gets the fallback answer, the model is not called, and the month never costs more than the budget. — brief: "能设个月度预算，超了就停"; `api.yaml` `PUT .../budget`, "spending in a month never exceeds it".
* **F31 [N]** The company is warned by mail at 80 % of the budget, and when the budget is used up. — `api.yaml` `budget_warning` / `budget_exhausted` mails.
* **F32 [N]** The analytics page shows the counts of conversations, questions, answers and handoffs. — `api.yaml` `GET .../analytics/summary`.

## G. Governance

* **F33 [N]** The owner and the admins read the log of the administration actions. — `api.yaml` `GET /api/workspaces/{ws}/audit-events`.
* **F34 [N]** The owner and the admins export everything in the workspace. — `api.yaml` `GET /api/workspaces/{ws}/export`.
* **F35 [N]** An admin deletes a conversation, so a visitor who asked to be forgotten disappears from every list. — `api.yaml` `DELETE /api/workspaces/{ws}/conversations/{id}`.
