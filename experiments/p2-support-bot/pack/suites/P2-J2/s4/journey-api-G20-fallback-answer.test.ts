import { expect, it } from "vitest";
import { Q_REFUND, Q_UNKNOWN, REFUNDS } from "../../lib/corpus";
import { addText, answerCalls, expectStatus, isolateFakeModel, owner, usageRecords } from "../../lib/helpers";
import { Visitor, expectUnanswered, widgetSettings } from "../../lib/widget";

// G20: 答不出来的时候给兜底回答，而不是错误或者瞎编。
// 依据 api.yaml：
//   POST /api/widget/{key}/conversations/{id}/messages — "unanswered: `outcome: "unanswered"`,
//     `citations: []`, `content` is exactly the widget's `fallbackMessage`. This happens when the
//     knowledge base cannot answer (including an empty knowledge base, which never calls the model) ...
//     The visitor is never shown an error, a made-up answer or the reason."
//   AdminMessage.reason — no_answer
// 依据 testability.md §5："不能回答 ... 这一次调用照样计费"（知识库非空但答不上来时，模型仍然被调用并计费）。

// 这个旅程会真的调用模型：前后都把假模型复位，免得别的用例留下的故障或延迟影响它。
isolateFakeModel();

it("G20: 知识库答不上来时给兜底文案，不给引用也不给错误", async () => {
  const team = await owner();
  await addText(team.client, team.ws.id, REFUNDS);
  const widget = await widgetSettings(team.client, team.ws.id);

  const visitor = new Visitor(widget.widgetKey);
  await visitor.start();

  // 这个问题在资料里找不到答案
  const answer = await visitor.answer(Q_UNKNOWN);
  expectUnanswered(answer.message, widget.fallbackMessage);

  // 知识库非空，模型还是被调用了，并且照样计费
  const calls = await answerCalls(team.client, team.ws.id, "ok", visitor.id);
  expect(calls.length, "the model was not called at all").toBe(1);
  expect(calls[0].costUsd, JSON.stringify(calls[0])).toBeGreaterThan(0);
  expect(calls[0].stage, JSON.stringify(calls[0])).toBe("answer");

  // 后台看得到原因：知识库里没有答案
  const admin = await team.client.get(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`);
  expectStatus(admin, 200);
  const message = (admin.body?.messages ?? []).find((m: any) => m.id === answer.message.id);
  expect(message, JSON.stringify(admin.body?.messages)).toBeTruthy();
  expect(message.reason, JSON.stringify(message)).toBe("no_answer");
  expect(message.citations ?? [], JSON.stringify(message)).toEqual([]);

  // 知识库是空的：根本不会调用模型，但访客看到的仍然是兜底回答
  const empty = await owner();
  const emptyWidget = await widgetSettings(empty.client, empty.ws.id);
  const emptyVisitor = new Visitor(emptyWidget.widgetKey);
  await emptyVisitor.start();
  const emptyAnswer = await emptyVisitor.answer(Q_REFUND);
  expectUnanswered(emptyAnswer.message, emptyWidget.fallbackMessage);

  const emptyRecords = await usageRecords(empty.client, empty.ws.id, { conversationId: emptyVisitor.id });
  expect(emptyRecords.length, JSON.stringify(emptyRecords)).toBe(0);
});
