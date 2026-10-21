// Held-out acceptance tests: the knowledge base.
//
// Contract source:
//   brief/contract/api.yaml:
//   - POST /api/workspaces/{ws}/documents: "Paste text (JSON) or upload a .txt/.md/.pdf/.docx/.html
//   file (multipart field `file`, optional `title`). Max 10 MB. Any member." "Parsing, chunking and
//   embedding run in the background: the document is `processing`, then `ready` or `failed`. A file
//   whose type is accepted but from which no text can be extracted (a corrupt or image-only PDF, a
//   broken .docx) is accepted with 201 and ends `failed` with error.code = "unreadable". HTML is
//   reduced to its visible text (no tags, no `<script>`/`<style>` content). The type is decided by
//   the file extension, falling back to the multipart part's content type."
//   - GET /api/workspaces/{ws}/documents: "Every document of the workspace's knowledge base
//   (deleted ones excluded). Any member."
//   - GET /api/workspaces/{ws}/documents/{id}/text: "The extracted plain text that citations quote
//   from."
//   - DELETE /api/workspaces/{ws}/documents/{id}: "Uploader, admin or owner. The document stops
//   taking part in answers at once."

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addMember,
  addText,
  documentText,
  expectError,
  expectStatus,
  knowledgeBase,
  waitForDocument,
} from "../../lib/helpers";
import { Visitor, supportTeam } from "../../lib/widget";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";

const PDF = readFileSync(new URL("../../fixtures/hello.pdf", import.meta.url));
const DOCX = readFileSync(new URL("../../fixtures/hours.docx", import.meta.url));

const HTML = [
  "<html><head><title>Store hours</title><style>.hidden { color: red }</style></head>",
  "<body><h1>Opening hours</h1><p>The showroom opens at ten o'clock on Saturdays.</p>",
  "<script>console.log('tracker')</script></body></html>",
].join("");

