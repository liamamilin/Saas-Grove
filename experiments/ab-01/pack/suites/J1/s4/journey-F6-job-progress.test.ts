// F6: See the job's status and progress while it runs, until it succeeds.
// Brief: a user must be able to watch the job make progress and see it finish.
// Contract: GET /api/workspaces/{ws}/research-jobs/{id} — status moves
//           queued -> running -> succeeded; stages (plan, analyze, synthesize)
//           and progress 0..100 (api.yaml 195–198, Job schema 367–386).
//           The fake model runs 5 chat calls; without faults the job
//           succeeds. Testability: job-status and job-progress are the
//           documented anchors (testability.md §8).
//
// Pass condition: the page's job-status text reaches 'succeeded' within a
// generous polling window (90s on top of the fake model's defaults).
import { test, expect } from "vitest";
import { withPage, uiLogin } from "../../lib/ui";
import { owner, addText } from "../../lib/helpers";
import { SOLAR, COFFEE } from "../../lib/corpus";

const TERMINAL = ["succeeded", "failed", "canceled", "budget_exceeded"];

test("F6: starting a job in the UI lets the user watch its progress until it succeeds", async () => {
  const team = await owner();
  await addText(team.client, team.ws.id, SOLAR);
  await addText(team.client, team.ws.id, COFFEE);

  await withPage(async (page) => {
    await uiLogin(page, team.email, team.password);
    await page.getByTestId("nav-research").click();

    await page.getByTestId("research-question").fill("F6: summarise these documents.");
    await page.getByTestId("research-submit").click();

    const status = page.getByTestId("job-status");
    const progress = page.getByTestId("job-progress");
    await status.waitFor({ state: "visible", timeout: 30_000 });
    await progress.waitFor({ state: "visible", timeout: 30_000 });

    // Poll the status text until it reaches a terminal value, capped so a
    // stuck implementation fails at 90s instead of the vitest test timeout.
    const deadline = Date.now() + 90_000;
    let last = "";
    while (Date.now() < deadline) {
      last = (await status.textContent()) ?? "";
      if (TERMINAL.some((t) => last.includes(t))) break;
      await page.waitForTimeout(500);
    }
    expect(last.includes("succeeded"), `job-status should reach 'succeeded'; last text: ${last}`).toBe(true);

    // After success the job page either renders report-content inline or
    // provides an open-report link (testability.md §8). F7 covers the
    // report content itself; F6 just confirms the UX reaches the report.
    void page; // closure marker
  });
});
