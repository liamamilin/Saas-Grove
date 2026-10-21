// Held-out acceptance tests: citation integrity of widget answers.
// Derived from spec/architecture.md §4.2 and spec/product.md §3, §6.

import { describe, expect, it } from "vitest";
import { BASE_URL, Client } from "../../lib/client";
import { expectStatus, isolateFakeModel, knowledgeBase, owner } from "../../lib/helpers";
import { Q_REFUND, Q_UNKNOWN, REFUNDS } from "../../lib/corpus";

describe("citations", () => {
  isolateFakeModel();

  // architecture.md §4.2: an answered answer carries at least one citation; every [n] has a citation;
  // quote is a verbatim substring (>=20 chars) of the cited document's text.
  it("an answered answer has valid, verbatim citations", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    const sse = await new Client().sse(`/api/widget/${key}/conversations/${conv.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${conv.body.visitorToken}` });
    const done = sse.events.find((e) => e.event === "done");
    expect(done).toBeTruthy();
    const msg = done!.data.message;
    expect(msg.outcome).toBe("answered");
    expect(msg.citations.length).toBeGreaterThan(0);

    const docs = await t.client.get(`/api/workspaces/${t.ws.id}/documents`);
    const byId = new Map(docs.body.documents.map((d: any) => [d.id, d]));
    const citedMarkers = new Set(msg.citations.map((c: any) => c.marker));
    for (const m of (msg.content as string).matchAll(/\[(\d+)\]/g)) {
      expect(citedMarkers.has(Number(m[1])), `marker ${m[1]} has no citation`).toBe(true);
    }
    for (const c of msg.citations) {
      expect(typeof c.documentTitle).toBe("string");
      const docTextRes = await t.client.get(`/api/workspaces/${t.ws.id}/documents/${c.documentId}/text`);
      expectStatus(docTextRes, 200);
      const text = docTextRes.body.text as string;
      expect(text).toContain(c.quote);
      expect((c.quote as string).length).toBeGreaterThanOrEqual(20);
      const doc = byId.get(c.documentId) as any;
      expect(doc).toBeTruthy();
      expect(c.documentTitle).toBe(doc.title);
    }
  });

  // architecture.md §4.2: an unanswered answer has no citations and content equals fallbackMessage.
  it("an unanswered answer has no citations and equals the fallback message", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;
    const fb = w.body.widget.fallbackMessage;

    const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    const sse = await new Client().sse(`/api/widget/${key}/conversations/${conv.body.conversation.id}/messages`, { content: Q_UNKNOWN }, { Origin: origin, Authorization: `Bearer ${conv.body.visitorToken}` });
    const done = sse.events.find((e) => e.event === "done");
    expect(done).toBeTruthy();
    const msg = done!.data.message;
    expect(msg.outcome).toBe("unanswered");
    expect(msg.citations).toEqual([]);
    expect(msg.content).toBe(fb);
  });
});
