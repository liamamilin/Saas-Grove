import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REFUNDS, SHIPPING } from "../../lib/corpus";
import {
  addText,
  documentText,
  expectError,
  expectStatus,
  isolateFakeModel,
  owner,
  waitForDocument,
} from "../../lib/helpers";

const FIXTURES = fileURLToPath(new URL("../../fixtures", import.meta.url));

describe("S2 knowledge base documents", () => {
  isolateFakeModel();

  it("turns pasted text into a ready, listable document", async () => {
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, REFUNDS);
    expect(doc.title).toBe(REFUNDS.title);

    const list = await team.client.get(`/api/workspaces/${team.ws.id}/documents`);
    expectStatus(list, 200);
    expect(list.body.documents.map((d: any) => d.id)).toContain(doc.id);
    expect(await documentText(team.client, team.ws.id, doc.id)).toContain("paid back to the original payment method");
  });

  it("parses Markdown and PDF uploads", async () => {
    const team = await owner();
    const ws = team.ws.id;

    const md = await team.client.upload(`/api/workspaces/${ws}/documents`, {
      filename: "faq.md",
      mimeType: "text/markdown",
      content: "# Gift cards\n\nGift cards are valid for **three years** from the date of purchase.\n",
    });
    expectStatus(md, 201);
    const mdDoc = await waitForDocument(team.client, ws, md.body.document.id);
    expect(await documentText(team.client, ws, mdDoc.id)).toContain("valid for");

    const pdf = await team.client.upload(`/api/workspaces/${ws}/documents`, {
      filename: "hello.pdf",
      mimeType: "application/pdf",
      content: new Uint8Array(fs.readFileSync(path.join(FIXTURES, "hello.pdf"))),
      title: "Lighthouse PDF",
    });
    expectStatus(pdf, 201);
    const pdfDoc = await waitForDocument(team.client, ws, pdf.body.document.id);
    expect(pdfDoc.title).toBe("Lighthouse PDF");
    expect(await documentText(team.client, ws, pdfDoc.id)).toContain("lighthouse keepers log the weather");
  });

  it("parses Word documents, and keeps only the visible text of HTML pages", async () => {
    const team = await owner();
    const ws = team.ws.id;

    const docx = await team.client.upload(`/api/workspaces/${ws}/documents`, {
      filename: "hours.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: new Uint8Array(fs.readFileSync(path.join(FIXTURES, "hours.docx"))),
    });
    expectStatus(docx, 201);
    const word = await waitForDocument(team.client, ws, docx.body.document.id);
    expect(await documentText(team.client, ws, word.id)).toContain("opens at ten o'clock on Saturdays");

    const html = await team.client.upload(`/api/workspaces/${ws}/documents`, {
      filename: "help-centre.html",
      mimeType: "text/html",
      content: [
        "<!doctype html><html><head><title>Help centre</title>",
        "<style>.banner { color: crimson; }</style>",
        '<script>window.trackingPixel = "do-not-index-me";</script></head>',
        "<body><h1>Gift wrapping</h1><p>We gift wrap any order for <b>two euros</b> extra.</p></body></html>",
      ].join(""),
    });
    expectStatus(html, 201);
    const page = await waitForDocument(team.client, ws, html.body.document.id);
    const text = await documentText(team.client, ws, page.id);
    expect(text).toContain("We gift wrap any order for");
    expect(text).toContain("two euros");
    for (const hidden of ["trackingPixel", "do-not-index-me", "crimson", "<p>", "<b>"]) {
      expect(text, `the extracted text of an HTML page contains ${hidden}`).not.toContain(hidden);
    }
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

  it("marks a file it cannot read as failed, with the reason", async () => {
    const team = await owner();
    const url = `/api/workspaces/${team.ws.id}/documents`;
    const ok = await team.client.upload(url, { filename: "returns.txt", mimeType: "text/plain", content: "Returns are free within the Netherlands." });
    expectStatus(ok, 201);
    await waitForDocument(team.client, team.ws.id, ok.body.document.id);

    // The type is accepted, but there is no text to get out of it.
    const broken = await team.client.upload(url, {
      filename: "scan.pdf",
      mimeType: "application/pdf",
      content: "%PDF-1.4\n% this is not really a PDF, just a header and noise\n0000 garbage garbage\n",
    });
    expectStatus(broken, 201);
    const failed = await waitForDocument(team.client, team.ws.id, broken.body.document.id, "failed");
    expect(failed.error?.code).toBe("unreadable");
    expect(typeof failed.error?.message).toBe("string");
  });

  it("keeps documents invisible to other workspaces", async () => {
    const a = await owner();
    const b = await owner();
    const doc = await addText(a.client, a.ws.id, SHIPPING);
    expectStatus(await a.client.get(`/api/workspaces/${a.ws.id}/documents/${doc.id}`), 200);

    expectError(await b.client.get(`/api/workspaces/${a.ws.id}/documents/${doc.id}`), 404, "not_found");
    expectError(await b.client.get(`/api/workspaces/${b.ws.id}/documents/${doc.id}`), 404, "not_found");
    expectError(await b.client.get(`/api/workspaces/${b.ws.id}/documents/${doc.id}/text`), 404, "not_found");
    const list = await b.client.get(`/api/workspaces/${b.ws.id}/documents`);
    expectStatus(list, 200);
    expect(list.body.documents.map((d: any) => d.id)).not.toContain(doc.id);
  });
});
