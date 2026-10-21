import { expect, it } from "vitest";
import { addMember, expectError, expectStatus, owner } from "../../lib/helpers";

// G17: 设置月度预算。
// 依据 api.yaml：
//   PUT /api/workspaces/{ws}/budget — "Admin or owner. null means unlimited. A new workspace starts
//     at 10."（200 { budgetUsd } / 400 / 403）
//   GET /api/workspaces/{ws}/usage — "This calendar month (UTC). Any member."
//     （{ periodStart, periodEnd, spentUsd, budgetUsd }）

it("G17: 管理员和所有者能设月度预算，普通成员不能", async () => {
  const team = await owner();
  const admin = await addMember(team, "admin");
  const member = await addMember(team, "member");

  // 新工作区的默认预算是 10
  const usage = await member.client.get(`/api/workspaces/${team.ws.id}/usage`);
  expectStatus(usage, 200);
  expect(usage.body?.budgetUsd, usage.text).toBe(10);
  expect(usage.body?.spentUsd, usage.text).toBe(0);
  expect(typeof usage.body?.periodStart, usage.text).toBe("string");
  expect(typeof usage.body?.periodEnd, usage.text).toBe("string");

  // 普通成员设不了
  const byMember = await member.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 5 });
  expectError(byMember, 403, "forbidden");

  // 所有者设
  const byOwner = await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 25 });
  expectStatus(byOwner, 200);
  expect(byOwner.body?.budgetUsd, byOwner.text).toBe(25);
  const reread = await team.client.get(`/api/workspaces/${team.ws.id}/usage`);
  expectStatus(reread, 200);
  expect(reread.body?.budgetUsd, reread.text).toBe(25);

  // 管理员也能设
  const byAdmin = await admin.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 12.5 });
  expectStatus(byAdmin, 200);
  expect(byAdmin.body?.budgetUsd, byAdmin.text).toBe(12.5);

  // null = 不限额度
  const unlimited = await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: null });
  expectStatus(unlimited, 200);
  expect(unlimited.body?.budgetUsd, unlimited.text).toBeNull();
  const after = await team.client.get(`/api/workspaces/${team.ws.id}/usage`);
  expectStatus(after, 200);
  expect(after.body?.budgetUsd, after.text).toBeNull();

  // 负数不合法
  const negative = await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: -1 });
  expectError(negative, 400, "validation_error");
});
