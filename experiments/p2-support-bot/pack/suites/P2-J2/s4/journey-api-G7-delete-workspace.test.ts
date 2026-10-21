import { expect, it } from "vitest";
import { REFUNDS } from "../../lib/corpus";
import { addMember, addText, expectError, expectStatus, owner } from "../../lib/helpers";

// G7: 删掉整个工作区。
// 依据 api.yaml：
//   DELETE /api/workspaces/{ws} — "(S4) Owner only. Everything in the workspace becomes
//     unreachable."（204 / 403）
//   全局约定 — 看不见的工作区一律 404 not_found
//   GET /api/workspaces — { workspaces[] }

it("G7: 工作区被删掉之后，那里的一切对所有人都不可达", async () => {
  const team = await owner();
  const member = await addMember(team, "member");
  const doc = await addText(team.client, team.ws.id, REFUNDS);

  // 不是 owner 的人删不了
  const byMember = await member.client.del(`/api/workspaces/${team.ws.id}`);
  expectError(byMember, 403, "forbidden");

  // 还在
  const alive = await team.client.get(`/api/workspaces/${team.ws.id}`);
  expectStatus(alive, 200);

  // owner 删
  const deleted = await team.client.del(`/api/workspaces/${team.ws.id}`);
  expectStatus(deleted, 204);

  // 谁都看不到了
  const mine = await team.client.get(`/api/workspaces/${team.ws.id}`);
  expectError(mine, 404, "not_found");

  const theirs = await member.client.get(`/api/workspaces/${team.ws.id}`);
  expectError(theirs, 404, "not_found");

  // 列表里也没有了
  const list = await team.client.get("/api/workspaces");
  expectStatus(list, 200);
  expect((list.body?.workspaces ?? []).some((w: any) => w.id === team.ws.id)).toBe(false);

  // 里面的资料也一并不可达
  const docs = await team.client.get(`/api/workspaces/${team.ws.id}/documents`);
  expectError(docs, 404, "not_found");
  expect(doc.id).toBeTruthy();
});
