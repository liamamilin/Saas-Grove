// F17 — the visitor asks for a person.
//
// Brief (user-brief.md): "答不出来或者客户不满意，能转人工，最好能留个联系方式，记录下来" —
// the visitor can ask for a human and leave a way to reach them.
// Contract (api.yaml §/api/widget/{key}/conversations/{id}/handoff): POST {name?, email?, note?}
// -> 201 {handoff: {id, status: "open"}}; the conversation becomes `handed_off` and a `handoff`
// mail goes to every member of the workspace.
// UI anchors (testability.md §8): widget-handoff (the button that asks for a person),
// widget-contact-email (the field for the contact address), widget-handoff-submit (the button
// that sends it), widget-handoff-done (the confirmation that appears afterwards).

import { expect, test } from "vitest";
import type { Page } from "playwright";
import { PASSWORD, createWorkspace, expectStatus, knowledgeBase, newEmail, signup, uid, waitFor } from "../../lib/helpers";
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

test("F17: a visitor asks for a person, leaves an address and gets a confirmation", async () => {
  const account = await signup({ email: newEmail("handoff"), password: PASSWORD });
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

      // The visitor asks something first: a handoff belongs to a conversation.
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

      // The visitor asks for a person.
      await waitForVisible(page, "widget-handoff", 30_000);
      if (!(await shown(page, "widget-contact-email"))) {
        await page.getByTestId("widget-handoff").first().click();
      }
      await waitForVisible(page, "widget-contact-email", 30_000);
      await waitForVisible(page, "widget-handoff-submit", 30_000);

      const contact = `visitor-${uid()}@example.test`;
      await page.getByTestId("widget-contact-email").fill(contact);
      await page.getByTestId("widget-handoff-submit").click();

      // The visitor is told that a person will take over.
      await waitForVisible(page, "widget-handoff-done", 30_000);

      // And the request really reached the company, with the address the visitor left.
      const res = await account.client.get(`/api/workspaces/${ws.id}/handoffs`);
      expectStatus(res, 200);
      const handoffs = (res.body?.handoffs ?? []) as { id: string; status: string; email?: string }[];
      expect(handoffs.length, "the handoff must be in the workspace").toBeGreaterThan(0);
      expect(
        handoffs.some((h) => h.email === contact),
        `no handoff with the address ${contact} among ${JSON.stringify(handoffs)}`,
      ).toBe(true);
      expect(handoffs[0].status).toBe("open");
    });
  } finally {
    await host.close();
  }
});
