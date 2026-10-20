import { describe, expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import {
  CALL_COST,
  EPS,
  addMember,
  addText,
  answerCalls,
  fakeModel,
  isolateFakeModel,
  mails,
  setBudget,
  spent,
  waitFor,
} from "../../lib/helpers";
import { type Visitor, expectAnswered, expectUnanswered, supportTeam, visitor, widgetSettings } from "../../lib/widget";

describe("S3 budget: a hard stop", () => {
  isolateFakeModel();

  it("stops calling the model when the budget is spent, and gives visitors the fallback", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);
    const fallback = (await widgetSettings(team.client, team.ws.id)).fallbackMessage;
    await setBudget(team.client, team.ws.id, 0.035); // room for three calls, not four (off the exact boundary)
    const v = await visitor(team.key);

    for (let i = 0; i < 3; i++) expectAnswered((await v.answer(Q_REFUND)).message);
    expect(Math.abs((await spent(team.client, team.ws.id)) - 3 * CALL_COST)).toBeLessThan(EPS);

    const refused = await v.answer(Q_REFUND);
    expectUnanswered(refused.message, fallback);
    expect(await answerCalls(team.client, team.ws.id, "ok"), "a call was made after the budget was spent").toHaveLength(3);
    expect(await spent(team.client, team.ws.id)).toBeLessThanOrEqual(0.035 + EPS);

    // Raising the budget lets the bot answer again.
    await setBudget(team.client, team.ws.id, 0.05);
    expectAnswered((await v.answer(Q_REFUND)).message);
  });

  it("never overspends when many visitors ask at once", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);
    await setBudget(team.client, team.ws.id, 0.035); // room for three calls, not four
    await fakeModel.set({ latencyMs: 300 });
    const visitors: Visitor[] = [];
    for (let i = 0; i < 10; i++) visitors.push(await visitor(team.key));

    const answers = await Promise.all(visitors.map((v) => v.answer(Q_REFUND)));
    const answered = answers.filter((a) => a.message.outcome === "answered").length;
    expect(answered, "some questions fit in the budget").toBeGreaterThanOrEqual(1);
    expect(answered, "more answers than the budget pays for").toBeLessThanOrEqual(3);
    expect(await spent(team.client, team.ws.id), "spent past the budget").toBeLessThanOrEqual(0.035 + EPS);
    expect(await answerCalls(team.client, team.ws.id, "ok")).toHaveLength(answered);
  });

  it("warns owners and admins at 80% and when the budget runs out, once each per month", async () => {
    const team = await supportTeam();
    const admin = await addMember(team, "admin");
    const member = await addMember(team, "member");
    await addText(team.client, team.ws.id, REFUNDS);
    // Off every exact boundary: 3 calls are 67% (< 80%), 4 calls are 89% (>= 80%), a 5th call does not fit.
    await setBudget(team.client, team.ws.id, 0.045);
    const v = await visitor(team.key);

    for (let i = 0; i < 3; i++) expectAnswered((await v.answer(Q_REFUND)).message);
    expect(await mails(team.email, "budget_warning"), "warned at 67% of the budget").toHaveLength(0);

    expectAnswered((await v.answer(Q_REFUND)).message); // 0.04 of 0.045: 89%
    for (const who of [team.email, admin.email]) {
      await waitFor(async () => (await mails(who, "budget_warning")).length > 0, { timeout: 10_000, what: `budget_warning to ${who}` });
    }

    expectUnanswered((await v.answer(Q_REFUND)).message, (await widgetSettings(team.client, team.ws.id)).fallbackMessage); // 0.05 > 0.045: refused
    for (const who of [team.email, admin.email]) {
      await waitFor(async () => (await mails(who, "budget_exhausted")).length > 0, { timeout: 10_000, what: `budget_exhausted to ${who}` });
    }
    await v.answer(Q_REFUND); // refused again: no second email

    // A new budget in the same month does not bring a second email of either kind (api.yaml PUT /budget).
    await setBudget(team.client, team.ws.id, 0.055); // 0.05 of 0.055 is 91% once the next answer is paid
    expectAnswered((await v.answer(Q_REFUND)).message);
    await v.answer(Q_REFUND); // 0.06 > 0.055: refused again

    for (const who of [team.email, admin.email]) {
      expect(await mails(who, "budget_warning"), `budget_warning emails to ${who} this month`).toHaveLength(1);
      expect(await mails(who, "budget_exhausted"), `budget_exhausted emails to ${who} this month`).toHaveLength(1);
    }
    expect(await mails(member.email, "budget_warning"), "budget emails go to owners and admins only").toHaveLength(0);
    expect(await mails(member.email, "budget_exhausted"), "budget emails go to owners and admins only").toHaveLength(0);
  });
});
