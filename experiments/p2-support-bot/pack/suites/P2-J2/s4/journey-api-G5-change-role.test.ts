import { expect, it } from "vitest";
import { addMember, expectError, expectStatus, owner } from "../../lib/helpers";

// G5: 所有者改成员的角色。
// 依据 api.yaml：
//   PATCH /api/workspaces/{ws}/members/{userId} — "Change a role. Owner only."
//     "Permission is checked before state, so a non-owner always gets 403"（200 { member } / 403）
//   GET /api/workspaces/{ws}/members — members[].role
//   GET /api/me — memberships[]，每项 { workspaceId, workspaceName, role }
//   GET /api/workspaces/{ws} — { workspace, role }

it("G5: 所有者把成员升为管理员后，新角色立刻生效", async () => {
  const team = await owner();
  const member = await addMember(team, "member");

  // 普通成员不能改角色（权限先于状态判断）：连给自己升权也不行
  const byMember = await member.client.patch(`/api/workspaces/${team.ws.id}/members/${member.user.id}`, {
    role: "admin",
  });
  expectError(byMember, 403, "forbidden");

  // 所有者改角色
  const byOwner = await team.client.patch(`/api/workspaces/${team.ws.id}/members/${member.user.id}`, {
    role: "admin",
  });
  expectStatus(byOwner, 200);
  expect(byOwner.body?.member?.role, byOwner.text).toBe("admin");
  expect(byOwner.body?.member?.userId, byOwner.text).toBe(member.user.id);

  // 成员名单显示新角色
  const members = await team.client.get(`/api/workspaces/${team.ws.id}/members`);
  expectStatus(members, 200);
  const row = (members.body?.members ?? []).find((m: any) => m.userId === member.user.id);
  expect(row, JSON.stringify(members.body)).toBeTruthy();
  expect(row.role).toBe("admin");

  // /api/me 里的 membership 也同步
  const me = await member.client.get("/api/me");
  expectStatus(me, 200);
  const membership = (me.body?.memberships ?? []).find((m: any) => m.workspaceId === team.ws.id);
  expect(membership, JSON.stringify(me.body)).toBeTruthy();
  expect(membership.role).toBe("admin");

  // 工作区详情里的 role 也同步
  const ws = await member.client.get(`/api/workspaces/${team.ws.id}`);
  expectStatus(ws, 200);
  expect(ws.body?.role, ws.text).toBe("admin");
});
