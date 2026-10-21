// F29 — the questions the bot could not answer.
//
// Brief (user-brief.md): "公司后台我想看到……都问了什么、哪些问题没答上来" — the company has to
// see what visitors ask and which questions the material does not cover, so it can write the
// missing documentation.
// Contract (api.yaml §/api/workspaces/{ws}/analytics/questions): GET .../questions ->
// {questions}; each question has its own text, its outcome and the reason.
// UI anchor (testability.md §8): analytics-unanswered-item — one per question of this month
// that went unanswered, its text contains the question itself.

import { expect, test } from "vitest";
import type { Page } from "playwright";
import { PASSWORD, expectStatus, knowledgeBase, newEmail, signup, uid, waitFor } from "../../lib/helpers";
import { BASE_URL, Client } from "../../lib/client";
import { Q_UNKNOWN } from "../../lib/corpus";
import { hostPage, updateWidget, widgetSettings } from "../../lib/widget";
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

test("F29: the analytics page lists the questions the bot could not answer", async () => {
  const account = await signup({ email: newEmail("unanswered"), password: PASSWORD });

  await withPage(async (page) => {
    await uiLogin(page, account.email, PASSWORD);
    const landing = await waitForAny(page, ["workspace-create-name", "workspace-name"], 30_000);
    if (landing === "workspace-create-name") {
      await page.getByTestId("workspace-create-name").fill(`Lamp shop ${uid()}`);
      await page.getByTestId("workspace-create-submit").click();
    }
    await waitForVisible(page, "workspace-name", 30_000);
    const homeUrl = page.url();
    const wsId = await workspaceOfBrowser(account.client, page);
    await knowledgeBase(account.client, wsId);
    const settings = await widgetSettings(account.client, wsId);

    const host = await hostPage(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Our shop</title></head>` +
        `<body><h1>Lamp shop</h1><script src="${BASE_URL}/widget.js" data-widget-key="${settings.widgetKey}" async></script></body></html>`,
    );
    try {
      await updateWidget(account.client, wsId, { allowedOrigins: [host.origin] });

      // A visitor asks something the knowledge base cannot answer.
      await page.goto(host.url);
      await waitForVisible(page, "widget-launcher", 30_000);
      if (!(await shown(page, "widget-input"))) {
        await page.getByTestId("widget-launcher").first().click();
      }
      await waitForVisible(page, "widget-input", 30_000);
      await page.getByTestId("widget-input").fill(Q_UNKNOWN);
      await page.getByTestId("widget-send").click();
      await waitFor(
        async () => {
          const messages = page.getByTestId("widget-message-assistant");
          if ((await messages.count()) === 0) return undefined;
          return ((await messages.last().innerText()) ?? "").trim().length ? true : undefined;
        },
        { timeout: 60_000, what: "an answer in the widget" },
      );

      // The question is on the company's list of unanswered questions.
      await page.goto(homeUrl);
      await waitForVisible(page, "workspace-name", 30_000);
      await page.getByTestId("nav-analytics").first().click();

      const item = await waitFor(
        async () => {
          const items = page.getByTestId("analytics-unanswered-item");
          for (let i = 0; i < (await items.count()); i++) {
            const text = (await items.nth(i).innerText()).trim();
            if (text.includes("submarine periscopes")) return text;
          }
          return undefined;
        },
        { timeout: 30_000, interval: 250, what: "an analytics-unanswered-item with the question" },
      );
      expect(item.length, "the unanswered item must not be empty").toBeGreaterThan(0);

      // The product agrees that the question went unanswered.
      const res = await account.client.get(`/api/workspaces/${wsId}/analytics/questions?outcome=unanswered`);
      expectStatus(res, 200);
      const questions = (res.body?.questions ?? []) as { question: string; outcome: string }[];
      expect(
        questions.some((q) => q.question.includes("submarine periscopes")),
        `the question is not among ${JSON.stringify(questions.map((q) => q.question))}`,
      ).toBe(true);
    } finally {
      await host.close();
    }
  });
});
