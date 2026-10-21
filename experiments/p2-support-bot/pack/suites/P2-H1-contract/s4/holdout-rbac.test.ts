// Held-out acceptance tests: roles and permissions.
//
// Contract source: brief/contract/api.yaml, the role summary of the global conventions:
//   "any member reads everything in the workspace, adds documents, deletes their own documents and
//   works handoffs; admin and owner also change widget settings and the budget, delete any
//   document or conversation, read the audit log and export; only the owner changes roles and
//   deletes the workspace."
//   Plus PATCH /api/workspaces/{ws}/members/{userId} ("Change a role. Owner only.", "Permission is
//   checked before state, so a non-owner always gets 403; 409 last_owner only arises when an owner
//   would leave the workspace without one"), DELETE members/{userId} ("Admin or owner; an admin
//   cannot remove an owner; the last owner cannot be removed"), POST invitations ("Admin or owner",
//   role enum [admin, member]) and POST /api/invitations/accept ("Accept as the invited email
//   (case-insensitive). Single use.").

import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import {
  addMember,
  addText,
  expectError,
  expectStatus,
  knowledgeBase,
  newEmail,
  owner,
  signup,
} from "../../lib/helpers";
import { Visitor, supportTeam } from "../../lib/widget";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";

describe("holdout: roles and permissions", () => {
  it("lets a member read everything, add material, delete their own and work with handoffs", async () => {
    // Contract: the role summary - "any member reads everything in the workspace, adds documents,
    // deletes their own documents and works handoffs".
    const team = await supportTeam();
    const member = await addMember(team, "member");
    await knowledgeBase(team.client, team.ws.id);

    for (const path of [
      "documents",
      "conversations",
      "handoffs",
      "analytics/summary",
      "analytics/questions",
      "usage",
      "usage/records",
      "widget",
    ]) {
      const res = await member.client.get(`/api/workspaces/${team.ws.id}/${path}`);
      expectStatus(res, 200);
    }
    expectStatus(await member.client.get(`/api/workspaces/${team.ws.id}`), 200);

    // The member adds material and deletes it again.
    const added = await member.client.post(`/api/workspaces/${team.ws.id}/documents`, {
      title: "Member note",
      text: "Bulbs under ten euros are not exchangeable.",
    });
    expectStatus(added, 201);
    const ownId = String(added.body?.document?.id ?? "");
    expect(ownId).not.toBe("");
    expectStatus(await member.client.del(`/api/workspaces/${team.ws.id}/documents/${ownId}`), 204);

    // The member works with handoffs: read the list, read one, resolve it.
    const visitor = await new Visitor(team.key).start();
    const handoff = await visitor.handoff({ name: "Ada", email: "ada@example.test" });
    expectStatus(handoff, 201);
    const handoffId = String(handoff.body?.handoff?.id ?? "");

    const list = await member.client.get(`/api/workspaces/${team.ws.id}/handoffs`);
    expectStatus(list, 200);
    expect((list.body?.handoffs ?? []).map((h: any) => h.id)).toContain(handoffId);

    const one = await member.client.get(`/api/workspaces/${team.ws.id}/handoffs/${handoffId}`);
    expectStatus(one, 200);
    expect(one.body?.handoff?.id).toBe(handoffId);
    expect(Array.isArray(one.body?.messages)).toBe(true);

    const resolved = await member.client.patch(`/api/workspaces/${team.ws.id}/handoffs/${handoffId}`, {
      status: "resolved",
    });
    expectStatus(resolved, 200);
    expect(resolved.body?.handoff?.status).toBe("resolved");
  });

  it("keeps the widget settings, the budget, the deletion of foreign things, the audit log and the export from members", async () => {
    // Contract: "admin and owner also change widget settings and the budget, delete any document
    // or conversation, read the audit log and export" - a member gets 403, an admin may.
    const team = await supportTeam();
    const admin = await addMember(team, "admin");
    const member = await addMember(team, "member");
    const doc = await addText(team.client, team.ws.id, REFUNDS);
    const visitor = await new Visitor(team.key).start();
    const conversationId = visitor.id;

    const refused = [
      await member.client.patch(`/api/workspaces/${team.ws.id}/widget`, { botName: "Nope" }),
      await member.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 5 }),
      await member.client.del(`/api/workspaces/${team.ws.id}/documents/${doc.id}`),
      await member.client.del(`/api/workspaces/${team.ws.id}/conversations/${conversationId}`),
      await member.client.get(`/api/workspaces/${team.ws.id}/audit-events`),
      await member.client.get(`/api/workspaces/${team.ws.id}/export`),
    ];
    for (const res of refused) {
      expectError(res, 403, "forbidden");
    }

    // The admin may do all of it.
    expectStatus(await admin.client.patch(`/api/workspaces/${team.ws.id}/widget`, { botName: "Lamp Bot" }), 200);
    expectStatus(await admin.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 5 }), 200);
    expectStatus(await admin.client.del(`/api/workspaces/${team.ws.id}/documents/${doc.id}`), 204);
    expectStatus(await admin.client.del(`/api/workspaces/${team.ws.id}/conversations/${conversationId}`), 204);
    expectStatus(await admin.client.get(`/api/workspaces/${team.ws.id}/audit-events`), 200);
    expectStatus(await admin.client.get(`/api/workspaces/${team.ws.id}/export`), 200);
  });

  it("leaves the roles and the workspace to the owner alone", async () => {
    // Contract: "only the owner changes roles and deletes the workspace"; PATCH members "Permission
    // is checked before state, so a non-owner always gets 403; 409 last_owner only arises when an
    // owner would leave the workspace without one."
    const team = await owner();
    const admin = await addMember(team, "admin");
    const member = await addMember(team, "member");

    expectError(
      await admin.client.patch(`/api/workspaces/${team.ws.id}/members/${member.user.id}`, { role: "admin" }),
      403,
      "forbidden",
    );
    expectError(await admin.client.del(`/api/workspaces/${team.ws.id}`), 403, "forbidden");

    const promoted = await team.client.patch(`/api/workspaces/${team.ws.id}/members/${member.user.id}`, {
      role: "admin",
    });
    expectStatus(promoted, 200);
    expect(promoted.body?.member?.role).toBe("admin");

    // The last owner is protected: 409 for an owner, 403 for an admin.
    expectError(
      await team.client.patch(`/api/workspaces/${team.ws.id}/members/${team.user.id}`, { role: "member" }),
      409,
      "last_owner",
    );
    expectError(
      await admin.client.del(`/api/workspaces/${team.ws.id}/members/${team.user.id}`),
      403,
      "forbidden",
    );
    expectError(
      await team.client.del(`/api/workspaces/${team.ws.id}/members/${team.user.id}`),
      409,
      "last_owner",
    );
  });

  it("lets only the invited email accept an invitation, and only once", async () => {
    // Contract: POST invitations -> "Admin or owner", role enum [admin, member]; POST
    // /api/invitations/accept -> "Accept as the invited email (case-insensitive). Single use.",
    // 400 invalid_token, 403 "Logged in as a different email".
    const team = await owner();
    const admin = await addMember(team, "admin");
    const member = await addMember(team, "member");
    const guestEmail = "Guest-" + newEmail("guest").split("@")[0] + "@Example.test";

    expectError(
      await member.client.post(`/api/workspaces/${team.ws.id}/invitations`, { email: guestEmail, role: "member" }),
      403,
      "forbidden",
    );
    expectError(
      await admin.client.post(`/api/workspaces/${team.ws.id}/invitations`, { email: guestEmail, role: "owner" }),
      400,
      "validation_error",
    );

    const invited = await admin.client.post(`/api/workspaces/${team.ws.id}/invitations`, {
      email: guestEmail,
      role: "member",
    });
    expectStatus(invited, 201);
    expect(String(invited.body?.invitation?.email ?? "").toLowerCase()).toBe(guestEmail.toLowerCase());
    expect(String(invited.body?.invitation?.role ?? "")).toBe("member");
    expect(String(invited.body?.invitation?.expiresAt ?? "")).not.toBe("");

    const token = await invitationToken(guestEmail);

    const stranger = await signup();
    expectError(await stranger.client.post("/api/invitations/accept", { token }), 403, "forbidden");

    // The invited email, in a different case, may accept it.
    const guest = await signup({ email: guestEmail.toLowerCase(), name: "Guest" });
    const accepted = await guest.client.post("/api/invitations/accept", { token });
    expectStatus(accepted, 200);
    expect(accepted.body?.workspaceId).toBe(team.ws.id);
    expect(accepted.body?.role).toBe("member");

    expectError(await guest.client.post("/api/invitations/accept", { token }), 400, "invalid_token");
  });
});

/** The token of the invitation email sent to `email`, whatever case the product stored it in. */
async function invitationToken(email: string): Promise<string> {
  for (const candidate of [email, email.toLowerCase(), email.toUpperCase()]) {
    const res = await new Client().get(`/api/__test__/outbox?to=${encodeURIComponent(candidate)}`);
    if (res.status !== 200) continue;
    const messages = (res.body?.messages ?? []).filter((m: any) => m.template === "invitation");
    if (messages.length) return String(messages[messages.length - 1].token);
  }
  throw new Error(`no invitation email was sent to ${email}`);
}
