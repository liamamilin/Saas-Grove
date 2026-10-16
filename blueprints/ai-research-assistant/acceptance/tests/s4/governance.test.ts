import { describe, expect, it } from "vitest";
import { SECRET, SECRET_PHRASE, TIDES } from "../../lib/corpus";
import {
  addMember,
  addText,
  createWorkspace,
  expectError,
  expectStatus,
  fakeModel,
  finishedJob,
  isolateFakeModel,
  owner,
  secretKeys,
  signup,
  startJob,
  twoDocs,
  waitForJob,
} from "../../lib/helpers";

describe("S4 audit log and export", () => {
  isolateFakeModel();

  it("records sensitive actions in the audit log, newest first", async () => {
    const team = await owner();
    const ws = team.ws.id;
    const member = await addMember(team, "member"); // member.invited + member.joined
    expectStatus(await team.client.patch(`/api/workspaces/${ws}/members/${member.user.id}`, { role: "admin" }), 200);
    expectStatus(await team.client.put(`/api/workspaces/${ws}/budget`, { monthlyUsd: 5 }), 200);

    const doc = await addText(member.client, ws, TIDES);
    expectStatus(await team.client.del(`/api/workspaces/${ws}/documents/${doc.id}`), 204);

    const docs = await twoDocs(team.client, ws);
    await fakeModel.set({ latencyMs: 300 });
    const job = await startJob(team.client, ws, docs.map((d) => d.id));
    expectStatus(await team.client.post(`/api/workspaces/${ws}/research-jobs/${job.id}/cancel`), 202);
    await waitForJob(team.client, ws, job.id, (j) => j.status === "canceled", 10_000);

    expectStatus(await team.client.get(`/api/workspaces/${ws}/export`), 200);
    expectStatus(await team.client.del(`/api/workspaces/${ws}/members/${member.user.id}`), 204);

    const res = await team.client.get(`/api/workspaces/${ws}/audit-events`);
    expectStatus(res, 200);
    const events = res.body.events;
    const types = new Set(events.map((e: any) => e.type));
    for (const t of [
      "member.invited",
      "member.joined",
      "member.role_changed",
      "budget.updated",
      "document.deleted",
      "job.canceled",
      "export.created",
      "member.removed",
    ]) {
      expect(types.has(t), `missing audit event ${t}`).toBe(true);
    }
    for (const e of events) expect(e.actorUserId).toBeTruthy();
    expect(events.find((e: any) => e.type === "member.joined").actorUserId).toBe(member.user.id);
    expect(events.find((e: any) => e.type === "budget.updated").actorUserId).toBe(team.user.id);
    const times = events.map((e: any) => Date.parse(e.createdAt));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeLessThanOrEqual(times[i - 1]);
  });

  it("keeps the audit log away from plain members", async () => {
    const team = await owner();
    const member = await addMember(team, "member");
    expectStatus(await team.client.get(`/api/workspaces/${team.ws.id}/audit-events`), 200);
    expectError(await member.client.get(`/api/workspaces/${team.ws.id}/audit-events`), 403, "forbidden");
  });

  it("exports the workspace's data and nothing secret", async () => {
    const team = await owner();
    const member = await addMember(team, "member");
    const elsewhere = await createWorkspace(team.client);
    await addText(team.client, elsewhere.id, SECRET);

    const docs = await twoDocs(team.client, team.ws.id);
    const job = await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));
    const chat = await team.client.sse(`/api/workspaces/${team.ws.id}/reports/${job.reportId}/messages`, { content: "Why?" });
    expect(chat.status).toBe(200);

    expectError(await member.client.get(`/api/workspaces/${team.ws.id}/export`), 403, "forbidden");
    const res = await team.client.get(`/api/workspaces/${team.ws.id}/export`);
    expectStatus(res, 200);
    const data = res.body;
    expect(data.workspace.id).toBe(team.ws.id);
    expect(data.members.map((m: any) => m.userId).sort()).toEqual([team.user.id, member.user.id].sort());
    expect(data.documents.map((d: any) => d.id).sort()).toEqual(docs.map((d) => d.id).sort());
    expect(data.documents.every((d: any) => typeof d.text === "string" && d.text.length > 0)).toBe(true);
    expect(data.reports.map((r: any) => r.id)).toContain(job.reportId);
    expect(data.messages.length).toBeGreaterThanOrEqual(2);
    expect(data.usageRecords.length).toBeGreaterThanOrEqual(6);

    expect(secretKeys(data)).toEqual([]);
    expect(res.text).not.toContain(SECRET_PHRASE);
  });
});

describe("S4 deletion", () => {
  isolateFakeModel();

  it("removes a deleted document from lists, new jobs and retrieval", async () => {
    const team = await owner();
    const ws = team.ws.id;
    const [solar, coffee] = await twoDocs(team.client, ws);
    const job = await finishedJob(team.client, ws, [solar.id, coffee.id]);

    expectStatus(await team.client.del(`/api/workspaces/${ws}/documents/${solar.id}`), 204);
    const list = await team.client.get(`/api/workspaces/${ws}/documents`);
    expect(list.body.documents.map((d: any) => d.id)).not.toContain(solar.id);
    expectError(await team.client.get(`/api/workspaces/${ws}/documents/${solar.id}`), 404, "not_found");
    expectError(
      await team.client.post(`/api/workspaces/${ws}/research-jobs`, { question: "Again?", documentIds: [solar.id] }),
      404,
      "not_found",
    );

    const chat = await team.client.sse(`/api/workspaces/${ws}/reports/${job.reportId}/messages`, {
      content: "What about perovskite stability?",
    });
    expect(chat.status).toBe(200);
    const message = chat.events.find((e) => e.event === "done")!.data.message;
    for (const c of message.citations) expect(c.documentId).not.toBe(solar.id);
  });

  it("lets members delete only their own documents", async () => {
    const team = await owner();
    const member = await addMember(team, "member");
    const admin = await addMember(team, "admin");
    const ws = team.ws.id;
    const own = await addText(member.client, ws, TIDES);
    const owners = await addText(team.client, ws, SECRET);

    expectError(await member.client.del(`/api/workspaces/${ws}/documents/${owners.id}`), 403, "forbidden");
    expectStatus(await member.client.del(`/api/workspaces/${ws}/documents/${own.id}`), 204);
    expectStatus(await admin.client.del(`/api/workspaces/${ws}/documents/${owners.id}`), 204);
  });

  it("makes everything in a deleted workspace unreachable", async () => {
    const team = await owner();
    const admin = await addMember(team, "admin");
    const ws = team.ws.id;
    const docs = await twoDocs(team.client, ws);
    const job = await finishedJob(team.client, ws, docs.map((d) => d.id));

    expectError(await admin.client.del(`/api/workspaces/${ws}`), 403, "forbidden");
    expectStatus(await team.client.del(`/api/workspaces/${ws}`), 204);

    for (const client of [team.client, admin.client]) {
      expectError(await client.get(`/api/workspaces/${ws}`), 404, "not_found");
      expectError(await client.get(`/api/workspaces/${ws}/documents/${docs[0].id}`), 404, "not_found");
      expectError(await client.get(`/api/workspaces/${ws}/reports/${job.reportId}`), 404, "not_found");
      const mine = await client.get("/api/workspaces");
      expect(mine.body.workspaces.map((w: any) => w.id)).not.toContain(ws);
    }
    // Their accounts still work.
    expectStatus(await team.client.get("/api/me"), 200);
    expect((await signup()).user.id).toBeTruthy();
  });
});
