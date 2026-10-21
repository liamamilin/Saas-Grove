import { expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { addMember, addText, expectStatus, isolateFakeModel, mails, owner } from "../../lib/helpers";
import { Visitor, widgetSettings } from "../../lib/widget";

// G18: 预算提醒与预算耗尽的邮件。
// 依据 api.yaml（PUT /api/workspaces/{ws}/budget 的 description）：
//   "Every owner and admin (not members) gets a `budget_warning` email when this month's spend first
//    reaches 80% of the budget (in micro-USD: spent × 5 >= budget × 4), and a `budget_exhausted`
//    email the first time a question is refused for lack of budget. Each kind is sent at most once
//    per calendar month (UTC), even if the budget is changed during the month."
// 依据 testability.md §6：budget_warning / budget_exhausted 邮件的 data 里带 spentUsd、budgetUsd。

// 这个旅程会真的调用模型：前后都把假模型复位，免得别的用例留下的故障或延迟影响它。
isolateFakeModel();

it("G18: 花到预算的八成提醒一次，预算付不起时提醒耗尽一次", async () => {
  const team = await owner();
  const admin = await addMember(team, "admin");
  const member = await addMember(team, "member");
  await addText(team.client, team.ws.id, REFUNDS);
  const widget = await widgetSettings(team.client, team.ws.id);

  // 这个月只给两次调用的钱
  const budget = await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 0.02 });
  expectStatus(budget, 200);
  expect(budget.body?.budgetUsd, budget.text).toBe(0.02);

  const visitor = new Visitor(widget.widgetKey);
  await visitor.start();

  // 两次调用刚好花到 0.02，超过八成 → 提醒
  await visitor.answer(Q_REFUND);
  await visitor.answer(Q_REFUND);

  for (const who of [team, admin]) {
    const warned = await mails(who.email, "budget_warning");
    expect(warned.length, `no budget_warning email to ${who.email}`).toBe(1);
    expect(typeof warned[0].data?.spentUsd, JSON.stringify(warned[0])).toBe("number");
    expect(warned[0].data?.budgetUsd, JSON.stringify(warned[0])).toBe(0.02);
  }
  expect((await mails(member.email, "budget_warning")).length, "members must not get budget warnings").toBe(0);

  // 第三次付不起了：预算耗尽的提醒
  await visitor.answer(Q_REFUND);
  for (const who of [team, admin]) {
    const exhausted = await mails(who.email, "budget_exhausted");
    expect(exhausted.length, `no budget_exhausted email to ${who.email}`).toBe(1);
    expect(typeof exhausted[0].data?.spentUsd, JSON.stringify(exhausted[0])).toBe("number");
  }
  expect((await mails(member.email, "budget_exhausted")).length, "members must not get budget emails").toBe(0);

  // 再问几次也不会重复发
  await visitor.answer(Q_REFUND);
  await visitor.answer(Q_REFUND);
  for (const who of [team, admin]) {
    expect((await mails(who.email, "budget_warning")).length, "the budget warning was sent twice").toBe(1);
    expect((await mails(who.email, "budget_exhausted")).length, "the budget exhaustion notice was sent twice").toBe(1);
  }

  // 就算改了预算，这个月也只发过一次
  const raised = await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 1 });
  expectStatus(raised, 200);
  await visitor.answer(Q_REFUND);
  for (const who of [team, admin]) {
    expect((await mails(who.email, "budget_warning")).length, "the budget warning was sent again").toBe(1);
    expect((await mails(who.email, "budget_exhausted")).length, "the budget exhaustion notice was sent again").toBe(1);
  }
});
