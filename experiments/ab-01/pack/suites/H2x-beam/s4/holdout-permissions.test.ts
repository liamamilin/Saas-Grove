import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { PASSWORD, newEmail, owner, addMember, addText, twoDocs, startJob, getJob, expectStatus, expectError, fakeModel, isolateFakeModel } from "../../lib/helpers";
import { SOLAR, COFFEE } from "../../lib/corpus";

// Clause: product.md §2 (roles) and §6 (cross-tenant leak); architecture.md §4.1.
describe("holdout permissions and tenant isolation", () => {
  isolateFakeModel();
  it("a member cannot invite members", async () => {
    // Clause: product.md §2 role table.
    const team = await owner();
    const member = await addMember(team, "member");
    const res = await member.client.post(`/api/workspaces/${team.ws.id}/invitations`, { email: newEmail(), role: "member" });
    expect(res.status).toBe(403);
  });

  it("a member cannot set the budget, an admin can", async () => {
    // Clause: product.md §2.
    const team = await owner();
    const member = await addMember(team, "member");
    const admin = await addMember(team, "admin");
    expect((await member.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 1 })).status).toBe(403);
    expect((await admin.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 1 })).status).toBe(200);
  });

  it("a member cannot read audit events or export data", async () => {
    // Clause: product.md §2.
    const team = await owner();
    const member = await addMember(team, "member");
    expect((await member.client.get(`/api/workspaces/${team.ws.id}/audit-events`)).status).toBe(403);
    expect((await member.client.get(`/api/workspaces/${team.ws.id}/export`)).status).toBe(403);
  });

  it("a member cannot delete another user's document but can delete their own", async () => {
    // Clause: product.md §2 (delete own documents).
    const team = await owner();
    const member = await addMember(team, "member");
    const foreign = await addText(team.client, team.ws.id, COFFEE);
    const own = await addText(member.client, team.ws.id, SOLAR);
    expect((await member.client.del(`/api/workspaces/${team.ws.id}/documents/${foreign.id}`)).status).toBe(403);
    expect((await member.client.del(`/api/workspaces/${team.ws.id}/documents/${own.id}`)).status).toBe(204);
  });

  it("a member cannot cancel another member's job but can cancel their own", async () => {
    // Clause: product.md §2.
    await fakeModel.set({ latencyMs: 500 });
    const team = await owner();
    const a = await addMember(team, "member");
    const b = await addMember(team, "member");
    const docs = await twoDocs(team.client, team.ws.id);
    const ids = docs.map((d) => d.id);
    const job = await startJob(a.client, team.ws.id, ids);
    expect((await b.client.post(`/api/workspaces/${team.ws.id}/research-jobs/${job.id}/cancel`)).status).toBe(403);
    expect((await a.client.post(`/api/workspaces/${team.ws.id}/research-jobs/${job.id}/cancel`)).status).toBe(202);
  });

  it("an admin cannot remove or demote an owner", async () => {
    // Clause: product.md §2; api.yaml member delete/patch permission-before-state note.
    const team = await owner();
    const admin = await addMember(team, "admin");
    const members = (await team.client.get(`/api/workspaces/${team.ws.id}/members`)).body.members;
    const ownerMember = members.find((m: any) => m.role === "owner");
    expect((await admin.client.del(`/api/workspaces/${team.ws.id}/members/${ownerMember.userId}`)).status).toBe(403);
    expect((await admin.client.patch(`/api/workspaces/${team.ws.id}/members/${ownerMember.userId}`, { role: "admin" })).status).toBe(403);
  });

  it("the last owner cannot be removed or demoted", async () => {
    // Clause: product.md §2 (每个工作区至少保留一个 owner); api.yaml 409 last_owner.
    const team = await owner();
    const members = (await team.client.get(`/api/workspaces/${team.ws.id}/members`)).body.members;
    const self = members.find((m: any) => m.userId === team.user.id);
    expect((await team.client.patch(`/api/workspaces/${team.ws.id}/members/${self.userId}`, { role: "admin" })).status).toBe(409);
    expect((await team.client.del(`/api/workspaces/${team.ws.id}/members/${self.userId}`)).status).toBe(409);
  });

  it("cross-tenant document access returns 404, not 403", async () => {
    // Clause: product.md §6 (跨租户泄露); architecture.md §4.1.
    const a = await owner();
    const b = await owner();
    const doc = await addText(b.client, b.ws.id, SOLAR);
    expect((await a.client.get(`/api/workspaces/${b.ws.id}`)).status).toBe(404);
    expect((await a.client.get(`/api/workspaces/${b.ws.id}/documents/${doc.id}`)).status).toBe(404);
    expect((await a.client.get(`/api/workspaces/${b.ws.id}/documents/${doc.id}/text`)).status).toBe(404);
  });

  it("only an owner can delete a workspace; an admin cannot", async () => {
    // Clause: product.md §2.
    const team = await owner();
    const admin = await addMember(team, "admin");
    expect((await admin.client.del(`/api/workspaces/${team.ws.id}`)).status).toBe(403);
    expect((await team.client.del(`/api/workspaces/${team.ws.id}`)).status).toBe(204);
  });
});