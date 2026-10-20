// F5: Start a research job by asking a question over the ready documents.
// Brief: "用中文提问，它帮我研读这些资料".
// Contract: POST /api/workspaces/{ws}/research-jobs returns 202 with a job in
//           queued/running state (api.yaml 181–194). Testability: the
//           research page exposes research-question and research-submit; the
//           job page exposes job-status (whose text is the status value) —
//           testability.md §8.
//
// "发起研究时，界面默认选中当前工作区里所有 ready 状态的资料" — submit picks every
// ready document of the workspace. So we seed ready documents through the
// API and let the submit button select them.
//
// Pass condition: after submit, the job page renders a job-status whose
// text contains a known JobStatus value, AND the API reports a job with
// the question we asked.
import { test, expect } from "vitest";
import { withPage, uiLogin } from "../../lib/ui";
import { owner, addText } from "../../lib/helpers";
import { SOLAR, COFFEE } from "../../lib/corpus";

test("F5: filling the research question and submitting opens a job page with a status", async () => {
  const team = await owner();
  // Seed two ready documents so the research submit button has material.
  await addText(team.client, team.ws.id, SOLAR);
  await addText(team.client, team.ws.id, COFFEE);

  const question = "F5: what limits do these documents mention?";

  await withPage(async (page) => {
    await uiLogin(page, team.email, team.password);
    await page.getByTestId("nav-research").click();

    await page.getByTestId("research-question").fill(question);
    await page.getByTestId("research-submit").click();

    // The job page exposes job-status (testability.md §8). Any JobStatus
    // value is acceptable as proof that the click reached the backend.
    const status = page.getByTestId("job-status");
    await status.waitFor({ state: "visible", timeout: 30_000 });
    const text = (await status.textContent()) ?? "";
    const known = ["queued", "running", "succeeded", "failed", "canceled", "budget_exceeded"];
    expect(
      known.some((s) => text.includes(s)),
      `job-status should include a known status; got: ${text}`,
    ).toBe(true);

    // And the question we asked is the one the worker received.
    const jobs = await team.client.get(`/api/workspaces/${team.ws.id}/research-jobs`);
    expect(jobs.status, `list jobs should be 200, got ${jobs.status}`).toBe(200);
    const arr = (jobs.body?.jobs ?? []) as Array<{ question: string }>;
    expect(arr.length, `at least one job should exist`).toBeGreaterThan(0);
    expect(arr.some((j) => j.question === question), `a job with question="${question}" should exist`).toBe(true);
  });
});
