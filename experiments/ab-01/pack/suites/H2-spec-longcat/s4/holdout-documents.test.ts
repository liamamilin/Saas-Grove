// Held-out acceptance tests: what a document's extracted text is, and what deletion does.
//
// Clauses under test:
//   * spec/product.md §4.3 — 上传资料：支持粘贴文本，或上传 .txt/.md/.pdf；解析在后台完成.
//   * spec/product.md S2 — "资料上传与解析（文本/Markdown/PDF）".
//   * spec/product.md S3 — "引用摘录必须是原文" (the text citations quote from is the document's own text).
//   * spec/product.md §7 数据 — "删除即不可再被访问"; §3 — 删除后不再参与任何检索.
//   * spec/decisions.md H7 — 软删除，对外表现为不可访问.

import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { addText, expectError, expectStatus, owner, waitForDocument } from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

const PDF = new Uint8Array(fs.readFileSync(new URL("../../fixtures/hello.pdf", import.meta.url)));

describe("documents", () => {
  test("the extracted text of a pasted document is the text that was pasted", async () => {
    // product.md §4.3 + §3: the document is parsed, and citations quote its extracted text.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    expect(doc.status).toBe("ready");

    const res = await team.client.get(`/api/workspaces/${team.ws.id}/documents/${doc.id}/text`);
    expectStatus(res, 200);
    expect(typeof res.body?.text).toBe("string");
    expect(res.body.text).toContain("Perovskite solar cells reached laboratory efficiencies above twenty-six percent");

    const list = await team.client.get(`/api/workspaces/${team.ws.id}/documents`);
    expectStatus(list, 200);
    expect(((list.body?.documents ?? []) as any[]).some((d) => d.id === doc.id && d.title === SOLAR.title)).toBe(true);
  });

  test("an uploaded PDF is parsed into the text it contains", async () => {
    // product.md S2: 资料上传与解析（文本/Markdown/PDF）— fixtures/hello.pdf holds one sentence.
    const team = await owner();
    const res = await team.client.upload(`/api/workspaces/${team.ws.id}/documents`, {
      filename: "hello.pdf",
      content: PDF,
      mimeType: "application/pdf",
      title: "Hello PDF",
    });
    expectStatus(res, 201);
    const doc = await waitForDocument(team.client, team.ws.id, res.body.document.id);
    expect(doc.status).toBe("ready");

    const text = await team.client.get(`/api/workspaces/${team.ws.id}/documents/${doc.id}/text`);
    expectStatus(text, 200);
    expect(typeof text.body?.text).toBe("string");
    expect(text.body.text).toContain("lighthouse keepers log the weather");
  });

  test("a deleted document is no longer reachable", async () => {
    // product.md §7: 删除即不可再被访问; decisions.md H7: 对外表现为不可访问.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);

    // the positive path first: it is reachable before the deletion
    expectStatus(await team.client.get(`/api/workspaces/${team.ws.id}/documents/${doc.id}`), 200);

    expectStatus(await team.client.del(`/api/workspaces/${team.ws.id}/documents/${doc.id}`), 204);
    expectError(await team.client.get(`/api/workspaces/${team.ws.id}/documents/${doc.id}`), 404, "not_found");
    expectError(await team.client.get(`/api/workspaces/${team.ws.id}/documents/${doc.id}/text`), 404, "not_found");
  });
});
