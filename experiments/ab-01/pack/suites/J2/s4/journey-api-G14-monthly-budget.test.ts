// G14: Set a monthly USD budget; a new job beyond it is refused.
// Derived from brief/contract/api.yaml:
//   - PUT  /api/workspaces/{ws}/budget             (Admin or owner; monthlyUsd, null means unlimited; minimum 0)
//   - POST /api/workspaces/{ws}/research-jobs      (402 budget_exceeded when the job would exceed the budget)
// Journey: the owner signs up, creates a workspace, adds a ready document,
// sets a budget that is too small to cover even one chat call (the fake model costs
// $0.01 per call per brief/contract/testability.md §5), then queues a research
// job. The product must refuse the job with 402 budget_exceeded.
// Binary pass condition: POST /api/workspaces/{ws}/research-jobs returns 402 with error code "budget_exceeded".

import { describe, expect, test } from "vitest";
import { addText, createWorkspace, signup } from "../../lib/helpers";

describe("G14: set a monthly USD budget; a new job beyond it is refused", () => {
  test("queuing a job with a budget smaller than the cost of one chat call is refused with 402", async () => {
    const ownerAcct = await signup();
    const ws = await createWorkspace(ownerAcct.client);

    const doc = await addText(ownerAcct.client, ws.id, {
      title: "Budget probe",
      text: "Anything will do; the budget gate should fire before this content is consulted.",
    });
    expect(doc.status).toBe("ready");

    const budget = await ownerAcct.client.put(`/api/workspaces/${ws.id}/budget`, { monthlyUsd: 0 });
    expect(budget.status).toBe(200);
    expect(budget.body?.budgetUsd).toBe(0);

    const res = await ownerAcct.client.post(`/api/workspaces/${ws.id}/research-jobs`, {
      question: "Will the budget gate fire before any chat call?",
      documentIds: [doc.id],
    });
    expect(res.status).toBe(402);
    expect(res.body?.error?.code).toBe("budget_exceeded");
  });
});