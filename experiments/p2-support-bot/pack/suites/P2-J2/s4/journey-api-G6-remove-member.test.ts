import { expect, it } from "vitest";
import { addMember, expectError, expectStatus, owner } from "../../lib/helpers";

// G6: 把成员移出工作区。
// 依据 api.yaml：
//   DELETE /api/workspaces/{ws}/members/{userId} — "Remove a member. Admin or owner;
//     an admin cannot remove an owner; the last owner cannot be removed."
//     "Permission is checked before state. An admin removing an owner gets 403 even when that owner
//      is the last one; only an owner can ever get 409 last_owner."（204 / 403 / 409）
//   全局约定 — 不是成员的调用者访问 /api/workspaces/{ws} 下的东西一律 404 not_found

it("G6: 成员被移除后就进不来了，最后一个所有者不能被移除", async () => {
  const team = await owner();
  const admin = await addMember(team, "admin");
  const member = await addMember(team, "member");

  // 管理员不能删所有者：先判权限，所以是 403 而不是 409
  const adminOnOwner = await admin.client.del(`/api/workspaces/${team.ws.id}/members/${team.user.id}`);
  expectError(adminOnOwner, 403, "forbidden");

  // 管理员可以删普通成员
  const removed = await admin.client.del(`/api/workspaces/${team.ws.id}/members/${member.user.id}`);
  expectStatus(removed, 204);

  // 名单里没有他了
  const members = await team.client.get(`/api/workspaces/${team.ws.id}/members`);
  expectStatus(members, 200);
  const list = members.body?.members ?? [];
  expect(list.some((m: any) => m.userId === member.user.id), JSON.stringify(list)).toBe(false);
  expect(list.some((m: any) => m.userId === admin.user.id), JSON.stringify(list)).toBe(true);

  // 被移除的人再访问这个工作区就看不到了
  const gone = await member.client.get(`/api/workspaces/${team.ws.id}`);
  expectError(gone, 404, "not_found");

  // 唯一的 owner 不能把自己删掉
  const last = await team.client.del(`/api/workspaces/${team.ws.id}/members/${team.user.id}`);
  expectError(last, 409, "last_owner");

  // 还在
  const still = await team.client.get(`/api/workspaces/${team.ws.id}/members`);
  expectStatus(still, 200);
  expect((still.body?.members ?? []).some((m: any) => m.userId === team.user.id)).toBe(true);
});
