import { expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { addMember, addText, expectError, expectStatus, isolateFakeModel, mails, owner } from "../../lib/helpers";
import { Visitor, expectAnswered, widgetSettings } from "../../lib/widget";

// G14: 访客转人工之后的通知与状态。
// 依据 api.yaml：
//   POST /api/widget/{key}/conversations/{id}/handoff — "Ask for a person. Contact details are
//     optional; an email, if given, must be valid." "Creates an open handoff for the conversation,
//     sets the conversation's status to `handed_off`, and sends a `handoff` email to every member of
//     the workspace. A conversation has at most one handoff: asking again gives 409 invalid_state.
//     The bot keeps answering questions in a handed-off conversation."（201 { handoff } / 400 / 409）
// 依据 testability.md §6：handoff 邮件的 data 里带 handoffId 和 conversationId。

// 这个旅程会真的调用模型：前后都把假模型复位，免得别的用例留下的故障或延迟影响它。
isolateFakeModel();

it("G14: 访客转人工后每个成员都收到通知，同一个会话只能转一次", async () => {
  const team = await owner();
  const member = await addMember(team, "member");
  await addText(team.client, team.ws.id, REFUNDS);
  const widget = await widgetSettings(team.client, team.ws.id);

  const visitor = new Visitor(widget.widgetKey);
  await visitor.start();
  await visitor.answer(Q_REFUND);

  // 邮箱不合法：400
  const badEmail = await visitor.handoff({ name: "王女士", email: "not-an-email", note: "订单 12345 还没收到" });
  expectError(badEmail, 400, "validation_error");

  // 正常转人工
  const asked = await visitor.handoff({ name: "王女士", email: "wang@example.test", note: "订单 12345 还没收到" });
  expectStatus(asked, 201);
  const handoff = asked.body?.handoff;
  expect(typeof handoff?.id, asked.text).toBe("string");
  expect(handoff.status, asked.text).toBe("open");
  expect(typeof handoff.createdAt, asked.text).toBe("string");

  // 工作区里的每个成员都收到 handoff 邮件，里面能对上 handoff 和会话
  for (const who of [team, member]) {
    const sent = await mails(who.email, "handoff");
    expect(sent.length, `no handoff email to ${who.email}`).toBe(1);
    expect(sent[0].data?.handoffId, JSON.stringify(sent[0])).toBe(handoff.id);
    expect(sent[0].data?.conversationId, JSON.stringify(sent[0])).toBe(visitor.id);
  }

  // 会话状态变成 handed_off
  const conversation = await visitor.conversation();
  expect(conversation.conversation.status, JSON.stringify(conversation.conversation)).toBe("handed_off");

  const admin = await team.client.get(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`);
  expectStatus(admin, 200);
  expect(admin.body?.conversation?.status, admin.text).toBe("handed_off");

  // 同一个会话不能再转一次
  const again = await visitor.handoff({ email: "wang@example.test" });
  expectError(again, 409, "invalid_state");

  // 转了人工之后，机器人照样回答问题
  const still = await visitor.answer(Q_REFUND);
  expectAnswered(still.message);
});
