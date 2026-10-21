// F8 — put a document into the knowledge base.
//
// Brief (user-brief.md): "他们的产品文档和常见问题一般都乱七八糟，散在 PDF、Word、Notion、
// 帮助中心里" — the material is the heart of the product; the company has to be able to put
// it in and see that it is usable.
// Contract (api.yaml §/api/workspaces/{ws}/documents): POST {title, text} -> 201 {document};
// the document is `processing` and then `ready` (or `failed`) once it is parsed and indexed.
// UI anchors (testability.md §8): document-text-title, document-text-body, document-text-submit
// and document-item — "每份资料一个，文本中包含它的状态值，原文就是 API 里的 processing / ready
// / failed。状态要自动刷新，不需要手动刷新页面".

import { expect, test } from "vitest";
import type { Page } from "playwright";
import { PASSWORD, expectStatus, newEmail, signup, uid, waitFor } from "../../lib/helpers";
import { Client } from "../../lib/client";
import { withPage, uiLogin } from "../../lib/ui";

async function shown(page: Page, testId: string): Promise<boolean> {
  const loc = page.getByTestId(testId);
  return (await loc.count()) > 0 && (await loc.first().isVisible());
}

async function waitForAny(page: Page, testIds: string[], timeout = 30_000): Promise<string> {
  return waitFor(
    async () => {
      for (const id of testIds) if (await shown(page, id)) return id;
      return undefined;
    },
    { timeout, what: `one of ${testIds.join(" / ")} to be visible` },
  );
}

async function waitForVisible(page: Page, testId: string, timeout = 30_000): Promise<void> {
  await page.getByTestId(testId).first().waitFor({ state: "visible", timeout });
}

/**
 * Wait for a document-item that shows the status `ready`. The page is never reloaded:
 * testability.md §8 says the status refreshes on its own.
 */
async function waitForReadyItem(page: Page, timeout = 60_000): Promise<string> {
  return waitFor(
    async () => {
      const items = page.getByTestId("document-item");
      const count = await items.count();
      for (let i = 0; i < count; i++) {
        const label = (await items.nth(i).innerText()).trim();
        if (/\bready\b/i.test(label)) return label;
      }
      return undefined;
    },
    { timeout, interval: 250, what: "a document-item whose status is ready" },
  );
}

/** The workspace the browser is showing, so the browser and the API talk about one workspace. */
async function workspaceOfBrowser(api: Client, page: Page): Promise<string> {
  const name = (await page.getByTestId("workspace-name").first().innerText()).trim();
  const res = await api.get("/api/workspaces");
  expectStatus(res, 200);
  const list = (res.body?.workspaces ?? []) as { id: string; name: string }[];
  const ws = list.find((w) => w.name === name) ?? list[0];
  expect(ws, `the workspace the browser shows ("${name}") must exist in the API`).toBeTruthy();
  return ws.id;
}

test("F8: a member pastes a document and its status turns to ready without a reload", async () => {
  const account = await signup({ email: newEmail("kb"), password: PASSWORD });

  await withPage(async (page) => {
    await uiLogin(page, account.email, PASSWORD);
    const landing = await waitForAny(page, ["workspace-create-name", "workspace-name"], 30_000);
    if (landing === "workspace-create-name") {
      await page.getByTestId("workspace-create-name").fill(`Lamp shop ${uid()}`);
      await page.getByTestId("workspace-create-submit").click();
    }
    await waitForVisible(page, "workspace-name", 30_000);
    const wsId = await workspaceOfBrowser(account.client, page);

    // The knowledge base page.
    await page.getByTestId("nav-knowledge").first().click();
    await waitForVisible(page, "document-text-title", 30_000);
    await waitForVisible(page, "document-text-body", 30_000);
    await waitForVisible(page, "document-text-submit", 30_000);

    const title = "Shipping and delivery";
    const text = [
      "Orders leave our Rotterdam warehouse every weekday before four in the afternoon.",
      "Standard delivery inside the Netherlands takes two working days.",
    ].join("\n\n");

    await page.getByTestId("document-text-title").fill(title);
    await page.getByTestId("document-text-body").fill(text);
    await page.getByTestId("document-text-submit").click();

    // The list shows the new document, and the status refreshes to `ready` by itself.
    const item = await waitForReadyItem(page);
    expect(item.length, "the document item must not be empty").toBeGreaterThan(0);

    // The product really stored the document, indexed and ready.
    const docs = await account.client.get(`/api/workspaces/${wsId}/documents`);
    expectStatus(docs, 200);
    const documents = (docs.body?.documents ?? []) as { id: string; title: string; status: string }[];
    const mine = documents.find((d) => d.title === title);
    expect(mine, `no document titled "${title}" among ${documents.map((d) => d.title).join(", ")}`).toBeTruthy();
    expect(mine!.status).toBe("ready");
  });
});
