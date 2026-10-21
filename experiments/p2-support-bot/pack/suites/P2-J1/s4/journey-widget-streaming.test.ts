// F14 — the answer arrives while it is being produced.
//
// Contract (api.yaml §/api/widget/{key}/conversations/{id}/messages): the answer is streamed
// as Server-Sent Events — "each flushed as soon as it is produced", then `event: done`.
// testability.md §5: the fake model returns the answer "以至少 2 段增量流式返回", so with a
// slow model the visitor sees the text grow.
// UI anchor (testability.md §8): widget-message-assistant — "每条助手消息一个，流式时文字逐步出现".

import { expect, test } from "vitest";
import type { Page } from "playwright";
import {
  PASSWORD,
  createWorkspace,
  fakeModel,
  isolateFakeModel,
  knowledgeBase,
  newEmail,
  signup,
  uid,
  waitFor,
} from "../../lib/helpers";
import { BASE_URL } from "../../lib/client";
import { Q_REFUND } from "../../lib/corpus";
import { hostPage, updateWidget, widgetSettings } from "../../lib/widget";
import { withPage } from "../../lib/ui";

// The fake model is shared by the whole application: its latency is set only for this
// journey and taken away again before and after it.
isolateFakeModel();

async function shown(page: Page, testId: string): Promise<boolean> {
  const loc = page.getByTestId(testId);
  return (await loc.count()) > 0 && (await loc.first().isVisible());
}

async function waitForVisible(page: Page, testId: string, timeout = 30_000): Promise<void> {
  await page.getByTestId(testId).first().waitFor({ state: "visible", timeout });
}

test("F14: the answer in the widget appears progressively, not all at once", async () => {
  // A slow model: the parts of the answer are far enough apart to be seen.
  await fakeModel.set({ latencyMs: 700 });

  const account = await signup({ email: newEmail("stream"), password: PASSWORD });
  const ws = await createWorkspace(account.client, `Lamp shop ${uid()}`);
  await knowledgeBase(account.client, ws.id);
  const settings = await widgetSettings(account.client, ws.id);
  const host = await hostPage(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Our shop</title></head>` +
      `<body><h1>Lamp shop</h1><script src="${BASE_URL}/widget.js" data-widget-key="${settings.widgetKey}" async></script></body></html>`,
  );
  try {
    await updateWidget(account.client, ws.id, { allowedOrigins: [host.origin] });

    await withPage(async (page) => {
      await page.goto(host.url);
      await waitForVisible(page, "widget-launcher", 30_000);
      if (!(await shown(page, "widget-input"))) {
        await page.getByTestId("widget-launcher").first().click();
      }
      await waitForVisible(page, "widget-input", 30_000);

      await page.getByTestId("widget-input").fill(Q_REFUND);
      await page.getByTestId("widget-send").click();

      // Watch the answer grow: it must be seen in more than one state.
      const seen = new Set<string>();
      await waitFor(
        async () => {
          const messages = page.getByTestId("widget-message-assistant");
          if ((await messages.count()) > 0) {
            const text = ((await messages.last().innerText()) ?? "").trim();
            if (text) seen.add(text);
          }
          return seen.size >= 2 ? true : undefined;
        },
        { timeout: 60_000, interval: 50, what: "the answer to appear in more than one piece" },
      );
      expect(seen.size, "the answer appeared all at once").toBeGreaterThanOrEqual(2);
    });
  } finally {
    await host.close();
  }
});
