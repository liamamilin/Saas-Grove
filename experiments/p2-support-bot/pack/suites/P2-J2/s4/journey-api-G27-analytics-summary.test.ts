import { expect, it } from "vitest";
import { Q_REFUND, Q_SHIPPING, Q_UNKNOWN } from "../../lib/corpus";
import { addMember, expectStatus, knowledgeBase, owner, usageRecords } from "../../lib/helpers";
import { Visitor, widgetSettings } from "../../lib/widget";

// G27: 本月的统计口径。
// 依据 api.yaml：
//   GET /api/workspaces/{ws}/analytics/summary — "Any member. Counts for this calendar month (UTC)."
//     "questions counts visitor questions; each is either answered or unanswered (answered +
//      unanswered = questions). handoffs counts handoffs created this month.
//      spentUsd/budgetUsd equal GET /usage."
//     （必填 periodStart, periodEnd, conversations, questions, answered, unanswered, handoffs,
//      spentUsd, budgetUsd）
//   GET /api/workspaces/{ws}/analytics/questions?outcome=answered|unanswered — "Any member. What
//     visitors asked, newest first (at most the latest 500)."
//     QuestionRecord — { messageId, conversationId, question, outcome, reason, answerMessageId, rating }

it("G27: 本月的统计数字与实际发生的一致", async () => {
  const team = await owner();
  const member = await addMember(team, "member");
  const kb = await knowledgeBase(team.client, team.ws.id);
  const widget = await widgetSettings(team.client, team.ws.id);

  // 第一个访客：一个答得上来，一个答不上来
  const first = new Visitor(widget.widgetKey);
  await first.start();
  const refund = await first.answer(Q_REFUND);
  await first.answer(Q_UNKNOWN);

  // 第二个访客：答得上来，并且转了人工
  const second = new Visitor(widget.widgetKey);
  await second.start();
  await second.answer(Q_SHIPPING);
  const handoff = await second.handoff({ name: "王女士", email: "wang@example.test" });
  expectStatus(handoff, 201);

  // 答得上来的时候，引用的正是答得上来的那一份资料
  expect(
    refund.message.citations.map((c: any) => c.documentId),
    JSON.stringify(refund.message.citations),
  ).toContain(kb.refunds.id);

  // 统计
  const summary = await team.client.get(`/api/workspaces/${team.ws.id}/analytics/summary`);
  expectStatus(summary, 200);
  const s = summary.body;
  expect(s.conversations, summary.text).toBe(2);
  expect(s.questions, summary.text).toBe(3);
  expect(s.answered, summary.text).toBe(2);
  expect(s.unanswered, summary.text).toBe(1);
  expect(s.answered + s.unanswered, summary.text).toBe(s.questions);
  expect(s.handoffs, summary.text).toBe(1);
  expect(typeof s.periodStart, summary.text).toBe("string");
  expect(typeof s.periodEnd, summary.text).toBe("string");

  // 花费与用量接口一致
  const records = await usageRecords(team.client, team.ws.id);
  const total = records.filter((r) => r.kind === "chat").reduce((sum, r) => sum + (r.costUsd || 0), 0);
  expect(s.spentUsd, summary.text).toBeCloseTo(total, 9);
  expect(s.budgetUsd, summary.text).toBe(10);

  // 问了什么：最新的在最前面
  const questions = await team.client.get(`/api/workspaces/${team.ws.id}/analytics/questions`);
  expectStatus(questions, 200);
  const list = questions.body?.questions ?? [];
  expect(list.length, JSON.stringify(list)).toBe(3);
  expect(list[0].question, JSON.stringify(list[0])).toBe(Q_SHIPPING);
  expect(list[1].question, JSON.stringify(list[1])).toBe(Q_UNKNOWN);
  expect(list[2].question, JSON.stringify(list[2])).toBe(Q_REFUND);
  for (const record of list) {
    expect(typeof record.messageId, JSON.stringify(record)).toBe("string");
    expect(typeof record.conversationId, JSON.stringify(record)).toBe("string");
    expect(["answered", "unanswered"], JSON.stringify(record)).toContain(record.outcome);
    expect(typeof record.createdAt, JSON.stringify(record)).toBe("string");
  }
  const times = list.map((r: any) => Date.parse(r.createdAt));
  for (let i = 1; i < times.length; i++) {
    expect(times[i], `the questions are not newest first: ${JSON.stringify(times)}`).toBeLessThanOrEqual(times[i - 1]);
  }

  // 按结果筛选
  const unanswered = await member.client.get(`/api/workspaces/${team.ws.id}/analytics/questions?outcome=unanswered`);
  expectStatus(unanswered, 200);
  const onlyUnanswered = unanswered.body?.questions ?? [];
  expect(onlyUnanswered.length, JSON.stringify(onlyUnanswered)).toBe(1);
  expect(onlyUnanswered[0].question).toBe(Q_UNKNOWN);
  expect(onlyUnanswered[0].outcome).toBe("unanswered");
  expect(onlyUnanswered[0].reason, JSON.stringify(onlyUnanswered[0])).toBe("no_answer");

  const answered = await team.client.get(`/api/workspaces/${team.ws.id}/analytics/questions?outcome=answered`);
  expectStatus(answered, 200);
  expect((answered.body?.questions ?? []).length, JSON.stringify(answered.body)).toBe(2);
});
