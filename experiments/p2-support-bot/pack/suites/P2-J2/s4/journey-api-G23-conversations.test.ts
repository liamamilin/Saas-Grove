import { expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { addMember, addText, expectError, expectStatus, isolateFakeModel, owner } from "../../lib/helpers";
import { Visitor, widgetSettings } from "../../lib/widget";

// G23: 工作区里的会话，以及删除会话（访客要求被遗忘）。
// 依据 api.yaml：
//   GET /api/workspaces/{ws}/conversations — "Any member. Newest first."
//   GET /api/workspaces/{ws}/conversations/{id} — "Any member. Oldest message first."
//   DELETE /api/workspaces/{ws}/conversations/{id} — "Admin or owner (e.g. a visitor asked to be
//     forgotten). The conversation, its messages and its handoff disappear from every list, analytics,
//     export and the widget; its visitor token stops working."（204 / 403）
//   ConversationSummary — { id, status, createdAt, questionCount, unansweredCount }

// 这个旅程会真的调用模型：前后都把假模型复位，免得别的用例留下的故障或延迟影响它。
isolateFakeModel();

it("G23: 会话可以查看和删除，删掉之后处处都消失", async () => {
  const team = await owner();
  const member = await addMember(team, "member");
  await addText(team.client, team.ws.id, REFUNDS);
  const widget = await widgetSettings(team.client, team.ws.id);

  const visitor = new Visitor(widget.widgetKey);
  await visitor.start();
  await visitor.answer(Q_REFUND);
  const handoff = await visitor.handoff({ name: "王女士", email: "wang@example.test", note: "订单 12345 还没收到" });
  expectStatus(handoff, 201);
  const handoffId = handoff.body?.handoff?.id as string;

  // 列表里能看到这个会话
  const list = await team.client.get(`/api/workspaces/${team.ws.id}/conversations`);
  expectStatus(list, 200);
  const conversations = list.body?.conversations ?? [];
  const row = conversations.find((c: any) => c.id === visitor.id);
  expect(row, JSON.stringify(conversations)).toBeTruthy();
  expect(row.status).toBe("handed_off");
  expect(row.questionCount).toBe(1);
  expect(row.unansweredCount).toBe(0);
  expect(typeof row.createdAt, JSON.stringify(row)).toBe("string");

  // 详情里的消息按时间正序
  const detail = await team.client.get(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`);
  expectStatus(detail, 200);
  const messages = detail.body?.messages ?? [];
  expect(messages.map((m: any) => m.role), JSON.stringify(messages)).toEqual(["user", "assistant"]);
  expect(messages[0].content).toBe(Q_REFUND);

  // 普通成员删不了
  const byMember = await member.client.del(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`);
  expectError(byMember, 403, "forbidden");

  // 所有者删
  const deleted = await team.client.del(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`);
  expectStatus(deleted, 204);

  // 列表里没有了
  const after = await team.client.get(`/api/workspaces/${team.ws.id}/conversations`);
  expectStatus(after, 200);
  expect((after.body?.conversations ?? []).some((c: any) => c.id === visitor.id)).toBe(false);

  // 详情也不到了
  const gone = await team.client.get(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`);
  expectError(gone, 404, "not_found");

  // 它的转人工也一起没了
  const handoffs = await team.client.get(`/api/workspaces/${team.ws.id}/handoffs`);
  expectStatus(handoffs, 200);
  expect((handoffs.body?.handoffs ?? []).some((h: any) => h.id === handoffId)).toBe(false);

  // 访客的令牌也不管用了
  const visitorView = await visitor.request("GET", `/conversations/${visitor.id}`);
  expect(visitorView.status, visitorView.text).toBe(404);

  // 统计里也不再数它
  const summary = await team.client.get(`/api/workspaces/${team.ws.id}/analytics/summary`);
  expectStatus(summary, 200);
  expect(summary.body?.questions, summary.text).toBe(0);
  expect(summary.body?.handoffs, summary.text).toBe(0);
});
