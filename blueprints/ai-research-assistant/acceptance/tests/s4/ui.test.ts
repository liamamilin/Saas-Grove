import { describe, expect, it } from "vitest";
import {
  finishedJob,
  isolateFakeModel,
  owner,
  twoDocs,
} from "../../lib/helpers";
import { uiLogin, withPage } from "../../lib/ui";

describe("S4 user interface", () => {
  isolateFakeModel();

  it("streams a follow-up answer in the report page and shows spend", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));

    await withPage(async (page) => {
      await uiLogin(page, team.email, team.password);
      await page.getByTestId("report-link").first().click();
      await expect
        .poll(async () => ((await page.getByTestId("report-content").first().textContent()) ?? "").trim().length, {
          timeout: 30_000,
        })
        .toBeGreaterThan(0);

      await page.getByTestId("chat-input").fill("What is the strongest finding?");
      await page.getByTestId("chat-submit").click();
      await expect
        .poll(async () => ((await page.getByTestId("chat-message-assistant").last().textContent()) ?? "").trim().length, {
          timeout: 30_000,
        })
        .toBeGreaterThan(0);

      await page.getByTestId("nav-usage").first().click();
      await expect
        .poll(async () => {
          const text = (await page.getByTestId("usage-spent").first().textContent()) ?? "";
          const amount = Number(text.replace(/[^0-9.]/g, ""));
          return Number.isFinite(amount) ? amount : 0;
        }, { timeout: 30_000 })
        .toBeGreaterThan(0);
    });
  });
});
