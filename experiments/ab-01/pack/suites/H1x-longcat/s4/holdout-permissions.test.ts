// Permissions per role.
// Clause: api.yaml — "A member lacking the role is 403"; owner-only endpoints (workspace
// delete, role change); admin/owner-only endpoints (budget, audit events, invitations, document
// delete, job cancel); and "Permission is checked before state".
import { describe, expect, it } from "vitest";
import {
  addMember,
  addText,
  expectError,
  expectStatus,
  fakeModel,
  newEmail,
  owner,
  startJob,
  waitForJob,
} from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

describe("role permissions", () => {
  // api.yaml: budget and audit-events are admin/owner only; a member lacking the role is 403.
  it("a member can read the workspace but cannot change the budget or read audit events", async () => {
    const a = await owner();
    await addText(a.client, a.ws.id, SOLAR);
    const member = await addMember(a, "member");

    // Guard: the member can read.
    expectStatus(await member.client.get(`/api/workspaces/${a.ws.id}/documents`), 200);
    expectStatus(await member.client.get(`/api/workspaces/${a.ws.id}/members`), 200);

    expectError(await member.client.put(`/api/workspaces/${a.ws.id}/budget`, { monthlyUsd: 1 }), 403, "forbidden");
    expectError(await member.client.get(`/api/workspaces/${a.ws.id}/audit-events`), 403, "forbidden");
  });

  // api.yaml DELETE /workspaces/{ws}: owner only, 403 for a member lacking the role.
  it("an admin cannot delete the workspace, the owner can", async () => {
    const a = await owner();
    const admin = await addMember(a, "admin");
    expectStatus(await a.client.get(`/api/workspaces/${a.ws.id}`), 200); // guard

    expectError(await admin.client.del(`/api/workspaces/${a.ws.id}`), 403, "forbidden");
    expectStatus(await a.client.del(`/api/workspaces/${a.ws.id}`), 204);
    expectError(await a.client.get(`/api/workspaces/${a.ws.id}`), 404, "not_found");
  });

  // api.yaml DELETE/PATCH members: an admin cannot remove or demote an owner (403, permission before state).
  it("an admin cannot remove or demote the owner", async () => {
    const a = await owner();
    const admin = await addMember(a, "admin");
    expectStatus(await admin.client.get(`/api/workspaces/${a.ws.id}/members`), 200); // guard

    expectError(await admin.client.del(`/api/workspaces/${a.ws.id}/members/${a.user.id}`), 403, "forbidden");
    expectError(
      await admin.client.patch(`/api/workspaces/${a.ws.id}/members/${a.user.id}`, { role: "member" }),
      403,
      "forbidden",
    );
  });

  // api.yaml PATCH members: 409 last_owner only when an owner would leave the workspace without one.
  it("the last owner cannot demote itself (409 last_owner)", async () => {
    const a = await owner();
    expectStatus(await a.client.get(`/api/workspaces/${a.ws.id}/members`), 200); // guard
    expectError(
      await a.client.patch(`/api/workspaces/${a.ws.id}/members/${a.user.id}`, { role: "member" }),
      409,
      "last_owner",
    );
  });

  // api.yaml POST invitations: admin/owner only; the role enum is [admin, member].
  it("a member cannot invite; an invalid invitation role is rejected", async () => {
    const a = await owner();
    const member = await addMember(a, "member");
    expectError(
      await member.client.post(`/api/workspaces/${a.ws.id}/invitations`, { email: newEmail(), role: "member" }),
      403,
      "forbidden",
    );

    // Guard: the owner can invite with a valid role (the role enum is [admin, member]).
    expectStatus(
      await a.client.post(`/api/workspaces/${a.ws.id}/invitations`, { email: newEmail(), role: "admin" }),
      201,
    );
    expectError(
      await a.client.post(`/api/workspaces/${a.ws.id}/invitations`, { email: newEmail(), role: "owner" }),
      400,
      "validation_error",
    );
  });

  // api.yaml POST cancel: creator, an admin or the owner; a member lacking the role is 403.
  it("a member who is not the creator cannot cancel a running job", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    const member = await addMember(a, "member");
    await fakeModel.set({ latencyMs: 400 });

    const job = await startJob(a.client, a.ws.id, [doc.id]);
    await waitForJob(a.client, a.ws.id, job.id, (j) => j.status === "running" || Boolean(j.startedAt), 30_000);

    expectStatus(await member.client.get(`/api/workspaces/${a.ws.id}/research-jobs/${job.id}`), 200); // guard
    expectError(
      await member.client.post(`/api/workspaces/${a.ws.id}/research-jobs/${job.id}/cancel`),
      403,
      "forbidden",
    );
    // Guard: the creator can cancel.
    expectStatus(await a.client.post(`/api/workspaces/${a.ws.id}/research-jobs/${job.id}/cancel`), 202);
    await waitForJob(a.client, a.ws.id, job.id, (j) => j.status === "canceled", 15_000);
  });
});
