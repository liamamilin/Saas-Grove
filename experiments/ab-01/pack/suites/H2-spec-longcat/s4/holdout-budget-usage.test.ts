// Held-out acceptance tests: budget enforcement and the usage ledger.
//
// Clauses under test:
//   * spec/architecture.md §4.3 — "每次调用模型前先预留…如果'已花 + 已预留 + 本次预估'超过预算，就不调用，
//     任务进入 budget_exceeded"; 不变式: "工作区当月已花费不超过预算"; "预算为 null 表示不限".
//   * spec/decisions.md T10 — 新工作区的默认预算：不限（null）.
//   * spec/product.md S3 — "用量的费用和汇总；预算设置与执行（超预算拒绝新任务、运行中的任务在超预算前停下）".
//   * spec/product.md §3 — Budget "每个工作区按自然月设置美元上限"; 每次模型调用记一条用量记录（阶段、模型、token、费用、成败）.
//   * spec/product.md §4.6 — 追问"计入预算".

import { describe, expect, test } from "vitest";
import {
  CALL_COST,
  EPS,
  addText,
  finishedJob,
  owner,
  report as getReport,
  startJob,
  usageRecords,
  waitForJob,
} from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

async function usageOf(client: any, wsId: string) {
  const res = await client.get(`/api/workspaces/${wsId}/usage`);
  expect(res.status, res.text).toBe(200);
  return res.body as { periodStart: string; periodEnd: string; spentUsd: number; budgetUsd: number | null };
}

describe("budget and usage", () => {
  test("a new workspace has no budget and has spent nothing", async () => {
    // decisions.md T10: 新工作区的默认预算不限（null）; architecture.md §4.3: null 表示不限.
    const team = await owner();
    const usage = await usageOf(team.client, team.ws.id);
    expect(usage.budgetUsd).toBeNull();
    expect(usage.spentUsd).toBe(0);
  });

  test("a budget stops a running job before it overspends", async () => {
    // architecture.md §4.3 不变式 + product.md S3: 运行中的任务在超预算前停下.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    const budget = 2 * CALL_COST;
    const set = await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: budget });
    expect(set.status, set.text).toBe(200);

    const job = await startJob(team.client, team.ws.id, [doc.id]);
    const done = await waitForJob(team.client, team.ws.id, job.id);
    expect(done.status, JSON.stringify(done.error)).toBe("budget_exceeded");

    const usage = await usageOf(team.client, team.ws.id);
    expect(usage.budgetUsd).toBeCloseTo(budget, 9);
    expect(usage.spentUsd).toBeLessThanOrEqual(budget + EPS);

    const records = (await usageRecords(team.client, team.ws.id, { jobId: job.id })) ?? [];
    const total = records.reduce((sum: number, r: any) => sum + (r.costUsd ?? 0), 0);
    expect(total).toBeLessThanOrEqual(budget + EPS);

    // a job stopped by the budget has no report
    expect(done.reportId ?? null).toBeNull();
  });

  test("the usage summary equals the sum of the usage records", async () => {
    // product.md S3: 用量的费用和汇总; §3: 每次模型调用记一条用量记录（阶段、模型、token、费用、成败）.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    const job = await finishedJob(team.client, team.ws.id, [doc.id]);

    const usage = await usageOf(team.client, team.ws.id);
    const records = (await usageRecords(team.client, team.ws.id)) ?? [];
    expect(records.length).toBeGreaterThan(0);

    const sum = records.reduce((acc: number, r: any) => acc + (r.costUsd ?? 0), 0);
    expect(usage.spentUsd).toBeCloseTo(sum, 9);
    expect(usage.spentUsd).toBeGreaterThan(0);

    // one successful job makes five chat calls, each of which names the model it used
    const chat = records.filter((r: any) => r.kind === "chat" && r.status === "ok" && r.jobId === job.id);
    expect(chat.length).toBe(5);
    for (const r of chat) expect(r.model, JSON.stringify(r)).toBeTruthy();
  });

  test("a follow-up question is charged to the workspace", async () => {
    // product.md §4.6: 追问…计入预算; §3: 每次模型调用记一条用量记录.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    const job = await finishedJob(team.client, team.ws.id, [doc.id]);
    const rep = await getReport(team.client, team.ws.id, job.reportId);

    const before = (await usageOf(team.client, team.ws.id)).spentUsd;
    const sse = await team.client.sse(`/api/workspaces/${team.ws.id}/reports/${rep.id}/messages`, {
      content: "Which limits do these documents mention?",
    });
    expect(sse.status, sse.body ? JSON.stringify(sse.body) : "no body").toBe(200);
    expect(sse.events.some((e) => e.event === "done")).toBe(true);

    const after = (await usageOf(team.client, team.ws.id)).spentUsd;
    expect(after - before).toBeCloseTo(CALL_COST, 9);
  });

  test("the usage period is the calendar month that contains now", async () => {
    // product.md §3: Budget 每个工作区按自然月设置美元上限; api.yaml exposes periodStart/periodEnd.
    const team = await owner();
    const usage = await usageOf(team.client, team.ws.id);
    const start = Date.parse(usage.periodStart);
    const end = Date.parse(usage.periodEnd);
    expect(Number.isFinite(start), `periodStart=${usage.periodStart}`).toBe(true);
    expect(Number.isFinite(end), `periodEnd=${usage.periodEnd}`).toBe(true);
    expect(start).toBeLessThanOrEqual(Date.now());
    expect(end).toBeGreaterThan(Date.now());
    const days = (end - start) / 86_400_000;
    expect(days, `periodStart=${usage.periodStart} periodEnd=${usage.periodEnd}`).toBeGreaterThan(27);
    expect(days, `periodStart=${usage.periodStart} periodEnd=${usage.periodEnd}`).toBeLessThan(32);
  });
});
