// The user-facing UI.
// Clause: testability.md §8 — the fixed data-testids on /signup and /login, the empty-workspace
// guide page, the workspace home (workspace-name, nav-research, nav-usage, report-link), the
// research form (document-text-*, document-item with its status value, research-question,
// research-submit, and all ready documents selected by default), the job page (job-status,
// job-progress, report-content or open-report) and the report page (report-content, chat-input,
// chat-submit, chat-message-assistant).
//
// The assertions use Playwright's own waiting primitives (waitFor / expect.poll) rather than
// Playwright matchers, because the suite runs under Vitest, whose expect has no toBeVisible.
import { describe, expect, it } from "vitest";
import { addText, finishedJob, newEmail, owner, PASSWORD } from "../../lib/helpers";
import { QUESTION, SOLAR } from "../../lib/corpus";
import { withPage } from "../../lib/ui";

describe("the user-facing UI", () => {
  // testability.md §8: /signup testids, the empty-workspace guide, document-item status, research form, report page.
  it("signs up, creates a workspace, adds a text document, runs a study and shows the report", async () => {
    await withPage(async (page) => {
      await page.goto("/signup");
      await page.getByTestId("signup-name").fill("UI Tester");
      await page.getByTestId("signup-email").fill(newEmail("ui"));
      await page.getByTestId("signup-password").fill(PASSWORD);
      await page.getByTestId("signup-submit").click();

      await page.getByTestId("workspace-create-name").waitFor({ state: "visible" });
      await page.getByTestId("workspace-create-name").fill(`UI Workspace ${Date.now()}`);
      await page.getByTestId("workspace-create-submit").click();

      await page.getByTestId("workspace-name").waitFor({ state: "visible" });
      await page.getByTestId("document-text-title").fill(SOLAR.title);
      await page.getByTestId("document-text-body").fill(SOLAR.text);
      await page.getByTestId("document-text-submit").click();

      // document-item carries the document's status value.
      await expect
        .poll(async () => await page.getByTestId("document-item").first().textContent(), { timeout: 30_000 })
        .toContain("ready");

      await page.getByTestId("research-question").fill(QUESTION);
      await page.getByTestId("research-submit").click();

      // The job page either shows the report directly or links to it.
      await page
        .locator('[data-testid="report-content"], [data-testid="open-report"]')
        .first()
        .waitFor({ state: "visible", timeout: 60_000 });
      if (await page.getByTestId("open-report").count()) {
        await page.getByTestId("open-report").first().click();
      }
      await page.getByTestId("report-content").waitFor({ state: "visible", timeout: 30_000 });
    });
  });

  // testability.md §8: /login testids, workspace-name, report-link, report-content, chat-input, chat-message-assistant.
  it("logs in, opens a report from the workspace and asks a follow-up question", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    await finishedJob(a.client, a.ws.id, [doc.id]); // guard: a report exists

    await withPage(async (page) => {
      await page.goto("/login");
      await page.getByTestId("login-email").fill(a.email);
      await page.getByTestId("login-password").fill(PASSWORD);
      await page.getByTestId("login-submit").click();

      await page.getByTestId("workspace-name").waitFor({ state: "visible" });
      await page.getByTestId("report-link").first().waitFor({ state: "visible" });
      await page.getByTestId("report-link").first().click();

      await page.getByTestId("report-content").waitFor({ state: "visible" });
      await page.getByTestId("chat-input").fill("What are the limits?");
      await page.getByTestId("chat-submit").click();
      await page.getByTestId("chat-message-assistant").first().waitFor({ state: "visible", timeout: 30_000 });
    });
  });
});
