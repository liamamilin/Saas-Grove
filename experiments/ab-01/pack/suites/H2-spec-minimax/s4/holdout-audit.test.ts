// Audit log (S4).
//
// Spec clauses verified here:
//   spec/product.md §3 (Audit Event: 谁在什么时候做了哪些敏感操作)
//   spec/product.md §5 S4 ("审计日志") + §2 (查看审计日志仅 admin/owner)
//   spec/architecture.md §4.1 (跨工作区隔离)
//
// We do NOT exhaustively test every event type — the contract enumerates the
// schema; we test the spec-emphasized properties: every sensitive action
// leaves a trail, ordering is newest-first, role enforcement, cross-workspace
// invisibility.

import { describe, expect, test } from "vitest";
import {
  addMember,
  createWorkspace,
  expectStatus,
  fakeModel,
  isolateFakeModel,
  signup,
  startJob,
  twoDocs,
  waitForJob,
} from "../../lib/helpers";
import { Client } from "../../lib/client";

interface AuditRow {
  id: string;
  type: string;
  actorUserId: string;
  targetId?: string;
  data?: any;
  createdAt: string;
}

async function auditEvents(client: Client, wsId: string): Promise<AuditRow[]> {
  const res = await client.get(`/api/workspaces/${wsId}/audit-events`);
  expectStatus(res, 200);
  return res.body.events as AuditRow[];
}

describe("s4: audit log", () => {
  isolateFakeModel();

  test("sensitive actions leave an audit trail: invite+join, role change, budget update, document delete, job cancel, export", async () => {
    // spec/product.md §3 (Audit Event: 谁在什么时候做了哪些敏感操作) — the
    // contract fixes the schema; the spec asks us to verify every category of
    // sensitive action produces a row.
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const team = { ...owner, ws };
    const member = await addMember(team, "member");
    await owner.client.patch(`/api/workspaces/${ws.id}/members/${member.user.id}`, { role: "admin" });
    await owner.client.del(`/api/workspaces/${ws.id}/members/${member.user.id}`);
    await owner.client.put(`/api/workspaces/${ws.id}/budget`, { monthlyUsd: 7 });
    const [doc] = await twoDocs(owner.client, ws.id);

    // Cancel a job (slow analyze → easy to cancel mid-flight).
    await fakeModel.set({ latencyMs: 200 });
    try {
      const slow = await startJob(owner.client, ws.id, [doc.id], "slow job");
      await waitForJob(
        owner.client,
        ws.id,
        slow.id,
        (j) => j.status === "running" || j.status === "succeeded" || j.status === "failed",
      );
      const cancel = await owner.client.post(`/api/workspaces/${ws.id}/research-jobs/${slow.id}/cancel`);
      expectStatus(cancel, 202);
      await waitForJob(owner.client, ws.id, slow.id);
    } finally {
      await fakeModel.set({ latencyMs: 20 });
    }

    await owner.client.del(`/api/workspaces/${ws.id}/documents/${doc.id}`);
    expectStatus(await owner.client.get(`/api/workspaces/${ws.id}/export`), 200);

    const events = await auditEvents(owner.client, ws.id);
    const types = new Set(events.map((e) => e.type));
    for (const expected of [
      "member.invited",
      "member.joined",
      "member.role_changed",
      "member.removed",
      "budget.updated",
      "job.canceled",
      "document.deleted",
      "export.created",
    ]) {
      expect(types.has(expected), `missing ${expected}; got: ${[...types].join(",")}`).toBe(true);
    }
  });

  test("audit log is returned newest-first (so the most recent sensitive action is at the top)", async () => {
    // spec/product.md §3 (Audit Event: 谁在什么时候) — ordering matters for
    // incident review.
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const team = { ...owner, ws };
    const member = await addMember(team, "member");
    await owner.client.patch(`/api/workspaces/${ws.id}/members/${member.user.id}`, { role: "admin" });
    await owner.client.del(`/api/workspaces/${ws.id}/members/${member.user.id}`);
    await owner.client.put(`/api/workspaces/${ws.id}/budget`, { monthlyUsd: 5 });

    const events = await auditEvents(owner.client, ws.id);
    expect(events.length).toBeGreaterThanOrEqual(3);
    const ts = events.map((e) => Date.parse(e.createdAt));
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i - 1]).toBeGreaterThanOrEqual(ts[i]);
    }
  });

  test("audit log requires admin or owner; a plain member gets 403", async () => {
    // spec/product.md §2 (查看审计日志仅 admin/owner)
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const team = { ...owner, ws };
    const member = await addMember(team, "member");
    const res = await member.client.get(`/api/workspaces/${ws.id}/audit-events`);
    expectStatus(res, 403);
    expect(res.body?.error?.code).toBe("forbidden");
  });

  test("audit events of workspace A are invisible to workspace B (404, not 403)", async () => {
    // spec/architecture.md §4.1 (跨工作区隔离: 一律 404)
    const ownerA = await signup();
    const wsA = await createWorkspace(ownerA.client);
    const ownerB = await signup();
    // Produce an event in workspace A so we know the list would otherwise be non-empty.
    await ownerA.client.put(`/api/workspaces/${wsA.id}/budget`, { monthlyUsd: 1 });
    const cross = await ownerB.client.get(`/api/workspaces/${wsA.id}/audit-events`);
    expectStatus(cross, 404);
    expect(cross.body?.error?.code).toBe("not_found");
  });
});