// F1: Register a new account (sign up starts a session).
// Brief: every flow starts here; the brief assumes an authenticated user.
// Contract: POST /api/auth/signup returns 201 and sets the session cookie
//           (api.yaml lines 32–48). Testability: /signup is one of the two
//           fixed routes and the four signup-* test ids are documented
//           (testability.md §8).
//
// Pass condition (binary, observable): after the UI submits the signup
// form, the page is no longer /signup AND the cookies captured from the
// browser context can authenticate against the API (GET /api/me returns
// 200 with the user's email). The end-to-end proof is the cookie journey.
import { test, expect } from "vitest";
import { withPage } from "../../lib/ui";
import { Client } from "../../lib/client";
import { newEmail, PASSWORD, expectStatus } from "../../lib/helpers";

test("F1: sign up through the UI creates an account and starts a session", async () => {
  const email = newEmail("f1");
  const password = PASSWORD;
  const name = "F1 User";

  await withPage(async (page) => {
    await page.goto("/signup");
    await page.getByTestId("signup-name").fill(name);
    await page.getByTestId("signup-email").fill(email);
    await page.getByTestId("signup-password").fill(password);
    // .click() auto-waits via Playwright's default 30s timeout.
    await page.getByTestId("signup-submit").click();

    // Plain chai: the page URL must no longer match /signup.
    // vitest's expect does not include Playwright matchers; use plain matchers.
    await page.waitForFunction(() => !window.location.pathname.startsWith("/signup"));
    expect(page.url()).not.toMatch(/\/signup(\?|#|$)/);

    // Bridge the browser cookies into the JSON Client and prove the cookie
    // identifies a live server-side session by hitting GET /api/me
    // (api.yaml 63–76).
    const browserCookies = await page.context().cookies();
    const jar = new Map<string, string>();
    for (const c of browserCookies) jar.set(c.name, c.value);
    const sessioned = Client.withCookies(jar);
    const me = await sessioned.get("/api/me");
    expectStatus(me, 200);
    expect(me.body?.user?.email).toBe(email);
  });
});
