// F24 — the team's own preview of the bot.
//
// Brief (user-brief.md): "最好先有个能演示的版本，我拿去找两三个熟客户试用" — the company wants
// to see the bot work on its own material before it goes live.
// Contract (api.yaml): the preview uses the public widget routes with the product's own
// origin, which the product always allows (widget rule 2); an answered message has
// `outcome: "answered"` and at least one citation.
// UI anchors (testability.md §8, "后台预览（在知识库页上，用产品自己的 origin 走公开接口）"):
// preview-input, preview-submit, preview-answer (the text of the latest answer),
// preview-citation (one per citation of the latest answer, its text contains the document title).

import { expect, test } from "vitest";
import type { Page } from "playwright";
import { PASSWORD, expectStatus, knowledgeBase, newEmail, signup, uid, waitFor } from "../../lib/helpers";
import { Client } from "../../lib/client";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
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

test("F24: the preview on the knowledge page answers with the document it cites", async () => {
  const account = await signup({ email: newEmail("preview"), password: PASSWORD });

  await withPage(async (page) => {
    await uiLogin(page, account.email, PASSWORD);
    const landing = await waitForAny(page, ["workspace-create-name", "workspace-name"], 30_000);
    if (landing === "workspace-create-name") {
      await page.getByTestId("workspace-create-name").fill(`Lamp shop ${uid()}`);
      await page.getByTestId("workspace-create-submit").click();
    }
    await waitForVisible(page, "workspace-name", 30_000);
    const wsId = await workspaceOfBrowser(account.client, page);
    await knowledgeBase(account.client, wsId);

    // The knowledge page carries the preview.
    await page.getByTestId("nav-knowledge").first().click();
    await waitForVisible(page, "preview-input", 30_000);
    await waitForVisible(page, "preview-submit", 30_000);

    await page.getByTestId("preview-input").fill(Q_REFUND);
    await page.getByTestId("preview-submit").click();

    // The answer shows up in the preview.
    const answer = await waitFor(
      async () => {
        const text = ((await page.getByTestId("preview-answer").first().innerText().catch(() => "")) ?? "").trim();
        return text.length ? text : undefined;
      },
      { timeout: 60_000, what: "an answer in the preview" },
    );
    expect(answer.length, "the preview must show the answer").toBeGreaterThan(0);

    // The preview names the document the answer came from.
    const citations = page.getByTestId("preview-citation");
    await waitFor(
      async () => ((await citations.count()) > 0 ? true : undefined),
      { timeout: 30_000, what: "a citation under the preview answer" },
    );
    const texts: string[] = [];
    for (let i = 0; i < (await citations.count()); i++) {
      texts.push((await citations.nth(i).innerText()).trim());
    }
    expect(
      texts.some((t) => t.includes(REFUNDS.title)),
      `the preview citations do not name the document: ${JSON.stringify(texts)}`,
    ).toBe(true);
  });
});
