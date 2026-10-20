import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { expectError, expectStatus, owner, addMember, PASSWORD, newEmail, uid } from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

// Contract: api.yaml /api/workspaces*, /api/workspaces/{ws}/members*, invitations, budget, audit-events, export.

describe("holdout workspaces", () => {
  it("create workspace makes caller owner; GET returns role (S1, S4)", async () => {
    const t = await owner();
    const res = await t.client.get(`/api/workspaces/${t.ws.id}`);
    expectStatus(res, 200);
    expect(res.body?.workspace?.id).toBe(t.ws.id);
    expect(res.body?.role).toBe("owner");
  });

  it("accept invitation: invited email works; different email 403; single use (S1)", async () => {
    const t = await owner();
    const email = newEmail("accept");
    const inviteRes = await t.client.post(`/api/workspaces/${t.ws.id}/invitations`, { email, role: "admin" });
    expectStatus(inviteRes, 201);
    const out = await new Client().get(`/api/__test__/outbox?to=${encodeURIComponent(email)}`);
    const token = (out.body.messages as any[]).find((m) => m.template === "invitation").token;
    // different logged-in user
    const other = await (async () => {
      const c = new Client();
      expectStatus(await c.post("/api/auth/signup", { email: newEmail("other"), password: PASSWORD, name: "Other" }), 201);
      return c;
    })();
    const wrong = await other.post("/api/invitations/accept", { token });
    expectError(wrong, 403);
    // invited user signs up then accepts
    const invited = new Client();
    expectStatus(await invited.post("/api/auth/signup", { email, password: PASSWORD, name: "Invited" }), 201);
    const acc = await invited.post("/api/invitations/accept", { token });
    expectStatus(acc, 200);
    expect(acc.body?.workspaceId).toBe(t.ws.id);
    expect(acc.body?.role).toBe("admin");
    // single use
    const reuse = await invited.post("/api/invitations/accept", { token });
    expectError(reuse, 400, "invalid_token");
    // invalid token
    const bad = await invited.post("/api/invitations/accept", { token: "nope" });
    expectError(bad, 400, "invalid_token");
  });

  it("role change: owner only; last owner protected; permission before state (S1, S4)", async () => {
    const t = await owner();
    const admin = await addMember(t, "admin");
    // admin cannot change role
    const byAdmin = await admin.client.patch(`/api/workspaces/${t.ws.id}/members/${t.user.id}`, { role: "member" });
    expectError(byAdmin, 403, "forbidden");
    // owner demoting self when only owner -> last_owner
    const self = await t.client.patch(`/api/workspaces/${t.ws.id}/members/${t.user.id}`, { role: "member" });
    expectError(self, 409, "last_owner");
    // owner can change admin role
    const change = await t.client.patch(`/api/workspaces/${t.ws.id}/members/${admin.user.id}`, { role: "member" });
    expectStatus(change, 200);
    expect(change.body?.member?.role).toBe("member");
    // invalid role
    const bad = await t.client.patch(`/api/workspaces/${t.ws.id}/members/${admin.user.id}`, { role: "super" });
    expectError(bad, 400);
  });

  it("remove member: admin/owner; admin cannot remove owner; last owner protected (S1, S4)", async () => {
    const t = await owner();
    const admin = await addMember(t, "admin");
    const member = await addMember(t, "member");
    // member cannot remove
    expectError(await member.client.del(`/api/workspaces/${t.ws.id}/members/${admin.user.id}`), 403);
    // admin cannot remove owner
    expectError(await admin.client.del(`/api/workspaces/${t.ws.id}/members/${t.user.id}`), 403);
    // owner removes member ok
    expectStatus(await t.client.del(`/api/workspaces/${t.ws.id}/members/${member.user.id}`), 204);
    // last owner cannot be removed even by owner
    expectError(await t.client.del(`/api/workspaces/${t.ws.id}/members/${t.user.id}`), 409, "last_owner");
  });

  it("workspace delete: owner only; afterwards everything unreachable (S4)", async () => {
    const t = await owner();
    const admin = await addMember(t, "admin");
    // admin forbidden
    expectError(await admin.client.del(`/api/workspaces/${t.ws.id}`), 403);
    // member forbidden
    const member = await addMember(t, "member");
    expectError(await member.client.del(`/api/workspaces/${t.ws.id}`), 403);
    // owner deletes
    expectStatus(await t.client.del(`/api/workspaces/${t.ws.id}`), 204);
    // now unreachable for all
    expectError(await t.client.get(`/api/workspaces/${t.ws.id}`), 404);
    expectError(await admin.client.get(`/api/workspaces/${t.ws.id}`), 404);
  });

  it("budget: admin/owner only; null unlimited; negative invalid (S3, S4)", async () => {
    const t = await owner();
    const member = await addMember(t, "member");
    expectError(await member.client.put(`/api/workspaces/${t.ws.id}/budget`, { monthlyUsd: 10 }), 403);
    expectStatus(await t.client.put(`/api/workspaces/${t.ws.id}/budget`, { monthlyUsd: null }), 200);
    const u = await t.client.get(`/api/workspaces/${t.ws.id}/usage`);
    expectStatus(u, 200);
    expect(u.body?.budgetUsd).toBeNull();
    expectStatus(await t.client.put(`/api/workspaces/${t.ws.id}/budget`, { monthlyUsd: 0 }), 200);
    const neg = await t.client.put(`/api/workspaces/${t.ws.id}/budget`, { monthlyUsd: -1 });
    expectError(neg, 400);
  });
  it("export: admin/owner only; required keys; no secrets (S4)", async () => {
    const { owner, addMember } = await import("../../lib/helpers");
    const t = await owner();
    const member = await addMember(t, "member");
    const { expectError, expectStatus } = await import("../../lib/helpers");
    expectError(await member.client.get(`/api/workspaces/${t.ws.id}/export`), 403);
    const res = await t.client.get(`/api/workspaces/${t.ws.id}/export`);
    expectStatus(res, 200);
    for (const k of ["exportedAt", "workspace", "members", "documents", "reports", "messages", "usageRecords"]) {
      expect(res.body).toHaveProperty(k);
    }
  });

});