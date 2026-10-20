// Acceptance stage S4 — deletion semantics.
//
// Derived from:
//   api.yaml DELETE /api/workspaces/{ws} — "Owner only. Everything in
//     the workspace becomes unreachable."
//   api.yaml DELETE /api/workspaces/{ws}/documents/{id} — "Uploader,
//     admin or owner."
//   api.yaml §workspaces/{ws} general rule — 404 not_found when the
//     caller is not a member; 403 forbidden when permission is missing.

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
  startJob,
  uid,
  waitForJob,
} from "../../lib/helpers";

const LATENCY = 40;

async function boot() {
  const owner = await signup();
  const ws = await owner.client.post("/api/workspaces", { name: `Del-${uid()}` });
  expectStatus(ws, 201);
  const docs = [
    await addText(owner.client, ws.body.workspace.id, SOLAR),
    await addText(owner.client, ws.body.workspace.id, COFFEE),
  ];
  return { owner, ws: ws.body.workspace, docs };
}

describe("holdout: workspace deletion (api.yaml §workspaces/{ws} DELETE)", () => {
  beforeEach(() => fakeModel.set({ latencyMs: LATENCY }));
  afterEach(() => fakeModel.reset());
  isolateFakeModel();

  test("owner can delete the workspace; documents/members become unreachable to everyone (api.yaml §workspaces DELETE — Everything in the workspace becomes unreachable)", async () => {
    const { owner, ws, docs } = await boot();
    const member = await addMember({ ...(owner as any), ws }, "member");
    expectStatus(
      await member.client.get(`/api/workspaces/${ws.id}/documents/${docs[0].id}`),
      200,
    );
    expectStatus(await owner.client.del(`/api/workspaces/${ws.id}`), 204);

    // Owner can no longer see it; members/outsiders get 404 by the §workspaces rule.
    expectError(await owner.client.get(`/api/workspaces/${ws.id}`), 404, "not_found");
    expectError(
      await member.client.get(`/api/workspaces/${ws.id}/documents/${docs[0].id}`),
      404,
      "not_found",
    );
  });

  test("only the owner can delete the workspace — admin/member are 403, outsider is 404 (api.yaml §workspaces DELETE — Owner only)", async () => {
    const { owner, ws } = await boot();
    const admin = await addMember({ ...(owner as any), ws }, "admin");
    const member = await addMember({ ...(owner as any), ws }, "member");
    const outsider = await signup();

    expectError(await admin.client.del(`/api/workspaces/${ws.id}`), 403, "forbidden");
    expectError(await member.client.del(`/api/workspaces/${ws.id}`), 403, "forbidden");
    expectError(await outsider.client.del(`/api/workspaces/${ws.id}`), 404, "not_found");
    expectStatus(await owner.client.get(`/api/workspaces/${ws.id}`), 200);
  });
});

describe("holdout: document deletion (api.yaml §documents DELETE)", () => {
  beforeEach(() => fakeModel.set({ latencyMs: LATENCY }));
  afterEach(() => fakeModel.reset());
  isolateFakeModel();

  test("uploader/admin/owner can delete a document; a plain member cannot (api.yaml §documents DELETE — Uploader, admin or owner)", async () => {
    const { owner, ws, docs } = await boot();
    const member = await addMember({ ...(owner as any), ws }, "member");
    const admin = await addMember({ ...(owner as any), ws }, "admin");
    const ownerDoc = docs[0].id;
    const adminDoc = docs[1].id;

    expectStatus(await owner.client.del(`/api/workspaces/${ws.id}/documents/${ownerDoc}`), 204);
    expectStatus(await admin.client.del(`/api/workspaces/${ws.id}/documents/${adminDoc}`), 204);
    const fresh = await addText(owner.client, ws.id, SOLAR);
    expectError(
      await member.client.del(`/api/workspaces/${ws.id}/documents/${fresh.id}`),
      403,
      "forbidden",
    );
    const outsider = await signup();
    expectError(
      await outsider.client.del(`/api/workspaces/${ws.id}/documents/${fresh.id}`),
      404,
      "not_found",
    );
  });

  test("deleted documents disappear from listings and 404 on direct GET; new jobs that reference the deleted doc fail with 404 not_found (api.yaml §research-jobs POST — 404 when doc unknown)", async () => {
    const { owner, ws, docs } = await boot();
    expectStatus(await owner.client.del(`/api/workspaces/${ws.id}/documents/${docs[1].id}`), 204);
    expectError(
      await owner.client.get(`/api/workspaces/${ws.id}/documents/${docs[1].id}`),
      404,
      "not_found",
    );
    const list = await owner.client.get(`/api/workspaces/${ws.id}/documents`);
    expectStatus(list, 200);
    const ids = (list.body.documents as any[]).map((d) => d.id);
    expect(ids).not.toContain(docs[1].id);
    expect(ids).toContain(docs[0].id);

    const queued = await owner.client.post(`/api/workspaces/${ws.id}/research-jobs`, {
      question: "still about the deleted doc?",
      documentIds: [docs[0].id, docs[1].id],
    });
    expectError(queued, 404, "not_found");
  });
});
