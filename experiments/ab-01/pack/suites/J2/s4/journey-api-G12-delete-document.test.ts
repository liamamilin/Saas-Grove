// G12: Delete a document so it stops participating in retrieval and in new research jobs.
// Derived from brief/contract/api.yaml:
//   - DELETE /api/workspaces/{ws}/documents/{id}              (Uploader, admin or owner)
//   - POST   /api/workspaces/{ws}/research-jobs              (404 when a document id is unknown, deleted or in another workspace)
// Journey: the owner signs up, creates a workspace, adds a ready document, deletes it,
// then tries to start a research job referring to that document id and is refused with 404.
// Binary pass condition: POST /api/workspaces/{ws}/research-jobs with the deleted document id returns 404.

import { describe, expect, test } from "vitest";
import { addText, createWorkspace, signup } from "../../lib/helpers";

describe("G12: delete a document so it stops participating in retrieval and new jobs", () => {
  test("a research job that names a deleted document is refused with 404", async () => {
    const ownerAcct = await signup();
    const ws = await createWorkspace(ownerAcct.client);

    const doc = await addText(ownerAcct.client, ws.id, {
      title: "Throwaway source",
      text: "This document is going to be deleted before any job is queued against it.",
    });
    expect(doc.status).toBe("ready");

    const del = await ownerAcct.client.del(`/api/workspaces/${ws.id}/documents/${doc.id}`);
    expect(del.status).toBe(204);

    const res = await ownerAcct.client.post(`/api/workspaces/${ws.id}/research-jobs`, {
      question: "What does the deleted document say?",
      documentIds: [doc.id],
    });
    expect(res.status).toBe(404);
    expect(res.body?.error?.code).toBe("not_found");
  });
});