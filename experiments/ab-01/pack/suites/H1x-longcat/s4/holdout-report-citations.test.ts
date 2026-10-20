// Report and citation integrity.
// Clause: api.yaml — Report requires id/jobId/title/markdown/citations; Citation requires
// marker (positive integer), documentId and quote, where quote is a "Verbatim substring of the
// document's extracted text"; download is text/markdown sent as an attachment whose filename
// ends in .md.
import { describe, expect, it } from "vitest";
import { addText, expectStatus, finishedJob, markers, owner, report } from "../../lib/helpers";
import { COFFEE, SOLAR } from "../../lib/corpus";

describe("reports and citations", () => {
  // api.yaml Citation: quote is a verbatim substring of the document text, marker is a positive integer.
  it("citations quote the document text verbatim, use positive markers and stay in the workspace", async () => {
    const a = await owner();
    const doc1 = await addText(a.client, a.ws.id, SOLAR);
    const doc2 = await addText(a.client, a.ws.id, COFFEE);
    const job = await finishedJob(a.client, a.ws.id, [doc1.id, doc2.id]);
    const rep = await report(a.client, a.ws.id, job.reportId);

    expect(rep.jobId).toBe(job.id);
    expect(rep.citations.length).toBeGreaterThan(0);
    expect(markers(rep.markdown).length).toBeGreaterThan(0);

    const texts: Record<string, string> = {};
    for (const d of [doc1, doc2]) {
      const res = await a.client.get(`/api/workspaces/${a.ws.id}/documents/${d.id}/text`);
      expectStatus(res, 200);
      texts[d.id] = res.body.text;
    }
    for (const c of rep.citations) {
      expect(Number.isInteger(c.marker)).toBe(true);
      expect(c.marker).toBeGreaterThanOrEqual(1);
      expect([doc1.id, doc2.id]).toContain(c.documentId);
      const text = texts[c.documentId];
      expect(text, `quote is not a verbatim substring of ${c.documentId}`).toContain(c.quote);
    }
  });

  // api.yaml download: text/markdown as an attachment whose filename ends in .md.
  it("a report can be downloaded as a markdown attachment whose filename ends in .md", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    const job = await finishedJob(a.client, a.ws.id, [doc.id]);
    const rep = await report(a.client, a.ws.id, job.reportId);

    const res = await a.client.get(`/api/workspaces/${a.ws.id}/reports/${rep.id}/download?format=markdown`);
    expectStatus(res, 200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toMatch(/filename="?.*\.md"?/);
    expect(res.text.length).toBeGreaterThan(0);
  });
});
