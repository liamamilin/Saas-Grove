// Held-out acceptance tests: retry backoff observable via usage record timestamps.
// Derived from spec/architecture.md §4.2.

import { describe, expect, it } from "vitest";
import { BASE_URL, Client } from "../../lib/client";
import { expectStatus, fakeModel, isolateFakeModel, knowledgeBase, owner, usageRecords } from "../../lib/helpers";
import { Q_REFUND } from "../../lib/corpus";

describe("retry backoff", () => {
  isolateFakeModel();

  // architecture.md §4.2: a transient error is retried at most 3 times, with >=200ms then >=400ms backoff.
  it("retry attempts are spaced by at least 200ms then 400ms", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    await fakeModel.set({ latencyMs: 0, faults: [{ stage: "answer", mode: "transient", times: 2 }] });
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    const sse = await new Client().sse(`/api/widget/${key}/conversations/${conv.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${conv.body.visitorToken}` });
    const done = sse.events.find((e) => e.event === "done");
    expect(done).toBeTruthy();
    expect(done!.data.message.outcome).toBe("answered");

    const records = await usageRecords(t.client, t.ws.id, { conversationId: conv.body.conversation.id });
    const attempts = records.filter((r: any) => r.kind === "chat").sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    expect(attempts.length).toBe(3);
    const gaps = [attempts[1].createdAt, attempts[2].createdAt].map((c, i) => new Date(c).getTime() - new Date(attempts[i].createdAt).getTime());
    expect(gaps[0]).toBeGreaterThanOrEqual(200 - 50);
    expect(gaps[1]).toBeGreaterThanOrEqual(400 - 50);
  });

  // architecture.md §4.2: a non-retryable error is attempted only once.
  it("a permanent fault leaves exactly one usage record", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    await fakeModel.set({ latencyMs: 0, faults: [{ stage: "answer", mode: "permanent" }] });
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    const sse = await new Client().sse(`/api/widget/${key}/conversations/${conv.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${conv.body.visitorToken}` });
    const done = sse.events.find((e) => e.event === "done");
    expect(done).toBeTruthy();
    expect(done!.data.message.outcome).toBe("unanswered");

    const records = await usageRecords(t.client, t.ws.id, { conversationId: conv.body.conversation.id });
    const chatCalls = records.filter((r: any) => r.kind === "chat");
    expect(chatCalls.length).toBe(1);
    expect(chatCalls[0].status).toBe("error");
  });
});
