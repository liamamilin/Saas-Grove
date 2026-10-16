import { describe, expect, it } from "vitest";
import { COFFEE, SECRET, SECRET_PHRASE } from "../../lib/corpus";
import {
  addText,
  expectError,
  expectStatus,
  finishedJob,
  isolateFakeModel,
  markers,
  owner,
  report,
  twoDocs,
} from "../../lib/helpers";

describe("S2 reports", () => {
  isolateFakeModel();

  it("cites only the job's documents, with a citation for every marker", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const ids = docs.map((d) => d.id);
    const job = await finishedJob(team.client, team.ws.id, ids);
    const r = await report(team.client, team.ws.id, job.reportId);

    expect(r.jobId).toBe(job.id);
    expect(r.markdown.length).toBeGreaterThan(0);
    expect(r.citations.length).toBeGreaterThan(0);
    const cited = new Set(r.citations.map((c: any) => c.marker));
    for (const m of markers(r.markdown)) expect(cited.has(m), `marker [${m}] has no citation`).toBe(true);
    for (const c of r.citations) expect(ids).toContain(c.documentId);
  });

  it("never retrieves from another workspace", async () => {
    const a = await owner();
    const secret = await addText(a.client, a.ws.id, SECRET);
    const theirs = await finishedJob(a.client, a.ws.id, [secret.id], `What is the ${SECRET_PHRASE}?`);
    const theirReport = await report(a.client, a.ws.id, theirs.reportId);
    expect(theirReport.citations.map((c: any) => c.documentId)).toContain(secret.id);

    const b = await owner();
    const ours = await addText(b.client, b.ws.id, COFFEE);
    const job = await finishedJob(b.client, b.ws.id, [ours.id], `What is the ${SECRET_PHRASE}? Quote it.`);
    const r = await report(b.client, b.ws.id, job.reportId);
    for (const c of r.citations) {
      expect(c.documentId).toBe(ours.id);
      expect(c.quote).not.toContain("zebrafish");
    }
    expect(r.markdown).not.toContain("beacon logs");
  });

  it("lists reports inside the workspace and hides them outside it", async () => {
    const a = await owner();
    const b = await owner();
    const docs = await twoDocs(a.client, a.ws.id);
    const job = await finishedJob(a.client, a.ws.id, docs.map((d) => d.id));

    const list = await a.client.get(`/api/workspaces/${a.ws.id}/reports`);
    expectStatus(list, 200);
    expect(list.body.reports.map((r: any) => r.id)).toContain(job.reportId);
    expectError(await b.client.get(`/api/workspaces/${a.ws.id}/reports/${job.reportId}`), 404, "not_found");
    expectError(await b.client.get(`/api/workspaces/${b.ws.id}/reports/${job.reportId}`), 404, "not_found");
  });
});
