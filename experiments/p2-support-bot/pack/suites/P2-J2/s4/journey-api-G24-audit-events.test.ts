import { expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { addMember, addText, expectError, expectStatus, owner } from "../../lib/helpers";
import { Visitor, updateWidget, widgetSettings } from "../../lib/widget";

// G24: 治理操作的审计事件。
// 依据 api.yaml：
//   GET /api/workspaces/{ws}/audit-events — "Admin or owner. Newest first."（200 { events } / 403）
//   AuditEvent.type — member.invited / member.joined / member.role_changed / member.removed /
//     budget.updated / document.deleted / widget.updated / widget.key_rotated / conversation.deleted /
//     export.created
//   AuditEvent.actorUserId — "whoever performed the action (for member.joined, the user who joined)"

it("G24: 邀请、加入、改角色、移除、改预算、删资料、改小窗、轮换密钥、删会话都留了痕", async () => {
  const team = await owner();
  const member = await addMember(team, "member");
  const admin = await addMember(team, "admin");

  // 普通成员看不到审计日志
  const byMember = await member.client.get(`/api/workspaces/${team.ws.id}/audit-events`);
  expectError(byMember, 403, "forbidden");

  // 改角色
  const promoted = await team.client.patch(`/api/workspaces/${team.ws.id}/members/${member.user.id}`, {
    role: "admin",
  });
  expectStatus(promoted, 200);

  // 改预算
  const budget = await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 3 });
  expectStatus(budget, 200);

  // 删一份资料
  const doc = await addText(team.client, team.ws.id, REFUNDS);
  const deletedDoc = await team.client.del(`/api/workspaces/${team.ws.id}/documents/${doc.id}`);
  expectStatus(deletedDoc, 204);

  // 改小窗设置
  await updateWidget(team.client, team.ws.id, { botName: "小灯助手" });

  // 轮换密钥
  const rotated = await team.client.post(`/api/workspaces/${team.ws.id}/widget/rotate-key`);
  expectStatus(rotated, 200);
  const key = rotated.body?.widget?.widgetKey as string;

  // 删一个会话
  const visitor = new Visitor(key);
  await visitor.start();
  await visitor.answer(Q_REFUND);
  const deleted = await team.client.del(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`);
  expectStatus(deleted, 204);

  // 移除成员
  const removed = await team.client.del(`/api/workspaces/${team.ws.id}/members/${member.user.id}`);
  expectStatus(removed, 204);

  const res = await team.client.get(`/api/workspaces/${team.ws.id}/audit-events`);
  expectStatus(res, 200);
  const events = res.body?.events ?? [];
  expect(events.length, "no audit events").toBeGreaterThan(0);

  const types = events.map((e: any) => e.type as string);
  const allowed = [
    "member.invited",
    "member.joined",
    "member.role_changed",
    "member.removed",
    "budget.updated",
    "document.deleted",
    "widget.updated",
    "widget.key_rotated",
    "conversation.deleted",
    "export.created",
  ];
  for (const type of types) expect(allowed, `unexpected audit type ${type}`).toContain(type);

  for (const expected of [
    "member.invited",
    "member.joined",
    "member.role_changed",
    "member.removed",
    "budget.updated",
    "document.deleted",
    "widget.updated",
    "widget.key_rotated",
    "conversation.deleted",
  ]) {
    expect(types, `missing audit event ${expected}`).toContain(expected);
  }

  // 最新的在最前面
  const times = events.map((e: any) => Date.parse(e.createdAt));
  for (const t of times) expect(Number.isNaN(t), "createdAt is not a timestamp").toBe(false);
  for (let i = 1; i < times.length; i++) {
    expect(times[i], `audit events are not newest first: ${JSON.stringify(times)}`).toBeLessThanOrEqual(times[i - 1]);
  }
  expect(types.indexOf("member.removed")).toBeLessThan(types.indexOf("member.invited"));

  // 做事情的人是谁
  const invited = events.find((e: any) => e.type === "member.invited");
  expect(invited.actorUserId, JSON.stringify(invited)).toBe(team.user.id);
  const joinedActors = events.filter((e: any) => e.type === "member.joined").map((e: any) => e.actorUserId);
  expect(joinedActors, JSON.stringify(joinedActors)).toContain(member.user.id);
  expect(joinedActors, JSON.stringify(joinedActors)).toContain(admin.user.id);
});
