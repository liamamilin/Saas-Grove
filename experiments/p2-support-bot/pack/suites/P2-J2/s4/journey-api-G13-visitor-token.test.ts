import { expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { addText, expectError, expectStatus, isolateFakeModel, owner } from "../../lib/helpers";
import { Visitor, widgetSettings } from "../../lib/widget";

// G13: 访客令牌保护会话。
// 依据 api.yaml（写在公开小窗接口上面的规则）：
//   5. "Routes under /conversations/{id} need `Authorization: Bearer <visitorToken>` as returned when
//      that conversation was created: missing -> 401 unauthenticated; a token that does not belong to
//      this conversation of this widget -> 404 not_found."
//   GET /api/widget/{key}/conversations/{id} — "The visitor's own conversation, oldest message first."

// 这个旅程会真的调用模型：前后都把假模型复位，免得别的用例留下的故障或延迟影响它。
isolateFakeModel();

it("G13: 没有令牌访问不了会话，别人的令牌也访问不了", async () => {
  const team = await owner();
  await addText(team.client, team.ws.id, REFUNDS);
  const widget = await widgetSettings(team.client, team.ws.id);

  const visitor = new Visitor(widget.widgetKey);
  await visitor.start();
  const other = new Visitor(widget.widgetKey);
  await other.start();

  // 带着自己的令牌：能读回自己的会话
  const mine = await visitor.conversation();
  expect(mine.conversation.id, JSON.stringify(mine.conversation)).toBe(visitor.id);
  expect(Array.isArray(mine.messages)).toBe(true);

  // 没有令牌：401
  const anonymous = new Visitor(widget.widgetKey);
  const noToken = await anonymous.request("GET", `/conversations/${visitor.id}`);
  expectError(noToken, 401, "unauthenticated");

  // 令牌不对：404
  const wrong = new Visitor(widget.widgetKey);
  wrong.token = "not-the-real-visitor-token";
  const badToken = await wrong.request("GET", `/conversations/${visitor.id}`);
  expectError(badToken, 404, "not_found");

  // 别人的令牌访问别人的会话可以，访问我的会话不行
  const theirs = await other.conversation();
  expect(theirs.conversation.id, JSON.stringify(theirs.conversation)).toBe(other.id);
  const stolen = await other.request("GET", `/conversations/${visitor.id}`);
  expectError(stolen, 404, "not_found");

  // 会话里的消息按时间正序：先是我的问题，再是助手的回答
  const answered = await visitor.answer(Q_REFUND);
  const back = await visitor.conversation();
  const roles = back.messages.map((m: any) => m.role);
  expect(roles, JSON.stringify(back.messages)).toEqual(["user", "assistant"]);
  expect(back.messages[0].content).toBe(Q_REFUND);
  expect(back.messages[1].id).toBe(answered.message.id);
});
