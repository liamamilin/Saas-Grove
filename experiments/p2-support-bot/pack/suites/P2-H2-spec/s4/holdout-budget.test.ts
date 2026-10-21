// Held-out acceptance tests: budget hard stop, micro-USD arithmetic and alerts.
// Derived from spec/architecture.md §4.3 and spec/product.md §3, §6.

import { describe, expect, it } from "vitest";
import { BASE_URL, Client } from "../../lib/client";
import { expectStatus, isolateFakeModel, knowledgeBase, owner, setBudget, spent } from "../../lib/helpers";
import { Q_REFUND } from "../../lib/corpus";

describe("budget", () => {
  isolateFakeModel();

  // architecture.md §4.3: spending never exceeds the budget, even under concurrent load.
  it("concurrent questions never push spending past the budget", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    await setBudget(t.client, t.ws.id, 0.01); // one call's worth
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    const c1 = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(c1, 201);
    const c2 = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(c2, 201);

    const [a, b] = await Promise.all([
      new Client().sse(`/api/widget/${key}/conversations/${c1.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${c1.body.visitorToken}` }),
      new Client().sse(`/api/widget/${key}/conversations/${c2.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${c2.body.visitorToken}` }),
    ]);
    const outcomes = [a, b].map((s) => s.events.find((e) => e.event === "done")?.data?.message?.outcome);
    expect(outcomes).toContain("answered");
    expect(outcomes).toContain("unanswered");

    const s = await spent(t.client, t.ws.id);
    expect(s).toBeLessThanOrEqual(0.01 + 1e-9);
  });

  // architecture.md §4.3: amounts are compared as integer micro-USD, so 0.01 x 3 is exactly 0.03.
  it("three small charges sum to exactly 0.03 (no floating-point drift)", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    for (let i = 0; i < 3; i++) {
      const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
      expectStatus(conv, 201);
      const sse = await new Client().sse(`/api/widget/${key}/conversations/${conv.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${conv.body.visitorToken}` });
      const done = sse.events.find((e) => e.event === "done");
      expect(done).toBeTruthy();
    }
    const s = await spent(t.client, t.ws.id);
    expect(s).toBe(0.03);
  });

  // architecture.md §4.3: a budget_warning email is sent the first time spend reaches 80%.
  it("a budget_warning email is sent once when spend reaches 80%", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    await setBudget(t.client, t.ws.id, 0.10); // 80% = 0.08 = 8 calls
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    for (let i = 0; i < 8; i++) {
      const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
      expectStatus(conv, 201);
      await new Client().sse(`/api/widget/${key}/conversations/${conv.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${conv.body.visitorToken}` });
    }
    const mails = await (await import("../../lib/helpers")).mails(t.user.email, "budget_warning");
    // mails(to, template) filters by recipient; budget emails go to members, not necessarily owner's signup email.
    // Check via outbox for each member? Simpler: count budget_warning emails to any member email is hard.
    // Instead verify at least one budget_warning email exists by querying owner's inbox is unreliable.
    // We'll just assert the call count did not throw; the email check is best-effort via member list.
    const members = await t.client.get(`/api/workspaces/${t.ws.id}/members`);
    expectStatus(members, 200);
    const { waitFor } = await import("../../lib/helpers");
    let found = false;
    await waitFor(async () => {
      for (const m of members.body.members) {
        const ms = await (await import("../../lib/helpers")).mails(m.email, "budget_warning");
        if (ms.length > 0) { found = true; return true; }
      }
      return false;
    }, { timeout: 10_000, what: "budget_warning email" });
    expect(found, "no budget_warning email was sent").toBe(true);

    // Asking more must not send a second budget_warning.
    const conv = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(conv, 201);
    await new Client().sse(`/api/widget/${key}/conversations/${conv.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${conv.body.visitorToken}` });
    let total = 0;
    for (const m of members.body.members) {
      total += (await (await import("../../lib/helpers")).mails(m.email, "budget_warning")).length;
    }
    expect(total).toBe(1);
  });

  // architecture.md §4.3: a budget_exhausted email is sent on the first refusal, only once.
  it("a budget_exhausted email is sent on the first refusal and only once", async () => {
    const t = await owner();
    await knowledgeBase(t.client, t.ws.id);
    await setBudget(t.client, t.ws.id, 0.005); // less than one call
    const origin = new URL(BASE_URL).origin;
    const w = await t.client.get(`/api/workspaces/${t.ws.id}/widget`);
    const key = w.body.widget.widgetKey;

    // First question refused for budget.
    const c1 = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(c1, 201);
    const s1 = await new Client().sse(`/api/widget/${key}/conversations/${c1.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${c1.body.visitorToken}` });
    const d1 = s1.events.find((e) => e.event === "done");
    expect(d1!.data.message.outcome).toBe("unanswered");

    const members = await t.client.get(`/api/workspaces/${t.ws.id}/members`);
    expectStatus(members, 200);
    const { waitFor } = await import("../../lib/helpers");
    let found = false;
    await waitFor(async () => {
      for (const m of members.body.members) {
        const ms = await (await import("../../lib/helpers")).mails(m.email, "budget_exhausted");
        if (ms.length > 0) { found = true; return true; }
      }
      return false;
    }, { timeout: 10_000, what: "budget_exhausted email" });
    expect(found, "no budget_exhausted email was sent").toBe(true);

    // Second refusal must not send another.
    const c2 = await new Client().request("POST", `/api/widget/${key}/conversations`, { json: {}, headers: { Origin: origin } });
    expectStatus(c2, 201);
    await new Client().sse(`/api/widget/${key}/conversations/${c2.body.conversation.id}/messages`, { content: Q_REFUND }, { Origin: origin, Authorization: `Bearer ${c2.body.visitorToken}` });
    let total = 0;
    for (const m of members.body.members) {
      total += (await (await import("../../lib/helpers")).mails(m.email, "budget_exhausted")).length;
    }
    expect(total).toBe(1);
  });
});
