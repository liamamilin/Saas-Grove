// Concurrency, cancellation and restart.
// Clause: api.yaml — cancel returns 202 and "No model call starts after this returns"; canceling
// a finished job is 409 invalid_state; a failed/budget_exceeded job can be retried. testability.md
// §7 — a restart keeps the database, so state and sessions survive.
import { describe, expect, it } from "vitest";
import {
  addText,
  CALL_COST,
  EPS,
  expectError,
  expectStatus,
  fakeModel,
  finishedJob,
  owner,
  restartApp,
  sleep,
  startJob,
  usageRecords,
  waitForJob,
} from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

describe("concurrency, cancellation and restart", () => {
  // api.yaml cancel: "No model call starts after this returns"; an aborted call records no usage.
  it("cancelling a running job stops further model calls", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    await fakeModel.set({ latencyMs: 300 });

    const job = await startJob(a.client, a.ws.id, [doc.id]);
    await waitForJob(a.client, a.ws.id, job.id, (j) => j.status === "running" || Boolean(j.startedAt), 30_000);

    expectStatus(await a.client.post(`/api/workspaces/${a.ws.id}/research-jobs/${job.id}/cancel`), 202);
    await waitForJob(a.client, a.ws.id, job.id, (j) => j.status === "canceled", 15_000);

    const before = (await usageRecords(a.client, a.ws.id, { jobId: job.id })).length;
    await sleep(1200);
    const after = (await usageRecords(a.client, a.ws.id, { jobId: job.id })).length;
    expect(after).toBe(before);
  });

  // api.yaml cancel: an already finished job is 409 invalid_state.
  it("cancelling a finished job is invalid_state", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    const job = await finishedJob(a.client, a.ws.id, [doc.id]); // guard: the job succeeded
    expectError(
      await a.client.post(`/api/workspaces/${a.ws.id}/research-jobs/${job.id}/cancel`),
      409,
      "invalid_state",
    );
  });

  // api.yaml research-jobs: concurrent jobs are independent and their usage is accounted per job.
  it("two concurrent jobs both succeed and their usage adds up", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    const [j1, j2] = await Promise.all([
      startJob(a.client, a.ws.id, [doc.id], "first question"),
      startJob(a.client, a.ws.id, [doc.id], "second question"),
    ]);
    const [d1, d2] = await Promise.all([
      waitForJob(a.client, a.ws.id, j1.id),
      waitForJob(a.client, a.ws.id, j2.id),
    ]);
    expect(d1.status).toBe("succeeded");
    expect(d2.status).toBe("succeeded");

    const all = await usageRecords(a.client, a.ws.id);
    const chat = all.filter((r) => r.kind === "chat" && r.status === "ok");
    expect(chat.length).toBe(10);
    const spent = chat.reduce((s, r) => s + r.costUsd, 0);
    expect(Math.abs(spent - 10 * CALL_COST)).toBeLessThan(EPS);
  });

  // testability.md §7: a restart keeps the database, so state and sessions survive.
  it("state survives a restart with the database kept", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    const job = await finishedJob(a.client, a.ws.id, [doc.id]);
    const before = await a.client.get(`/api/workspaces/${a.ws.id}/reports/${job.reportId}`);
    expectStatus(before, 200);

    await restartApp();

    const after = await a.client.get(`/api/workspaces/${a.ws.id}/reports/${job.reportId}`);
    expectStatus(after, 200);
    expect(after.body.report.markdown).toBe(before.body.report.markdown);
    expectStatus(await a.client.get("/api/me"), 200);
    expectStatus(await a.client.get(`/api/workspaces/${a.ws.id}/usage`), 200);
  });
});
