// F13 — the visitor's question is answered, with the document it came from.
//
// Brief (user-brief.md): "访客提问就按资料回答，而且要说清楚答案是从哪段资料来的，不然客户
// 不敢信" — the answer must say where it comes from, that is the whole point of the product.
// Contract (api.yaml): POST /api/widget/{key}/conversations/{id}/messages streams SSE; an
// answered message has `outcome: "answered"`, at least one citation, a citation for every
// `[n]` in the content, and every quote is verbatim from the cited document's text.
// UI anchors (testability.md §8): widget-input, widget-send, widget-message-assistant,
// widget-citation (one per citation, its text contains the document title).

import { expect, test } from "vitest";
import type { Page } from "playwright";
import { PASSWORD, createWorkspace, documentText, expectStatus, knowledgeBase, newEmail, signup, uid, waitFor } from "../../lib/helpers";
import { BASE_URL } from "../../lib/client";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { hostPage, updateWidget, widgetSettings } from "../../lib/widget";
import { withPage } from "../../lib/ui";

async function shown(page: Page, testId: string): Promise<boolean> {
  const loc = page.getByTestId(testId);
  return (await loc.count()) > 0 && (await loc.first().isVisible());
}

async function waitForVisible(page: Page, testId: string, timeout = 30_000): Promise<void> {
  await page.getByTestId(testId).first().waitFor({ state: "visible", timeout });
}

async function waitForAnswer(page: Page, timeout = 60_000): Promise<string> {
  return waitFor(
    async () => {
      const messages = page.getByTestId("widget-message-assistant");
      if ((await messages.count()) === 0) return undefined;
      const text = ((await messages.last().innerText()) ?? "").trim();
      return text.length ? text : undefined;
    },
    { timeout, what: "an answer in the widget" },
  );
}

test("F13: a visitor's question is answered from the knowledge base, with the document named", async () => {
  const account = await signup({ email: newEmail("answer"), password: PASSWORD });
  const ws = await createWorkspace(account.client, `Lamp shop ${uid()}`);
  const kb = await knowledgeBase(account.client, ws.id);
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

      // The answer arrives in the widget.
      const answer = await waitForAnswer(page);
      expect(answer.length, "the answer must not be empty").toBeGreaterThan(0);

      // The answer names the document it was taken from.
      const citations = page.getByTestId("widget-citation");
      await waitFor(
        async () => ((await citations.count()) > 0 ? true : undefined),
        { timeout: 30_000, what: "a citation under the answer" },
      );
      const texts: string[] = [];
      for (let i = 0; i < (await citations.count()); i++) {
        texts.push((await citations.nth(i).innerText()).trim());
      }
      expect(
        texts.some((t) => t.includes(REFUNDS.title)),
        `the citations do not name the document: ${JSON.stringify(texts)}`,
      ).toBe(true);

      // And the product really cites that document, with a passage taken from it.
      const list = await account.client.get(`/api/workspaces/${ws.id}/conversations`);
      expectStatus(list, 200);
      const conversations = (list.body?.conversations ?? []) as { id: string }[];
      expect(conversations.length, "the conversation must be in the workspace").toBeGreaterThan(0);
      const detail = await account.client.get(`/api/workspaces/${ws.id}/conversations/${conversations[0].id}`);
      expectStatus(detail, 200);
      const messages = (detail.body?.messages ?? []) as any[];
      const answers = messages.filter((m) => m.role === "assistant");
      expect(answers.length, "the answer must be stored").toBeGreaterThan(0);
      const stored = answers[answers.length - 1];
      expect(stored.outcome).toBe("answered");
      expect(Array.isArray(stored.citations) && stored.citations.length > 0, "an answered message has citations").toBe(true);
      const source = await documentText(account.client, ws.id, kb.refunds.id);
      for (const citation of stored.citations) {
        expect(citation.documentId, "the citation points at another document").toBe(kb.refunds.id);
        expect(
          source.includes(citation.quote),
          `the quote is not in the document: ${JSON.stringify(citation.quote)}`,
        ).toBe(true);
      }
    });
  } finally {
    await host.close();
  }
});
