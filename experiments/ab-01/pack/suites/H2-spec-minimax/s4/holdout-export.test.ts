// Data export (S4).
//
// Spec clauses verified here:
//   spec/product.md  §3 (导出内容只包含本工作区的数据) + §6 (敏感数据外泄: 接口或导出文件里
//                        出现密码哈希、会话令牌、邀请令牌)
//   spec/product.md  §2 (导出仅 admin/owner) + spec/architecture.md §4.1 (跨工作区 404)
//
// The contract fixes the export's shape; we test the spec-emphasised security
// property "no plaintext secrets in the export" and the cross-workspace 404.

import { describe, expect, test } from "vitest";
import {
  addMember,
  createWorkspace,
  expectStatus,
  finishedJob,
  invite,
  isolateFakeModel,
  newEmail,
  outbox as fetchOutbox,
  secretKeys,
  signup,
  twoDocs,
} from "../../lib/helpers";

async function exportOf(client: any, wsId: string) {
  const res = await client.get(`/api/workspaces/${wsId}/export`);
  expectStatus(res, 200);
  return res.body;
}

describe("s4: data export", () => {
  isolateFakeModel();

  test("export does not leak plaintext invite, reset or session tokens; nor any password/hash/token JSON keys", async () => {
    // spec/product.md §6 (敏感数据外泄) — the SPEC elevates this to a security
    // requirement; the contract only describes the export's shape.
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const team = { ...owner, ws };

    // Seed the workspace with content that produces sensitive tokens: invite a
    // member and request a password reset for the owner.
    const inviteeEmail = newEmail("leak");
    const invitee = await signup({ email: inviteeEmail });
    const inviteTok = await invite(owner.client, ws.id, inviteeEmail, "member");
    await invitee.client.post(`/api/invitations/accept`, { token: inviteTok });

    await addMember(team, "member");
    await owner.client.post(`/api/auth/password-reset/request`, { email: owner.email });
    const resetTok = (await fetchOutbox(owner.email, "password_reset")).token;

    // Grab the live session cookie value to assert it never appears in plaintext.
    const sessionCookies = [...owner.client.snapshot().values()];
    expect(sessionCookies.length).toBeGreaterThan(0);

    const body = await exportOf(owner.client, ws.id);
    const json = JSON.stringify(body);
    expect(json, "plaintext invite token leaks").not.toContain(inviteTok);
    expect(json, "plaintext reset token leaks").not.toContain(resetTok);
    for (const v of sessionCookies) {
      expect(json, "plaintext session cookie leaks").not.toContain(v);
    }
    // And no JSON key name should look like a password/hash/token field.
    expect(secretKeys(body), `secret keys leaked: ${secretKeys(body).join(",")}`).toEqual([]);
  });

  test("export requires admin or owner; a plain member gets 403", async () => {
    // spec/product.md §2 (导出仅 admin/owner)
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const team = { ...owner, ws };
    const member = await addMember(team, "member");
    const res = await member.client.get(`/api/workspaces/${ws.id}/export`);
    expectStatus(res, 403);
    expect(res.body?.error?.code).toBe("forbidden");
  });

  test("export of workspace A returns 404 (not 403) to a user who is not a member of A", async () => {
    // spec/architecture.md §4.1 (跨工作区隔离: 一律 404)
    const ownerA = await signup();
    const wsA = await createWorkspace(ownerA.client);
    const ownerB = await signup();
    const cross = await ownerB.client.get(`/api/workspaces/${wsA.id}/export`);
    expectStatus(cross, 404);
    expect(cross.body?.error?.code).toBe("not_found");
  });

  test("export includes report markdown with verbatim citation quotes and the per-document extracted text", async () => {
    // spec/product.md §6 (引用造假: 引用的"原文摘录"在原文里根本找不到)
    // We verify that each citation quote is a real substring of the document's
    // extracted text — this catches implementations that fabricate quotes.
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const docs = await twoDocs(owner.client, ws.id);
    const job = await finishedJob(owner.client, ws.id, [docs[0].id]);
    const rep = await owner.client.get(`/api/workspaces/${ws.id}/reports/${job.reportId}`);
    const report = rep.body.report;

    const body = await exportOf(owner.client, ws.id);
    const reportRow = body.reports.find((r: any) => r.id === report.id);
    expect(reportRow).toBeTruthy();
    expect(typeof reportRow.markdown).toBe("string");

    // For every citation: the quote must be a substring of the corresponding
    // document's extracted text.
    const docById = new Map<string, string>(body.documents.map((d: any) => [d.id, d.text as string]));
    for (const c of reportRow.citations as any[]) {
      expect(c.quote.length, `empty quote: ${JSON.stringify(c)}`).toBeGreaterThan(0);
      const text = docById.get(c.documentId);
      expect(text, `document ${c.documentId} not in export`).toBeTruthy();
      expect(text!.includes(c.quote), `quote not in doc text: ${JSON.stringify(c)}`).toBe(true);
    }
  });
});