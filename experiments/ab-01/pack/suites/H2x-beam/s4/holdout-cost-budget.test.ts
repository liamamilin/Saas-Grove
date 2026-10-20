import { describe, expect, it } from "vitest";
import {
  owner, addMember, addText, twoDocs, startJob, waitForJob, finishedJob, report,
  expectStatus, expectError, fakeModel, isolateFakeModel, TERMINAL, usageRecords,
} from "../../lib/helpers";

// Clause: product.md §S3 (用量费用与汇总; 预算设置与执行); architecture.md §4.3.
describe("holdout cost and budget", () => {
  isolateFakeModel();

  it("usage spent matches the sum of successful record costs", async () => {
    // Clause: product.md §3 (Usage Record); api.yaml /usage.
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));
    const records = await usageRecords(team.client, team.ws.id, { jobId: job.id });
    const expected = records.filter((r: any) => r.status === "ok").reduce((s: number, r: any) => s + r.costUsd, 0);
    const usage = await team.client.get(`/api/workspaces/${team.ws.id}/usage`);
    expectStatus(usage, 200);
    expect(Math.abs(usage.body.spentUsd - expected)).toBeLessThan(1e-9);
  });

  it("admin sets the budget and it is reflected in usage", async () => {
    // Clause: product.md §3 (Budget); api.yaml /budget.
    const team = await owner();
    const admin = await addMember(team, "admin");
    const member = await addMember(team, "member");
    expectStatus(await admin.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 0.05 }), 200);
    const usage = await team.client.get(`/api/workspaces/${team.ws.id}/usage`);
    expect(usage.body.budgetUsd).toBe(0.05);
    expect((await member.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 1 })).status).toBe(403);
  });

  it("a new job is rejected when the budget is already exhausted", async () => {
    // Clause: product.md §S3 (超预算拒绝新任务); api.yaml 402 budget_exceeded.
    const team = await owner();
    await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 0 });
    const docs = await twoDocs(team.client, team.ws.id);
    const res = await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs`, {
      question: "q", documentIds: docs.map((d) => d.id),
    });
    expectError(res, 402, "budget_exceeded");
  });

  it("a running job stops before exceeding the budget", async () => {
    // Clause: product.md §6 (预算形同虚设); architecture.md §4.3.
    await fakeModel.set({ latencyMs: 20 });
    const team = await owner();
    await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 0.015 });
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await startJob(team.client, team.ws.id, docs.map((d) => d.id));
    const final = await waitForJob(team.client, team.ws.id, job.id);
    expect(final.status).toBe("budget_exceeded");
    const records = await usageRecords(team.client, team.ws.id, { jobId: job.id });
    expect(records.filter((r: any) => r.kind === "chat" && r.status === "ok").length).toBe(1);
  });

  it("a chat usage record carries stage chat and the report id", async () => {
    // Clause: architecture.md §5 (每条 chat 用量记录带 stage 与 reportId).
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));
    const rep = await report(team.client, team.ws.id, job.reportId);
    const sse = await team.client.sse(`/api/workspaces/${team.ws.id}/reports/${rep.id}/messages`, { content: "Follow up?" });
    expect(sse.status).toBe(200);
    const records = await usageRecords(team.client, team.ws.id, { reportId: rep.id });
    expect(records.length).toBeGreaterThanOrEqual(1);
    const chatRecord = records.find((r: any) => r.kind === "chat");
    expect(chatRecord).toBeTruthy();
    expect(chatRecord.stage).toBe("chat");
    expect(chatRecord.reportId).toBe(rep.id);
  });
});