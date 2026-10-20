// Held-out acceptance tests: per-workspace job concurrency, and surviving a restart.
//
// Clauses under test:
//   * spec/architecture.md §4.2 并发 — "同一工作区最多同时运行 WORKSPACE_MAX_CONCURRENT_JOBS 个任务
//     （默认 2），多出来的保持 queued"; spec/decisions.md T9 — 默认 2.
//   * spec/architecture.md §4.2 重启恢复 — "进程重启后，running 状态的任务要能继续，并最终进入终态";
//     spec/product.md §6 — "重启丢任务：服务重启后，任务永远停在 running".

import { describe, expect, test } from "vitest";
import {
  TERMINAL,
  addText,
  expectStatus,
  fakeModel,
  getJob,
  isolateFakeModel,
  owner,
  restartApp,
  sleep,
  startJob,
  waitForJob,
} from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

describe("scheduling", () => {
  isolateFakeModel();

  test("a workspace runs at most two jobs at once and keeps the rest queued", async () => {
    // architecture.md §4.2 并发 + decisions.md T9: 默认 2，多出来的保持 queued.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    await fakeModel.set({ latencyMs: 800 });

    const jobs: any[] = [];
    for (let i = 0; i < 3; i += 1) {
      jobs.push(await startJob(team.client, team.ws.id, [doc.id], `Question number ${i}?`));
    }

    let maxRunning = 0;
    let sawQueued = false;
    let last: string[] = [];
    const deadline = Date.now() + 90_000;
    for (;;) {
      last = [];
      for (const job of jobs) last.push((await getJob(team.client, team.ws.id, job.id)).status);
      maxRunning = Math.max(maxRunning, last.filter((s) => s === "running").length);
      if (last.includes("queued")) sawQueued = true;
      if (last.every((s) => TERMINAL.includes(s))) break;
      if (Date.now() > deadline) throw new Error(`jobs never finished: ${JSON.stringify(last)}`);
      await sleep(100);
    }

    expect(maxRunning, `statuses at the end: ${JSON.stringify(last)}`).toBeLessThanOrEqual(2);
    expect(maxRunning, "no two jobs were ever running at the same time").toBe(2);
    expect(sawQueued, "the third job was never left waiting in the queue").toBe(true);

    for (const job of jobs) {
      const final = await getJob(team.client, team.ws.id, job.id);
      expect(final.status, JSON.stringify(final.error)).toBe("succeeded");
    }
  });

  test("a job interrupted by a restart still reaches a terminal state", async () => {
    // architecture.md §4.2 重启恢复; product.md §6: 重启丢任务.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    await fakeModel.set({ latencyMs: 700 });

    const job = await startJob(team.client, team.ws.id, [doc.id]);
    await waitForJob(team.client, team.ws.id, job.id, (j) => j.status === "running", 30_000);

    await restartApp();

    const done = await waitForJob(team.client, team.ws.id, job.id, (j) => TERMINAL.includes(j.status), 120_000);
    expect(done.status, JSON.stringify(done.error)).toBe("succeeded");
    expect(done.reportId).toBeTruthy();

    const rep = await team.client.get(`/api/workspaces/${team.ws.id}/reports/${done.reportId}`);
    expectStatus(rep, 200);
    expect(rep.body?.report?.jobId).toBe(job.id);
  });
});
