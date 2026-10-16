import { describe, expect, it } from "vitest";
import { SOLAR } from "../../lib/corpus";
import {
  isolateFakeModel,
  owner,
} from "../../lib/helpers";
import { uiLogin, withPage } from "../../lib/ui";

describe("S2 user interface", () => {
  isolateFakeModel();

  it("starts research from the UI, shows progress, then the report", async () => {
    const team = await owner();
    await withPage(async (page) => {
      await uiLogin(page, team.email, team.password);
      await expect
        .poll(() => page.getByTestId("workspace-name").first().textContent(), { timeout: 30_000 })
        .toContain(team.ws.name);

      await page.getByTestId("nav-research").first().click();
      await page.getByTestId("document-text-title").fill(SOLAR.title);
      await page.getByTestId("document-text-body").fill(SOLAR.text);
      await page.getByTestId("document-text-submit").click();
      await expect
        .poll(() => page.getByTestId("document-item").first().textContent(), { timeout: 30_000 })
        .toContain("ready");

      await page.getByTestId("research-question").fill("What limits perovskite cells?");
      await page.getByTestId("research-submit").click();
      await page.getByTestId("job-progress").first().waitFor();
      await expect
        .poll(() => page.getByTestId("job-status").first().textContent(), { timeout: 60_000 })
        .toContain("succeeded");

      const link = page.getByTestId("open-report");
      if (await link.count()) await link.first().click();
      await expect
        .poll(async () => ((await page.getByTestId("report-content").first().textContent()) ?? "").trim().length, {
          timeout: 30_000,
        })
        .toBeGreaterThan(0);
    });
  });
});
