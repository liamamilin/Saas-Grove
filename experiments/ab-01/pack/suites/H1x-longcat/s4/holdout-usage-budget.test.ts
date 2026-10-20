// Usage and budget accounting.
// Clause: testability.md §5 — a job with no faults is exactly 5 chat calls (plan 1, analyze 3,
// synthesize 1), each successful chat call costs FAKE_CHAT_CALL_COST_USD, failed calls are
// recorded with costUsd 0, and embeddings are free; api.yaml — usage/records and budget
// endpoints, POST research-jobs returns 402 budget_exceeded, and a failed/budget_exceeded job
// can be retried from its first unfinished stage.
import { describe, expect, it } from "vitest";
import {
  addText,
  CALL_COST,
  createWorkspace,
  EPS,
  expectError,
  expectStatus,
  fakeModel,
  finishedJob,
  owner,
  report,
  startJob,
  usageRecords,
  waitForJob,
} from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

describe("usage and budget accounting", () => {
  // testability.md §5: plan 1 + analyze 3 + synthesize 1 = 5 chat calls at FAKE_CHAT_CALL_COST_USD.
  it("a successful job is exactly 5 chat calls (plan 1, analyze 3, synthesize 1) and costs 5x the call price", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    const job = await finishedJob(a.client, a.ws.id, [doc.id]);

    const records = await usageRecords(a.client, a.ws.id, { jobId: job.id });
    const chat = records.filter((r) => r.kind === "chat");
    const byStage: Record<string, number> = {};
    for (const r of chat) {
      expect(r.jobId).toBe(job.id);
      expect(r.status).toBe("ok");
      byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
    }
    expect(byStage).toEqual({ plan: 1, analyze: 3, synthesize: 1 });

    const total = chat.reduce((s, r) => s + r.costUsd, 0);
    expect(Math.abs(total - 5 * CALL_COST)).toBeLessThan(EPS);

    const usage = await a.client.get(`/api/workspaces/${a.ws.id}/usage`);
    expectStatus(usage, 200);
    expect(Math.abs(usage.body.spentUsd - 5 * CALL_COST)).toBeLessThan(EPS);
  });

  // api.yaml: POST research-jobs is 402 budget_exceeded when the budget is already exhausted; null is unlimited.
  it("a zero budget rejects new jobs with 402 and null means unlimited", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    // Guard: before the budget is set, a job succeeds.
    await finishedJob(a.client, a.ws.id, [doc.id]);

    expectStatus(await a.client.put(`/api/workspaces/${a.ws.id}/budget`, { monthlyUsd: 0 }), 200);
    expectError(await startJob(a.client, a.ws.id, [doc.id]), 402, "budget_exceeded");

    expectStatus(await a.client.put(`/api/workspaces/${a.ws.id}/budget`, { monthlyUsd: null }), 200);
    expectStatus(await startJob(a.client, a.ws.id, [doc.id]), 202); // guard: unlimited again
  });

  // api.yaml JobStatus budget_exceeded; the job stops when the budget runs out and never overspends.
  it("a job that runs out of budget stops with budget_exceeded and never overspends", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    await finishedJob(a.client, a.ws.id, [doc.id]); // guard: jobs work by default

    // A fresh workspace with a tight budget.
    const ws2 = await createWorkspace(a.client);
    const doc2 = await addText(a.client, ws2.id, SOLAR);
    expectStatus(await a.client.put(`/api/workspaces/${ws2.id}/budget`, { monthlyUsd: CALL_COST }), 200);

    const job = await startJob(a.client, ws2.id, [doc2.id]);
    const done = await waitForJob(a.client, ws2.id, job.id);
    expect(done.status).toBe("budget_exceeded");

    const usage = await a.client.get(`/api/workspaces/${ws2.id}/usage`);
    expect(usage.body.spentUsd).toBeLessThanOrEqual(CALL_COST + EPS);
    const chat = (await usageRecords(a.client, ws2.id, { jobId: job.id })).filter(
      (r) => r.kind === "chat" && r.status === "ok",
    );
    expect(chat.length).toBeGreaterThanOrEqual(1);
  });

  // testability.md §5: each chat usage record carries stage chat and reportId for follow-up questions.
  it("a follow-up chat call is recorded with the report id and stage chat", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    const job = await finishedJob(a.client, a.ws.id, [doc.id]);
    const rep = await report(a.client, a.ws.id, job.reportId);

    const sse = await a.client.sse(`/api/workspaces/${a.ws.id}/reports/${rep.id}/messages`, {
      content: "And the limits?",
    });
    expect(sse.status).toBe(200);
    expect(sse.events.some((e) => e.event === "done")).toBe(true); // guard

    const records = await usageRecords(a.client, a.ws.id, { reportId: rep.id });
    const chat = records.filter((r) => r.kind === "chat");
    expect(chat.length).toBe(1);
    expect(chat[0].stage).toBe("chat");
    expect(chat[0].status).toBe("ok");
    expect(chat[0].costUsd).toBeGreaterThan(0);
  });

  // testability.md §5: failed calls are status error with costUsd 0; api.yaml retry resumes the first unfinished stage.
  it("a failed model call costs 0, and retry resumes the first unfinished stage", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    await fakeModel.set({ faults: [{ stage: "synthesize", mode: "permanent" }] });

    const job = await startJob(a.client, a.ws.id, [doc.id]);
    const failed = await waitForJob(a.client, a.ws.id, job.id);
    expect(failed.status).toBe("failed");

    const records = await usageRecords(a.client, a.ws.id, { jobId: job.id });
    const errors = records.filter((r) => r.kind === "chat" && r.status === "error");
    expect(errors.some((r) => r.stage === "synthesize")).toBe(true);
    expect(errors.every((r) => r.costUsd === 0)).toBe(true);
    const ok = records.filter((r) => r.kind === "chat" && r.status === "ok");
    expect(ok.length).toBe(4); // plan + 3 analyze

    await fakeModel.reset();
    expectStatus(await a.client.post(`/api/workspaces/${a.ws.id}/research-jobs/${job.id}/retry`), 202);
    const done = await waitForJob(a.client, a.ws.id, job.id);
    expect(done.status).toBe("succeeded");
    const after = await usageRecords(a.client, a.ws.id, { jobId: job.id });
    const synth = after.filter((r) => r.kind === "chat" && r.status === "ok" && r.stage === "synthesize");
    expect(synth.length).toBe(1);
  });
});
