import { expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { addText, expectError, expectStatus, isolateFakeModel, owner } from "../../lib/helpers";
import { Visitor, widgetSettings } from "../../lib/widget";

// G28: 工作区之间互相看不见。
// 依据 api.yaml 全局约定："Anything under /api/workspaces/{ws} that the caller cannot see — because
// they are not a member, or the resource belongs to another workspace, or it does not exist — is
// 404 not_found. A member lacking the role is 403."

// 这个旅程会真的调用模型：前后都把假模型复位，免得别的用例留下的故障或延迟影响它。
isolateFakeModel();

it("G28: 不是成员就看不到别人的工作区，别的路径也拿不到那里的资料", async () => {
  const mine = await owner();
  const doc = await addText(mine.client, mine.ws.id, REFUNDS);
  const widget = await widgetSettings(mine.client, mine.ws.id);
  const visitor = new Visitor(widget.widgetKey);
  await visitor.start();
  await visitor.answer(Q_REFUND);

  const other = await owner();

  // 不是成员：整个工作区都看不见
  const ws = await other.client.get(`/api/workspaces/${mine.ws.id}`);
  expectError(ws, 404, "not_found");

  const documents = await other.client.get(`/api/workspaces/${mine.ws.id}/documents`);
  expectError(documents, 404, "not_found");

  const one = await other.client.get(`/api/workspaces/${mine.ws.id}/documents/${doc.id}`);
  expectError(one, 404, "not_found");

  const text = await other.client.get(`/api/workspaces/${mine.ws.id}/documents/${doc.id}/text`);
  expectError(text, 404, "not_found");

  const conversations = await other.client.get(`/api/workspaces/${mine.ws.id}/conversations`);
  expectError(conversations, 404, "not_found");

  const conversation = await other.client.get(`/api/workspaces/${mine.ws.id}/conversations/${visitor.id}`);
  expectError(conversation, 404, "not_found");

  const handoffs = await other.client.get(`/api/workspaces/${mine.ws.id}/handoffs`);
  expectError(handoffs, 404, "not_found");

  const summary = await other.client.get(`/api/workspaces/${mine.ws.id}/analytics/summary`);
  expectError(summary, 404, "not_found");

  // 换成自己的工作区路径，资料同样拿不到（资源属于别的工作区）
  const crossed = await other.client.get(`/api/workspaces/${other.ws.id}/documents/${doc.id}`);
  expectError(crossed, 404, "not_found");

  // 我的数据没有被动过
  const still = await mine.client.get(`/api/workspaces/${mine.ws.id}/documents/${doc.id}`);
  expectStatus(still, 200);
  expect(still.body?.document?.id, still.text).toBe(doc.id);
});
