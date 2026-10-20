// F7: Open the report produced by the job and read it with at least one
//     citation that links to a document we uploaded.
//
// Brief: "产出带出处的研究报告——能标清楚'这个结论是从哪份资料来的'".
//
// Contract: GET /api/workspaces/{ws}/reports/{id} returns
//           { report: { markdown, citations: [{ marker, documentId, quote }] } }
//           with quote a verbatim substring of the document text
//           (api.yaml 220–223, Citation schema 387–393, Contract §5).
//           GET /api/workspaces/{ws}/documents/{id}/text returns the extracted
//           plain text that citations quote from (api.yaml 174–178).
//           Testability: the report page exposes report-content
//           (testability.md §8).
//
// Adjudicated pass conditions (do not over-assert the UI):
//
//   1. UI: the rendered report-content contains a [n] citation marker.
//   2. API: for every [n] marker found in the rendered report, the
//      corresponding citation record in the fetched report
//        (a) exists in the citations list,
//        (b) has documentId equal to the uploaded solar document, and
//        (c) has quote as a verbatim substring of that document's text.
//
// The UI is not required to render the citation text inline; that is
// proven entirely through the API.
import { test, expect } from "vitest";
import { withPage, uiLogin } from "../../lib/ui";
import { owner, addText, finishedJob, expectStatus } from "../../lib/helpers";

test("F7: every [n] marker in report-content corresponds to a citation that points at the uploaded solar document with a verbatim quote", async () => {
  const team = await owner();
  // One ready solar document. F7 targets that document so every citation
  // can be checked against it directly.
  const solarText =
    "Perovskite solar cells reached laboratory efficiencies above " +
    "twenty-six percent within fifteen years of their first report.\n\n" +
    "Their main weakness is stability under ultraviolet light.";
  const solar = await addText(team.client, team.ws.id, {
    title: "Perovskite solar cells",
    text: solarText,
  });

  // Run a research job and wait for it to finish so the report exists by
  // the time the UI begins navigating.
  const job = await finishedJob(team.client, team.ws.id, [solar.id], "F7: cite a specific passage.");
  expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
  expect(job.reportId, `finished job must produce a reportId`).toBeTruthy();
  const reportId = job.reportId as string;

  let markers: number[];
  let renderedText: string;
  await withPage(async (page) => {
    await uiLogin(page, team.email, team.password);
    // The workspace home lists every report as a `report-link`
    // (testability.md §8). Our workspace has exactly one report.
    const link = page.locator(`[data-testid="report-link"]`).first();
    await link.waitFor({ state: "visible", timeout: 30_000 });
    await link.click();

    const content = page.getByTestId("report-content");
    await content.waitFor({ state: "visible", timeout: 30_000 });
    renderedText = (await content.textContent()) ?? "";

    // 1) UI assertion: a [n] marker renders in the report view.
    const renderedMarkers = [...renderedText.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    expect(
      renderedMarkers.length,
      `report-content should contain at least one [n] marker; got: ${renderedText}`,
    ).toBeGreaterThan(0);
    markers = renderedMarkers;
  });

  // 2) API assertions: for every rendered marker, the citation in the
  // fetched report exists, points at the solar document, and its quote
  // is a verbatim substring of the solar document's text. The document
  // text is read back through the API endpoint whose explicit purpose
  // is "the extracted plain text that citations quote from"
  // (api.yaml 174–178).
  const reportRes = await team.client.get(`/api/workspaces/${team.ws.id}/reports/${reportId}`);
  expectStatus(reportRes, 200);
  const report = reportRes.body.report as {
    markdown: string;
    citations: Array<{ marker: number; documentId: string; quote: string }>;
  };
  expect(Array.isArray(report.citations), `report.citations must be an array`).toBe(true);

  const textRes = await team.client.get(`/api/workspaces/${team.ws.id}/documents/${solar.id}/text`);
  expectStatus(textRes, 200);
  const solarStoredText: string = textRes.body.text ?? "";
  expect(solarStoredText.length, `solar document text should not be empty`).toBeGreaterThan(0);

  for (const marker of markers!) {
    const citation = report.citations.find((c) => c.marker === marker);
    expect(citation, `citation for marker [${marker}] must exist in report.citations`).toBeTruthy();
    expect(
      citation!.documentId,
      `citation for marker [${marker}] should reference the uploaded solar document ${solar.id}; got ${citation!.documentId}`,
    ).toBe(solar.id);
    expect(
      solarStoredText.includes(citation!.quote),
      `citation for marker [${marker}] should be a verbatim substring of the solar document text; quote=${JSON.stringify(
        citation!.quote,
      )}`,
    ).toBe(true);
  }
});
