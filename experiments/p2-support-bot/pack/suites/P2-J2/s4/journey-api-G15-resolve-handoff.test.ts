import { expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { addMember, addText, expectError, expectStatus, isolateFakeModel, owner } from "../../lib/helpers";
import { Visitor, widgetSettings } from "../../lib/widget";

// G15: 团队怎么处理转人工。
// 依据 api.yaml：
//   GET /api/workspaces/{ws}/handoffs?status=open|resolved — "Any member. Newest first."
//   GET /api/workspaces/{ws}/handoffs/{id} — "Any member. The handoff and the whole conversation,
//     oldest message first."
//   PATCH /api/workspaces/{ws}/handoffs/{id} — "Any member. Mark resolved (or reopen)."（200 / 400）
//   Handoff: { id, conversationId, status, name, email, note, createdAt, resolvedAt }

// 这个旅程会真的调用模型：前后都把假模型复位，免得别的用例留下的故障或延迟影响它。
isolateFakeModel();

it("G15: 转人工可以查看、标记已解决，也能重新打开", async () => {
  const team = await owner();
  const member = await addMember(team, "member");
  await addText(team.client, team.ws.id, REFUNDS);
  const widget = await widgetSettings(team.client, team.ws.id);

  const visitor = new Visitor(widget.widgetKey);
  await visitor.start();
  await visitor.answer(Q_REFUND);
  const asked = await visitor.handoff({ name: "王女士", email: "wang@example.test", note: "订单 12345 还没收到" });
  expectStatus(asked, 201);
  const handoffId = asked.body?.handoff?.id as string;
  expect(typeof handoffId, asked.text).toBe("string");

  // 列表里能看到这个转人工
  const all = await team.client.get(`/api/workspaces/${team.ws.id}/handoffs`);
  expectStatus(all, 200);
  const handoffs = all.body?.handoffs ?? [];
  const row = handoffs.find((h: any) => h.id === handoffId);
  expect(row, JSON.stringify(handoffs)).toBeTruthy();
  expect(row.status).toBe("open");
  expect(row.conversationId).toBe(visitor.id);
  expect(row.email).toBe("wang@example.test");
  expect(row.name).toBe("王女士");
  expect(row.note).toBe("订单 12345 还没收到");
  expect(typeof row.createdAt, JSON.stringify(row)).toBe("string");

  // 按状态筛选
  const open = await team.client.get(`/api/workspaces/${team.ws.id}/handoffs?status=open`);
  expectStatus(open, 200);
  expect((open.body?.handoffs ?? []).map((h: any) => h.id)).toContain(handoffId);
  const resolved = await team.client.get(`/api/workspaces/${team.ws.id}/handoffs?status=resolved`);
  expectStatus(resolved, 200);
  expect((resolved.body?.handoffs ?? []).map((h: any) => h.id)).not.toContain(handoffId);

  // 详情里有整个会话，消息按时间正序
  const detail = await team.client.get(`/api/workspaces/${team.ws.id}/handoffs/${handoffId}`);
  expectStatus(detail, 200);
  expect(detail.body?.handoff?.id, detail.text).toBe(handoffId);
  const messages = detail.body?.messages ?? [];
  expect(messages.length, JSON.stringify(messages)).toBeGreaterThanOrEqual(2);
  expect(messages[0].role, JSON.stringify(messages.map((m: any) => m.role))).toBe("user");
  expect(messages[0].content).toBe(Q_REFUND);
  expect(messages[1].role, JSON.stringify(messages.map((m: any) => m.role))).toBe("assistant");

  // 任何一个成员都能标记已解决
  const closed = await member.client.patch(`/api/workspaces/${team.ws.id}/handoffs/${handoffId}`, { status: "resolved" });
  expectStatus(closed, 200);
  expect(closed.body?.handoff?.status, closed.text).toBe("resolved");
  expect(typeof closed.body?.handoff?.resolvedAt, closed.text).toBe("string");

  const nowResolved = await team.client.get(`/api/workspaces/${team.ws.id}/handoffs?status=resolved`);
  expectStatus(nowResolved, 200);
  expect((nowResolved.body?.handoffs ?? []).map((h: any) => h.id)).toContain(handoffId);

  // 也能重新打开
  const reopened = await team.client.patch(`/api/workspaces/${team.ws.id}/handoffs/${handoffId}`, { status: "open" });
  expectStatus(reopened, 200);
  expect(reopened.body?.handoff?.status, reopened.text).toBe("open");

  // 非法状态：400
  const bad = await team.client.patch(`/api/workspaces/${team.ws.id}/handoffs/${handoffId}`, { status: "bogus" });
  expectError(bad, 400, "validation_error");
});
