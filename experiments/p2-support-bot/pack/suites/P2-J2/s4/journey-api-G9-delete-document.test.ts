import { expect, it } from "vitest";
import { Q_WARRANTY, REFUNDS, WARRANTY } from "../../lib/corpus";
import { addMember, addText, expectError, expectStatus, isolateFakeModel, owner } from "../../lib/helpers";
import { Visitor, expectAnswered, expectUnanswered, widgetSettings } from "../../lib/widget";

// G9: 删掉一份资料之后，它立刻不再参与回答。
// 依据 api.yaml：
//   DELETE /api/workspaces/{ws}/documents/{id} — "(S4) Uploader, admin or owner.
//     The document stops taking part in answers at once."（204 / 403）
//   GET /api/workspaces/{ws}/documents — "Every document of the workspace's knowledge base
//     (deleted ones excluded)."
//   GET /api/workspaces/{ws}/documents/{id}、/text — 查不到就是 404
//   POST /api/widget/{key}/conversations/{id}/messages — 答不上来时给兜底回答（citations 为空）

// 这个旅程会真的调用模型：前后都把假模型复位，免得别的用例留下的故障或延迟影响它。
isolateFakeModel();

it("G9: 资料被删掉之后立刻不再参与回答", async () => {
  const team = await owner();
  const member = await addMember(team, "member");
  const refunds = await addText(team.client, team.ws.id, REFUNDS);
  const warranty = await addText(team.client, team.ws.id, WARRANTY);
  const widget = await widgetSettings(team.client, team.ws.id);

  // 删之前，这个问题答得上来，而且引用的正是保修那一份
  const visitor = new Visitor(widget.widgetKey);
  await visitor.start();
  const before = await visitor.answer(Q_WARRANTY);
  expectAnswered(before.message);
  expect(
    before.message.citations.map((c: any) => c.documentId),
    JSON.stringify(before.message.citations),
  ).toContain(warranty.id);

  // 既不是上传者，也不是 admin/owner 的成员删不了
  const byMember = await member.client.del(`/api/workspaces/${team.ws.id}/documents/${warranty.id}`);
  expectError(byMember, 403, "forbidden");

  // 上传者/所有者删
  const deleted = await team.client.del(`/api/workspaces/${team.ws.id}/documents/${warranty.id}`);
  expectStatus(deleted, 204);

  // 列表里没有了
  const list = await team.client.get(`/api/workspaces/${team.ws.id}/documents`);
  expectStatus(list, 200);
  const docs = list.body?.documents ?? [];
  expect(docs.some((d: any) => d.id === warranty.id), JSON.stringify(docs)).toBe(false);
  expect(docs.some((d: any) => d.id === refunds.id), JSON.stringify(docs)).toBe(true);

  // 单个查询也查不到了
  const gone = await team.client.get(`/api/workspaces/${team.ws.id}/documents/${warranty.id}`);
  expectError(gone, 404, "not_found");
  const text = await team.client.get(`/api/workspaces/${team.ws.id}/documents/${warranty.id}/text`);
  expectError(text, 404, "not_found");

  // 同一个问题现在答不上来了：那份资料已经不再参与回答
  const after = await visitor.answer(Q_WARRANTY);
  expectUnanswered(after.message, widget.fallbackMessage);
});
