# Journey notes — features not driven through the UI

The instructions ask: "If a feature cannot be driven through the documented UI
anchors, list it in `tests/s4/JOURNEY-NOTES.md` instead of writing a fragile
test."

The testability contract (`brief/contract/testability.md` §8) documents the
UI **`data-testid`s** that the acceptance harness is allowed to drive:

```
signup-name / signup-email / signup-password / signup-submit  (signup page)
login-email / login-password / login-submit                    (login page)
workspace-create-name / workspace-create-submit                 (no-workspace landing)
workspace-name / nav-research / nav-usage / report-link        (workspace home)
document-text-title / document-text-body / document-text-submit (research page)
document-item (per document; carries its status word)
research-question / research-submit                            (start research)
job-status (status text) / job-progress                        (job page)
report-content / chat-input / chat-submit / chat-message-assistant (report page)
usage-spent                                                    (usage page)
```

It also fixes exactly two routes: `/signup` and `/login`. All other route
shapes are at the implementation's discretion.

The following features from the brief and contract **cannot be driven
through documented UI anchors**, because they have no `data-testid`s and
they live on routes the implementation is free to name. A journey that
"clicks an invite button" or "fills the budget form" would have to guess
implementation-specific selectors and become fragile:

- **F11 — Invite member by email and assign a role.** No `invite-*` test id.
  Test would have to guess selectors like "the invite form field" against
  each candidate UI.
- **F12 — Delete a document.** No `delete-*` or row-action test id on
  `document-item`. The item carries the status word but no action handle.
- **F13 — Delete a workspace.** No `workspace-delete-submit` test id and
  no documented route.
- **F14 — Set a monthly budget.** No `budget-monthly` / `budget-submit`
  test id and the budget page is not part of the navigation anchors
  (`nav-*` only covers research and usage).
- **F15 — Export the workspace.** No `export-*` test id and not in
  navigation.
- **F16 — Request a password reset email and confirm a new password.**
  The contract fixes only `/signup` and `/login`; a reset-password form
  has no documented route and no test ids.

Each of F1–F10 in `tests/s4/CHECKLIST.md` does have a documented UI anchor
and is exercised through one end-to-end journey in `tests/s4/`.
