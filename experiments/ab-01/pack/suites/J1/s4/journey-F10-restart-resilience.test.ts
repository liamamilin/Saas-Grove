// F10: The product comes back healthy and serves the signed-in session after
//      an in-place restart (testability.md §7: 验收会在测试中途重启应用).
// Brief: a one-person team will restart the app; data must survive.
// Contract: end-to-end anchor — uses the documented UI test ids (workspace-name,
//           nav-research, document-item) plus the runner's /restart control
//           API (run.mjs 253–257 + helpers.ts 265–268).
//
// Pass condition: after the restart, the same workspace name renders in the
// header and the same document still appears among the document items.
import { test, expect } from "vitest";
import { withPage, uiLogin } from "../../lib/ui";
import { owner, addText, restartApp } from "../../lib/helpers";
import { TIDES } from "../../lib/corpus";

test("F10: after an in-place restart, the workspace and its documents are still visible in the UI", async () => {
  const team = await owner();
  const uniqueTitle = `F10 document ${Date.now()}`;
  // Always pass both title and text (corpus.ts: TIDES = { title, text }).
  // addText posts via the JSON Client and polls until status=ready.
  await addText(team.client, team.ws.id, { ...TIDES, title: uniqueTitle });

  // Restart the product under test. Same database, fresh process.
  await restartApp();

  await withPage(async (page) => {
    // Log in again from scratch after the restart. (Browser context has no
    // cookie from before.) The journey proves (a) sign-in still works and
    // (b) the data we stored before the restart is still served.
    await uiLogin(page, team.email, team.password);

    const header = page.getByTestId("workspace-name");
    await header.waitFor({ state: "visible", timeout: 30_000 });
    expect((await header.textContent()) ?? "").toBe(team.ws.name);

    await page.getByTestId("nav-research").click();
    const item = page.locator(`[data-testid="document-item"]`, { hasText: uniqueTitle });
    await item.first().waitFor({ state: "visible", timeout: 30_000 });
  });
});
