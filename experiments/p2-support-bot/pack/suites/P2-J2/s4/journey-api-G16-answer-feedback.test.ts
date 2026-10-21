import { expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { addText, expectError, expectStatus, isolateFakeModel, owner } from "../../lib/helpers";
import { Visitor, widgetSettings } from "../../lib/widget";

// G16: 访客给机器人的回答评分。
// 依据 api.yaml：
//   POST /api/widget/{key}/conversations/{id}/messages/{messageId}/feedback — "(S3) Rate an
//     assistant message of this conversation. Rating again replaces the rating."
//     （200 { message }；400 validation_error（评分不合法，或者评的是访客自己的问题）；404 not_found）
//   VisitorMessage.rating — up / down / null
//   QuestionRecord.rating — 访客对回答的评分

// 这个旅程会真的调用模型：前后都把假模型复位，免得别的用例留下的故障或延迟影响它。
isolateFakeModel();

it("G16: 给回答评分，再评一次就替换", async () => {
  const team = await owner();
  await addText(team.client, team.ws.id, REFUNDS);
  const widget = await widgetSettings(team.client, team.ws.id);

  const visitor = new Visitor(widget.widgetKey);
  await visitor.start();
  const answered = await visitor.answer(Q_REFUND);
  const messageId = answered.message.id as string;
  expect(typeof messageId, JSON.stringify(answered.message)).toBe("string");

  // 评 up
  const up = await visitor.feedback(messageId, "up");
  expectStatus(up, 200);
  expect(up.body?.message?.id, up.text).toBe(messageId);
  expect(up.body?.message?.rating, up.text).toBe("up");

  // 再评 down：替换掉原来的评分
  const down = await visitor.feedback(messageId, "down");
  expectStatus(down, 200);
  expect(down.body?.message?.rating, down.text).toBe("down");

  // 后台看到的也是 down
  const admin = await team.client.get(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`);
  expectStatus(admin, 200);
  const assistant = (admin.body?.messages ?? []).find((m: any) => m.id === messageId);
  expect(assistant, JSON.stringify(admin.body?.messages)).toBeTruthy();
  expect(assistant.rating, JSON.stringify(assistant)).toBe("down");

  const questions = await team.client.get(`/api/workspaces/${team.ws.id}/analytics/questions`);
  expectStatus(questions, 200);
  const record = (questions.body?.questions ?? []).find((q: any) => q.question === Q_REFUND);
  expect(record, JSON.stringify(questions.body)).toBeTruthy();
  expect(record.rating, JSON.stringify(record)).toBe("down");

  // 评自己的问题不行
  const own = (admin.body?.messages ?? []).find((m: any) => m.role === "user");
  expect(own, JSON.stringify(admin.body?.messages)).toBeTruthy();
  const onQuestion = await visitor.feedback(own.id, "up");
  expectError(onQuestion, 400, "validation_error");

  // 评分值不合法
  const bad = await visitor.feedback(messageId, "great");
  expectError(bad, 400, "validation_error");
});
