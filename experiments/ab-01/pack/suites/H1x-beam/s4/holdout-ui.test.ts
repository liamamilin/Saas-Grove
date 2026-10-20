import { describe, expect, it } from "vitest";
import { withPage } from "../../lib/ui";
import { PASSWORD, newEmail } from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

// Contract: testability.md §8 (UI anchors).

describe("holdout ui", () => {
  it("signup and create workspace flow (§8)", async () => {
    await withPage(async (page) => {
      const email = newEmail("ui");
      await page.goto("/signup");
      await page.getByTestId("signup-name").fill("UI User");
      await page.getByTestId("signup-email").fill(email);
      await page.getByTestId("signup-password").fill(PASSWORD);
      await page.getByTestId("signup-submit").click();
      // create workspace if empty
      const createName = page.getByTestId("workspace-create-name");
      if (await createName.isVisible({ timeout: 5000 }).catch(() => false)) {
        await createName.fill("UI Workspace");
        await page.getByTestId("workspace-create-submit").click();
      }
      await page.getByTestId("workspace-name").waitFor({ state: "visible", timeout: 15000 });
    });
  });

  it("paste document, run research, see report (§8)", async () => {
    const { signup, createWorkspace } = await import("../../lib/helpers");
    const acc = await signup();
    const ws = await createWorkspace(acc.client);
    await withPage(async (page) => {
      // login
      await page.goto("/login");
      await page.getByTestId("login-email").fill(acc.email);
      await page.getByTestId("login-password").fill(acc.password);
      await page.getByTestId("login-submit").click();
      // navigate to workspace? URL unknown; try home
      await page.waitForTimeout(1000);
      // paste doc
      const title = page.getByTestId("document-text-title");
      await title.waitFor({ timeout: 15000 });
      await title.fill(SOLAR.title);
      await page.getByTestId("document-text-body").fill(SOLAR.text);
      await page.getByTestId("document-text-submit").click();
      // wait for ready status in a document-item
      await page.waitForFunction(() => {
        const items = Array.from(document.querySelectorAll('[data-testid="document-item"]'));
        return items.some((el) => (el.textContent || "").includes("ready"));
      }, { timeout: 30000 });
      // research
      await page.getByTestId("research-question").fill("What?");
      await page.getByTestId("research-submit").click();
      // job status eventually succeeded
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="job-status"]');
        return !!el && /succeeded/.test(el.textContent || "");
      }, { timeout: 60000 });
      // report content or open-report
      const hasReport = await page.getByTestId("report-content").isVisible().catch(() => false);
      if (!hasReport) {
        const open = page.getByTestId("open-report");
        if (await open.isVisible().catch(() => false)) await open.click();
      }
      await page.getByTestId("report-content").waitFor({ state: "visible", timeout: 30000 });
    });
  });

  it("usage page shows spent (§8)", async () => {
    const { signup, createWorkspace, twoDocs, finishedJob } = await import("../../lib/helpers");
    const acc = await signup();
    const ws = await createWorkspace(acc.client);
    const docs = await twoDocs(acc.client, ws.id);
    await finishedJob(acc.client, ws.id, docs.map((d: any) => d.id));
    await withPage(async (page) => {
      await page.goto("/login");
      await page.getByTestId("login-email").fill(acc.email);
      await page.getByTestId("login-password").fill(acc.password);
      await page.getByTestId("login-submit").click();
      await page.waitForTimeout(1000);
      await page.getByTestId("nav-usage").click();
      await page.getByTestId("usage-spent").waitFor({ state: "visible", timeout: 15000 });
      const text = await page.getByTestId("usage-spent").textContent();
      expect(text).toBeTruthy();
    });
  });

});