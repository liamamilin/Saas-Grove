// F16 — the model fails; the visitor still gets a straight answer.
//
// Brief (user-brief.md): "我最担心的是它瞎编答案" — when something goes wrong the bot must
// not invent an answer either.
// Contract (api.yaml): a question is unanswered "when the model still fails after its
// retries"; the visitor is never shown an error, a made-up answer or the reason. A
// non-retryable error is not retried; a retryable one is retried at most 3 times.
// testability.md §5: a `permanent` fault in the stage `answer` fails every call.
// UI anchors (testability.md §8): widget-input, widget-send, widget-message-assistant.

import { expect, test } from "vitest";
import type { Page } from "playwright";
import {
  PASSWORD,
  createWorkspace,
  expectStatus,
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

// The fault belongs to the fake model of the whole application: it is set only for this
// journey and taken away again before and after it.
isolateFakeModel();

/** The fallback the company configured; the bot must say exactly this. */
const FALLBACK = "抱歉，这个问题我暂时答不上来，请留下联系方式让客服同事跟进。";

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

test("F16: when the model fails the visitor gets the fallback answer, not an invented one", async () => {
  await fakeModel.set({ faults: [{ stage: "answer", mode: "permanent", times: 1 }] });

  const account = await signup({ email: newEmail("modelfail"), password: PASSWORD });
  const ws = await createWorkspace(account.client, `Lamp shop ${uid()}`);
  await knowledgeBase(account.client, ws.id);
  const settings = await widgetSettings(account.client, ws.id);
  const host = await hostPage(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Our shop</title></head>` +
      `<body><h1>Lamp shop</h1><script src="${BASE_URL}/widget.js" data-widget-key="${settings.widgetKey}" async></script></body></html>`,
  );
  try {
    await updateWidget(account.client, ws.id, { allowedOrigins: [host.origin], fallbackMessage: FALLBACK });

    await withPage(async (page) => {
      await page.goto(host.url);
      await waitForVisible(page, "widget-launcher", 30_000);
      if (!(await shown(page, "widget-input"))) {
        await page.getByTestId("widget-launcher").first().click();
      }
      await waitForVisible(page, "widget-input", 30_000);

      // A question the knowledge base *could* answer, but the model is broken.
      await page.getByTestId("widget-input").fill(Q_REFUND);
      await page.getByTestId("widget-send").click();

      const answer = await waitForAnswer(page);
      expect(answer, "the visitor did not get the fallback answer").toContain(FALLBACK);
      expect(answer, "the widget showed an error instead of the fallback answer").not.toMatch(/error|错误|失败/i);

      // The product records it as unanswered, not as an answer.
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
      expect(stored.outcome).toBe("unanswered");
      expect(stored.citations ?? []).toEqual([]);
    });
  } finally {
    await host.close();
  }
});
