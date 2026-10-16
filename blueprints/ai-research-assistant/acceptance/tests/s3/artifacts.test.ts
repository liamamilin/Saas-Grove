import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import {
  addMember,
  expectError,
  expectStatus,
  finishedJob,
  isolateFakeModel,
  owner,
  report,
  twoDocs,
} from "../../lib/helpers";

describe("S3 report integrity and access", () => {
  isolateFakeModel();

  it("quotes every citation verbatim from the cited document", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));
    const r = await report(team.client, team.ws.id, job.reportId);

    const texts = new Map<string, string>();
    for (const c of r.citations) {
      if (!texts.has(c.documentId)) {
        const res = await team.client.get(`/api/workspaces/${team.ws.id}/documents/${c.documentId}/text`);
        expectStatus(res, 200);
        texts.set(c.documentId, res.body.text);
      }
      expect(c.quote.length, "quote too short to be evidence").toBeGreaterThanOrEqual(20);
      expect(texts.get(c.documentId), `quote not found in its document: ${c.quote}`).toContain(c.quote);
    }
  });

  it("downloads a report as a Markdown attachment for members only", async () => {
    const a = await owner();
    const b = await owner();
    const docs = await twoDocs(a.client, a.ws.id);
    const job = await finishedJob(a.client, a.ws.id, docs.map((d) => d.id));
    const r = await report(a.client, a.ws.id, job.reportId);
    const path = `/api/workspaces/${a.ws.id}/reports/${job.reportId}/download?format=markdown`;

    const res = await a.client.get(path);
    expectStatus(res, 200);
    expect(res.headers.get("content-type") ?? "").toMatch(/^text\/markdown/);
    expect(res.headers.get("content-disposition") ?? "").toMatch(/attachment/i);
    expect(res.headers.get("content-disposition") ?? "").toMatch(/\.md/);
    expect(res.text).toContain(r.markdown.trim().slice(0, 40));

    expectError(await new Client().get(path), 401, "unauthenticated");
    expectError(await b.client.get(path), 404, "not_found");
  });

  it("revokes report and usage access when a member is removed", async () => {
    const team = await owner();
    const member = await addMember(team, "member");
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));
    const reportPath = `/api/workspaces/${team.ws.id}/reports/${job.reportId}`;
    expectStatus(await member.client.get(reportPath), 200);
    expectStatus(await member.client.get(`/api/workspaces/${team.ws.id}/usage`), 200);

    expectStatus(await team.client.del(`/api/workspaces/${team.ws.id}/members/${member.user.id}`), 204);
    expectError(await member.client.get(reportPath), 404, "not_found");
    expectError(await member.client.get(`/api/workspaces/${team.ws.id}/usage`), 404, "not_found");
  });
});
