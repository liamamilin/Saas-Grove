// Held-out acceptance tests: what a plain member may read, what deleting a workspace does,
// and how long an invitation lives.
//
// Clauses under test:
//   * spec/product.md §2 角色表 — member "查看工作区内全部资料、任务、报告"; owner "删除工作区".
//   * spec/product.md §4.7 — 删除工作区（管理）.
//   * spec/decisions.md T8 — 邀请有效期 7 天.

import { describe, expect, test } from "vitest";
import { addMember, addText, expectError, expectStatus, finishedJob, newEmail, owner } from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

describe("membership, workspace deletion and invitations", () => {
  test("a member can read every document, job, report and usage figure of the workspace", async () => {
    // product.md §2 角色表: member 查看工作区内全部资料、任务、报告.
    const team = await owner();
    const member = await addMember(team, "member");
    const doc = await addText(team.client, team.ws.id, SOLAR);
    const job = await finishedJob(team.client, team.ws.id, [doc.id]);

    const docs = await member.client.get(`/api/workspaces/${team.ws.id}/documents`);
    expectStatus(docs, 200);
    expect(((docs.body?.documents ?? []) as any[]).some((d) => d.id === doc.id)).toBe(true);

    const jobs = await member.client.get(`/api/workspaces/${team.ws.id}/research-jobs`);
    expectStatus(jobs, 200);
    expect(((jobs.body?.jobs ?? []) as any[]).some((j) => j.id === job.id)).toBe(true);

    const reports = await member.client.get(`/api/workspaces/${team.ws.id}/reports`);
    expectStatus(reports, 200);
    expect(((reports.body?.reports ?? []) as any[]).some((r) => r.id === job.reportId)).toBe(true);

    expectStatus(await member.client.get(`/api/workspaces/${team.ws.id}/reports/${job.reportId}`), 200);
    expectStatus(await member.client.get(`/api/workspaces/${team.ws.id}`), 200);
    expectStatus(await member.client.get(`/api/workspaces/${team.ws.id}/usage`), 200);
    expectStatus(await member.client.get(`/api/workspaces/${team.ws.id}/usage/records`), 200);
  });

  test("deleting a workspace makes the workspace and its documents unreachable", async () => {
    // product.md §4.7 删除工作区; api.yaml: "Everything in the workspace becomes unreachable".
    const team = await owner();
    await addText(team.client, team.ws.id, SOLAR);
    expectStatus(await team.client.get(`/api/workspaces/${team.ws.id}`), 200);

    expectStatus(await team.client.del(`/api/workspaces/${team.ws.id}`), 204);

    expectError(await team.client.get(`/api/workspaces/${team.ws.id}/documents`), 404, "not_found");
    expectError(await team.client.get(`/api/workspaces/${team.ws.id}/research-jobs`), 404, "not_found");
    expectError(await team.client.get(`/api/workspaces/${team.ws.id}`), 404, "not_found");

    const list = await team.client.get("/api/workspaces");
    expectStatus(list, 200);
    expect(((list.body?.workspaces ?? []) as any[]).some((w) => w.id === team.ws.id)).toBe(false);
  });

  test("an invitation expires about a week after it is sent", async () => {
    // decisions.md T8: 邀请有效期 7 天; api.yaml exposes invitation.expiresAt.
    const team = await owner();
    const res = await team.client.post(`/api/workspaces/${team.ws.id}/invitations`, {
      email: newEmail("invitee"),
      role: "member",
    });
    expectStatus(res, 201);
    const expiresAt = res.body?.invitation?.expiresAt;
    expect(typeof expiresAt).toBe("string");
    const ms = Date.parse(expiresAt);
    expect(Number.isFinite(ms), `expiresAt=${expiresAt}`).toBe(true);
    const days = (ms - Date.now()) / 86_400_000;
    expect(days, `expiresAt=${expiresAt}`).toBeGreaterThan(6);
    expect(days, `expiresAt=${expiresAt}`).toBeLessThan(8);
  });
});
