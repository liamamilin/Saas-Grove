// Cross-workspace tenant isolation (S4 + general).
//
// Spec clauses verified here:
//   spec/product.md §2 (工作区是数据隔离的边界) + §6 (跨租户泄露: 通过 ID 能读到别人的资源
//                        必须返回 404)
//   spec/architecture.md §4.1 (must: 不是成员、或者资源不在该工作区，一律返回 404)
//   api.yaml (any /api/workspaces/{ws}/... 404 to non-member)

import { describe, expect, test } from "vitest";
import {
  createWorkspace,
  expectStatus,
  finishedJob,
  isolateFakeModel,
  newEmail,
  signup,
  twoDocs,
} from "../../lib/helpers";
import { Client } from "../../lib/client";

describe("s4: cross-workspace tenant isolation", () => {
  isolateFakeModel();

  test("a user who is not a member of workspace A receives 404 (not 403) on its documents, jobs and reports", async () => {
    // spec/architecture.md §4.1 — this is the explicit "must: 一律返回 404" rule.
    const ownerA = await signup();
    const wsA = await createWorkspace(ownerA.client);
    const [docA] = await twoDocs(ownerA.client, wsA.id);
    const job = await finishedJob(ownerA.client, wsA.id, [docA.id]);

    const ownerB = await signup();
    const wsB = await createWorkspace(ownerB.client);

    for (const path of [
      `/api/workspaces/${wsA.id}/documents/${docA.id}`,
      `/api/workspaces/${wsA.id}/research-jobs/${job.id}`,
      `/api/workspaces/${wsA.id}/reports/${job.reportId}`,
      `/api/workspaces/${wsA.id}/usage/records?jobId=${job.id}`,
      `/api/workspaces/${wsA.id}/audit-events`,
      `/api/workspaces/${wsA.id}/export`,
      `/api/workspaces/${wsA.id}/documents`,
    ]) {
      const res = await ownerB.client.get(path);
      expectStatus(res, 404);
      expect(res.body?.error?.code, path).toBe("not_found");
    }

    // Negative control: workspace B still works for owner B.
    expectStatus(await ownerB.client.get(`/api/workspaces/${wsB.id}`), 200);
  });

  test("invitation accept with the wrong session email returns 403 (the invitee is the email on the invitation)", async () => {
    // api.yaml /invitations/accept 403 ("Logged in as a different email") — the
    // spec elevates this into a security requirement: invitations are bound to
    // the email they were issued for.
    const ownerA = await signup();
    const wsA = await createWorkspace(ownerA.client);
    const inviteeEmail = newEmail("invitee");
    const inv = await ownerA.client.post(`/api/workspaces/${wsA.id}/invitations`, {
      email: inviteeEmail,
      role: "member",
    });
    expectStatus(inv, 201);
    const out = await new Client().get(`/api/__test__/outbox?to=${encodeURIComponent(inviteeEmail)}`);
    const messages = out.body.messages as any[];
    const token = messages[messages.length - 1].token;

    // A different user, signed up under a different email, tries to accept.
    const wrong = await signup();
    const accept = await wrong.client.post(`/api/invitations/accept`, { token });
    expectStatus(accept, 403);
    expect(accept.body?.error?.code).toBe("forbidden");
  });

  test("secret content from workspace A never appears in workspace B's reports or chat answers", async () => {
    // spec/product.md §6 (跨租户泄露) — A 工作区的资料出现在 B 的检索结果、报告或回答里。
    // We give workspace A a unique secret phrase, then run a research job in
    // workspace B with its own (topic-distinct) documents and assert the secret
    // phrase never leaks into B's output.
    const SECRET_PHRASE = "flaming-otter-credential-9182";
    const ownerA = await signup();
    const wsA = await createWorkspace(ownerA.client);
    const aDoc = await ownerA.client.post(`/api/workspaces/${wsA.id}/documents`, {
      title: "Confidential A",
      text: `The ${SECRET_PHRASE} keeps the lighthouse safe every night.`,
    });
    expectStatus(aDoc, 201);
    const aDocId = aDoc.body.document.id;

    const ownerB = await signup();
    const wsB = await createWorkspace(ownerB.client);
    const [bDoc] = await twoDocs(ownerB.client, wsB.id);

    const job = await finishedJob(ownerB.client, wsB.id, [bDoc.id]);
    const rep = await ownerB.client.get(`/api/workspaces/${wsB.id}/reports/${job.reportId}`);
    expect(rep.body.report.markdown).not.toContain(SECRET_PHRASE);
    for (const c of rep.body.report.citations as any[]) {
      expect(c.quote).not.toContain(SECRET_PHRASE);
      expect(c.documentId).not.toBe(aDocId);
    }

    // And the chat answer over workspace B's report does not contain it either.
    const sse = await ownerB.client.sse(
      `/api/workspaces/${wsB.id}/reports/${rep.body.report.id}/messages`,
      { content: "What does the document say?" },
    );
    expect(sse.status).toBe(200);
    const assembled = sse.events
      .filter((e) => e.event === "delta")
      .map((e) => (typeof e.data?.text === "string" ? e.data.text : ""))
      .join("");
    expect(assembled).not.toContain(SECRET_PHRASE);
    const assistantMessage = sse.events.find((e) => e.event === "done")!.data.message;
    expect(assistantMessage.content).not.toContain(SECRET_PHRASE);
  });
});