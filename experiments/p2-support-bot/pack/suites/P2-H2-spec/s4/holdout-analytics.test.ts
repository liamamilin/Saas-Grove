// Held-out acceptance tests: analytics consistency.
// Derived from spec/product.md §4 step 8 and spec/architecture.md §4.2.

import { describe, expect, it } from "vitest";
import { BASE_URL, Client } from "../../lib/client";
import { expectStatus, isolateFakeModel, knowledgeBase, owner } from "../../lib/helpers";
import { Q_REFUND, Q_UNKNOWN } from "../../lib/corpus";

describe("analytics", () => {
  isolateFakeModel();

  // product.md §4 step 8: summary counts are consistent (answered + unanswered = questions).
  it("analytics summary counts are internally consistent", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    // one answered, one unanswered
    const c1 = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(c1, 201);
    await new Client().sse(`/api/widget/${key}/conversations/${c1.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${c1.body.visitorToken}` });

    const c2 = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(c2, 201);
    await new Client().sse(`/api/widget/${key}/conversations/${c2.body.conversation.id}/messages`, { content: Q_UNKNOWN }, { Origin: origin, Authorization: `Bearer ${c2.body.visitorToken}` });

    const s = await t.client.get(`/api/workspaces/${t.ws.id}/analytics/summary`);
    expectStatus(s, 200);
    expect(s.body.questions).toBe(s.body.answered + s.body.unanswered);
    expect(s.body.questions).toBe(2);
    expect(s.body.answered).toBe(1);
    expect(s.body.unanswered).toBe(1);

    const spent = await t.client.get(`/api/workspaces/${t.ws.id}/usage`);
    expectStatus(spent, 200);
    expect(s.body.spentUsd).toBe(spent.body.spentUsd);
    expect(s.body.budgetUsd).toBe(spent.body.budgetUsd);
  });

  // product.md §4 step 8: unanswered questions list contains the question text.
  it("the unanswered list contains the question text", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    await new Client().sse(`/api/widget/${key}/conversations/${conv.body.conversation.id}/messages`, { content: Q_UNKNOWN }, { Origin: origin, Authorization: `Bearer ${conv.body.visitorToken}` });

    const qs = await t.client.get(`/api/workspaces/${t.ws.id}/analytics/questions?outcome=unanswered`);
    expectStatus(qs, 200);
    const found = (qs.body.questions ?? []).some((q: any) => q.question === Q_UNKNOWN);
    expect(found).toBe(true);
  });

  // product.md §4 step 8: questions are returned newest first.
  it("analytics questions are returned newest first", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    const c1 = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(c1, 201);
    await new Client().sse(`/api/widget/${key}/conversations/${c1.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${c1.body.visitorToken}` });

    await new Promise((r) => setTimeout(r, 50));

    const c2 = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(c2, 201);
    await new Client().sse(`/api/widget/${key}/conversations/${c2.body.conversation.id}/messages`, { content: Q_UNKNOWN }, { Origin: origin, Authorization: `Bearer ${c2.body.visitorToken}` });

    const qs = await t.client.get(`/api/workspaces/${t.ws.id}/analytics/questions`);
    expectStatus(qs, 200);
    const items = qs.body.questions ?? [];
    expect(items.length).toBeGreaterThanOrEqual(2);
    const t1 = new Date(items[0].createdAt).getTime();
    const t2 = new Date(items[1].createdAt).getTime();
    expect(t1).toBeGreaterThanOrEqual(t2);
  });
});
