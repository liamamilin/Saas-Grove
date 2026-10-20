// Acceptance stage S4 — UI surface area (testability.md §8).
//
// The contract makes `/signup` and `/login` the only two fixed paths;
// each must expose specific data-testid hooks. A test that opens the
// page and looks for them distinguishes a real implementation from the
// empty app, which serves no pages at all.

import { describe, expect, test } from "vitest";
import { uiLogin, withPage } from "../../lib/ui";
import { newEmail, PASSWORD } from "../../lib/helpers";

describe("holdout: UI testids (testability.md §8)", () => {
  test("the /signup page exposes signup-name, signup-email, signup-password, signup-submit (testability.md §8)", async () => {
    await withPage(async (page) => {
      await page.goto("/signup");
      for (const tid of ["signup-name", "signup-email", "signup-password", "signup-submit"]) {
        await expect(page.getByTestId(tid)).toBeVisible();
      }
    });
  });

  test("the /login page exposes login-email, login-password, login-submit (testability.md §8)", async () => {
    await withPage(async (page) => {
      await page.goto("/login");
      for (const tid of ["login-email", "login-password", "login-submit"]) {
        await expect(page.getByTestId(tid)).toBeVisible();
      }
    });
  });
});
