// Deletion semantics.
// Clause: api.yaml — deleting a document makes it "stop taking part in retrieval and new jobs"
// (a new job referencing it is 404), deleting a workspace makes everything in it unreachable,
// and document deletion needs the uploader, an admin or the owner.
import { describe, expect, it } from "vitest";
import { addMember, addText, expectError, expectStatus, finishedJob, owner, startJob } from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

describe("deletion", () => {
  // api.yaml DELETE document: it "stops taking part in retrieval and new jobs"; new jobs referencing it are 404.
  it("a deleted document can no longer be used by a new research job", async () => {
    const a = await owner();
    const doc1 = await addText(a.client, a.ws.id, SOLAR);
    const doc2 = await addText(a.client, a.ws.id, SOLAR);
    // Guard: both documents are usable before deletion.
    expectStatus(await startJob(a.client, a.ws.id, [doc1.id, doc2.id]), 202);

    expectStatus(await a.client.del(`/api/workspaces/${a.ws.id}/documents/${doc1.id}`), 204);
    expectError(await startJob(a.client, a.ws.id, [doc1.id]), 404, "not_found");
    // The surviving document still works.
    expectStatus(await startJob(a.client, a.ws.id, [doc2.id]), 202);
  });

  // api.yaml DELETE workspace: "Everything in the workspace becomes unreachable."
  it("deleting a workspace makes everything in it unreachable", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    await finishedJob(a.client, a.ws.id, [doc.id]);
    expectStatus(await a.client.get(`/api/workspaces/${a.ws.id}`), 200); // guard

    expectStatus(await a.client.del(`/api/workspaces/${a.ws.id}`), 204);
    expectError(await a.client.get(`/api/workspaces/${a.ws.id}`), 404, "not_found");
    expectError(await a.client.get(`/api/workspaces/${a.ws.id}/documents`), 404, "not_found");
    expectError(await a.client.get(`/api/workspaces/${a.ws.id}/reports`), 404, "not_found");
    expectError(await a.client.get(`/api/workspaces/${a.ws.id}/usage`), 404, "not_found");
    expectError(await a.client.get(`/api/workspaces/${a.ws.id}/research-jobs`), 404, "not_found");
  });

  // api.yaml DELETE document: uploader, admin or owner; a member lacking the role is 403.
  it("only the uploader, an admin or the owner can delete a document", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    const member = await addMember(a, "member");
    expectStatus(await member.client.get(`/api/workspaces/${a.ws.id}/documents/${doc.id}`), 200); // guard

    expectError(await member.client.del(`/api/workspaces/${a.ws.id}/documents/${doc.id}`), 403, "forbidden");
    expectStatus(await a.client.del(`/api/workspaces/${a.ws.id}/documents/${doc.id}`), 204);
    expectError(await a.client.get(`/api/workspaces/${a.ws.id}/documents/${doc.id}`), 404, "not_found");
  });
});
