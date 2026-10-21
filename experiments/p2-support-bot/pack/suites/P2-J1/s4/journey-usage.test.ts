// F28 — what this month has cost.
//
// Brief (user-brief.md): "公司后台我想看到这个月用了多少" — the company has to see the bill
// of the month.
// Contract (api.yaml §/api/workspaces/{ws}/usage): GET .../usage -> {periodStart, periodEnd,
// spentUsd, budgetUsd} for this calendar month (UTC); every chat call costs
// FAKE_CHAT_CALL_COST_USD (0.01 by default, testability.md §5).
// UI anchor (testability.md §8): usage-spent — "本月已花费；文本里出现的第一个数字就是本月
// 已花费的美元金额，不要把日期或预算写在它前面".

import { expect, test } from "vitest";
import type { Page } from "playwright";
import { PASSWORD, expectStatus, knowledgeBase, newEmail, signup, uid, waitFor } from "../../lib/helpers";
import { BASE_URL, Client } from "../../lib/client";
import { Q_REFUND } from "../../lib/corpus";
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

/** The first number in a piece of text is the amount (testability.md §8). */
function firstNumber(text: string): number {
  const match = text.match(/-?\d[\d,]*\.?\d*/);
  expect(match, `no amount in "${text}"`).toBeTruthy();
  return Number(match![0].replace(/,/g, ""));
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

test("F28: the analytics page shows what this month has cost", async () => {
  const account = await signup({ email: newEmail("usage"), password: PASSWORD });

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

      // A visitor asks a question that the bot answers: one model call, one cent.
      await page.goto(host.url);
      await waitForVisible(page, "widget-launcher", 30_000);
      if (!(await shown(page, "widget-input"))) {
        await page.getByTestId("widget-launcher").first().click();
      }
      await waitForVisible(page, "widget-input", 30_000);
      await page.getByTestId("widget-input").fill(Q_REFUND);
      await page.getByTestId("widget-send").click();
      await waitFor(
        async () => {
          const messages = page.getByTestId("widget-message-assistant");
          if ((await messages.count()) === 0) return undefined;
          return ((await messages.last().innerText()) ?? "").trim().length ? true : undefined;
        },
        { timeout: 60_000, what: "an answer in the widget" },
      );

      // The company sees the cost of the month.
      const usage = await account.client.get(`/api/workspaces/${wsId}/usage`);
      expectStatus(usage, 200);
      const spentUsd = Number(usage.body?.spentUsd);
      expect(Number.isFinite(spentUsd), "the usage must report a spent amount").toBe(true);
      expect(spentUsd, "the answered question must have cost something").toBeGreaterThan(0);

      await page.goto(homeUrl);
      await waitForVisible(page, "workspace-name", 30_000);
      await page.getByTestId("nav-analytics").first().click();
      await waitForVisible(page, "usage-spent", 30_000);

      const label = ((await page.getByTestId("usage-spent").first().innerText()) ?? "").trim();
      expect(label.length, "usage-spent must show an amount").toBeGreaterThan(0);
      const shownAmount = firstNumber(label);
      expect(shownAmount, `usage-spent shows "${label}"`).toBeGreaterThan(0);
      expect(
        Math.abs(shownAmount - spentUsd),
        `usage-spent shows "${label}" but the month has cost ${spentUsd}`,
      ).toBeLessThanOrEqual(0.005);
    } finally {
      await host.close();
    }
  });
});
