import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COFFEE, SOLAR } from "../../lib/corpus";
import {
  addText,
  expectError,
  expectStatus,
  isolateFakeModel,
  owner,
  startJob,
  waitForDocument,
} from "../../lib/helpers";

const FIXTURES = fileURLToPath(new URL("../../fixtures", import.meta.url));

describe("S2 documents", () => {
  isolateFakeModel();

  it("turns pasted text into a ready, listable document", async () => {
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    expect(doc.title).toBe(SOLAR.title);

    const list = await team.client.get(`/api/workspaces/${team.ws.id}/documents`);
    expectStatus(list, 200);
    expect(list.body.documents.map((d: any) => d.id)).toContain(doc.id);

    const text = await team.client.get(`/api/workspaces/${team.ws.id}/documents/${doc.id}/text`);
    expectStatus(text, 200);
    expect(text.body.text).toContain("Tandem cells that stack perovskite on top of silicon");
  });

  it("parses Markdown and PDF uploads", async () => {
    const team = await owner();
    const ws = team.ws.id;

    const md = await team.client.upload(`/api/workspaces/${ws}/documents`, {
      filename: "notes.md",
      mimeType: "text/markdown",
      content: "# Field notes\n\nThe archive keeps **fourteen** boxes of letters from the harbour office.\n",
    });
    expectStatus(md, 201);
    const mdDoc = await waitForDocument(team.client, ws, md.body.document.id);
    const mdText = await team.client.get(`/api/workspaces/${ws}/documents/${mdDoc.id}/text`);
    expect(mdText.body.text).toContain("boxes of letters from the harbour office");

    const pdf = await team.client.upload(`/api/workspaces/${ws}/documents`, {
      filename: "hello.pdf",
      mimeType: "application/pdf",
      content: new Uint8Array(fs.readFileSync(path.join(FIXTURES, "hello.pdf"))),
      title: "Lighthouse PDF",
    });
    expectStatus(pdf, 201);
    const pdfDoc = await waitForDocument(team.client, ws, pdf.body.document.id);
    expect(pdfDoc.title).toBe("Lighthouse PDF");
    const pdfText = await team.client.get(`/api/workspaces/${ws}/documents/${pdfDoc.id}/text`);
    expect(pdfText.body.text).toContain("lighthouse keepers log the weather");
  });

  it("refuses unsupported, oversized and empty uploads", async () => {
    const team = await owner();
    const url = `/api/workspaces/${team.ws.id}/documents`;
    expectStatus(await team.client.upload(url, { filename: "ok.txt", mimeType: "text/plain", content: "plain text works" }), 201);

    expectError(
      await team.client.upload(url, { filename: "tool.exe", mimeType: "application/x-msdownload", content: "MZ binary" }),
      415,
      "unsupported_media_type",
    );
    const big = new Uint8Array(10 * 1024 * 1024 + 1).fill(97);
    expectError(await team.client.upload(url, { filename: "big.txt", mimeType: "text/plain", content: big }), 413, "payload_too_large");
    expectError(await team.client.post(url, { title: "empty", text: "" }), 400, "validation_error");
  });

  it("keeps documents invisible to other workspaces", async () => {
    const a = await owner();
    const b = await owner();
    const doc = await addText(a.client, a.ws.id, COFFEE);
    expectStatus(await a.client.get(`/api/workspaces/${a.ws.id}/documents/${doc.id}`), 200);

    expectError(await b.client.get(`/api/workspaces/${a.ws.id}/documents/${doc.id}`), 404, "not_found");
    expectError(await b.client.get(`/api/workspaces/${b.ws.id}/documents/${doc.id}`), 404, "not_found");
    expectError(await b.client.get(`/api/workspaces/${b.ws.id}/documents/${doc.id}/text`), 404, "not_found");
    const list = await b.client.get(`/api/workspaces/${b.ws.id}/documents`);
    expect(list.body.documents.map((d: any) => d.id)).not.toContain(doc.id);
  });

  it("does not let a job use another workspace's documents", async () => {
    const a = await owner();
    const b = await owner();
    const theirs = await addText(a.client, a.ws.id, COFFEE);
    const ours = await addText(b.client, b.ws.id, SOLAR);

    await startJob(b.client, b.ws.id, [ours.id]);
    const res = await b.client.post(`/api/workspaces/${b.ws.id}/research-jobs`, {
      question: "Borrow their notes?",
      documentIds: [ours.id, theirs.id],
    });
    expectError(res, 404, "not_found");
  });
});
