// F30 — the monthly budget is a hard stop.
//
// Brief (user-brief.md): "能设个月度预算，超了就停，别让我客户月底收到一张天价账单。这个我很
// 在意" — over the budget the bot stops, and the bill never surprises the company.
// Contract (api.yaml §/api/workspaces/{ws}/budget): the budget is a hard stop, "spending in a
// month never exceeds it"; before each model call the product reserves the most that call can
// cost and the call is made only if spent + reserved + this reservation <= budget. A question
// that cannot be paid for is unanswered ("the model is not called at all") and the visitor
// gets the fallback answer. A new workspace starts at a budget of 10.
// The budget itself has no documented UI anchor (see JOURNEY-NOTES.md), so the journey sets
// it through the contract's API and watches what the browser does with it.

import { expect, test } from "vitest";
import type { Page } from "playwright";
import {
  PASSWORD,
  createWorkspace,
  expectStatus,
  knowledgeBase,
  newEmail,
  setBudget,
  signup,
  uid,
  usageRecords,
  waitFor,
} from "../../lib/helpers";
import { BASE_URL } from "../../lib/client";
import { Q_REFUND } from "../../lib/corpus";
import { hostPage, updateWidget, widgetSettings } from "../../lib/widget";
import { withPage } from "../../lib/ui";

/** One fake chat call costs 0.01; this budget cannot even pay for one. */
const BUDGET_USD = 0.005;

/** The fallback the company configured; the bot must say exactly this. */
const FALLBACK = "抱歉，这个问题我暂时答不上来，请留下联系方式让客服同事跟进。";

async function shown(page: Page, testId: string): Promise<boolean> {
  const loc = page.getByTestId(testId);
  return (await loc.count()) > 0 && (await loc.first().isVisible());
}

async function waitForVisible(page: Page, testId: string, timeout = 30_000): Promise<void> {
  await page.getByTestId(testId).first().waitFor({ state: "visible", timeout });
}

test("F30: a question that does not fit the budget is not answered, and the month stays cheap", async () => {
  const account = await signup({ email: newEmail("budget"), password: PASSWORD });
  const ws = await createWorkspace(account.client, `Lamp shop ${uid()}`);
  await knowledgeBase(account.client, ws.id);
  const settings = await widgetSettings(account.client, ws.id);
  const host = await hostPage(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Our shop</title></head>` +
      `<body><h1>Lamp shop</h1><script src="${BASE_URL}/widget.js" data-widget-key="${settings.widgetKey}" async></script></body></html>`,
  );
  try {
    await updateWidget(account.client, ws.id, { allowedOrigins: [host.origin], fallbackMessage: FALLBACK });
    const put = await setBudget(account.client, ws.id, BUDGET_USD);
    expect(Number(put?.budgetUsd), "the budget was not stored").toBeCloseTo(BUDGET_USD, 6);

    await withPage(async (page) => {
      await page.goto(host.url);
      await waitForVisible(page, "widget-launcher", 30_000);
      if (!(await shown(page, "widget-input"))) {
        await page.getByTestId("widget-launcher").first().click();
      }
      await waitForVisible(page, "widget-input", 30_000);

      // A question the knowledge base could answer, but the budget cannot pay for.
      await page.getByTestId("widget-input").fill(Q_REFUND);
      await page.getByTestId("widget-send").click();

      const answer = await waitFor(
        async () => {
          const messages = page.getByTestId("widget-message-assistant");
          if ((await messages.count()) === 0) return undefined;
          const text = ((await messages.last().innerText()) ?? "").trim();
          return text.length ? text : undefined;
        },
        { timeout: 60_000, what: "an answer in the widget" },
      );
      expect(answer, "the visitor did not get the fallback answer").toContain(FALLBACK);

      // The model was not called: no call, no cost.
      const records = await usageRecords(account.client, ws.id);
      const calls = records.filter((r: any) => r.kind === "chat");
      expect(calls.length, "the model was called although the budget could not pay for it").toBe(0);

      // And the month did not cost more than the budget.
      const usage = await account.client.get(`/api/workspaces/${ws.id}/usage`);
      expectStatus(usage, 200);
      expect(Number(usage.body?.budgetUsd)).toBeCloseTo(BUDGET_USD, 6);
      const spentUsd = Number(usage.body?.spentUsd);
      expect(Number.isFinite(spentUsd), "the usage must report a spent amount").toBe(true);
      expect(
        spentUsd,
        `the month cost ${spentUsd} of a budget of ${BUDGET_USD}`,
      ).toBeLessThanOrEqual(BUDGET_USD + 1e-9);
    });
  } finally {
    await host.close();
  }
});
