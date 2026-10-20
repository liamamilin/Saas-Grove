import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { expectError, expectStatus, owner, twoDocs, finishedJob, CALL_COST, isolateFakeModel } from "../../lib/helpers";

// Contract: api.yaml research-jobs cancel/retry; testability.md §5 (abort).

describe("holdout concurrency", () => {
  isolateFakeModel();

  it("cancel during high latency yields canceled and no in-flight usage record (§5)", async () => {
    const t = await owner();
    const helpers = await import("../../lib/helpers");
    await helpers.fakeModel.set({ latencyMs: 500 });
    const docs = await twoDocs(t.client, t.ws.id);
    const ids = docs.map((d) => d.id);
    const res = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "q", documentIds: ids });
    expectStatus(res, 202);
    const jobId = res.body.job.id;
    const running = await helpers.waitForJob(t.client, t.ws.id, jobId, (j: any) => j.status === "running" || (j.stages ?? []).some((s: any) => s.status === "running"), 30_000);
    expect(running).toBeTruthy();
    const cr = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs/${jobId}/cancel`);
    expectStatus(cr, 202);
    const final = await helpers.waitForJob(t.client, t.ws.id, jobId, (j: any) => ["canceled", "succeeded", "failed", "budget_exceeded"].includes(j.status), 30_000);
    expect(final.status).toBe("canceled");
    await helpers.sleep(700);
    const recs = await helpers.usageRecords(t.client, t.ws.id, { jobId });
    // no record for a canceled in-flight call: total < 5
    expect(recs.length).toBeLessThan(5);
    await helpers.fakeModel.reset();
  });

  it("restarting app keeps data (restart recovery) (S1, S4)", async () => {
    const t = await owner();
    // create doc
    const r = await t.client.post(`/api/workspaces/${t.ws.id}/documents`, { title: "persist", text: "hello" });
    expectStatus(r, 201);
    const docId = r.body.document.id;
    const { restartApp } = await import("../../lib/helpers");
    await restartApp();
    // after restart, document still there
    const g = await t.client.get(`/api/workspaces/${t.ws.id}/documents/${docId}`);
    expectStatus(g, 200);
  });
});