import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { expectError, expectStatus, owner, finishedJob, twoDocs, CALL_COST, EPS, isolateFakeModel } from "../../lib/helpers";

// Contract: api.yaml reports/{id}/messages, reports/{id}/download; testability.md §5 (chat streaming).

describe("holdout chat", () => {
  isolateFakeModel();

  async function jobWithReport(t: any) {
    const docs = await twoDocs(t.client, t.ws.id);
    const ids = docs.map((d: any) => d.id);
    const job = await finishedJob(t.client, t.ws.id, ids);
    return { docs, job };
  }

  it("chat streams at least two deltas; done content equals concatenation; assistant message saved (S4, §5)", async () => {
    const t = await owner();
    const { job } = await jobWithReport(t);
    const reportId = job.reportId;
    const res = await t.client.sse(`/api/workspaces/${t.ws.id}/reports/${reportId}/messages`, { content: "Follow up question?" });
    expect(res.status).toBe(200);
    const deltas = res.events.filter((e) => e.event === "delta");
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    const concat = deltas.map((d) => d.data?.text ?? "").join("");
    const done = res.events.find((e) => e.event === "done");
    expect(done).toBeTruthy();
    expect((done as any).data?.message?.content).toBe(concat);
    expect((done as any).data?.message?.role).toBe("assistant");
    // persisted
    const msgs = await t.client.get(`/api/workspaces/${t.ws.id}/reports/${reportId}/messages`);
    expectStatus(msgs, 200);
    const messages = msgs.body.messages as any[];
    expect(messages.some((m) => m.role === "user")).toBe(true);
    expect(messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("chat usage record: kind chat, stage chat, reportId set, cost (S2, §5)", async () => {
    const t = await owner();
    const { job } = await jobWithReport(t);
    const reportId = job.reportId;
    await t.client.sse(`/api/workspaces/${t.ws.id}/reports/${reportId}/messages`, { content: "q" });
    const records = await (await import("../../lib/helpers")).usageRecords(t.client, t.ws.id, { reportId });
    const chatRecs = records.filter((r: any) => r.kind === "chat");
    expect(chatRecs.length).toBeGreaterThanOrEqual(1);
    const last = chatRecs[chatRecs.length - 1];
    expect(last.stage).toBe("chat");
    expect(last.reportId).toBe(reportId);
    expect(last.status).toBe("ok");
    expect(last.costUsd).toBeCloseTo(CALL_COST, 6);
  });

  it("budget exhausted returns plain 402 JSON instead of stream (S3, §5)", async () => {
    const t = await owner();
    const { job } = await jobWithReport(t);
    const reportId = job.reportId;
    await t.client.put(`/api/workspaces/${t.ws.id}/budget`, { monthlyUsd: 0 });
    const res = await t.client.sse(`/api/workspaces/${t.ws.id}/reports/${reportId}/messages`, { content: "q" });
    expect(res.status).toBe(402);
    expect(res.body?.error?.code).toBe("budget_exceeded");
    expect(res.events.length).toBe(0);
  });

  it("report download is markdown attachment (S3)", async () => {
    const t = await owner();
    const { job } = await jobWithReport(t);
    const reportId = job.reportId;
    const rep = await (await import("../../lib/helpers")).report(t.client, t.ws.id, reportId);
    const res = await t.client.get(`/api/workspaces/${t.ws.id}/reports/${reportId}/download?format=markdown`);
    expect(res.status).toBe(200);
    expect((res.headers.get("content-type") ?? "").toLowerCase()).toContain("text/markdown");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd.toLowerCase()).toContain("attachment");
    expect(cd).toMatch(/\.md"/);
    expect(res.text).toBe(rep.markdown);
  });

  it("chat message validation (S4)", async () => {
    const { owner, finishedJob, twoDocs } = await import("../../lib/helpers");
    const t = await owner();
    const docs = await twoDocs(t.client, t.ws.id);
    const ids = docs.map((d: any) => d.id);
    const job = await finishedJob(t.client, t.ws.id, ids);
    const reportId = job.reportId;
    const { expectError } = await import("../../lib/helpers");
    expectError(await t.client.post(`/api/workspaces/${t.ws.id}/reports/${reportId}/messages`, { content: "" }), 400, "validation_error");
    expectError(await t.client.post(`/api/workspaces/${t.ws.id}/reports/${reportId}/messages`, { content: "a".repeat(4001) }), 400, "validation_error");
  });

});