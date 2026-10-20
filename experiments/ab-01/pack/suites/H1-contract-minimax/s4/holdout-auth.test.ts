// Acceptance stage S4 — authentication and session security.
//
// Derived from:
//   api.yaml POST /auth/login — "After 10 failed attempts for one
//     email within 15 minutes, further attempts get 429 rate_limited."
//   api.yaml POST /auth/logout — "End the session server-side; the old
//     cookie stops working."
//   api.yaml POST /auth/password-reset/confirm — "Single-use token.
//     Ends every existing session of that user."
//   api.yaml POST /auth/signup — Email is case-insensitive.

import { describe, expect, test } from "vitest";
import { Client } from "../../lib/client";
import {
  PASSWORD,
  expectError,
  expectStatus,
  login,
  newEmail,
  outbox,
  signup,
} from "../../lib/helpers";

describe("holdout: authentication (api.yaml §auth)", () => {
  test("after 10 failed login attempts within 15 minutes further attempts get 429 rate_limited (api.yaml §login)", async () => {
    const victim = await signup();
    const attacker = new Client();
    for (let i = 0; i < 10; i++) {
      const r = await attacker.post("/api/auth/login", {
        email: victim.email,
        password: `wrong-${i}`,
      });
      expectError(r, 401, "invalid_credentials");
    }
    expectError(
      await attacker.post("/api/auth/login", { email: victim.email, password: PASSWORD }),
      429,
      "rate_limited",
    );
    expectError(
      await attacker.post("/api/auth/login", { email: victim.email, password: PASSWORD }),
      429,
      "rate_limited",
    );
  });

  test("logout invalidates the live session cookie (api.yaml §logout)", async () => {
    const acc = await signup();
    expectStatus(await acc.client.get("/api/me"), 200);
    expectStatus(await acc.client.post("/api/auth/logout"), 204);
    expectError(await acc.client.get("/api/me"), 401, "unauthenticated");
    // The same credentials can log back in.
    expectStatus(await login(acc.email, acc.password).then((c) => c.get("/api/me")), 200);
  });

  test("password reset ends every existing session of the user and is single-use (api.yaml §password-reset/confirm)", async () => {
    const acc = await signup();
    const snapshot = acc.client.snapshot();
    expectStatus(await new Client().post("/api/auth/password-reset/request", { email: acc.email }), 202);
    const msg = await outbox(acc.email, "password_reset");
    const token = msg.token;
    const newPw = "completely-new-pass-9876";

    expectStatus(
      await new Client().post("/api/auth/password-reset/confirm", { token, password: newPw }),
      204,
    );
    // The old cookie must be dead.
    const replay = Client.withCookies(snapshot);
    expectError(await replay.get("/api/me"), 401, "unauthenticated");
    // The old password no longer works.
    expectError(
      await new Client().post("/api/auth/login", { email: acc.email, password: acc.password }),
      401,
      "invalid_credentials",
    );
    // The new password does.
    expectStatus(await login(acc.email, newPw).then((c) => c.get("/api/me")), 200);
    // The token is single-use.
    expectError(
      await new Client().post("/api/auth/password-reset/confirm", {
        token,
        password: "another-new-pass-6543",
      }),
      400,
      "invalid_token",
    );
  });

  test("password reset for an unknown email still returns 202 and writes nothing to the outbox (api.yaml §password-reset/request — Always 202)", async () => {
    const phantom = newEmail("phantom");
    const res = await new Client().post("/api/auth/password-reset/request", { email: phantom });
    expectStatus(res, 202);
    const check = await new Client().get(`/api/__test__/outbox?to=${encodeURIComponent(phantom)}`);
    expectStatus(check, 200);
    const resetMails = (check.body?.messages ?? []).filter(
      (m: any) => m.template === "password_reset",
    );
    expect(resetMails.length).toBe(0);
  });

  test("signup with a duplicate email (case-insensitive) returns 409 email_taken (api.yaml §signup — Email is case-insensitive)", async () => {
    const original = await signup();
    const clash = await new Client().post("/api/auth/signup", {
      email: original.email.toUpperCase(),
      password: PASSWORD,
      name: "Other",
    });
    expectError(clash, 409, "email_taken");
    expectStatus(await original.client.get("/api/me"), 200);
  });
});
