// F1 — sign up.
//
// Brief (user-brief.md): a small company buys the product; the people who run it need an
// account of their own before they can put their documents in.
// Contract (api.yaml §/api/auth/signup): POST {email, password, name} -> 201 {user} and sets
// the session cookie; the e-mail is case-insensitive, the password needs 10 characters.
// UI anchors (testability.md §8): signup-name, signup-email, signup-password, signup-submit
// on the one fixed route /signup.

import { expect, test } from "vitest";
import type { Page } from "playwright";
import { PASSWORD, newEmail, waitFor } from "../../lib/helpers";
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

test("F1: a visitor signs up with a name, an e-mail and a password and is signed in", async () => {
  await withPage(async (page) => {
    const email = newEmail("signup");

    await page.goto("/signup");
    await page.getByTestId("signup-name").fill("Shop Owner");
    await page.getByTestId("signup-email").fill(email);
    await page.getByTestId("signup-password").fill(PASSWORD);
    await page.getByTestId("signup-submit").click();

    // The account exists and the session is open: the product shows its own pages now.
    await waitForAny(page, INSIDE, 30_000);
    expect(await shown(page, "signup-submit"), "the sign-up form is still on screen").toBe(false);

    // The session is a real cookie, not a client-side illusion: a reload stays inside.
    await page.reload();
    await waitForAny(page, INSIDE, 30_000);
    expect(await shown(page, "signup-submit"), "the sign-up form is back after a reload").toBe(false);
  });
});
