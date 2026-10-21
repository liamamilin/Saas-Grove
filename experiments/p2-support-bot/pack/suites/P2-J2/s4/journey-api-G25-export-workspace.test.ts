import { expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { addMember, addText, expectError, expectStatus, isolateFakeModel, owner, secretKeys, usageRecords } from "../../lib/helpers";
import { Visitor, widgetSettings } from "../../lib/widget";

// G25: 导出整个工作区。
// 依据 api.yaml：
//   GET /api/workspaces/{ws}/export — "Admin or owner. Everything in this workspace, and nothing
//     secret (no password hashes, session, invitation, reset or visitor tokens)."（200 / 403）
//     返回 { exportedAt, workspace, members, documents（带 text）, widget, conversations（带
//     messages）, handoffs, usageRecords }

// 这个旅程会真的调用模型：前后都把假模型复位，免得别的用例留下的故障或延迟影响它。
isolateFakeModel();

it("G25: 导出工作区能一次拿到全部内容，而且不带出任何密钥", async () => {
  const team = await owner();
  const member = await addMember(team, "member");
  const doc = await addText(team.client, team.ws.id, REFUNDS);
  const widget = await widgetSettings(team.client, team.ws.id);

  const visitor = new Visitor(widget.widgetKey);
  await visitor.start();
  await visitor.answer(Q_REFUND);
  const handoff = await visitor.handoff({ name: "王女士", email: "wang@example.test", note: "订单 12345 还没收到" });
  expectStatus(handoff, 201);

  // 普通成员导不了
  const byMember = await member.client.get(`/api/workspaces/${team.ws.id}/export`);
  expectError(byMember, 403, "forbidden");

  const res = await team.client.get(`/api/workspaces/${team.ws.id}/export`);
  expectStatus(res, 200);
  const body = res.body;

  expect(typeof body?.exportedAt, res.text.slice(0, 200)).toBe("string");
  expect(body?.workspace?.id, res.text.slice(0, 200)).toBe(team.ws.id);
  expect(body?.workspace?.name, res.text.slice(0, 200)).toBe(team.ws.name);

  // 成员
  const members = body?.members ?? [];
  expect(members.some((m: any) => m.userId === team.user.id), JSON.stringify(members)).toBe(true);
  expect(members.some((m: any) => m.userId === member.user.id), JSON.stringify(members)).toBe(true);

  // 资料连正文一起导出
  const documents = body?.documents ?? [];
  const exportedDoc = documents.find((d: any) => d.id === doc.id);
  expect(exportedDoc, JSON.stringify(documents.map((d: any) => d.id))).toBeTruthy();
  expect(String(exportedDoc.text ?? "")).toContain("Customers may request a refund within thirty days");

  // 小窗设置
  expect(body?.widget?.widgetKey, res.text.slice(0, 200)).toBe(widget.widgetKey);

  // 会话连消息一起导出
  const conversations = body?.conversations ?? [];
  const exported = conversations.find((c: any) => c.id === visitor.id);
  expect(exported, JSON.stringify(conversations.map((c: any) => c.id))).toBeTruthy();
  expect(Array.isArray(exported.messages), JSON.stringify(exported)).toBe(true);
  expect(exported.messages.length, JSON.stringify(exported.messages)).toBeGreaterThanOrEqual(2);

  // 转人工与用量
  expect((body?.handoffs ?? []).some((h: any) => h.id === handoff.body.handoff.id)).toBe(true);
  const records = body?.usageRecords ?? [];
  const original = await usageRecords(team.client, team.ws.id);
  expect(records.length, JSON.stringify(records.map((r: any) => r.id))).toBe(original.length);

  // 不能带出任何密钥（密码哈希、会话/邀请/重置/访客令牌）
  expect(secretKeys(body)).toEqual([]);
});
