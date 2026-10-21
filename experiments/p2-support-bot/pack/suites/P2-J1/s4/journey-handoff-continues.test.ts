// F18 — the bot keeps answering after a handoff.
//
// Contract (api.yaml §/api/widget/{key}/conversations/{id}/handoff): "A conversation has at
// most one handoff … The bot keeps answering questions in a handed-off conversation." The
// visitor of a shop that has just been handed to a person can still ask the bot, and the bot
// still answers from the knowledge base.
// UI anchors (testability.md §8): widget-input, widget-send, widget-message-assistant,
// widget-handoff, widget-contact-email, widget-handoff-submit, widget-handoff-done.

import { expect, test } from "vitest";
import type { Page } from "playwright";
import { PASSWORD, createWorkspace, expectStatus, knowledgeBase, newEmail, signup, uid, waitFor } from "../../lib/helpers";
import { BASE_URL } from "../../lib/client";
import { Q_REFUND, Q_SHIPPING } from "../../lib/corpus";
import { hostPage, updateWidget, widgetSettings } from "../../lib/widget";
import { withPage } from "../../lib/ui";

async function shown(page: Page, testId: string): Promise<boolean> {
  const loc = page.getByTestId(testId);
  return (await loc.count()) > 0 && (await loc.first().isVisible());
}

async function waitForVisible(page: Page, testId: string, timeout = 30_000): Promise<void> {
  await page.getByTestId(testId).first().waitFor({ state: "visible", timeout });
}

/** Wait until the widget shows `count` assistant messages with text. */
async function waitForAnswers(page: Page, count: number, timeout = 60_000): Promise<string[]> {
  return waitFor(
    async () => {
      const messages = page.getByTestId("widget-message-assistant");
      const found: string[] = [];
      for (let i = 0; i < (await messages.count()); i++) {
        const text = ((await messages.nth(i).innerText()) ?? "").trim();
        if (text) found.push(text);
      }
      return found.length >= count ? found : undefined;
    },
    { timeout, what: `${count} answers in the widget` },
  );
}

test("F18: the bot keeps answering questions in a conversation that was handed off", async () => {
  const account = await signup({ email: newEmail("handoff2"), password: PASSWORD });
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

      // The first question is answered.
      await page.getByTestId("widget-input").fill(Q_REFUND);
      await page.getByTestId("widget-send").click();
      await waitForAnswers(page, 1);

      // The visitor asks for a person.
      await waitForVisible(page, "widget-handoff", 30_000);
      if (!(await shown(page, "widget-contact-email"))) {
        await page.getByTestId("widget-handoff").first().click();
      }
      await waitForVisible(page, "widget-contact-email", 30_000);
      await page.getByTestId("widget-contact-email").fill(`visitor-${uid()}@example.test`);
      await page.getByTestId("widget-handoff-submit").click();
      await waitForVisible(page, "widget-handoff-done", 30_000);

      // The bot still answers in the same conversation.
      await waitForVisible(page, "widget-input", 30_000);
      await page.getByTestId("widget-input").fill(Q_SHIPPING);
      await page.getByTestId("widget-send").click();
      const answers = await waitForAnswers(page, 2);
      expect(answers.length, "the bot stopped answering after the handoff").toBeGreaterThanOrEqual(2);

      // The conversation is marked as handed off, and both answers are in it.
      const list = await account.client.get(`/api/workspaces/${ws.id}/conversations`);
      expectStatus(list, 200);
      const conversations = (list.body?.conversations ?? []) as { id: string; status: string }[];
      expect(conversations.length, "the conversation must be in the workspace").toBeGreaterThan(0);
      expect(conversations[0].status).toBe("handed_off");
      const detail = await account.client.get(`/api/workspaces/${ws.id}/conversations/${conversations[0].id}`);
      expectStatus(detail, 200);
      const messages = (detail.body?.messages ?? []) as any[];
      expect(messages.filter((m) => m.role === "assistant").length, "both answers must be stored").toBeGreaterThanOrEqual(2);
    });
  } finally {
    await host.close();
  }
});
