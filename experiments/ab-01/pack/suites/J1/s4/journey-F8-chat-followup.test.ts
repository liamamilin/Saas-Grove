// F8: Ask a follow-up chat question on the report and see the assistant's
//     streamed answer.
// Brief: "然后直接用中文提问" — follow-ups are the natural second interaction.
// Contract: POST /api/workspaces/{ws}/reports/{id}/messages streams SSE
//           event:delta then event:done (api.yaml 231–248). Testability:
//           the report page exposes chat-input, chat-submit and chat-
//           message-assistant (testability.md §8). The fake model
//           streams at least two delta chunks per call (testability.md §5).
//
// Pass condition: after clicking chat-submit, a chat-message-assistant
// element appears with non-empty content (proving the SSE stream reached
// the UI and was rendered).
import { test, expect } from "vitest";
import { withPage, uiLogin } from "../../lib/ui";
import { owner, addText, finishedJob } from "../../lib/helpers";

test("F8: typing a follow-up into chat-input shows an assistant message on the report page", async () => {
  const team = await owner();
  const doc = await addText(team.client, team.ws.id, {
    title: "Tides",
    text:
      "Spring tides occur when the Sun and Moon align, producing higher high tides and lower low tides.\n\n" +
      "Neap tides happen when the Sun and Moon pull at right angles.",
  });

  const job = await finishedJob(team.client, team.ws.id, [doc.id], "F8: prepare for chat.");
  expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
  expect(job.reportId).toBeTruthy();

  const followUp = "F8 chat: when do neap tides happen?";

  await withPage(async (page) => {
    await uiLogin(page, team.email, team.password);
    // The workspace home lists every report as a `report-link`.
    const link = page.locator(`[data-testid="report-link"]`).first();
    await link.waitFor({ state: "visible", timeout: 30_000 });
    await link.click();

    const content = page.getByTestId("report-content");
    await content.waitFor({ state: "visible", timeout: 30_000 });

    await page.getByTestId("chat-input").fill(followUp);
    await page.getByTestId("chat-submit").click();

    // An assistant message element must appear. The fake model emits at
    // least two chunks, so by the time the user sees the message the text
    // has length > 0 (we poll briefly for that).
    const assistant = page.locator(`[data-testid="chat-message-assistant"]`).last();
    await assistant.waitFor({ state: "visible", timeout: 60_000 });

    const deadline = Date.now() + 30_000;
    let body = "";
    while (Date.now() < deadline) {
      body = ((await assistant.textContent()) ?? "").trim();
      if (body.length > 0) break;
      await page.waitForTimeout(200);
    }
    expect(body.length, `assistant message should have content; got: ${body}`).toBeGreaterThan(0);
  });
});
