import { describe, expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { isolateFakeModel, owner } from "../../lib/helpers";
import { uiLogin, withPage } from "../../lib/ui";

describe("S2 user interface", () => {
  isolateFakeModel();

  it("builds a knowledge base and previews a cited answer", async () => {
    const team = await owner();
    await withPage(async (page) => {
      await uiLogin(page, team.email, team.password);
      await expect
        .poll(() => page.getByTestId("workspace-name").first().textContent(), { timeout: 30_000 })
        .toContain(team.ws.name);

      await page.getByTestId("nav-knowledge").first().click();
      await page.getByTestId("document-text-title").fill(REFUNDS.title);
      await page.getByTestId("document-text-body").fill(REFUNDS.text);
      await page.getByTestId("document-text-submit").click();
      await expect
        .poll(() => page.getByTestId("document-item").first().textContent(), { timeout: 30_000 })
        .toContain("ready");

      await page.getByTestId("preview-input").fill(Q_REFUND);
      await page.getByTestId("preview-submit").click();
      await expect
        .poll(async () => ((await page.getByTestId("preview-answer").first().textContent()) ?? "").trim().length, { timeout: 30_000 })
        .toBeGreaterThan(0);
      await expect
        .poll(() => page.getByTestId("preview-citation").first().textContent(), { timeout: 30_000 })
        .toContain(REFUNDS.title);
    });
  });
});
