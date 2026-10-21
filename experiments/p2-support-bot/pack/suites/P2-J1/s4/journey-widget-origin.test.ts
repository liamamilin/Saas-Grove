// F19 — the widget answers only on the websites the company allowed.
//
// Contract (api.yaml, the rules for every route under /api/widget/{key}): "The request's
// Origin header must be one of the widget's allowedOrigins, or the product's own origin
// (APP_BASE_URL, for its in-app preview). Otherwise -> 403 origin_not_allowed. A request
// WITHOUT an Origin header is refused the same way (fail closed)." The product's own origin
// is always allowed, which is what the in-app preview uses.
// UI anchors (testability.md §8): widget-launcher, widget-input, widget-send,
// widget-message-assistant.

import { expect, test } from "vitest";
import type { Page } from "playwright";
import { PASSWORD, createWorkspace, knowledgeBase, newEmail, signup, uid, waitFor } from "../../lib/helpers";
import { BASE_URL } from "../../lib/client";
import { Q_REFUND } from "../../lib/corpus";
import { hostPage, updateWidget, widgetSettings } from "../../lib/widget";
import { withPage } from "../../lib/ui";

async function shown(page: Page, testId: string): Promise<boolean> {
  const loc = page.getByTestId(testId);
  return (await loc.count()) > 0 && (await loc.first().isVisible());
}

async function waitForVisible(page: Page, testId: string, timeout = 30_000): Promise<void> {
  await page.getByTestId(testId).first().waitFor({ state: "visible", timeout });
}

/** Open the widget on a host page and ask one question. */
async function askOnHost(page: Page, url: string, question: string): Promise<void> {
  await page.goto(url);
  await waitForVisible(page, "widget-launcher", 30_000);
  if (!(await shown(page, "widget-input"))) {
    await page.getByTestId("widget-launcher").first().click();
  }
  await waitForVisible(page, "widget-input", 30_000);
  await page.getByTestId("widget-input").fill(question);
  await page.getByTestId("widget-send").click();
}

/** True when the widget shows an answer. */
async function hasAnswer(page: Page): Promise<boolean> {
  const messages = page.getByTestId("widget-message-assistant");
  if ((await messages.count()) === 0) return false;
  return ((await messages.last().innerText()) ?? "").trim().length > 0;
}

test("F19: the widget answers on an allowed website and stays silent on any other", async () => {
  const account = await signup({ email: newEmail("origin"), password: PASSWORD });
  const ws = await createWorkspace(account.client, `Lamp shop ${uid()}`);
  await knowledgeBase(account.client, ws.id);
  const settings = await widgetSettings(account.client, ws.id);
  const site = () =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Our shop</title></head>` +
    `<body><h1>Lamp shop</h1><script src="${BASE_URL}/widget.js" data-widget-key="${settings.widgetKey}" async></script></body></html>`;

  const allowed = await hostPage(site());
  const stranger = await hostPage(site());
  try {
    // Only the origin of the first page is on the list.
    await updateWidget(account.client, ws.id, { allowedOrigins: [allowed.origin] });

    await withPage(async (page) => {
      // The allowed website gets an answer.
      await askOnHost(page, allowed.url, Q_REFUND);
      const answered = await waitFor(() => hasAnswer(page), {
        timeout: 60_000,
        what: "an answer on the allowed website",
      });
      expect(answered, "the allowed website got no answer").toBe(true);

      // Another website gets none.
      await page.goto(stranger.url);
      await waitForVisible(page, "widget-launcher", 30_000);
      if (await shown(page, "widget-input")) {
        await page.getByTestId("widget-input").fill(Q_REFUND);
        await page.getByTestId("widget-send").click();
      }
      let answeredElsewhere = false;
      try {
        await waitFor(() => hasAnswer(page), {
          timeout: 12_000,
          interval: 250,
          what: "an answer on a website that is not allowed",
        });
        answeredElsewhere = true;
      } catch {
        answeredElsewhere = false;
      }
      expect(answeredElsewhere, "a website that is not on the allowed list got an answer").toBe(false);
    });
  } finally {
    await allowed.close();
    await stranger.close();
  }
});
