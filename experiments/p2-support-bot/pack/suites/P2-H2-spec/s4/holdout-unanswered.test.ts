// Held-out acceptance tests: unanswered handling, including the sentinel not leaking.
// Derived from spec/architecture.md §4.2 and spec/product.md §6.

import { describe, expect, it } from "vitest";
import { BASE_URL, Client } from "../../lib/client";
import { expectStatus, fakeModel, isolateFakeModel, knowledgeBase, owner, setBudget } from "../../lib/helpers";
import { Q_REFUND, Q_UNKNOWN } from "../../lib/corpus";

describe("unanswered handling", () => {
  isolateFakeModel();

  // architecture.md §4.2: an empty knowledge base never calls the model and answers unanswered.
  it("an empty knowledge base answers unanswered without calling the model", async () => {
    const t = await owner();
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    const sse = await new Client().sse(`/api/widget/${key}/conversations/${conv.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${conv.body.visitorToken}` });
    const done = sse.events.find((e) => e.event === "done");
    expect(done).toBeTruthy();
    expect(done!.data.message.outcome).toBe("unanswered");

    const records = await (await import("../../lib/helpers")).usageRecords(t.client, t.ws.id, { conversationId: conv.body.conversation.id });
    const chatCalls = records.filter((r: any) => r.kind === "chat");
    expect(chatCalls.length).toBe(0);
  });

  // architecture.md §4.2: the sentinel "无法回答" must never reach the visitor; deltas concatenate to fallbackMessage.
  it("the unanswered sentinel is never streamed to the visitor", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;
    const fb = w.body.widget.fallbackMessage;

    const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    const sse = await new Client().sse(`/api/widget/${key}/conversations/${conv.body.conversation.id}/messages`, { content: Q_UNKNOWN }, { Origin: origin, Authorization: `Bearer ${conv.body.visitorToken}` });
    const deltas = sse.events.filter((e) => e.event === "delta").map((e) => e.data?.text ?? "");
    const joined = deltas.join("");
    expect(joined).toBe(fb);
    for (const d of deltas) expect(d).not.toContain("无法回答");
    const done = sse.events.find((e) => e.event === "done");
    expect(done!.data.message.content).toBe(fb);
  });

  // architecture.md §4.2: a non-retryable model error yields unanswered reason model_error.
  it("a permanent model error yields an unanswered answer with reason model_error", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    await fakeModel.set({ faults: [{ stage: "answer", mode: "permanent" }] });
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    const sse = await new Client().sse(`/api/widget/${key}/conversations/${conv.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${conv.body.visitorToken}` });
    const done = sse.events.find((e) => e.event === "done");
    expect(done).toBeTruthy();
    expect(done!.data.message.outcome).toBe("unanswered");

    const qs = await t.client.get(`/api/workspaces/${t.ws.id}/analytics/questions`);
    expectStatus(qs, 200);
    const rec = (qs.body.questions ?? []).find((q: any) => q.conversationId === conv.body.conversation.id);
    expect(rec).toBeTruthy();
    expect(rec.reason).toBe("model_error");
  });

  // architecture.md §4.2: budget exceeded yields unanswered reason budget_exceeded.
  it("an exhausted budget yields an unanswered answer with reason budget_exceeded", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    await setBudget(t.client, t.ws.id, 0.005); // less than one call (0.01)
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    const sse = await new Client().sse(`/api/widget/${key}/conversations/${conv.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${conv.body.visitorToken}` });
    const done = sse.events.find((e) => e.event === "done");
    expect(done).toBeTruthy();
    expect(done!.data.message.outcome).toBe("unanswered");

    const qs = await t.client.get(`/api/workspaces/${t.ws.id}/analytics/questions`);
    expectStatus(qs, 200);
    const rec = (qs.body.questions ?? []).find((q: any) => q.conversationId === conv.body.conversation.id);
    expect(rec).toBeTruthy();
    expect(rec.reason).toBe("budget_exceeded");
  });

  // architecture.md §4.2: no_answer reason appears for questions the KB cannot answer.
  it("a question the knowledge base cannot answer is recorded as no_answer", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    const sse = await new Client().sse(`/api/widget/${key}/conversations/${conv.body.conversation.id}/messages`, { content: Q_UNKNOWN }, { Origin: origin, Authorization: `Bearer ${conv.body.visitorToken}` });
    const done = sse.events.find((e) => e.event === "done");
    expect(done).toBeTruthy();
    expect(done!.data.message.outcome).toBe("unanswered");

    const qs = await t.client.get(`/api/workspaces/${t.ws.id}/analytics/questions`);
    expectStatus(qs, 200);
    const rec = (qs.body.questions ?? []).find((q: any) => q.conversationId === conv.body.conversation.id);
    expect(rec).toBeTruthy();
    expect(rec.reason).toBe("no_answer");
  });
});
