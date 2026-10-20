// F9: See total spend on the usage page.
// Brief: a user (and especially a paying team) wants to know how much it costs.
// Contract: GET /api/workspaces/{ws}/usage returns { spentUsd, budgetUsd, ... }
//           (api.yaml 251–264). Testability: usage page exposes usage-spent
//           (testability.md §8).
//
// Pass condition: after a successful research job whose synthetic cost is
// FAKE_CHAT_CALL_COST_USD × 5 = $0.05 (testability.md §5), the usage-spent
// text contains a number in the [0.04, 1] range.
import { test, expect } from "vitest";
import { withPage, uiLogin } from "../../lib/ui";
import { owner, addText, finishedJob } from "../../lib/helpers";

test("F9: the usage page renders a non-zero spend after a successful research job", async () => {
  const team = await owner();
  const doc = await addText(team.client, team.ws.id, {
    title: "Solar panel note",
    text:
      "Perovskite solar cells reached laboratory efficiencies above twenty-six percent " +
      "within fifteen years of their first report. Their main weakness is stability under ultraviolet light.",
  });

  const job = await finishedJob(team.client, team.ws.id, [doc.id], "F9: a job to generate spend.");
  expect(job.status, JSON.stringify(job.error)).toBe("succeeded");

  await withPage(async (page) => {
    await uiLogin(page, team.email, team.password);
    await page.getByTestId("nav-usage").click();

    const spent = page.getByTestId("usage-spent");
    await spent.waitFor({ state: "visible", timeout: 30_000 });
    const text = (await spent.textContent()) ?? "";
    const m = text.match(/(\d+(?:\.\d+)?)/);
    expect(m, `usage-spent should contain a number; got: ${text}`).toBeTruthy();
    const n = Number(m![1]);
    expect(
      n >= 0.04 && n <= 1,
      `usage-spent should be around $0.05 after one successful job; got ${text}`,
    ).toBe(true);
  });
});
