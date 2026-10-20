// Streaming chat follow-ups (S4).
//
// Spec clauses verified here:
//   spec/product.md  §3 (Message 追问: 只能引用该报告用到的资料)
//   spec/product.md  §6 (取消不彻底: 点了取消，后台还在继续调用模型、继续扣钱)
//   spec/architecture.md §5 (每条消息 1 次聊天调用, 记一条 kind=chat 用量记录;
//                            正在等待的调用必须能被中止，不产生任何用量记录)
//
// We deliberately do NOT re-test the SSE shape (event names, ordering, content
// equality): that is fixed by the API contract.

import { describe, expect, test } from "vitest";
import {
  CALL_COST,
  createWorkspace,
  fakeModel,
  finishedJob,
  isolateFakeModel,
  signup,
  sleep,
  twoDocs,
  usageRecords,
} from "../../lib/helpers";

describe("s4: streaming chat follow-ups", () => {
  isolateFakeModel();

  test("a chat question produces exactly one ok chat usage record tied to the report, with the fake-model cost", async () => {
    // spec/architecture.md §5 ("每条 kind:'chat' 的用量记录都必须带 stage ... 还有 ... reportId")
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const [doc] = await twoDocs(owner.client, ws.id);
    const job = await finishedJob(owner.client, ws.id, [doc.id]);
    const rep = await owner.client.get(`/api/workspaces/${ws.id}/reports/${job.reportId}`);
    const reportId = rep.body.report.id;

    const sse = await owner.client.sse(`/api/workspaces/${ws.id}/reports/${reportId}/messages`, {
      content: "Anything about moisture?",
    });
    expect(sse.status).toBe(200);
    expect(sse.events.find((e) => e.event === "done")).toBeDefined();

    const records = await usageRecords(owner.client, ws.id, { reportId });
    const chatOk = records.filter((r) => r.kind === "chat" && r.status === "ok" && r.stage === "chat");
    expect(chatOk.length, `chat ok records: ${JSON.stringify(records)}`).toBe(1);
    expect(chatOk[0].costUsd).toBeCloseTo(CALL_COST, 6);
    expect(chatOk[0].jobId).toBeNull();
    expect(chatOk[0].reportId).toBe(reportId);
  });

  test("a chat citation never references a document the report did not use", async () => {
    // spec/product.md §3 (Message 追问: 只能引用该报告用到的资料)
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const [used, unused] = await twoDocs(owner.client, ws.id);
    const job = await finishedJob(owner.client, ws.id, [used.id]);
    const rep = await owner.client.get(`/api/workspaces/${ws.id}/reports/${job.reportId}`);
    const report = rep.body.report;

    const usedDocIds = new Set<string>(report.citations.map((c: any) => c.documentId));
    expect(usedDocIds.has(used.id)).toBe(true);
    expect(usedDocIds.has(unused.id)).toBe(false);

    const sse = await owner.client.sse(`/api/workspaces/${ws.id}/reports/${report.id}/messages`, {
      content: "Tell me more about stability.",
    });
    expect(sse.status).toBe(200);
    const done = sse.events.find((e) => e.event === "done");
    expect(done).toBeDefined();
    const assistantMessage = done!.data.message;
    const citations = assistantMessage.citations as any[];
    expect(citations.length).toBeGreaterThanOrEqual(1);
    for (const c of citations) {
      expect(usedDocIds.has(c.documentId), `chat cites doc ${c.documentId} not used by report`).toBe(true);
    }
  });

  test("disconnecting the chat client mid-stream produces no chat usage record (latency wait is abortable)", async () => {
    // spec/architecture.md §5 ("正在等待的调用立即结束，并且不产生任何用量记录")
    // spec/product.md §6 (取消不彻底: 点了取消，后台还在继续调用模型、继续扣钱)
    //
    // Open an SSE request with a long latency so the server is still waiting on
    // the fake model when we abort the underlying fetch.
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const [doc] = await twoDocs(owner.client, ws.id);
    const job = await finishedJob(owner.client, ws.id, [doc.id]);
    const reportId = job.reportId!;

    await fakeModel.set({ latencyMs: 1500 });
    try {
      const cookies = owner.client.snapshot();
      const cookieHeader = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      const ctrl = new AbortController();
      const base = owner.client.base;
      const promise = fetch(`${base}/api/workspaces/${ws.id}/reports/${reportId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", cookie: cookieHeader },
        body: JSON.stringify({ content: "Quick question that will be aborted." }),
        signal: ctrl.signal,
      }).catch(() => undefined);
      // Give the server a moment to enter the fake-model wait.
      await sleep(150);
      ctrl.abort();
      await promise;
    } finally {
      await fakeModel.set({ latencyMs: 20 });
    }

    // Give the server a moment to settle, then assert no chat record.
    await sleep(400);
    const records = await usageRecords(owner.client, ws.id, { reportId });
    const chatAny = records.filter((r) => r.kind === "chat" && r.stage === "chat");
    expect(chatAny.length, `chat records after abort: ${JSON.stringify(chatAny)}`).toBe(0);
  });
});