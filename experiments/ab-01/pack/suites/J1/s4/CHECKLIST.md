# S4 Feature Checklist

User-visible features the brief and contract require for S4 (governance + chat + resilience, building on S1–S3).
Derived ONLY from `brief/user-brief.md` and `brief/contract/api.yaml` (with anchors from `brief/contract/testability.md`).

| ID | Feature |
|----|---------|
| F1 | Register a new account (sign up starts a session) |
| F2 | Log in to an existing account |
| F3 | Create a workspace when none exists |
| F4 | Add a text document (pasted text) and see it become ready in the workspace |
| F5 | Start a research job by asking a question over the ready documents |
| F6 | See the job's status and progress while it runs, until it succeeds |
| F7 | Open the report produced by the job and read it with at least one `[n]` citation that links to the document |
| F8 | Ask a follow-up chat question on the report and see the assistant's streamed answer |
| F9 | See total spend on the usage page |
| F10 | The product comes back healthy and serves the signed-in session after an in-place restart |
| F11 | Invite a member to the workspace by email and assign a role *(no documented UI anchors)* |
| F12 | Delete a document so it stops participating in retrieval and new jobs *(no documented UI anchors)* |
| F13 | Delete a workspace as owner *(no documented UI anchors)* |
| F14 | Set a monthly USD budget for the workspace *(no documented UI anchors)* |
| F15 | Export the workspace contents (admin/owner only) *(no documented UI anchors)* |
| F16 | Request a password-reset email and confirm a new password *(no documented UI anchors)* |

JOURNEY-NOTES.md explains why F11–F16 are not driven through the UI: the testability contract (`brief/contract/testability.md` §8) only documents UI `data-testid`s for sign-up, log-in, workspace creation, document paste, research, job, report, chat and usage. Inviting members, deleting documents/workspaces, setting a budget, exporting, and password reset have no `data-testid`s in the contract, and there are no fixed routes for those pages, so a journey that "clicks a delete button" or "fills an invite form" would be fragile and would name implementation-specific elements.
