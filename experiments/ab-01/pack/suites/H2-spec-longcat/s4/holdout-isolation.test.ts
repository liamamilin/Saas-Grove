// Held-out acceptance tests: one workspace never sees another workspace's material,
// including through the export.
//
// Clauses under test:
//   * spec/product.md §2 — "工作区是数据隔离的边界：工作区之间什么都看不到".
//   * spec/product.md §6 — "跨租户泄露：A 工作区的资料出现在 B 的检索结果、报告或回答里".
//   * spec/product.md §7 数据 — "导出内容只包含本工作区的数据"; §4.7 — 导出工作区数据.

import { describe, expect, test } from "vitest";
import { addText, finishedJob, owner, report as getReport } from "../../lib/helpers";
import { COFFEE, SECRET, SECRET_PHRASE } from "../../lib/corpus";

describe("workspace isolation", () => {
  test("another workspace's document never shows up in a report or its citations", async () => {
    // product.md §2 + §6: cross-tenant leakage through retrieval, reports or answers.
    const a = await owner();
    const secret = await addText(a.client, a.ws.id, SECRET);
    const b = await owner();
    const own = await addText(b.client, b.ws.id, COFFEE);
    expect(secret.id).not.toBe(own.id);

    const job = await finishedJob(b.client, b.ws.id, [own.id]);
    const rep = await getReport(b.client, b.ws.id, job.reportId);

    expect(rep.citations.length).toBeGreaterThan(0);
    expect(rep.markdown).not.toContain(SECRET_PHRASE);
    for (const c of rep.citations) {
      expect(c.documentId, JSON.stringify(c)).not.toBe(secret.id);
      expect(c.quote).not.toContain(SECRET_PHRASE);
    }

    // the document is there, and is readable by the workspace that owns it
    const ownText = await a.client.get(`/api/workspaces/${a.ws.id}/documents/${secret.id}/text`);
    expect(ownText.status, ownText.text).toBe(200);
    expect(ownText.body.text).toContain(SECRET_PHRASE);
  });

  test("the export contains this workspace's data and nothing from another workspace", async () => {
    // product.md §7: 导出内容只包含本工作区的数据; §4.7 导出工作区数据.
    const a = await owner();
    const mine = await addText(a.client, a.ws.id, SECRET);
    const b = await owner();
    await addText(b.client, b.ws.id, COFFEE);

    const res = await a.client.get(`/api/workspaces/${a.ws.id}/export`);
    expect(res.status, res.text).toBe(200);
    expect(res.body?.workspace?.id).toBe(a.ws.id);
    expect(Array.isArray(res.body?.documents)).toBe(true);
    expect(((res.body.documents ?? []) as any[]).some((d) => d.id === mine.id && d.title === SECRET.title)).toBe(true);

    const dump = JSON.stringify(res.body);
    expect(dump).toContain(SECRET_PHRASE); // this workspace's own document text is exported
    expect(dump).not.toContain(COFFEE.title); // the other workspace's document is not
  });
});
