// Held-out acceptance test: cancelling a running research job really stops it.
//
// Clauses under test:
//   * spec/architecture.md §4.2 取消 — "先把状态改为 canceled；worker 每次调用模型之前都要检查状态…
//     取消生效后，不能再产生新的用量记录".
//   * spec/product.md §6 — "取消不彻底：点了取消，后台还在继续调用模型、继续扣钱".
//   * spec/product.md §4.4 — 可以取消 (a cancelled job produces no report).

import { describe, expect, test } from "vitest";
import {
  addText,
  fakeModel,
  isolateFakeModel,
  owner,
  sleep,
  startJob,
  usageRecords,
  waitFor,
  waitForJob,
} from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

describe("cancelling a research job", () => {
  isolateFakeModel();

  test("cancelling a running job stops the model calls, the spending and the report", async () => {
    // architecture.md §4.2 + product.md §6 (取消不彻底). The fake model waits latencyMs before every
    // call (contract testability.md §5), so a cancel that does not abort the work keeps spending.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    await fakeModel.set({ latencyMs: 1500 });

    const job = await startJob(team.client, team.ws.id, [doc.id]);
    await waitForJob(team.client, team.ws.id, job.id, (j) => j.status === "running", 30_000);

    const cancelled = await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs/${job.id}/cancel`);
    expect(cancelled.status, cancelled.text).toBe(202);

    const atCancel = ((await usageRecords(team.client, team.ws.id, { jobId: job.id })) ?? []).length;
    const spentAtCancel = (await team.client.get(`/api/workspaces/${team.ws.id}/usage`)).body?.spentUsd;

    const done = await waitForJob(team.client, team.ws.id, job.id, (j) => j.status === "canceled", 30_000);
    expect(done.status).toBe("canceled");

    // Nothing may be recorded or charged afterwards. Wait for the ledger to be still for longer than
    // one fake-model call (1.5 s) instead of trusting a single reading.
    await waitFor(
      async () => {
        await sleep(4000);
        const now = (await usageRecords(team.client, team.ws.id, { jobId: job.id })) ?? [];
        return now.length === atCancel ? true : undefined;
      },
      { timeout: 30_000, interval: 500, what: "the cancelled job's usage records to stop growing" },
    );
    const settled = (await usageRecords(team.client, team.ws.id, { jobId: job.id })) ?? [];
    expect(settled.length).toBe(atCancel);

    const usageNow = (await team.client.get(`/api/workspaces/${team.ws.id}/usage`)).body;
    expect(usageNow?.spentUsd).toBeCloseTo(spentAtCancel, 9);

    // A cancelled job has no report (product.md §4.4: 取消 vs 报告).
    expect(done.reportId ?? null).toBeNull();
    const reports = await team.client.get(`/api/workspaces/${team.ws.id}/reports`);
    expect(reports.status, reports.text).toBe(200);
    expect(((reports.body?.reports ?? []) as any[]).filter((r) => r.jobId === job.id).length).toBe(0);
  });
});
