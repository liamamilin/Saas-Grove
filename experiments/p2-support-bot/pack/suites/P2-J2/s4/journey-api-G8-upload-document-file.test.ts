import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { expectError, expectStatus, owner, waitForDocument } from "../../lib/helpers";

// G8: 上传资料文件（不是粘贴文本；粘贴文本有 UI 锚点，文件上传没有）。
// 依据 api.yaml：
//   POST /api/workspaces/{ws}/documents — "Paste text (JSON) or upload a .txt/.md/.pdf/.docx/.html
//     file (multipart field `file`, optional `title`). Max 10 MB. Any member."（201 / 400 / 413 / 415）
//     "A file whose type is accepted but from which no text can be extracted ... is accepted with 201
//      and ends `failed` with `error.code = "unreadable"`."
//     "HTML is reduced to its visible text (no tags, no `<script>`/`<style>` content)."
//   GET /api/workspaces/{ws}/documents/{id}/text — "The extracted plain text that citations quote from."
// 依据 testability.md §6：415 unsupported_media_type、413 payload_too_large。

it("G8: 上传 .md/.pdf/.docx/.html 当资料，能取出抽取出的正文，坏文件被拒", async () => {
  const team = await owner();

  // 一个 .md 文件
  const md = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
    filename: "notes.md",
    content: "# 退换货说明\n\n灯泡拆封后不能退换，灯罩有裂纹也不在保修范围内。\n",
    mimeType: "text/markdown",
    title: "退换货说明",
  });
  expectStatus(md, 201);
  const mdId = md.body?.document?.id as string;
  expect(mdId, md.text).toBeTruthy();
  const mdDoc = await waitForDocument(team.client, team.ws.id, mdId);
  expect(mdDoc.status).toBe("ready");

  const mdText = await team.client.get(`/api/workspaces/${team.ws.id}/documents/${mdId}/text`);
  expectStatus(mdText, 200);
  const mdBody = String(mdText.body?.text ?? "").replace(/\s+/g, " ");
  expect(mdBody.length, "no text was extracted from the .md upload").toBeGreaterThan(0);
  expect(mdBody).toContain("灯泡拆封后不能退换");

  // 一个 PDF
  const pdf = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
    filename: "hello.pdf",
    content: readFileSync(new URL("../../fixtures/hello.pdf", import.meta.url)),
    mimeType: "application/pdf",
    title: "灯塔日志 PDF",
  });
  expectStatus(pdf, 201);
  const pdfId = pdf.body?.document?.id as string;
  expect(pdfId, pdf.text).toBeTruthy();
  await waitForDocument(team.client, team.ws.id, pdfId);
  const pdfText = await team.client.get(`/api/workspaces/${team.ws.id}/documents/${pdfId}/text`);
  expectStatus(pdfText, 200);
  const pdfBody = String(pdfText.body?.text ?? "").replace(/\s+/g, " ");
  expect(pdfBody.length, "no text was extracted from the .pdf upload").toBeGreaterThan(0);
  expect(pdfBody).toContain("lighthouse keepers");

  // 一个 .docx
  const docx = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
    filename: "hours.docx",
    content: readFileSync(new URL("../../fixtures/hours.docx", import.meta.url)),
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    title: "营业时间",
  });
  expectStatus(docx, 201);
  const docxId = docx.body?.document?.id as string;
  expect(docxId, docx.text).toBeTruthy();
  await waitForDocument(team.client, team.ws.id, docxId);
  const docxText = await team.client.get(`/api/workspaces/${team.ws.id}/documents/${docxId}/text`);
  expectStatus(docxText, 200);
  const docxBody = String(docxText.body?.text ?? "").replace(/\s+/g, " ");
  expect(docxBody.length, "no text was extracted from the .docx upload").toBeGreaterThan(0);
  expect(docxBody).toContain("showroom in Utrecht opens at ten o'clock");

  // 一个 HTML：只留可见文字，不要标签和脚本
  const html = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
    filename: "faq.html",
    content:
      "<html><head><style>.a{color:red}</style><script>var secret = 1;</script></head>" +
      "<body><p>Warranty claims need the order number.</p></body></html>",
    mimeType: "text/html",
    title: "常见问题",
  });
  expectStatus(html, 201);
  const htmlId = html.body?.document?.id as string;
  expect(htmlId, html.text).toBeTruthy();
  await waitForDocument(team.client, team.ws.id, htmlId);
  const htmlText = await team.client.get(`/api/workspaces/${team.ws.id}/documents/${htmlId}/text`);
  expectStatus(htmlText, 200);
  const htmlBody = String(htmlText.body?.text ?? "").replace(/\s+/g, " ");
  expect(htmlBody).toContain("Warranty claims need the order number.");
  expect(htmlBody).not.toContain("<p>");
  expect(htmlBody).not.toContain("var secret");
  expect(htmlBody).not.toContain("color:red");

  // 读不出文字的文件：201 收下，但最后是 failed（unreadable）
  const broken = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
    filename: "broken.pdf",
    content: "%PDF-1.4 but there is no text in here at all",
    mimeType: "application/pdf",
    title: "坏掉的 PDF",
  });
  expectStatus(broken, 201);
  const brokenId = broken.body?.document?.id as string;
  expect(brokenId, broken.text).toBeTruthy();
  const brokenDoc = await waitForDocument(team.client, team.ws.id, brokenId, "failed");
  expect(brokenDoc.error?.code, JSON.stringify(brokenDoc.error)).toBe("unreadable");

  // 不支持的文件类型
  const exe = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
    filename: "payload.exe",
    content: "MZ not really an executable",
    mimeType: "application/octet-stream",
  });
  expectError(exe, 415, "unsupported_media_type");

  // 超过 10 MB
  const huge = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
    filename: "huge.txt",
    content: "x".repeat(11 * 1024 * 1024),
    mimeType: "text/plain",
  });
  expectStatus(huge, 413);
});
