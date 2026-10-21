// Held-out acceptance tests: the user interface.
//
// Contract source: brief/contract/testability.md §8 - the two fixed paths /signup and /login and
// the data-testid anchors:
//   signup: signup-name, signup-email, signup-password, signup-submit
//   login: login-email, login-password, login-submit
//   onboarding (no workspace yet): workspace-create-name, workspace-create-submit
//   workspace home: workspace-name, nav-knowledge, nav-handoffs, nav-analytics
//   knowledge base page: document-text-title, document-text-body, document-text-submit,
//     document-item (one per document, its text contains the status value; "the status refreshes
//     itself, the page does not have to be reloaded")
//   preview (on the knowledge base page, with the product's own origin): preview-input,
//     preview-submit, preview-answer, preview-citation (one per citation, the text contains the
//     title of the document)
//   handoff page: handoff-item (one per handoff, the text contains the email of the visitor)
//   analytics page: analytics-unanswered-item (one per unanswered question of this month, the text
//     contains the question), usage-spent ("the first number in the text is the USD amount spent
//     this month")
//   embedded widget: widget-launcher, widget-input, widget-send, widget-message-assistant,
//     widget-citation, widget-handoff, widget-contact-email, widget-handoff-submit,
//     widget-handoff-done

import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { withPage, uiLogin } from "../../lib/ui";
import { PASSWORD, newEmail, waitFor, waitForDocument } from "../../lib/helpers";
import { Visitor, hostPage, supportTeam, updateWidget } from "../../lib/widget";
import { Q_REFUND, Q_UNKNOWN, REFUNDS } from "../../lib/corpus";

/** Sign up through the form and create the first workspace of the account. */
async function signUpAndCreateWorkspace(page: Page, email: string, workspaceName: string): Promise<void> {
  await page.goto("/signup");
  await page.getByTestId("signup-name").fill("UI User");
  await page.getByTestId("signup-email").fill(email);
  await page.getByTestId("signup-password").fill(PASSWORD);
  await page.getByTestId("signup-submit").click();

  await page.waitForSelector('[data-testid="workspace-create-name"], [data-testid="workspace-name"]', {
    timeout: 30_000,
  });
  const create = page.getByTestId("workspace-create-name");
  if (await create.isVisible().catch(() => false)) {
    await create.fill(workspaceName);
    await page.getByTestId("workspace-create-submit").click();
  }
  await page.getByTestId("workspace-name").first().waitFor({ state: "visible", timeout: 30_000 });
}

/** The first number in a text. */
function firstNumber(text: string): number {
  const match = /-?\d+(?:\.\d+)?/.exec(text);
  return match ? Number(match[0]) : Number.NaN;
}

