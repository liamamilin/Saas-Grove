// Tenant isolation.
// Clause: api.yaml conventions — "Anything under /api/workspaces/{ws} that the caller cannot
// see — because they are not a member, or the resource belongs to another workspace, or it does
// not exist — is 404 not_found." Documents, reports, usage and jobs are workspace-scoped, and
// citations must not point outside the workspace they were produced in.
import { describe, expect, it } from "vitest";
import {
  addText,
  expectError,
  expectStatus,
  finishedJob,
  owner,
  report,
  startJob,
  usageRecords,
} from "../../lib/helpers";
import { SECRET, SECRET_PHRASE, SOLAR } from "../../lib/corpus";

describe("tenant isolation", () => {
  // api.yaml: a caller who cannot see the resource gets 404 not_found.
  it("a non-member gets 404 for another workspace's document, the owner gets 200", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    // Guard: the owner can read it, so a 404-for-everything app cannot pass.
    expectStatus(await a.client.get(`/api/workspaces/${a.ws.id}/documents/${doc.id}`), 200);

    const b = await owner();
    expectError(await b.client.get(`/api/workspaces/${a.ws.id}/documents/${doc.id}`), 404, "not_found");
  });

  // api.yaml POST research-jobs: a foreign/deleted/unknown document id is 404 not_found.
  it("a research job cannot reference a document from another workspace", async () => {
    const a = await owner();
    const docA = await addText(a.client, a.ws.id, SOLAR);
    const b = await owner();
    const docB = await addText(b.client, b.ws.id, SOLAR);

    // Guard: a document of the same workspace is accepted.
    expectStatus(await startJob(a.client, a.ws.id, [docA.id]), 202);

    // A foreign document id is "unknown, deleted or in another workspace".
    expectError(await startJob(a.client, a.ws.id, [docB.id]), 404, "not_found");
  });

  // api.yaml Citation.documentId / brief: answers must be traceable to the workspace's own material.
  it("citations and answers never point at another workspace's document", async () => {
    const a = await owner();
    const docA = await addText(a.client, a.ws.id, SOLAR);
    const b = await owner();
    const docB = await addText(b.client, b.ws.id, SECRET);

    const job = await finishedJob(a.client, a.ws.id, [docA.id]);
    const rep = await report(a.client, a.ws.id, job.reportId);
    expect(rep.citations.length).toBeGreaterThan(0);
    for (const c of rep.citations) {
      expect(c.documentId, `citation points at document ${c.documentId}`).toBe(docA.id);
    }
    expect(rep.markdown).not.toContain(SECRET_PHRASE);

    // Guard: the other workspace can run its own job (the fake model works there too).
    expectStatus(await startJob(b.client, b.ws.id, [docB.id]), 202);
  });

  // api.yaml: usage, reports and members are scoped to the caller's visible workspace.
  it("usage records, reports and member lists do not cross workspaces", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    const job = await finishedJob(a.client, a.ws.id, [doc.id]);

    // Guard: the owner sees its own usage and member list.
    const mine = await usageRecords(a.client, a.ws.id, { jobId: job.id });
    expect(mine.length).toBeGreaterThan(0);
    expectStatus(await a.client.get(`/api/workspaces/${a.ws.id}/members`), 200);

    const b = await owner();
    expectError(await b.client.get(`/api/workspaces/${a.ws.id}/usage`), 404, "not_found");
    expectError(await b.client.get(`/api/workspaces/${a.ws.id}/members`), 404, "not_found");
    const bReports = await b.client.get(`/api/workspaces/${b.ws.id}/reports`);
    expectStatus(bReports, 200);
    expect((bReports.body.reports ?? []).some((r: any) => r.id === job.reportId)).toBe(false);
  });
});