describe("holdout: the knowledge base", () => {
  it("turns pasted text into a ready document whose text can be read back", async () => {
    // Contract: POST documents (JSON) -> 201 { document }; the JSON body requires [title, text],
    // both minLength 1; the document ends `ready`; GET documents/{id}/text returns the extracted
    // plain text; the list holds every document of the workspace.
    const team = await supportTeam();
    const res = await team.client.post(`/api/workspaces/${team.ws.id}/documents`, {
      title: REFUNDS.title,
      text: REFUNDS.text,
    });
    expectStatus(res, 201);
    const id = String(res.body?.document?.id ?? "");
    expect(id).not.toBe("");
    expect(res.body?.document?.title).toBe(REFUNDS.title);

    const doc = await waitForDocument(team.client, team.ws.id, id);
    expect(doc.status).toBe("ready");

    const text = await documentText(team.client, team.ws.id, id);
    expect(text).toContain("Customers may request a refund within thirty days");

    const list = await team.client.get(`/api/workspaces/${team.ws.id}/documents`);
    expectStatus(list, 200);
    expect((list.body?.documents ?? []).map((d: any) => d.id)).toContain(id);

    expectError(
      await team.client.post(`/api/workspaces/${team.ws.id}/documents`, { title: "t", text: "" }),
      400,
      "validation_error",
    );
    expectError(
      await team.client.post(`/api/workspaces/${team.ws.id}/documents`, { text: "some text" }),
      400,
      "validation_error",
    );
    expectError(
      await team.client.post(`/api/workspaces/${team.ws.id}/documents`, { title: "", text: "some text" }),
      400,
      "validation_error",
    );
  });

  it("accepts the documented file types, reduces HTML to its visible text and refuses the rest", async () => {
    // Contract: "upload a .txt/.md/.pdf/.docx/.html file"; "The type is decided by the file
    // extension, falling back to the multipart part's content type"; "HTML is reduced to its visible
    // text (no tags, no `<script>`/`<style>` content)"; 415 unsupported_media_type; 413
    // payload_too_large ("Max 10 MB"); "A file whose type is accepted but from which no text can be
    // extracted ... is accepted with 201 and ends `failed` with error.code = "unreadable"".
    const team = await supportTeam();

    // The extension decides, not the content type of the part: a .txt is text even when the part
    // claims to be a pdf, and a .pdf is a pdf even when the part claims to be plain text.
    const txt = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
      filename: "notes.txt",
      content: "Bulbs under ten euros are not exchangeable.",
      mimeType: "application/pdf",
      title: "Notes",
    });
    expectStatus(txt, 201);
    const txtId = String(txt.body?.document?.id ?? "");
    await waitForDocument(team.client, team.ws.id, txtId);
    expect(await documentText(team.client, team.ws.id, txtId)).toContain("not exchangeable");

    const pdf = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
      filename: "notes.pdf",
      content: PDF,
      mimeType: "text/plain",
    });
    expectStatus(pdf, 201);
    const pdfId = String(pdf.body?.document?.id ?? "");
    await waitForDocument(team.client, team.ws.id, pdfId);
    expect(await documentText(team.client, team.ws.id, pdfId)).toContain("lighthouse");

    const docx = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
      filename: "hours.docx",
      content: DOCX,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expectStatus(docx, 201);
    const docxId = String(docx.body?.document?.id ?? "");
    await waitForDocument(team.client, team.ws.id, docxId);
    expect(await documentText(team.client, team.ws.id, docxId)).toContain("Showroom opening hours");

    const html = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
      filename: "hours.html",
      content: HTML,
      mimeType: "text/html",
    });
    expectStatus(html, 201);
    const htmlId = String(html.body?.document?.id ?? "");
    await waitForDocument(team.client, team.ws.id, htmlId);
    const visible = await documentText(team.client, team.ws.id, htmlId);
    expect(visible).toContain("The showroom opens at ten o'clock on Saturdays.");
    expect(visible, "the html tags are still in the text").not.toContain("<");
    expect(visible, "the script content is still in the text").not.toContain("tracker");
    expect(visible, "the style content is still in the text").not.toContain("color: red");

    // A type that is not accepted, and a file that is too big.
    const executable = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
      filename: "tool.exe",
      content: "MZ\u0000\u0000not a document",
      mimeType: "application/x-msdownload",
    });
    expectError(executable, 415, "unsupported_media_type");

    const tooBig = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
      filename: "big.txt",
      content: "x".repeat(11 * 1024 * 1024),
      mimeType: "text/plain",
    });
    expectError(tooBig, 413, "payload_too_large");

    // A file of an accepted type from which no text can be extracted.
    const broken = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
      filename: "broken.pdf",
      content: "this is not a pdf at all",
      mimeType: "application/pdf",
    });
    expectStatus(broken, 201);
    const brokenId = String(broken.body?.document?.id ?? "");
    const doc = await waitForDocument(team.client, team.ws.id, brokenId, "failed");
    expect(doc.status).toBe("failed");
    expect(String(doc.error?.code ?? "")).toBe("unreadable");
  });

  it("lets only the uploader, an admin or the owner delete a document, which then stops answering", async () => {
    // Contract: DELETE documents/{id} -> "Uploader, admin or owner. The document stops taking part
    // in answers at once."; GET documents -> "deleted ones excluded".
    const team = await supportTeam();
    const admin = await addMember(team, "admin");
    const uploader = await addMember(team, "member");
    const stranger = await addMember(team, "member");
    const kb = await knowledgeBase(team.client, team.ws.id);

    const visitor = await new Visitor(team.key).start();
    const before = await visitor.answer(Q_REFUND);
    expect(before.message.outcome).toBe("answered");
    expect(String(before.message.citations?.[0]?.documentId ?? "")).toBe(kb.refunds.id);

    expectError(
      await stranger.client.del(`/api/workspaces/${team.ws.id}/documents/${kb.refunds.id}`),
      403,
      "forbidden",
    );

    // The uploader may delete their own document.
    const own = await addText(uploader.client, team.ws.id, REFUNDS);
    expectStatus(await uploader.client.del(`/api/workspaces/${team.ws.id}/documents/${own.id}`), 204);

    // So may an admin.
    expectStatus(await admin.client.del(`/api/workspaces/${team.ws.id}/documents/${kb.refunds.id}`), 204);

    const list = await team.client.get(`/api/workspaces/${team.ws.id}/documents`);
    expectStatus(list, 200);
    const ids = (list.body?.documents ?? []).map((d: any) => d.id);
    expect(ids).not.toContain(kb.refunds.id);
    expect(ids).not.toContain(own.id);

    // The deleted document no longer takes part in the answers.
    const after = await visitor.answer(Q_REFUND);
    expect(after.message.outcome).toBe("unanswered");
  });
});
