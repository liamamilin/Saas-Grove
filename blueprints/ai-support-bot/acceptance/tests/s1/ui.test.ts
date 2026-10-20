import { describe, expect, it } from "vitest";
import { PASSWORD, newEmail, signup, uid } from "../../lib/helpers";
import { uiLogin, withPage } from "../../lib/ui";

describe("S1 user interface", () => {
  it("takes a new user from sign-up to their first workspace", async () => {
    const name = `UI Workspace ${uid()}`;
    await withPage(async (page) => {
      await page.goto("/signup");
      await page.getByTestId("signup-name").fill("UI Person");
      await page.getByTestId("signup-email").fill(newEmail("ui"));
      await page.getByTestId("signup-password").fill(PASSWORD);
      await page.getByTestId("signup-submit").click();

      await page.getByTestId("workspace-create-name").fill(name);
      await page.getByTestId("workspace-create-submit").click();
      await expect
        .poll(() => page.getByTestId("workspace-name").first().textContent(), { timeout: 30_000 })
        .toContain(name);
    });
  });

  it("signs an existing user in", async () => {
    const account = await signup();
    await withPage(async (page) => {
      await uiLogin(page, account.email, account.password);
      // No workspace yet, so the app asks for one.
      await page.getByTestId("workspace-create-name").waitFor();
    });
  });
});
