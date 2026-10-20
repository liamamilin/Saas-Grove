// Held-out acceptance tests: the audit log records who did which sensitive action.
//
// Clauses under test:
//   * spec/product.md §3 — "Audit Event（审计事件）：记录谁在什么时候做了哪些敏感操作".
//   * spec/product.md §2 — admin 可以设置预算、查看审计日志; owner 可以修改成员角色.
//   * brief/contract/api.yaml AuditEvent.type — the event names this product uses, and
//     "actorUserId is whoever performed the action (for member.joined, the user who joined)".

import { describe, expect, test } from "vitest";
import { addMember, addText, expectStatus, invite, owner, signup } from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

async function auditEvents(client: any, wsId: string): Promise<any[]> {
  const res = await client.get(`/api/workspaces/${wsId}/audit-events`);
  expectStatus(res, 200);
  return (res.body?.events ?? []) as any[];
}

describe("audit log", () => {
  test("changing the budget is audited with the actor", async () => {
    // product.md §3 + §2 (admin 设置预算); api.yaml event type budget.updated.
    const team = await owner();
    const admin = await addMember(team, "admin");
    const put = await admin.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 5 });
    expectStatus(put, 200);

    const events = await auditEvents(team.client, team.ws.id);
    const event = events.find((e) => e.type === "budget.updated");
    expect(event, `event types: ${events.map((e) => e.type).join(",")}`).toBeTruthy();
    expect(event.actorUserId).toBe(admin.user.id);
    expect(typeof event.id).toBe("string");
    expect(typeof event.createdAt).toBe("string");
  });

  test("joining through an invitation is audited, with the joiner as actor", async () => {
    // api.yaml AuditEvent: "for member.joined, the user who joined"; event types member.invited / member.joined.
    const team = await owner();
    const account = await signup();
    const token = await invite(team.client, team.ws.id, account.email, "member");
    expectStatus(await account.client.post("/api/invitations/accept", { token }), 200);

    const events = await auditEvents(team.client, team.ws.id);
    const types = events.map((e) => e.type).join(",");
    const joined = events.find((e) => e.type === "member.joined");
    expect(joined, `event types: ${types}`).toBeTruthy();
    expect(joined.actorUserId).toBe(account.user.id);

    const invited = events.find((e) => e.type === "member.invited");
    expect(invited, `event types: ${types}`).toBeTruthy();
    expect(invited.actorUserId).toBe(team.user.id);
  });

  test("changing a member's role is audited with the owner as actor", async () => {
    // product.md §2 (owner 修改成员角色) + §3; api.yaml event type member.role_changed.
    const team = await owner();
    const member = await addMember(team, "member");
    const patch = await team.client.patch(`/api/workspaces/${team.ws.id}/members/${member.user.id}`, { role: "admin" });
    expectStatus(patch, 200);

    const events = await auditEvents(team.client, team.ws.id);
    const event = events.find((e) => e.type === "member.role_changed");
    expect(event, `event types: ${events.map((e) => e.type).join(",")}`).toBeTruthy();
    expect(event.actorUserId).toBe(team.user.id);
  });

  test("deleting a document and exporting the workspace are audited with their actor", async () => {
    // product.md §3 敏感操作; api.yaml event types document.deleted / export.created.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    expectStatus(await team.client.del(`/api/workspaces/${team.ws.id}/documents/${doc.id}`), 204);
    expectStatus(await team.client.get(`/api/workspaces/${team.ws.id}/export`), 200);

    const events = await auditEvents(team.client, team.ws.id);
    const types = events.map((e) => e.type).join(",");
    const deleted = events.find((e) => e.type === "document.deleted");
    expect(deleted, `event types: ${types}`).toBeTruthy();
    expect(deleted.actorUserId).toBe(team.user.id);

    const exported = events.find((e) => e.type === "export.created");
    expect(exported, `event types: ${types}`).toBeTruthy();
    expect(exported.actorUserId).toBe(team.user.id);
  });
});
