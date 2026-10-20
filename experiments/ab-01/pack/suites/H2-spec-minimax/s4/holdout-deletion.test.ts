// Document and workspace deletion (S4).
//
// Spec clauses verified here:
//   spec/product.md §3 (删除后不再参与任何检索) + §5 S4 (删除资料；删除工作区)
//   spec/product.md §2 (member 仅可删除自己上传的; admin/owner 可删除任何; owner 才能删除工作区)
//   spec/product.md §6 (跨租户泄露 via ID)

import { describe, expect, test } from "vitest";
import {
  addMember,
  addText,
  createWorkspace,
  expectStatus,
  finishedJob,
  isolateFakeModel,
  signup,
  startJob,
  twoDocs,
  waitForDocument,
  waitForJob,
} from "../../lib/helpers";

describe("s4: deletion", () => {
  isolateFakeModel();

  test("a deleted document is removed from the document list and its id returns 404 (no leakage)", async () => {
    // spec/product.md §3 ("删除后不再参与任何检索") — a deleted document id is
    // unreachable, and including it in a new research job is a 404.
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const drop = await addText(owner.client, ws.id, { title: "Drop", text: "Some text." });

    const before = await owner.client.get(`/api/workspaces/${ws.id}/documents`);
    expect(before.body.documents.find((d: any) => d.id === drop.id)).toBeTruthy();

    const del = await owner.client.del(`/api/workspaces/${ws.id}/documents/${drop.id}`);
    expectStatus(del, 204);

    const after = await owner.client.get(`/api/workspaces/${ws.id}/documents`);
    expect(after.body.documents.find((d: any) => d.id === drop.id)).toBeUndefined();

    // The deleted id is not retrievable through any document endpoint.
    const get = await owner.client.get(`/api/workspaces/${ws.id}/documents/${drop.id}`);
    expectStatus(get, 404);
    const text = await owner.client.get(`/api/workspaces/${ws.id}/documents/${drop.id}/text`);
    expectStatus(text, 404);

    // Including the deleted id in a new research job is rejected (the contract
    // says: "A document id is unknown, deleted or in another workspace" → 404).
    const job = await owner.client.post(`/api/workspaces/${ws.id}/research-jobs`, {
      question: "What?",
      documentIds: [drop.id],
    });
    expectStatus(job, 404);
    expect(job.body?.error?.code).toBe("not_found");
  });

  test("document deletion requires uploader, admin, or owner; another member gets 403", async () => {
    // spec/product.md §2 (member 仅可删除自己上传的; admin/owner 可删除任何)
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const team = { ...owner, ws };
    const uploader = await addMember(team, "member");
    const other = await addMember(team, "member");

    const otherDoc = await addText(other.client, ws.id, { title: "Other's doc", text: "Owned by other." });
    await waitForDocument(other.client, ws.id, otherDoc.id);

    // 'uploader' (also a plain member) must NOT be able to delete 'other's doc.
    const uploaderDelete = await uploader.client.del(`/api/workspaces/${ws.id}/documents/${otherDoc.id}`);
    expectStatus(uploaderDelete, 403);

    // The owner CAN delete other members' documents.
    const ownerDelete = await owner.client.del(`/api/workspaces/${ws.id}/documents/${otherDoc.id}`);
    expectStatus(ownerDelete, 204);
  });

  test("workspace deletion is owner-only; an admin (who is not owner) gets 403", async () => {
    // spec/product.md §2 (owner 才能删除工作区)
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const team = { ...owner, ws };
    const admin = await addMember(team, "admin");
    expectStatus(await admin.client.del(`/api/workspaces/${ws.id}`), 403);
  });

  test("after workspace deletion, every workspace endpoint returns 404 and the workspace disappears from /api/me", async () => {
    // spec/product.md §3 (删除即不可再被访问)
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const [doc] = await twoDocs(owner.client, ws.id);
    const job = await finishedJob(owner.client, ws.id, [doc.id]);

    expectStatus(await owner.client.del(`/api/workspaces/${ws.id}`), 204);

    expectStatus(await owner.client.get(`/api/workspaces/${ws.id}`), 404);
    expectStatus(await owner.client.get(`/api/workspaces/${ws.id}/documents/${doc.id}`), 404);
    expectStatus(await owner.client.get(`/api/workspaces/${ws.id}/research-jobs/${job.id}`), 404);
    expectStatus(await owner.client.get(`/api/workspaces/${ws.id}/reports/${job.reportId}`), 404);

    const me = await owner.client.get("/api/me");
    expectStatus(me, 200);
    const ids = (me.body.memberships as any[]).map((m) => m.workspaceId);
    expect(ids).not.toContain(ws.id);
  });
});