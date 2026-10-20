import { describe, expect, it } from "vitest";
import { Q_REFUND, Q_UNKNOWN, Q_WARRANTY, REFUNDS } from "../../lib/corpus";
import {
  EPS,
  addMember,
  addText,
  expectError,
  expectStatus,
  fakeModel,
  isolateFakeModel,
  knowledgeBase,
  setBudget,
  spent,
} from "../../lib/helpers";
import { expectAnswered, supportTeam, visitor } from "../../lib/widget";

describe("S4 analytics", () => {
  isolateFakeModel();

  it("summarises this month for every member of the team", async () => {
    const team = await supportTeam();
    const member = await addMember(team, "member");
    await knowledgeBase(team.client, team.ws.id);
    const first = await visitor(team.key);
    await first.answer(Q_REFUND);
    await first.answer(Q_UNKNOWN);
    const second = await visitor(team.key);
    await second.answer(Q_WARRANTY);
    expectStatus(await second.handoff({ email: "second@example.test" }), 201);

    const url = `/api/workspaces/${team.ws.id}/analytics/summary`;
    const res = await member.client.get(url);
    expectStatus(res, 200);
    expect(res.body).toEqual(
      expect.objectContaining({ conversations: 2, questions: 3, answered: 2, unanswered: 1, handoffs: 1, budgetUsd: 10 }),
    );
    expect(Math.abs(res.body.spentUsd - (await spent(team.client, team.ws.id)))).toBeLessThan(EPS);
    expect(res.body.spentUsd).toBeGreaterThan(0);
    expect(Date.parse(res.body.periodStart)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(res.body.periodEnd)).toBeGreaterThan(Date.now());

    const outsider = await supportTeam();
    expectError(await outsider.client.get(url), 404, "not_found");
    expectError(await outsider.client.get(`/api/workspaces/${team.ws.id}/analytics/questions`), 404, "not_found");
  });

  it("lists what visitors asked, newest first, and why questions went unanswered", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);
    const v = await visitor(team.key);

    const good = await v.answer(Q_REFUND);
    expectAnswered(good.message);
    expectStatus(await v.feedback(good.message.id, "down"), 200);
    await v.answer(Q_UNKNOWN); // the knowledge base has nothing on it
    await fakeModel.set({ faults: [{ stage: "answer", mode: "transient", times: 3 }] });
    const broken = "When will my refund be paid back, please?";
    await v.answer(broken); // the model fails three times
    await fakeModel.reset();
    await setBudget(team.client, team.ws.id, await spent(team.client, team.ws.id));
    const late = "Can I still get a refund after opening the bulbs?";
    await v.answer(late); // nothing left to pay for it

    const all = await team.client.get(`/api/workspaces/${team.ws.id}/analytics/questions`);
    expectStatus(all, 200);
    const asked = all.body.questions.filter((q: any) => q.conversationId === v.id);
    expect(asked.map((q: any) => q.question)).toEqual([late, broken, Q_UNKNOWN, Q_REFUND]);
    expect(asked[3]).toEqual(expect.objectContaining({ outcome: "answered", rating: "down", answerMessageId: good.message.id }));
    expect(asked[3].reason ?? null).toBeNull();

    const missed = await team.client.get(`/api/workspaces/${team.ws.id}/analytics/questions?outcome=unanswered`);
    expectStatus(missed, 200);
    const reasons = Object.fromEntries(missed.body.questions.filter((q: any) => q.conversationId === v.id).map((q: any) => [q.question, q.reason]));
    expect(reasons).toEqual({ [Q_UNKNOWN]: "no_answer", [broken]: "model_error", [late]: "budget_exceeded" });
  });
});
