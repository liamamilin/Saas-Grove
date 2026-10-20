import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { expectError, expectStatus, owner, addMember, waitForDocument, newEmail } from "../../lib/helpers";
import { SOLAR, COFFEE, TIDES } from "../../lib/corpus";
import fs from "node:fs";
import path from "node:path";

// Contract: api.yaml /api/workspaces/{ws}/documents*, documents/{id}/text.

describe("holdout documents", () => {
  it("paste text creates a ready document with metadata (S2)", async () => {
    const t = await owner();
    const res = await t.client.post(`/api/workspaces/${t.ws.id}/documents`, { title: SOLAR.title, text: SOLAR.text });
    expectStatus(res, 201);
    const doc = res.body.document;
    expect(doc?.id).toBeTruthy();
    expect(doc?.title).toBe(SOLAR.title);
    expect(["processing", "ready"]).toContain(doc?.status);
    const ready = await waitForDocument(t.client, t.ws.id, doc.id);
    expect(ready.status).toBe("ready");
    expect(typeof ready.sizeBytes === "number" || ready.sizeBytes === undefined).toBe(true);
  });

  it("paste text validates title/text and text minLength (S2)", async () => {
    const t = await owner();
    expectError(await t.client.post(`/api/workspaces/${t.ws.id}/documents`, { title: "x", text: "" }), 400, "validation_error");
    expectError(await t.client.post(`/api/workspaces/${t.ws.id}/documents`, { title: "x" }), 400, "validation_error");
    expectError(await t.client.post(`/api/workspaces/${t.ws.id}/documents`, { text: SOLAR.text }), 400, "validation_error");
  });

  it("payload too large > 10MB (S2)", async () => {
    const t = await owner();
    const big = "a".repeat(10 * 1024 * 1024 + 100);
    const res = await t.client.post(`/api/workspaces/${t.ws.id}/documents`, { title: "big", text: big });
    expectError(res, 413, "payload_too_large");
  });

  it("document delete permissions: uploader/admin/owner; other member 403 (S4)", async () => {
    const t = await owner();
    const member = await addMember(t, "member");
    // member uploads own doc
    const r = await member.client.post(`/api/workspaces/${t.ws.id}/documents`, { title: "m", text: "hello world" });
    expectStatus(r, 201);
    const docId = r.body.document.id;
    await waitForDocument(member.client, t.ws.id, docId);
    // another member cannot delete
    const member2 = await addMember(t, "member");
    expectError(await member2.client.del(`/api/workspaces/${t.ws.id}/documents/${docId}`), 403);
    // uploader can
    expectStatus(await member.client.del(`/api/workspaces/${t.ws.id}/documents/${docId}`), 204);
    // owner can delete any
    const r2 = await t.client.post(`/api/workspaces/${t.ws.id}/documents`, { title: "o", text: "owner doc" });
    expectStatus(r2, 201);
    const doc2 = r2.body.document.id;
    await waitForDocument(t.client, t.ws.id, doc2);
    const admin = await addMember(t, "admin");
    expectStatus(await admin.client.del(`/api/workspaces/${t.ws.id}/documents/${doc2}`), 204);
  });

  it("deleted document stops taking part in new jobs (S4)", async () => {
    const t = await owner();
    const r = await t.client.post(`/api/workspaces/${t.ws.id}/documents`, { title: "d", text: "delete me" });
    expectStatus(r, 201);
    const docId = r.body.document.id;
    await waitForDocument(t.client, t.ws.id, docId);
    expectStatus(await t.client.del(`/api/workspaces/${t.ws.id}/documents/${docId}`), 204);
    const job = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "q", documentIds: [docId] });
    expectError(job, 404);
  });

  it("upload txt works; unsupported type 415 (S2)", async () => {
    const { owner, waitForDocument } = await import("../../lib/helpers");
    const t = await owner();
    const { expectStatus, expectError } = await import("../../lib/helpers");
    const up = await t.client.upload(`/api/workspaces/${t.ws.id}/documents`, { filename: "a.txt", content: "hello", mimeType: "text/plain" });
    expectStatus(up, 201);
    await waitForDocument(t.client, t.ws.id, up.body.document.id);
    const bad = await t.client.upload(`/api/workspaces/${t.ws.id}/documents`, { filename: "a.png", content: "x", mimeType: "image/png" });
    expectError(bad, 415, "unsupported_media_type");
  });

  it("document text endpoint returns extracted text (S2)", async () => {
    const { owner, waitForDocument } = await import("../../lib/helpers");
    const t = await owner();
    const { expectStatus } = await import("../../lib/helpers");
    const r = await t.client.post(`/api/workspaces/${t.ws.id}/documents`, { title: "t", text: "hello world marker" });
    expectStatus(r, 201);
    const doc = await waitForDocument(t.client, t.ws.id, r.body.document.id);
    const res = await t.client.get(`/api/workspaces/${t.ws.id}/documents/${doc.id}/text`);
    expectStatus(res, 200);
    expect(res.body.text).toContain("marker");
  });

});