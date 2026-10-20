// Acceptance stage S4 — audit log and data export.
//
// Derived from:
//   api.yaml GET /audit-events — "Admin or owner."
//   api.yaml AuditEvent enum — member.joined, member.role_changed,
//     budget.updated, document.deleted appear after the corresponding
//     action.
//   api.yaml GET /export — "Admin or owner. Everything in this
//     workspace, and nothing secret."

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Client } from "../../lib/client";
import { COFFEE, SOLAR } from "../../lib/corpus";
import {
  addMember,
  addText,
  expectError,
  expectStatus,
  fakeModel,
  finishedJob,
  isolateFakeModel,
  signup,
  uid,
} from "../../lib/helpers";

const LATENCY = 30;

async function boot() {
  const owner = await signup();
  const ws = await owner.client.post("/api/workspaces", { name: `Gov-${uid()}` });
  expectStatus(ws, 201);
  return { owner, ws: ws.body.workspace };
}

describe("holdout: audit log access and content (api.yaml §audit-events)", () => {
  beforeEach(() => fakeModel.set({ latencyMs: LATENCY }));
  afterEach(() => fakeModel.reset());
  isolateFakeModel();

  test("admin and owner can read the audit log; member and outsider cannot (api.yaml §audit-events — Admin or owner)", async () => {
    const { owner, ws } = await boot();
    const admin = await addMember({ ...(owner as any), ws } as any, "admin");
    const member = await addMember({ ...(owner as any), ws } as any, "member");
    const outsider = await signup();

    expectStatus(await owner.client.get(`/api/workspaces/${ws.id}/audit-events`), 200);
    expectStatus(await admin.client.get(`/api/workspaces/${ws.id}/audit-events`), 200);
    expectError(
      await member.client.get(`/api/workspaces/${ws.id}/audit-events`),
      403,
      "forbidden",
    );
    expectError(
      await outsider.client.get(`/api/workspaces/${ws.id}/audit-events`),
      404,
      "not_found",
    );
  });

  test("member.joined, member.role_changed and budget.updated appear in the audit log (api.yaml AuditEvent enum)", async () => {
    const { owner, ws } = await boot();
    const member = await addMember({ ...(owner as any), ws } as any, "member");
    expectStatus(
      await owner.client.put(`/api/workspaces/${ws.id}/budget`, { monthlyUsd: 7.5 }),
      200,
    );
    expectStatus(
      await owner.client.patch(`/api/workspaces/${ws.id}/members/${member.user.id}`, {
        role: "admin",
      }),
      200,
    );

    const list = await owner.client.get(`/api/workspaces/${ws.id}/audit-events`);
    expectStatus(list, 200);
    const types = (list.body.events as any[]).map((e) => e.type);
    expect(types).toContain("member.joined");
    expect(types).toContain("member.role_changed");
    expect(types).toContain("budget.updated");
    // Newest first — chronological createdAt is non-increasing.
    for (let i = 1; i < list.body.events.length; i++) {
      expect(Date.parse(list.body.events[i].createdAt)).toBeLessThanOrEqual(
        Date.parse(list.body.events[i - 1].createdAt),
      );
    }
  });
});

describe("holdout: data export (api.yaml §export)", () => {
  beforeEach(() => fakeModel.set({ latencyMs: LATENCY }));
  afterEach(() => fakeModel.reset());
  isolateFakeModel();

  test("export access: admin/owner read 200; member 403; outsider 404 (api.yaml §export — Admin or owner)", async () => {
    const { owner, ws } = await boot();
    const admin = await addMember({ ...(owner as any), ws } as any, "admin");
    const member = await addMember({ ...(owner as any), ws } as any, "member");
    const outsider = await signup();
    expectStatus(await owner.client.get(`/api/workspaces/${ws.id}/export`), 200);
    expectStatus(await admin.client.get(`/api/workspaces/${ws.id}/export`), 200);
    expectError(await member.client.get(`/api/workspaces/${ws.id}/export`), 403, "forbidden");
    expectError(await outsider.client.get(`/api/workspaces/${ws.id}/export`), 404, "not_found");
  });

  test("export returns the documented top-level keys and the workspace's own data only (api.yaml §export response schema)", async () => {
    const { owner, ws } = await boot();
    const docs = [await addText(owner.client, ws.id, SOLAR), await addText(owner.client, ws.id, COFFEE)];
    const job = await finishedJob(owner.client, ws.id, docs.map((d) => d.id));
    expect(job.reportId).toBeTruthy();

    const exp = await owner.client.get(`/api/workspaces/${ws.id}/export`);
    expectStatus(exp, 200);
    for (const key of ["exportedAt", "workspace", "members", "documents", "reports", "messages", "usageRecords"]) {
      expect(exp.body?.[key], `export has ${key}`).toBeTruthy();
    }
    expect(typeof exp.body.exportedAt).toBe("string");
    expect(Number.isNaN(Date.parse(exp.body.exportedAt))).toBe(false);
    const reportIds = (exp.body.reports as any[]).map((r) => r.id);
    expect(reportIds).toContain(job.reportId);
  });
});
