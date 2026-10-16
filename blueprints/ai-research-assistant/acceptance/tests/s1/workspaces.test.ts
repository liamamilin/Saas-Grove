import { describe, expect, it } from "vitest";
import {
  addMember,
  expectError,
  expectStatus,
  invite,
  newEmail,
  owner,
  signup,
} from "../../lib/helpers";

describe("S1 workspaces, invitations and roles", () => {
  it("makes the creator of a workspace its owner", async () => {
    const team = await owner();
    const list = await team.client.get("/api/workspaces");
    expectStatus(list, 200);
    expect(list.body.workspaces).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: team.ws.id, role: "owner" })]),
    );

    const one = await team.client.get(`/api/workspaces/${team.ws.id}`);
    expectStatus(one, 200);
    expect(one.body.role).toBe("owner");

    const me = await team.client.get("/api/me");
    expect(me.body.memberships).toEqual(
      expect.arrayContaining([expect.objectContaining({ workspaceId: team.ws.id, role: "owner" })]),
    );

    const members = await team.client.get(`/api/workspaces/${team.ws.id}/members`);
    expectStatus(members, 200);
    expect(members.body.members).toEqual([expect.objectContaining({ userId: team.user.id, role: "owner" })]);
  });

  it("accepts only JSON for state changes", async () => {
    const { client } = await signup();
    expectStatus(await client.post("/api/workspaces", { name: "json works" }), 201);
    const form = await client.request("POST", "/api/workspaces", {
      body: "name=form-post",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expectError(form, 415, "unsupported_media_type");
  });

  it("hides a workspace from non-members with 404", async () => {
    const team = await owner();
    expectStatus(await team.client.get(`/api/workspaces/${team.ws.id}`), 200);

    const outsider = await signup();
    expectError(await outsider.client.get(`/api/workspaces/${team.ws.id}`), 404, "not_found");
    expectError(await outsider.client.get(`/api/workspaces/${team.ws.id}/members`), 404, "not_found");
    const theirs = await outsider.client.get("/api/workspaces");
    expect(theirs.body.workspaces.map((w: any) => w.id)).not.toContain(team.ws.id);
  });

  it("adds an invited user with the invited role", async () => {
    const team = await owner();
    const member = await addMember(team, "member");
    const view = await member.client.get(`/api/workspaces/${team.ws.id}`);
    expectStatus(view, 200);
    expect(view.body.role).toBe("member");

    const members = await team.client.get(`/api/workspaces/${team.ws.id}/members`);
    expect(members.body.members).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: member.user.id, role: "member" })]),
    );
  });

  it("invites an email that has no account yet", async () => {
    const team = await owner();
    const email = newEmail("future");
    const token = await invite(team.client, team.ws.id, email, "member");

    const later = await signup({ email });
    expectError(await later.client.get(`/api/workspaces/${team.ws.id}`), 404, "not_found");
    const accepted = await later.client.post("/api/invitations/accept", { token });
    expectStatus(accepted, 200);
    expect(accepted.body.role).toBe("member");
    expectStatus(await later.client.get(`/api/workspaces/${team.ws.id}`), 200);
  });

  it("lets only the invited email accept an invitation, and only once", async () => {
    const team = await owner();
    const invitee = await signup({ email: newEmail("invitee") });
    const stranger = await signup();
    // Invited with different capitalisation: matching is case-insensitive.
    const token = await invite(team.client, team.ws.id, invitee.email.toUpperCase(), "member");

    expectError(await stranger.client.post("/api/invitations/accept", { token }), 403, "forbidden");
    const ok = await invitee.client.post("/api/invitations/accept", { token });
    expectStatus(ok, 200);
    expect(ok.body.workspaceId).toBe(team.ws.id);
    expectError(await invitee.client.post("/api/invitations/accept", { token }), 400, "invalid_token");
    expectError(await stranger.client.get(`/api/workspaces/${team.ws.id}`), 404, "not_found");
  });

  it("does not let members manage the team", async () => {
    const team = await owner();
    const member = await addMember(team, "member");
    const other = await addMember(team, "member");
    const ws = team.ws.id;

    expectStatus(await team.client.post(`/api/workspaces/${ws}/invitations`, { email: newEmail(), role: "member" }), 201);
    expectError(await member.client.post(`/api/workspaces/${ws}/invitations`, { email: newEmail(), role: "member" }), 403, "forbidden");
    expectError(await member.client.patch(`/api/workspaces/${ws}/members/${other.user.id}`, { role: "admin" }), 403, "forbidden");
    expectError(await member.client.del(`/api/workspaces/${ws}/members/${other.user.id}`), 403, "forbidden");
  });

  it("lets admins invite and remove members, but not change roles or remove owners", async () => {
    const team = await owner();
    const admin = await addMember(team, "admin");
    const member = await addMember(team, "member");
    const ws = team.ws.id;

    expectStatus(await admin.client.post(`/api/workspaces/${ws}/invitations`, { email: newEmail(), role: "member" }), 201);
    expectError(await admin.client.patch(`/api/workspaces/${ws}/members/${member.user.id}`, { role: "admin" }), 403, "forbidden");
    expectError(await admin.client.del(`/api/workspaces/${ws}/members/${team.user.id}`), 403, "forbidden");
    expectStatus(await admin.client.del(`/api/workspaces/${ws}/members/${member.user.id}`), 204);
  });

  it("lets the owner change roles but never leaves a workspace without an owner", async () => {
    const team = await owner();
    const member = await addMember(team, "member");
    const ws = team.ws.id;

    const promoted = await team.client.patch(`/api/workspaces/${ws}/members/${member.user.id}`, { role: "admin" });
    expectStatus(promoted, 200);
    expect((await member.client.get(`/api/workspaces/${ws}`)).body.role).toBe("admin");

    expectError(await team.client.patch(`/api/workspaces/${ws}/members/${team.user.id}`, { role: "admin" }), 409, "last_owner");
    expectError(await team.client.del(`/api/workspaces/${ws}/members/${team.user.id}`), 409, "last_owner");

    expectStatus(await team.client.patch(`/api/workspaces/${ws}/members/${member.user.id}`, { role: "owner" }), 200);
    expectStatus(await team.client.patch(`/api/workspaces/${ws}/members/${team.user.id}`, { role: "member" }), 200);
  });

  it("cuts off a removed member immediately", async () => {
    const team = await owner();
    const member = await addMember(team, "member");
    const ws = team.ws.id;
    expectStatus(await member.client.get(`/api/workspaces/${ws}`), 200);

    expectStatus(await team.client.del(`/api/workspaces/${ws}/members/${member.user.id}`), 204);
    expectError(await member.client.get(`/api/workspaces/${ws}`), 404, "not_found");
    const list = await member.client.get("/api/workspaces");
    expect(list.body.workspaces.map((w: any) => w.id)).not.toContain(ws);
  });
});
