import { describe, expect, it } from "vitest";
import { Q_REFUND, Q_UNKNOWN, REFUNDS } from "../../lib/corpus";
import { addText, isolateFakeModel, newEmail } from "../../lib/helpers";
import { uiLogin, withPage } from "../../lib/ui";
import { hostPage, supportTeam, updateWidget, visitor, widgetSettings } from "../../lib/widget";

describe("S4 user interface", () => {
  isolateFakeModel();

  it("answers and hands off in the widget embedded on a customer's website", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);
    const contact = newEmail("widget-visitor");
    // The customer's website: another origin, carrying exactly the embed snippet the product hands out.
    const snippet = (await widgetSettings(team.client, team.ws.id)).embedSnippet ?? "";
    expect(snippet, "the widget settings carry an embed snippet").toContain("widget.js");
    const site = await hostPage(`<!doctype html><html><head><title>Lamp shop</title></head><body><h1>Lamp shop</h1>${snippet}</body></html>`);
    try {
      await updateWidget(team.client, team.ws.id, { allowedOrigins: [site.origin] });
      await withPage(async (page) => {
        await page.goto(site.url);
        const launcher = page.getByTestId("widget-launcher").first();
        await launcher.waitFor({ timeout: 30_000 });
        if (!(await page.getByTestId("widget-input").first().isVisible())) await launcher.click();

        await page.getByTestId("widget-input").first().fill(Q_REFUND);
        await page.getByTestId("widget-send").first().click();
        await expect
          .poll(async () => ((await page.getByTestId("widget-message-assistant").last().textContent()) ?? "").trim().length, { timeout: 30_000 })
          .toBeGreaterThan(0);
        await expect
          .poll(() => page.getByTestId("widget-citation").first().textContent(), { timeout: 30_000 })
          .toContain(REFUNDS.title);

        await page.getByTestId("widget-handoff").first().click();
        await page.getByTestId("widget-contact-email").first().fill(contact);
        await page.getByTestId("widget-handoff-submit").first().click();
        await page.getByTestId("widget-handoff-done").first().waitFor({ timeout: 30_000 });
      });
    } finally {
      await site.close();
    }

    // The team sees the handoff, with the visitor's email, in the product.
    await withPage(async (page) => {
      await uiLogin(page, team.email, team.password);
      await page.getByTestId("nav-handoffs").first().click();
      await expect
        .poll(async () => (await page.getByTestId("handoff-item").allTextContents()).join(" | "), { timeout: 30_000 })
        .toContain(contact);
    });
  });

  it("shows unanswered questions and the month's spend on the analytics page", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);
    const v = await visitor(team.key);
    await v.answer(Q_REFUND);
    await v.answer(Q_UNKNOWN);

    await withPage(async (page) => {
      await uiLogin(page, team.email, team.password);
      await page.getByTestId("nav-analytics").first().click();
      await expect
        .poll(async () => (await page.getByTestId("analytics-unanswered-item").allTextContents()).join(" | "), { timeout: 30_000 })
        .toContain(Q_UNKNOWN);
      await expect
        .poll(async () => {
          const text = (await page.getByTestId("usage-spent").first().textContent()) ?? "";
          // spec/architecture.md §8: the first number in usage-spent is this month's spend.
          const first = text.match(/\d+(\.\d+)?/);
          const amount = first ? Number(first[0]) : 0;
          return Number.isFinite(amount) ? amount : 0;
        }, { timeout: 30_000 })
        .toBeGreaterThan(0);
    });
  });
});
