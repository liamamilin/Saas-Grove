import { expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { addText, answerCalls, expectStatus, isolateFakeModel, owner, spent, usageRecords } from "../../lib/helpers";
import { Visitor, expectAnswered, expectUnanswered, widgetSettings } from "../../lib/widget";

// G19: 预算是硬闸——付不起就不再调用模型。
// 依据 api.yaml：
//   PUT /api/workspaces/{ws}/budget — "The budget is a hard stop: spending in a month never exceeds
//     it ... the call is made only if spent + reserved + this reservation <= budget."
//   POST /api/widget/{key}/conversations/{id}/messages — "unanswered: ... when this month's budget
//     cannot pay for the call (then the model is not called at all). The visitor is never shown an
//     error, a made-up answer or the reason."
//   AdminMessage.reason — no_answer / model_error / budget_exceeded

// 这个旅程会真的调用模型：前后都把假模型复位，免得别的用例留下的故障或延迟影响它。
isolateFakeModel();

it("G19: 预算付不起时不再调用模型，直接兜底回答", async () => {
  const team = await owner();
  await addText(team.client, team.ws.id, REFUNDS);
  const widget = await widgetSettings(team.client, team.ws.id);

  // 这个月只给一次调用的钱
  const budget = await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 0.01 });
  expectStatus(budget, 200);
  expect(budget.body?.budgetUsd, budget.text).toBe(0.01);

  const visitor = new Visitor(widget.widgetKey);
  await visitor.start();

  // 第一个问题付得起：正常回答
  const first = await visitor.answer(Q_REFUND);
  expectAnswered(first.message);

  // 第二个问题付不起了：不再调用模型，直接兜底
  const second = await visitor.answer(Q_REFUND);
  expectUnanswered(second.message, widget.fallbackMessage);

  // 兜底的原因在后台看得到
  const admin = await team.client.get(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`);
  expectStatus(admin, 200);
  const fallback = (admin.body?.messages ?? []).find((m: any) => m.id === second.message.id);
  expect(fallback, JSON.stringify(admin.body?.messages)).toBeTruthy();
  expect(fallback.reason, JSON.stringify(fallback)).toBe("budget_exceeded");

  // 第二个问题没有产生任何模型调用
  const records = await usageRecords(team.client, team.ws.id, { conversationId: visitor.id });
  const calls = await answerCalls(team.client, team.ws.id, "ok", visitor.id);
  expect(calls.length, JSON.stringify(records)).toBe(1);
  expect(records.filter((r) => r.messageId === second.message.id).length, JSON.stringify(records)).toBe(0);

  // 花费没有超过预算
  const used = await spent(team.client, team.ws.id);
  expect(used, "the budget was overspent").toBeLessThanOrEqual(0.01 + 1e-9);
});
