import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { expectError, expectStatus, owner, twoDocs, finishedJob, CALL_COST, EPS, isolateFakeModel } from "../../lib/helpers";

// Contract: api.yaml usage, usage/records, budget; testability.md §5 (costs).

describe("holdout usage budget", () => {
  isolateFakeModel();

  it("usage spent increases by 5*cost after a job; records filter by jobId (S2, S3)", async () => {
    const t = await owner();
    const docs = await twoDocs(t.client, t.ws.id);
    const ids = docs.map((d) => d.id);
    const before = await t.client.get(`/api/workspaces/${t.ws.id}/usage`);
    expectStatus(before, 200);
    const spentBefore = before.body.spentUsd as number;
    const job = await finishedJob(t.client, t.ws.id, ids);
    const after = await t.client.get(`/api/workspaces/${t.ws.id}/usage`);
    expectStatus(after, 200);
    expect(after.body.spentUsd).toBeCloseTo(spentBefore + 5 * CALL_COST, 6);
    expect(after.body.periodStart).toBeTruthy();
    expect(after.body.periodEnd).toBeTruthy();
    const recs = await (await import("../../lib/helpers")).usageRecords(t.client, t.ws.id, { jobId: job.id });
    expect(recs.length).toBe(5);
  });

  it("failed model call recorded status error cost 0 (§5)", async () => {
    const t = await owner();
    const helpers = await import("../../lib/helpers");
    await helpers.fakeModel.set({ faults: [{ stage: "plan", mode: "permanent" }] });
    const docs = await twoDocs(t.client, t.ws.id);
    const ids = docs.map((d) => d.id);
    const res = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "q", documentIds: ids });
    expectStatus(res, 202);
    const job = await (await import("../../lib/helpers")).waitForJob(t.client, t.ws.id, res.body.job.id, (j: any) => ["failed", "succeeded", "budget_exceeded", "canceled"].includes(j.status));
    expect(job.status).toBe("failed");
    const recs = await helpers.usageRecords(t.client, t.ws.id, { jobId: job.id });
    const errRecs = recs.filter((r: any) => r.status === "error");
    expect(errRecs.length).toBeGreaterThanOrEqual(1);
    for (const r of errRecs) expect(r.costUsd).toBe(0);
    await helpers.fakeModel.reset();
  });

  it("budget update affects usage.budgetUsd (S3)", async () => {
    const t = await owner();
    expectStatus(await t.client.put(`/api/workspaces/${t.ws.id}/budget`, { monthlyUsd: 42.5 }), 200);
    const u = await t.client.get(`/api/workspaces/${t.ws.id}/usage`);
    expectStatus(u, 200);
    expect(u.body.budgetUsd).toBe(42.5);
  });

});