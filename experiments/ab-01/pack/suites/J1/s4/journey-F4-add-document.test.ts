// F4: Add a text document and see it become ready.
// Brief: "把各种资料（网页链接、PDF、笔记）丢进去" — putting material in is the first step.
// Contract: POST /api/workspaces/{ws}/documents accepts JSON {title, text}
//           (api.yaml 151–166); status moves processing -> ready.
//           Testability: document-text-title / document-text-body /
//           document-text-submit drive the paste-text form; document-item
//           renders one item per document and carries the status word
//           (processing | ready | failed) — testability.md §8.
//
// Pass condition: the document appears among document-item entries and
// its status text reaches "ready" within a generous poll window.
import { test, expect } from "vitest";
import { withPage, uiLogin } from "../../lib/ui";
import { owner, waitFor } from "../../lib/helpers";

test("F4: pasting a text document from the research page shows it as 'ready' among the document items", async () => {
  const team = await owner();
  const title = `F4 doc ${Date.now()}`;
  const body =
    "Solar panels degrade under ultraviolet light.\n\n" +
    "A tandem cell stacks perovskite on silicon.";

  await withPage(async (page) => {
    await uiLogin(page, team.email, team.password);
    await page.getByTestId("nav-research").click();

    // Paste-text form (testability.md §8).
    await page.getByTestId("document-text-title").fill(title);
    await page.getByTestId("document-text-body").fill(body);
    await page.getByTestId("document-text-submit").click();

    // A document-item with this title appears, then its status text reaches
    // "ready". We poll via the helpers (locator.waitFor auto-waits 30s; we
    // give the worker more headroom for the 'ready' text to land).
    const item = page.locator(`[data-testid="document-item"]`, { hasText: title });
    await item.first().waitFor({ state: "visible", timeout: 30_000 });

    // Status text reaches "ready".
    await waitFor(
      async () => {
        const t = (await item.first().textContent()) ?? "";
        return t.includes("ready") ? t : undefined;
      },
      { timeout: 60_000, what: `document ${title} status to read 'ready'` },
    );

    // And the API agrees (use the JSON Client we already own).
    const list = await team.client.get(`/api/workspaces/${team.ws.id}/documents`);
    expect(list.status, `GET documents should be 200, got ${list.status}`).toBe(200);
    const docs = (list.body?.documents ?? []) as Array<{ title: string; status: string }>;
    const match = docs.find((d) => d.title === title);
    expect(match, `doc ${title} should be in the list`).toBeTruthy();
    expect(match!.status).toBe("ready");
  });
});
