// Held-out acceptance tests: handoffs and conversation deletion effects.
// Derived from spec/product.md §4, §7 and spec/architecture.md §4.2.

import { describe, expect, it } from "vitest";
import { BASE_URL, Client } from "../../lib/client";
import { expectStatus, isolateFakeModel, knowledgeBase, owner } from "../../lib/helpers";
import { Q_REFUND } from "../../lib/corpus";

describe("handoffs and deletion", () => {
  isolateFakeModel();

  // product.md §4 step 7: a handoff notifies every member of the workspace.
  it("a handoff sends an email to every member of the workspace", async () => {
    const t = await owner();
    const member = await (await import("../../lib/helpers")).addMember(t, "member");
    await knowledgeBase(t.client, t.ws.id);
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    const cid = conv.body.conversation.id;
    const token = conv.body.visitorToken;
    const hf = await new Client().request("POST", `/api/widget/${key}/conversations/${cid}/handoff`, { json: { email: "visitor@example.test", note: "help" }, headers: { Origin: origin, Authorization: `Bearer ${token}` } });
    expectStatus(hf, 201);

    const members = await t.client.get(`/api/workspaces/${t.ws.id}/members`);
    expectStatus(members, 200);
    for (const m of members.body.members) {
      const ms = await (await import("../../lib/helpers")).mails(m.email, "handoff");
      expect(ms.length, `no handoff email to ${m.email}`).toBeGreaterThan(0);
    }
  });

  // product.md §4 step 9 / §7: deleting a conversation removes it from analytics, export and the widget.
  it("a deleted conversation disappears from analytics, export and the widget", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    const cid = conv.body.conversation.id;
    const token = conv.body.visitorToken;
    await new Client().sse(`/api/widget/${key}/conversations/${cid}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${token}` });

    // capture the conversation's message texts before deletion
    const detail = await t.client.get(`/api/workspaces/${t.ws.id}/conversations/${cid}`);
    expectStatus(detail, 200);
    const messageTexts = (detail.body.messages ?? []).map((m: any) => m.content as string).filter((s: string) => s && s.length > 0);

    // delete
    expectStatus(await t.client.del(`/api/workspaces/${t.ws.id}/conversations/${cid}`), 204);

    // widget token stops working
    const getConv = await new Client().request("GET", `/api/widget/${key}/conversations/${cid}`, { headers: { Origin: origin, Authorization: `Bearer ${token}` } });
    expect(getConv.status).not.toBe(200);

    // analytics questions no longer include it
    const qs = await t.client.get(`/api/workspaces/${t.ws.id}/analytics/questions`);
    expectStatus(qs, 200);
    const found = (qs.body.questions ?? []).some((q: any) => q.conversationId === cid);
    expect(found).toBe(false);

    // export no longer includes the conversation or its handoffs, nor any of its message texts
    const exp = await t.client.get(`/api/workspaces/${t.ws.id}/export`);
    expectStatus(exp, 200);
    const convIds = (exp.body.conversations ?? []).map((c: any) => c.id);
    expect(convIds).not.toContain(cid);
    const handoffConvIds = (exp.body.handoffs ?? []).map((h: any) => h.conversationId);
    expect(handoffConvIds).not.toContain(cid);
    const exportText = JSON.stringify(exp.body);
    for (const mt of messageTexts) {
      expect(exportText).not.toContain(mt);
    }
  });

  // product.md §4 step 7: a conversation has at most one handoff.
  it("a second handoff request on the same conversation is rejected", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    const cid = conv.body.conversation.id;
    const token = conv.body.visitorToken;

    const hf1 = await new Client().request("POST", `/api/widget/${key}/conversations/${cid}/handoff`, { json: {}, headers: { Origin: origin, Authorization: `Bearer ${token}` } });
    expectStatus(hf1, 201);
    const hf2 = await new Client().request("POST", `/api/widget/${key}/conversations/${cid}/handoff`, { json: {}, headers: { Origin: origin, Authorization: `Bearer ${token}` } });
    expectStatus(hf2, 409);
  });
});
