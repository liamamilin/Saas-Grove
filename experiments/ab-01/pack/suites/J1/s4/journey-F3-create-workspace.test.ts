// F3: Create a workspace when none exists.
// Brief: the product is for small teams — every team needs a workspace.
// Contract: POST /api/workspaces returns 201 and the caller becomes owner
//           (api.yaml lines 91–101). Testability: workspace-create-name and
//           workspace-create-submit are the documented test ids on the
//           "no workspace" landing page (testability.md §8).
//
// Pass condition: naming the workspace on the empty-state page and
// submitting makes the workspace header test id (workspace-name) render
// the new name AND the user is its owner in /api/me.
import { test, expect } from "vitest";
import { withPage, uiLogin } from "../../lib/ui";
import { Client } from "../../lib/client";
import { newEmail, PASSWORD, signup, uid, expectStatus } from "../../lib/helpers";

test("F3: from the 'no workspace' page, naming a workspace brings up the workspace home", async () => {
  const email = newEmail("f3");
  const password = PASSWORD;
  await signup({ email, password, name: "F3 Owner" });
  const name = `Workspace ${uid()}`;

  await withPage(async (page) => {
    await uiLogin(page, email, password);

    // The empty-state onboarding test ids are documented (testability.md §8).
    await page.getByTestId("workspace-create-name").fill(name);
    await page.getByTestId("workspace-create-submit").click();

    // After submit, the workspace header test id renders our name.
    const header = page.getByTestId("workspace-name");
    await header.waitFor({ state: "visible", timeout: 30_000 });
    expect((await header.textContent()) ?? "").toBe(name);

    // Contract-level proof: the user is the owner of the new workspace.
    const browserCookies = await page.context().cookies();
    const jar = new Map<string, string>();
    for (const c of browserCookies) jar.set(c.name, c.value);
    const sessioned = Client.withCookies(jar);
    const me = await sessioned.get("/api/me");
    expectStatus(me, 200);
    const ms = (me.body?.memberships ?? []) as Array<{ workspaceName: string; role: string }>;
    const m = ms.find((x) => x.workspaceName === name);
    expect(m, `membership for ${name} should be returned`).toBeTruthy();
    expect(m!.role, `user should be owner of ${name}`).toBe("owner");
  });
});
