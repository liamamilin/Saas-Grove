// Acceptance stage S4 — role-based permissions and last-owner protection.
//
// Derived from:
//   api.yaml §members/{userId} PATCH — Owner only. 403 before 409;
//     409 last_owner only when an owner would leave the workspace
//     without one.
//   api.yaml §members/{userId} DELETE — Admin or owner; an admin
//     cannot remove an owner; last owner cannot be removed.
//   api.yaml §invitations POST — admin or owner.
//   api.yaml /invitations/accept — single-use, case-insensitive email,
//     403 when logged in as a different email.

import { describe, expect, test } from "vitest";
import {
  addMember,
  expectError,
  expectStatus,
  newEmail,
  signup,
  uid,
} from "../../lib/helpers";

async function boot() {
  const owner = await signup();
  const ws = await owner.client.post("/api/workspaces", { name: `Roles-${uid()}` });
  expectStatus(ws, 201);
  return { owner, ws: ws.body.workspace };
}

describe("holdout: roles — owners-only write on members (api.yaml §members/{userId})", () => {
  test("PATCH role: only the owner can change roles; admin/member see 403 (api.yaml §members PATCH — Owner only)", async () => {
    const { owner, ws } = await boot();
    const admin = await addMember({ ...(owner as any), ws } as any, "admin");
    const member = await addMember({ ...(owner as any), ws } as any, "member");

    // Positive: owner promotes a member.
    const ok = await owner.client.patch(
      `/api/workspaces/${ws.id}/members/${member.user.id}`,
      { role: "admin" },
    );
    expectStatus(ok, 200);

    expectError(
      await admin.client.patch(`/api/workspaces/${ws.id}/members/${admin.user.id}`, {
        role: "member",
      }),
      403,
      "forbidden",
    );
    expectError(
      await member.client.patch(`/api/workspaces/${ws.id}/members/${member.user.id}`, {
        role: "admin",
      }),
      403,
      "forbidden",
    );
  });

  test("demoting the only owner returns 409 last_owner; a non-owner attempting the same demotion gets 403 (permission-before-state) (api.yaml §members PATCH — last_owner)", async () => {
    const { owner, ws } = await boot();
    const admin = await addMember({ ...(owner as any), ws } as any, "admin");
    const demote = await owner.client.patch(
      `/api/workspaces/${ws.id}/members/${owner.user.id}`,
      { role: "admin" },
    );
    expectError(demote, 409, "last_owner");
    // Non-owner does not get to learn that this would have been a last-owner case.
    const nonOwner = await admin.client.patch(
      `/api/workspaces/${ws.id}/members/${owner.user.id}`,
      { role: "admin" },
    );
    expectError(nonOwner, 403, "forbidden");
  });

  test("DELETE member: admin cannot remove an owner (403); the last owner cannot be removed (409) (api.yaml §members DELETE — admin cannot remove an owner; last owner cannot be removed)", async () => {
    const { owner, ws } = await boot();
    const admin = await addMember({ ...(owner as any), ws } as any, "admin");
    expectError(
      await admin.client.del(`/api/workspaces/${ws.id}/members/${owner.user.id}`),
      403,
      "forbidden",
    );
    expectError(
      await owner.client.del(`/api/workspaces/${ws.id}/members/${owner.user.id}`),
      409,
      "last_owner",
    );
  });
});

describe("holdout: invitation flow (api.yaml §invitations POST, /invitations/accept)", () => {
  test("invitations can be created only by an admin or owner; member cannot invite (api.yaml §invitations POST — admin or owner)", async () => {
    const { owner, ws } = await boot();
    const admin = await addMember({ ...(owner as any), ws } as any, "admin");
    const member = await addMember({ ...(owner as any), ws } as any, "member");

    expectStatus(
      await admin.client.post(`/api/workspaces/${ws.id}/invitations`, {
        email: newEmail("admin-inv"),
        role: "member",
      }),
      201,
    );
    expectError(
      await member.client.post(`/api/workspaces/${ws.id}/invitations`, {
        email: newEmail("member-inv"),
        role: "member",
      }),
      403,
      "forbidden",
    );
  });

  test("invitation tokens are single-use; accepting while logged in as a different email returns 403 forbidden (api.yaml /invitations/accept)", async () => {
    const { owner, ws } = await boot();
    const intended = await signup();
    const other = await signup();
    const invite = await import("../../lib/helpers");
    const token = await invite.invite(owner.client, ws.id, intended.email, "member");

    expectError(
      await other.client.post("/api/invitations/accept", { token }),
      403,
      "forbidden",
    );

    // First accept works; second use is refused.
    const first = await intended.client.post("/api/invitations/accept", { token });
    expectStatus(first, 200);
    const second = await intended.client.post("/api/invitations/accept", { token });
    expectError(second, 400, "invalid_token");
  });
});
