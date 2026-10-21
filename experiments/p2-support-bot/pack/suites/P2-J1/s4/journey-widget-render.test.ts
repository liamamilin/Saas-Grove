// F12 — the widget on the company's own website.
//
// Brief (user-brief.md): "客户把资料传进去，在自己网站上挂个聊天小窗口" — the chat window is
// hung on the company's own website, not on the product's site.
// Contract (api.yaml): GET /widget.js serves the embeddable widget script; the widget talks
// to the public routes under /api/widget/{key}.
// UI anchors (testability.md §8): widget-launcher (the button that opens the panel; the panel
// may start collapsed), widget-input, widget-send.

import { test } from "vitest";
import type { Page } from "playwright";
import { PASSWORD, createWorkspace, newEmail, signup, uid } from "../../lib/helpers";
import { BASE_URL } from "../../lib/client";
import { hostPage, updateWidget, widgetSettings } from "../../lib/widget";
import { withPage } from "../../lib/ui";

async function shown(page: Page, testId: string): Promise<boolean> {
  const loc = page.getByTestId(testId);
  return (await loc.count()) > 0 && (await loc.first().isVisible());
}

async function waitForVisible(page: Page, testId: string, timeout = 30_000): Promise<void> {
  await page.getByTestId(testId).first().waitFor({ state: "visible", timeout });
}

test("F12: the widget script puts a launcher on the company's website and it opens the panel", async () => {
  const account = await signup({ email: newEmail("widget"), password: PASSWORD });
  const ws = await createWorkspace(account.client, `Lamp shop ${uid()}`);
  const settings = await widgetSettings(account.client, ws.id);

  // The company's own website, on its own origin.
  const host = await hostPage(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Our shop</title></head>` +
      `<body><h1>Lamp shop</h1><script src="${BASE_URL}/widget.js" data-widget-key="${settings.widgetKey}" async></script></body></html>`,
  );
  try {
    await updateWidget(account.client, ws.id, { allowedOrigins: [host.origin] });

    await withPage(async (page) => {
      await page.goto(host.url);

      // The script renders a launcher into the host page.
      await waitForVisible(page, "widget-launcher", 30_000);

      // The launcher opens the chat panel.
      if (!(await shown(page, "widget-input"))) {
        await page.getByTestId("widget-launcher").first().click();
      }
      await waitForVisible(page, "widget-input", 30_000);
      await waitForVisible(page, "widget-send", 30_000);
    });
  } finally {
    await host.close();
  }
});
