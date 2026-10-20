import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sleep } from "../../lib/helpers";
import {
  PASSWORD, owner, addText, twoDocs, startJob, getJob, waitForJob, finishedJob,
  expectStatus, expectError, fakeModel, isolateFakeModel, TERMINAL, restartApp, callsByStage, usageRecords,
} from "../../lib/helpers";

// Clause: product.md §S2 (资料上传与解析; 后台研究任务; 取消; 重试; 并发; 重启恢复).
describe("holdout documents and jobs", () => {
  isolateFakeModel();

  it("rejects an unsupported upload media type with 415", async () => {
    // Clause: api.yaml /documents post (415 unsupported_media_type).
    const team = await owner();
    const res = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
      filename: "x.png", content: "abc", mimeType: "image/png",
    });
    expect(res.status).toBe(415);
  });

  it("a deleted document is unreachable and cannot start a job", async () => {
    // Clause: product.md §3 (删除后不再参与任何检索); api.yaml document delete.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, { title: "Solar", text: "hello" });
    expect((await team.client.del(`/api/workspaces/${team.ws.id}/documents/${doc.id}`)).status).toBe(204);
    expect((await team.client.get(`/api/workspaces/${team.ws.id}/documents/${doc.id}`)).status).toBe(404);
    const res = await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs`, {
      question: "q", documentIds: [doc.id],
    });
    expect(res.status).toBe(404);
  });

  it("cancel stops further model calls", async () => {
    // Clause: product.md §6 (取消不彻底); architecture.md §4.2 cancel.
    await fakeModel.set({ latencyMs: 500 });
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await startJob(team.client, team.ws.id, docs.map((d) => d.id));
    await sleep(50);
    const cancel = await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs/${job.id}/cancel`);
    expect(cancel.status).toBe(202);
    const final = await waitForJob(team.client, team.ws.id, job.id);
    expect(final.status).toBe("canceled");
    const countNow = Object.values(await callsByStage(team.client, team.ws.id, job.id, "ok")).reduce((a: number, b: any) => a + b, 0);
    await sleep(1200);
    const countLater = Object.values(await callsByStage(team.client, team.ws.id, job.id, "ok")).reduce((a: number, b: any) => a + b, 0);
    expect(countLater).toBe(countNow);
  });

  it("a transient fault is retried and the job still succeeds", async () => {
    // Clause: architecture.md §4.2 (auto retry transient, max 3 attempts).
    await fakeModel.set({ latencyMs: 20, faults: [{ stage: "plan", mode: "transient", times: 1 }] });
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await startJob(team.client, team.ws.id, docs.map((d) => d.id));
    const final = await waitForJob(team.client, team.ws.id, job.id);
    expect(final.status).toBe("succeeded");
    const okCounts = await callsByStage(team.client, team.ws.id, job.id, "ok");
    const errCounts = await callsByStage(team.client, team.ws.id, job.id, "error");
    expect(okCounts.plan).toBe(1);
    expect(errCounts.plan ?? 0).toBe(1);
    const records = await usageRecords(team.client, team.ws.id, { jobId: job.id });
    expect(records.filter((r: any) => r.kind === "chat").length).toBe(6);
  });

  it("a permanent fault fails the job as model_error without retry", async () => {
    // Clause: architecture.md §4.2 (permanent is not retryable).
    await fakeModel.set({ faults: [{ stage: "plan", mode: "permanent" }] });
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await startJob(team.client, team.ws.id, docs.map((d) => d.id));
    const final = await waitForJob(team.client, team.ws.id, job.id);
    expect(final.status).toBe("failed");
    expect(final.error?.code).toBe("model_error");
    const records = await usageRecords(team.client, team.ws.id, { jobId: job.id });
    expect(records.filter((r: any) => r.kind === "chat" && r.stage === "plan" && r.status === "error").length).toBe(1);
    expect(records.filter((r: any) => r.kind === "chat").length).toBe(1);
  });

  it("manual retry resumes from the first unfinished stage without redoing plan", async () => {
    // Clause: architecture.md §4.2 (manual retry, step-level idempotency).
    await fakeModel.set({ faults: [{ stage: "analyze", mode: "permanent" }] });
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await startJob(team.client, team.ws.id, docs.map((d) => d.id));
    const failed = await waitForJob(team.client, team.ws.id, job.id);
    expect(failed.status).toBe("failed");
    await fakeModel.reset();
    const retry = await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs/${job.id}/retry`);
    expect(retry.status).toBe(202);
    const final = await waitForJob(team.client, team.ws.id, job.id);
    expect(final.status).toBe("succeeded");
    const okCounts = await callsByStage(team.client, team.ws.id, job.id, "ok");
    const errCounts = await callsByStage(team.client, team.ws.id, job.id, "error");
    expect(okCounts.plan).toBe(1);
    expect(okCounts.analyze).toBe(3);
    expect(errCounts.analyze ?? 0).toBe(1);
  });

  it("excess jobs stay queued while two run", async () => {
    // Clause: architecture.md §4.2 (concurrency WORKSPACE_MAX_CONCURRENT_JOBS default 2).
    await fakeModel.set({ latencyMs: 1000 });
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const ids = docs.map((d) => d.id);
    const jobs = [await startJob(team.client, team.ws.id, ids), await startJob(team.client, team.ws.id, ids), await startJob(team.client, team.ws.id, ids)];
    const seen = await (async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const statuses = await Promise.all(jobs.map((j) => getJob(team.client, team.ws.id, j.id)));
        if (statuses.filter((j) => j.status === "queued").length >= 1 && statuses.filter((j) => j.status === "running").length >= 1) return statuses;
        await sleep(100);
      }
      throw new Error("never saw a queued job");
    })();
    expect(seen.filter((j) => j.status === "queued").length).toBeGreaterThanOrEqual(1);
    await Promise.all(jobs.map((j) => waitForJob(team.client, team.ws.id, j.id, (jj) => TERMINAL.includes(jj.status), 60_000)));
  });

  it("a restarted app finishes a job that was running", async () => {
    // Clause: product.md §6 (重启丢任务); architecture.md §4.2 restart recovery.
    await fakeModel.set({ latencyMs: 500 });
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await startJob(team.client, team.ws.id, docs.map((d) => d.id));
    await sleep(100);
    await restartApp();
    const final = await waitForJob(team.client, team.ws.id, job.id, undefined, 60_000);
    expect(final.status).toBe("succeeded");
  });
});