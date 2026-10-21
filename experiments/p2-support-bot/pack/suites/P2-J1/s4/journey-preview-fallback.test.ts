// F25 — the preview falls back, too.
//
// Brief (user-brief.md): "我最担心的是它瞎编答案" — the demo the company shows its customers
// must not invent answers either.
// Contract (api.yaml): an unanswered message has `outcome: "unanswered"`, `citations: []` and
// a content that is exactly the widget's `fallbackMessage`; the visitor is never shown an
// error, a made-up answer or the reason.
// UI anchors (testability.md §8): preview-input, preview-submit, preview-answer.

import { expect, test } from "vitest";
import type { Page } from "playwright";
import { PASSWORD, expectStatus, knowledgeBase, newEmail, signup, uid, waitFor } from "../../lib/helpers";
import { Client } from "../../lib/client";
import { updateWidget } from "../../lib/widget";
import { Q_UNKNOWN } from "../../lib/corpus";
import { withPage, uiLogin } from "../../lib/ui";

/** The fallback the company configured; the bot must say exactly this. */
const FALLBACK = "抱歉，这个问题我暂时答不上来，请留下联系方式让客服同事跟进。";

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

test("F25: the preview shows the fallback answer for a question that cannot be answered", async () => {
  const account = await signup({ email: newEmail("preview2"), password: PASSWORD });

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
    await updateWidget(account.client, wsId, { fallbackMessage: FALLBACK });

    await page.getByTestId("nav-knowledge").first().click();
    await waitForVisible(page, "preview-input", 30_000);
    await waitForVisible(page, "preview-submit", 30_000);

    // A question no document in the knowledge base can answer.
    await page.getByTestId("preview-input").fill(Q_UNKNOWN);
    await page.getByTestId("preview-submit").click();

    const answer = await waitFor(
      async () => {
        const text = ((await page.getByTestId("preview-answer").first().innerText().catch(() => "")) ?? "").trim();
        return text.length ? text : undefined;
      },
      { timeout: 60_000, what: "an answer in the preview" },
    );
    expect(answer, "the preview did not show the fallback answer").toContain(FALLBACK);
  });
});
