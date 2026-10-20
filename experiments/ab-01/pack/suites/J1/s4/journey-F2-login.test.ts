// F2: Log in to an existing account.
// Brief: every flow assumes an authenticated user ("用中文提问它帮我研读…").
// Contract: POST /api/auth/login returns 200 and sets the cookie (api.yaml
//           lines 49–58). Testability: /login is the other fixed route, and
//           login-email/login-password/login-submit are documented
//           (testability.md §8).
import { test, expect } from "vitest";
import { withPage, uiLogin } from "../../lib/ui";
import { Client } from "../../lib/client";
import { newEmail, PASSWORD, signup, expectStatus } from "../../lib/helpers";

test("F2: logging in through the UI starts a session and reaches a post-login page", async () => {
  // Set up the account via the JSON Client. The journey itself logs in via UI.
  const email = newEmail("f2");
  const password = PASSWORD;
  await signup({ email, password });

  await withPage(async (page) => {
    await uiLogin(page, email, password);
    // .fill() and .click() auto-wait via Playwright's default 30s timeout.

    // Plain chai: the login page must be gone.
    await page.waitForFunction(() => !window.location.pathname.startsWith("/login"));
    expect(page.url()).not.toMatch(/\/login(\?|#|$)/);

    // Bridge the browser cookies into the JSON Client and authenticate against /api/me.
    const browserCookies = await page.context().cookies();
    const jar = new Map<string, string>();
    for (const c of browserCookies) jar.set(c.name, c.value);
    const sessioned = Client.withCookies(jar);
    const me = await sessioned.get("/api/me");
    expectStatus(me, 200);
    expect(me.body?.user?.email).toBe(email);
  });
});