describe("holdout: the user interface", () => {
  it("signs up, creates a workspace, adds material and previews an answer", async () => {
    // Contract: testability §8 - the sign-up form, the onboarding page, the home page, the
    // knowledge base page with a document whose status refreshes by itself, and the preview with
    // its citation.
    const email = newEmail("ui");
    await withPage(async (page) => {
      await signUpAndCreateWorkspace(page, email, "UI Workspace");

      const name = page.getByTestId("workspace-name").first();
      await waitFor(async () => ((await name.textContent()) ?? "").includes("UI Workspace") ? true : undefined, {
        timeout: 30_000,
        what: "the name of the workspace",
      });
      await page.getByTestId("nav-knowledge").first().waitFor({ state: "visible", timeout: 30_000 });
      await page.getByTestId("nav-handoffs").first().waitFor({ state: "visible", timeout: 30_000 });
      await page.getByTestId("nav-analytics").first().waitFor({ state: "visible", timeout: 30_000 });

      await page.getByTestId("nav-knowledge").first().click();
      await page.getByTestId("document-text-title").waitFor({ state: "visible", timeout: 30_000 });
      await page.getByTestId("document-text-title").fill(REFUNDS.title);
      await page.getByTestId("document-text-body").fill(REFUNDS.text);
      await page.getByTestId("document-text-submit").click();

      // The status of the document refreshes by itself, without reloading the page.
      const item = page.getByTestId("document-item").first();
      await item.waitFor({ state: "visible", timeout: 30_000 });
      await waitFor(async () => ((await item.textContent()) ?? "").includes("ready") ? true : undefined, {
        timeout: 30_000,
        what: "the document to become ready",
      });

      // The preview answers from the material and names the document it used.
      await page.getByTestId("preview-input").waitFor({ state: "visible", timeout: 30_000 });
      await page.getByTestId("preview-input").fill(Q_REFUND);
      await page.getByTestId("preview-submit").click();
      const answer = page.getByTestId("preview-answer").first();
      await answer.waitFor({ state: "visible", timeout: 60_000 });
      await waitFor(async () => ((await answer.textContent()) ?? "").trim().length > 0 ? true : undefined, {
        timeout: 60_000,
        what: "the answer of the preview",
      });
      const citation = page.getByTestId("preview-citation").first();
      await citation.waitFor({ state: "visible", timeout: 30_000 });
      expect((await citation.textContent()) ?? "").toContain(REFUNDS.title);
    });
  });

  it("shows the handoffs and the questions that were not answered", async () => {
    // Contract: testability §8 - handoff-item contains the email of the visitor;
    // analytics-unanswered-item contains the question; usage-spent shows the amount spent, and the
    // first number in its text is that amount.
    const team = await supportTeam();
    const doc = await team.client.post(`/api/workspaces/${team.ws.id}/documents`, {
      title: REFUNDS.title,
      text: REFUNDS.text,
    });
    expect(doc.status).toBe(201);
    await waitForDocument(team.client, team.ws.id, String(doc.body?.document?.id ?? ""));

    const visitor = await new Visitor(team.key).start();
    await visitor.answer(Q_UNKNOWN);
    await visitor.handoff({ name: "Ada", email: "ada@example.test" });

    await withPage(async (page) => {
      await uiLogin(page, team.email, team.password);
      await page.getByTestId("workspace-name").first().waitFor({ state: "visible", timeout: 30_000 });

      await page.getByTestId("nav-handoffs").first().click();
      const handoff = page.getByTestId("handoff-item").first();
      await handoff.waitFor({ state: "visible", timeout: 30_000 });
      expect((await handoff.textContent()) ?? "").toContain("ada@example.test");

      await page.getByTestId("nav-analytics").first().click();
      const unanswered = page.getByTestId("analytics-unanswered-item").first();
      await unanswered.waitFor({ state: "visible", timeout: 30_000 });
      expect((await unanswered.textContent()) ?? "").toContain(Q_UNKNOWN);

      const spent = page.getByTestId("usage-spent").first();
      await spent.waitFor({ state: "visible", timeout: 30_000 });
      await waitFor(async () => /\d/.test((await spent.textContent()) ?? "") ? true : undefined, {
        timeout: 30_000,
        what: "the amount spent",
      });
      const amount = firstNumber((await spent.textContent()) ?? "");
      expect(Number.isNaN(amount)).toBe(false);
      expect(amount).toBeGreaterThan(0);
      expect(amount).toBeLessThan(1);
    });
  });

  it("runs the embedded widget in the page of a customer, answers and takes a handoff", async () => {
    // Contract: testability §8 - the embedded widget: widget-launcher, widget-input, widget-send,
    // widget-message-assistant, widget-citation (with the title of the document), widget-handoff,
    // widget-contact-email, widget-handoff-submit, widget-handoff-done. The widget talks to the
    // public API with the origin of the host page, so that origin must be allowed.
    const team = await supportTeam();
    const doc = await team.client.post(`/api/workspaces/${team.ws.id}/documents`, {
      title: REFUNDS.title,
      text: REFUNDS.text,
    });
    expect(doc.status).toBe(201);
    await waitForDocument(team.client, team.ws.id, String(doc.body?.document?.id ?? ""));

    const snippet =
      String(team.widget.embedSnippet ?? "") ||
      `<script src="${team.client.base}/widget.js" data-widget-key="${team.key}" async></script>`;
    const host = await hostPage(`<html><body><h1>Lamp shop</h1>${snippet}</body></html>`);
    try {
      await updateWidget(team.client, team.ws.id, { allowedOrigins: [host.origin] });

      await withPage(async (page) => {
        await page.goto(host.url);

        const launcher = page.getByTestId("widget-launcher").first();
        await launcher.waitFor({ state: "visible", timeout: 30_000 });
        await launcher.click();

        await page.getByTestId("widget-input").waitFor({ state: "visible", timeout: 30_000 });
        await page.getByTestId("widget-input").fill(Q_REFUND);
        await page.getByTestId("widget-send").click();

        const answer = page.getByTestId("widget-message-assistant").first();
        await answer.waitFor({ state: "visible", timeout: 60_000 });
        await waitFor(async () => ((await answer.textContent()) ?? "").trim().length > 0 ? true : undefined, {
          timeout: 60_000,
          what: "the answer of the widget",
        });
        const citation = page.getByTestId("widget-citation").first();
        await citation.waitFor({ state: "visible", timeout: 30_000 });
        expect((await citation.textContent()) ?? "").toContain(REFUNDS.title);

        await page.getByTestId("widget-handoff").first().click();
        await page.getByTestId("widget-contact-email").waitFor({ state: "visible", timeout: 30_000 });
        await page.getByTestId("widget-contact-email").fill("ada@example.test");
        await page.getByTestId("widget-handoff-submit").click();
        await page.getByTestId("widget-handoff-done").waitFor({ state: "visible", timeout: 30_000 });
      });
    } finally {
      await host.close();
    }
  });
});
