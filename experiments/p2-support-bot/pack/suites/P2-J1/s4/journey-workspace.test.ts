// F5 — the company's workspace.
//
// Brief (user-brief.md): the product is sold to a small company; all of its documents,
// conversations and handoffs belong to that company, not to one person.
// Contract (api.yaml §/api/workspaces): POST {name} -> 201 {workspace}, the caller becomes
// its owner; GET /api/workspaces lists the caller's workspaces.
// UI anchors (testability.md §8): workspace-create-name, workspace-create-submit (the page
// shown while the user has no workspace yet), workspace-name, nav-knowledge, nav-handoffs,
// nav-analytics (the workspace home).

import { expect, test } from "vitest";
import type { Page } from "playwright";
import { PASSWORD, expectStatus, newEmail, signup, uid, waitFor } from "../../lib/helpers";
import { withPage, uiLogin } from "../../lib/ui";

async function shown(page: Page, testId: string): Promise<boolean> {
  const loc = page.getByTestId(testId);
  return (await loc.count()) > 0 && (await loc.first().isVisible());
}

async function waitForAny(page: Page, testIds: string[], timeout = 30_000): Promise<string> {
  return waitFor(
    async () => {
      for (const id of testIds) if (await shown(page, id)) return id;
      return undefined;
    },
    { timeout, what: `one of ${testIds.join(" / ")} to be visible` },
  );
}

async function waitForVisible(page: Page, testId: string, timeout = 30_000): Promise<void> {
  await page.getByTestId(testId).first().waitFor({ state: "visible", timeout });
}

test("F5: the first-run page creates the workspace and the home page names it", async () => {
  const account = await signup({ email: newEmail("ws"), password: PASSWORD });

  await withPage(async (page) => {
    await uiLogin(page, account.email, PASSWORD);

    // A user without a workspace gets the first-run page; a product that makes one for
    // them lands on the workspace home instead. Both are accepted.
    const landing = await waitForAny(page, ["workspace-create-name", "workspace-name"], 30_000);
    const wanted = `Lamp shop ${uid()}`;

    if (landing === "workspace-create-name") {
      await page.getByTestId("workspace-create-name").fill(wanted);
      await page.getByTestId("workspace-create-submit").click();
      await waitForVisible(page, "workspace-name", 30_000);
      const shownName = (await page.getByTestId("workspace-name").first().innerText()).trim();
      expect(shownName, "the home page must show the name of the workspace just created").toBe(wanted);
    } else {
      const shownName = (await page.getByTestId("workspace-name").first().innerText()).trim();
      expect(shownName.length, "the workspace home must show a name").toBeGreaterThan(0);
    }

    // The home page is the way into the three parts of the product.
    for (const nav of ["nav-knowledge", "nav-handoffs", "nav-analytics"]) {
      expect(await shown(page, nav), `${nav} is missing on the workspace home`).toBe(true);
    }

    // The workspace exists in the product's own data as well.
    const res = await account.client.get("/api/workspaces");
    expectStatus(res, 200);
    const workspaces = (res.body?.workspaces ?? []) as { id: string; name: string }[];
    expect(workspaces.length, "the user must own at least one workspace").toBeGreaterThan(0);
    const name = (await page.getByTestId("workspace-name").first().innerText()).trim();
    expect(
      workspaces.some((w) => w.name === name),
      `no workspace named "${name}" among ${workspaces.map((w) => w.name).join(", ")}`,
    ).toBe(true);
  });
});
