import { describe, expect, it } from "vitest";
import { BASE_URL } from "../../lib/client";
import {
  owner, addMember, addText, twoDocs, finishedJob, report, expectStatus, expectError,
  fakeModel, isolateFakeModel, usageRecords, markers, secretKeys, sleep,
  invite, startJob, waitForJob, signup,
} from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

// Clause: product.md §S3/S4 (报告引用; 报告下载; 追问流式; 审计; 导出; 删除).
describe("holdout reports, chat, audit and export", () => {
  isolateFakeModel();

  it("every citation quote is a verbatim substring and markers are covered", async () => {
    // Clause: product.md §3 (Report citations quote); architecture.md §4.4.
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));
    const rep = await report(team.client, team.ws.id, job.reportId);
    expect(rep.citations.length).toBeGreaterThanOrEqual(1);
    for (const c of rep.citations) {
      expect(rep.markdown).toContain(`[${c.marker}]`);
      const textRes = await team.client.get(`/api/workspaces/${team.ws.id}/documents/${c.documentId}/text`);
      expectStatus(textRes, 200);
      expect(textRes.body.text).toContain(c.quote);
    }
    const ms = markers(rep.markdown);
    for (const m of ms) expect(rep.citations.some((c: any) => c.marker === m)).toBe(true);
  });

  it("report download is a markdown attachment named .md", async () => {
    // Clause: product.md §4.5; api.yaml /reports/{id}/download.
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));
    const rep = await report(team.client, team.ws.id, job.reportId);
    const res = await team.client.request("GET", `/api/workspaces/${team.ws.id}/reports/${rep.id}/download?format=markdown`);
    expectStatus(res, 200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/attachment/i);
    expect(cd).toMatch(/\.md/);
    expect(res.text).toContain(rep.markdown.slice(0, 80));
  });

  it("chat streams at least two deltas before done and content matches", async () => {
    // Clause: product.md §S4; api.yaml /reports/{id}/messages (streaming).
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));
    const rep = await report(team.client, team.ws.id, job.reportId);
    const sse = await team.client.sse(`/api/workspaces/${team.ws.id}/reports/${rep.id}/messages`, { content: "Explain?" });
    expect(sse.status).toBe(200);
    const deltas = sse.events.filter((e) => e.event === "delta");
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    const done = sse.events.find((e) => e.event === "done");
    expect(done).toBeTruthy();
    const concatenated = deltas.map((e: any) => e.data.text).join("");
    expect(done.data.message.content).toBe(concatenated);
    expect(deltas[0].at).toBeLessThan(done.at);
    expect(done.data.message.citations.length).toBeGreaterThanOrEqual(1);
    const msgs = await team.client.get(`/api/workspaces/${team.ws.id}/reports/${rep.id}/messages`);
    expectStatus(msgs, 200);
    const assistant = msgs.body.messages.find((m: any) => m.role === "assistant");
    expect(assistant.content).toBe(concatenated);
  });

  it("audit log records invitation events newest first", async () => {
    // Clause: product.md §S4 (审计日志); api.yaml /audit-events.
    const team = await owner();
    const invitee = await signup();
    const token = await invite(team.client, team.ws.id, invitee.email, "member");
    await invitee.client.post("/api/invitations/accept", { token });
    const res = await team.client.get(`/api/workspaces/${team.ws.id}/audit-events`);
    expectStatus(res, 200);
    const types = res.body.events.map((e: any) => e.type);
    expect(types).toContain("member.invited");
    expect(types).toContain("member.joined");
    const times = res.body.events.map((e: any) => Date.parse(e.createdAt));
    for (let i = 1; i < times.length; i++) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
  });

  it("export contains workspace data and no secrets", async () => {
    // Clause: product.md §S4 (数据导出); api.yaml /export.
    const team = await owner();
    const admin = await addMember(team, "admin");
    const member = await addMember(team, "member");
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));
    const rep = await report(team.client, team.ws.id, job.reportId);
    await team.client.sse(`/api/workspaces/${team.ws.id}/reports/${rep.id}/messages`, { content: "hi" });
    const res = await admin.client.get(`/api/workspaces/${team.ws.id}/export`);
    expectStatus(res, 200);
    expect(res.body.workspace.id).toBe(team.ws.id);
    expect(Array.isArray(res.body.documents)).toBe(true);
    expect(res.body.documents.length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(res.body.reports)).toBe(true);
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(Array.isArray(res.body.usageRecords)).toBe(true);
    expect(secretKeys(res.body)).toEqual([]);
    expect((await member.client.get(`/api/workspaces/${team.ws.id}/export`)).status).toBe(403);
    const audit = await admin.client.get(`/api/workspaces/${team.ws.id}/audit-events`);
    expect(audit.body.events.map((e: any) => e.type)).toContain("export.created");
  });

  it("deleting a workspace makes it unreachable", async () => {
    // Clause: product.md §S4 (删除工作区); api.yaml workspace delete.
    const team = await owner();
    const admin = await addMember(team, "admin");
    expect((await admin.client.del(`/api/workspaces/${team.ws.id}`)).status).toBe(403);
    expect((await team.client.del(`/api/workspaces/${team.ws.id}`)).status).toBe(204);
    expect((await team.client.get(`/api/workspaces/${team.ws.id}`)).status).toBe(404);
  });
});