// Held-out acceptance tests: conversations and analytics.
//
// Contract source:
//   brief/contract/api.yaml:
//   - GET /api/workspaces/{ws}/conversations: "Any member. Newest first." (ConversationSummary:
//     { id, status, createdAt, questionCount, unansweredCount }).
//   - GET /api/workspaces/{ws}/conversations/{id}: "Any member. Oldest message first."
//   - DELETE /api/workspaces/{ws}/conversations/{id}: "Admin or owner (e.g. a visitor asked to be
//   forgotten). The conversation, its messages and its handoff disappear from every list,
//   analytics, export and the widget; its visitor token stops working."
//   - GET /api/workspaces/{ws}/analytics/summary: "Any member. Counts for this calendar month
//   (UTC)." "`questions` counts visitor questions; each is either `answered` or `unanswered`
//   (answered + unanswered = questions). `handoffs` counts handoffs created this month.
//   `spentUsd`/`budgetUsd` equal GET /usage."
//   - GET /api/workspaces/{ws}/analytics/questions: "Any member. What visitors asked, newest first
//   (at most the latest 500)."

import { describe, expect, it } from "vitest";
import { addMember, expectError, expectStatus, knowledgeBase, sleep } from "../../lib/helpers";
import { Visitor, supportTeam } from "../../lib/widget";
import { Q_REFUND, Q_UNKNOWN } from "../../lib/corpus";

describe("holdout: conversations and analytics", () => {
  it("lists the conversations newest first and shows every message of one", async () => {
    // Contract: GET conversations "Newest first"; GET conversations/{id} "Oldest message first".
    const team = await supportTeam();
    await knowledgeBase(team.client, team.ws.id);

    const first = await new Visitor(team.key).start();
    await first.answer(Q_REFUND);
    // A moment between the two conversations, so that their timestamps differ.
    await sleep(30);
    const second = await new Visitor(team.key).start();
    await second.answer(Q_UNKNOWN);

    const list = await team.client.get(`/api/workspaces/${team.ws.id}/conversations`);
    expectStatus(list, 200);
    const conversations = list.body?.conversations ?? [];
    expect(conversations.length).toBe(2);
    expect(conversations[0].id).toBe(second.id);
    expect(conversations[1].id).toBe(first.id);
    expect(conversations[0].questionCount).toBe(1);
    expect(conversations[0].unansweredCount).toBe(1);
    expect(conversations[1].unansweredCount).toBe(0);
    expect(Date.parse(conversations[0].createdAt)).toBeGreaterThanOrEqual(Date.parse(conversations[1].createdAt));

    const detail = await team.client.get(`/api/workspaces/${team.ws.id}/conversations/${first.id}`);
    expectStatus(detail, 200);
    expect(detail.body?.conversation?.id).toBe(first.id);
    const messages = detail.body?.messages ?? [];
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe(Q_REFUND);
    expect(messages[1].role).toBe("assistant");
  });

  it("counts the questions of the month and lists what the visitors asked", async () => {
    // Contract: the analytics summary (answered + unanswered = questions, handoffs, spentUsd and
    // budgetUsd equal GET /usage) and the questions list with the outcome filter.
    const team = await supportTeam();
    await knowledgeBase(team.client, team.ws.id);

    const first = await new Visitor(team.key).start();
    await first.answer(Q_REFUND);
    const second = await new Visitor(team.key).start();
    await second.answer(Q_UNKNOWN);
    await second.handoff({ name: "Ada", email: "ada@example.test" });

    const summary = await team.client.get(`/api/workspaces/${team.ws.id}/analytics/summary`);
    expectStatus(summary, 200);
    for (const key of [
      "periodStart",
      "periodEnd",
      "conversations",
      "questions",
      "answered",
      "unanswered",
      "handoffs",
      "spentUsd",
      "budgetUsd",
    ]) {
      expect(Object.keys(summary.body ?? {}), `the summary has no ${key}`).toContain(key);
    }
    expect(summary.body?.conversations).toBe(2);
    expect(summary.body?.questions).toBe(2);
    expect(summary.body?.answered).toBe(1);
    expect(summary.body?.unanswered).toBe(1);
    expect(summary.body?.questions).toBe((summary.body?.answered ?? 0) + (summary.body?.unanswered ?? 0));
    expect(summary.body?.handoffs).toBe(1);

    const usage = await team.client.get(`/api/workspaces/${team.ws.id}/usage`);
    expect(summary.body?.spentUsd).toBeCloseTo(usage.body?.spentUsd, 10);
    expect(summary.body?.budgetUsd).toBe(usage.body?.budgetUsd);

    const questions = await team.client.get(`/api/workspaces/${team.ws.id}/analytics/questions`);
    expectStatus(questions, 200);
    expect((questions.body?.questions ?? []).length).toBe(2);

    const unanswered = await team.client.get(
      `/api/workspaces/${team.ws.id}/analytics/questions?outcome=unanswered`,
    );
    expectStatus(unanswered, 200);
    const records = unanswered.body?.questions ?? [];
    expect(records.length).toBe(1);
    expect(String(records[0]?.question ?? "")).toBe(Q_UNKNOWN);
    expect(records[0]?.outcome).toBe("unanswered");

    const answered = await team.client.get(`/api/workspaces/${team.ws.id}/analytics/questions?outcome=answered`);
    expectStatus(answered, 200);
    expect((answered.body?.questions ?? []).length).toBe(1);
    expect(String(answered.body?.questions?.[0]?.question ?? "")).toBe(Q_REFUND);
  });

  it("forgets a deleted conversation everywhere and stops its visitor token", async () => {
    // Contract: DELETE conversations/{id} -> 204 (admin or owner); "The conversation, its messages
    // and its handoff disappear from every list, analytics, export and the widget; its visitor
    // token stops working."
    const team = await supportTeam();
    const member = await addMember(team, "member");
    const admin = await addMember(team, "admin");
    await knowledgeBase(team.client, team.ws.id);

    const visitor = await new Visitor(team.key).start();
    await visitor.answer(Q_REFUND);
    await visitor.handoff({ name: "Ada", email: "ada@example.test" });

    expectError(
      await member.client.del(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`),
      403,
      "forbidden",
    );
    expectStatus(await admin.client.del(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`), 204);

    const list = await team.client.get(`/api/workspaces/${team.ws.id}/conversations`);
    expectStatus(list, 200);
    expect((list.body?.conversations ?? []).map((c: any) => c.id)).not.toContain(visitor.id);

    const summary = await team.client.get(`/api/workspaces/${team.ws.id}/analytics/summary`);
    expectStatus(summary, 200);
    expect(summary.body?.questions).toBe(0);
    expect(summary.body?.handoffs).toBe(0);

    const exported = await team.client.get(`/api/workspaces/${team.ws.id}/export`);
    expectStatus(exported, 200);
    expect((exported.body?.conversations ?? []).map((c: any) => c.id)).not.toContain(visitor.id);
    expect((exported.body?.handoffs ?? []).length).toBe(0);

    // The visitor token does not work any more.
    const res = await visitor.http.request("GET", visitor.path(`/conversations/${visitor.id}`), {
      headers: visitor.headers(),
    });
    expectError(res, 404, "not_found");
  });
});
