// F2 — sign in.
//
// Brief (user-brief.md): the people of the small company come back to the product every day.
// Contract (api.yaml §/api/auth/login): POST {email, password} -> 200 {user}; an unknown
// e-mail and a wrong password both answer 401 invalid_credentials, so the product must not
// tell the two apart. 10 failed attempts for one e-mail inside 15 minutes -> 429.
// UI anchors (testability.md §8): login-email, login-password, login-submit on /login.

import { expect, test } from "vitest";
import type { Page } from "playwright";
import { PASSWORD, newEmail, signup, waitFor } from "../../lib/helpers";
import { withPage } from "../../lib/ui";

/** Anchors that only exist inside the product (testability.md §8). */
const INSIDE = [
  "workspace-create-name",
  "workspace-name",
  "nav-knowledge",
  "nav-handoffs",
  "nav-analytics",
  "document-text-title",
  "preview-input",
  "usage-spent",
];

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

/** The request the sign-in form makes, whatever route the implementation chose for it. */
function isSignInRequest(response: { request(): { method(): string }; url(): string }): boolean {
  return response.request().method() === "POST" && /login|session|signin/i.test(response.url());
}

test("F2: a user signs in with e-mail and password, and a wrong password opens no session", async () => {
  const account = await signup({ email: newEmail("login"), password: PASSWORD });

  await withPage(async (page) => {
    await page.goto("/login");

    // A wrong password must not open a session.
    await page.getByTestId("login-email").fill(account.email);
    await page.getByTestId("login-password").fill("not-the-right-password");
    const [rejected] = await Promise.all([
      page.waitForResponse(isSignInRequest, { timeout: 30_000 }),
      page.getByTestId("login-submit").click(),
    ]);
    expect(rejected.status(), "a wrong password must not be answered with success").toBeGreaterThanOrEqual(400);
    expect(await shown(page, "login-submit"), "the sign-in form disappeared after a failed attempt").toBe(true);
    for (const id of INSIDE) {
      expect(await shown(page, id), `${id} is on screen although the sign-in failed`).toBe(false);
    }

    // The right password opens the session.
    await page.getByTestId("login-email").fill(account.email);
    await page.getByTestId("login-password").fill(PASSWORD);
    const [accepted] = await Promise.all([
      page.waitForResponse(isSignInRequest, { timeout: 30_000 }),
      page.getByTestId("login-submit").click(),
    ]);
    expect(accepted.status(), "the right password must be accepted").toBeLessThan(300);
    await waitForAny(page, INSIDE, 30_000);
  });
});
