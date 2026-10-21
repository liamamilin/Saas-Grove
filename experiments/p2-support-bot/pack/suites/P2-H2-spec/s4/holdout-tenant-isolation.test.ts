// Held-out acceptance tests: tenant isolation of the knowledge base and conversations.
// Derived from spec/product.md §2, §6 and spec/architecture.md §4.1.

import { describe, expect, it } from "vitest";
import { BASE_URL, Client } from "../../lib/client";
import { addText, expectError, expectStatus, isolateFakeModel, knowledgeBase, owner, uid } from "../../lib/helpers";
import { SECRET, SECRET_LEAKS, SECRET_PHRASE, Q_SECRET } from "../../lib/corpus";

describe("tenant isolation", () => {
  isolateFakeModel();

  // product.md §6: A company's material must never surface in another company's answers.
  it("a widget answer never contains another workspace's secret material", async () => {
    const a = await owner();
    await addText(a.client, a.ws.id, SECRET);
    const origin = new URL(BASE_URL).origin;
    const wA = await a.client.get(`/api/workspaces/${a.ws.id}/widget`);
    const keyA = wA.body.widget.widgetKey;

    const b = await owner();
    await knowledgeBase(b.client, b.ws.id);
    const wB = await b.client.get(`/api/workspaces/${b.ws.id}/widget`);
    const keyB = wB.body.widget.widgetKey;

    const convA = await new Client().request("POST", `/api/widget/${keyA}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(convA, 201);
    const sseA = await new Client().sse(`/api/widget/${keyA}/conversations/${convA.body.conversation.id}/messages`, { content: Q_SECRET }, { Origin: origin, Authorization: `Bearer ${convA.body.visitorToken}` });
    const doneA = sseA.events.find((e) => e.event === "done");
    expect(doneA).toBeTruthy();

    const convB = await new Client().request("POST", `/api/widget/${keyB}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(convB, 201);
    const sseB = await new Client().sse(`/api/widget/${keyB}/conversations/${convB.body.conversation.id}/messages`, { content: Q_SECRET }, { Origin: origin, Authorization: `Bearer ${convB.body.visitorToken}` });
    const doneB = sseB.events.find((e) => e.event === "done");
    expect(doneB).toBeTruthy();
    const answerB = doneB!.data.message.content as string;
    for (const leak of SECRET_LEAKS) {
      expect(answerB.toLowerCase()).not.toContain(leak.toLowerCase());
    }
    const docsA = await a.client.get(`/api/workspaces/${a.ws.id}/documents`);
    const secretDocId = docsA.body.documents.find((d: any) => d.title === SECRET.title)?.id;
    for (const c of doneB!.data.message.citations ?? []) {
      expect(c.documentId).not.toBe(secretDocId);
    }
  });

  // product.md §6: a document deleted stops being used in answers at once.
  it("a deleted document stops being used in answers at once", async () => {
    const t = await owner();
    const doc = await addText(t.client, t.ws.id, { title: "Refund policy", text: "Customers may request a refund within thirty days." });
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    const c1 = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(c1, 201);
    const s1 = await new Client().sse(`/api/widget/${key}/conversations/${c1.body.conversation.id}/messages`, { content: "How many days until my refund arrives?" }, { Origin: origin, Authorization: `Bearer ${c1.body.visitorToken}` });
    const d1 = s1.events.find((e) => e.event === "done");
    expect(d1).toBeTruthy();
    expect(d1!.data.message.outcome).toBe("answered");

    expectStatus(await t.client.del(`/api/workspaces/${t.ws.id}/documents/${doc.id}`), 204);

    const c2 = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(c2, 201);
    const s2 = await new Client().sse(`/api/widget/${key}/conversations/${c2.body.conversation.id}/messages`, { content: "How many days until my refund arrives?" }, { Origin: origin, Authorization: `Bearer ${c2.body.visitorToken}` });
    const d2 = s2.events.find((e) => e.event === "done");
    expect(d2).toBeTruthy();
    expect(d2!.data.message.outcome).toBe("unanswered");
  });

  // product.md §6: a visitor cannot read another workspace's conversation.
  it("a conversation of one workspace is not readable from another workspace", async () => {
    const a = await owner();
    const b = await owner();
    await knowledgeBase(a.client, a.ws.id);
    const origin = new URL(BASE_URL).origin;
    const wA = await a.client.get(`/api/workspaces/${a.ws.id}/widget`);
    const keyA = wA.body.widget.widgetKey;
    const conv = await new Client().request("POST", `/api/widget/${keyA}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    const convId = conv.body.conversation.id;

    const res = await b.client.get(`/api/workspaces/${b.ws.id}/conversations/${convId}`);
    expectStatus(res, 404);

    const wrong = await new Client().request("GET", `/api/widget/${keyA}/conversations/${convId}`, { headers: { Origin: origin, Authorization: "Bearer not-a-real-token" } });
    expectStatus(wrong, 404);

    // A member of B cannot list A's conversations as a workspace resource.
    const listB = await b.client.get(`/api/workspaces/${b.ws.id}/conversations`);
    expectStatus(listB, 200);
    const leaked = (listB.body.conversations ?? []).some((c: any) => c.id === convId);
    expect(leaked).toBe(false);
  });
});
