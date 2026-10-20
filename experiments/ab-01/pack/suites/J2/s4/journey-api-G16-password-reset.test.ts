// G16: Request a password reset, confirm a new password, log in with it.
// Derived from brief/contract/api.yaml:
//   - POST /api/auth/password-reset/request    (Always 202; sends a password_reset email when the email exists)
//   - POST /api/auth/password-reset/confirm    (Single-use token; ends every existing session of that user)
//   - POST /api/auth/login                     (invalid_credentials 401 on wrong password)
// Plus brief/contract/testability.md §6: the test-mode outbox exposes the token as cleartext,
// and §9 confirms reset tokens are hashed at rest.
// Journey: the user signs up with one password, requests a reset, pulls the token from the outbox,
// sets a new password, logs in with the new password, then proves the old password no longer works.
// Binary pass conditions:
//   - login with the new password returns 200,
//   - login with the old password returns 401.

import { describe, expect, test } from "vitest";
import { Client } from "../../lib/client";
import { PASSWORD, signup } from "../../lib/helpers";

describe("G16: request a password reset, confirm a new password, log in with it", () => {
  test("after the reset the new password works and the old one no longer does", async () => {
    const account = await signup();
    const NEW_PASSWORD = "new-correct-horse-42";

    const req = await new Client().post("/api/auth/password-reset/request", { email: account.email });
    expect(req.status).toBe(202);

    const outboxRes = await new Client().get(`/api/__test__/outbox?to=${encodeURIComponent(account.email)}`);
    expect(outboxRes.status).toBe(200);
    const messages = ((outboxRes.body?.messages ?? []) as Array<{ template: string; token: string }>)
      .filter((m) => m.template === "password_reset");
    expect(messages.length, `no password_reset email for ${account.email}`).toBeGreaterThan(0);
    const token = messages[messages.length - 1].token;
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const confirm = await new Client().post("/api/auth/password-reset/confirm", {
      token,
      password: NEW_PASSWORD,
    });
    expect(confirm.status).toBe(204);

    const oldLogin = await new Client().post("/api/auth/login", { email: account.email, password: PASSWORD });
    expect(oldLogin.status).toBe(401);
    expect(oldLogin.body?.error?.code).toBe("invalid_credentials");

    const newLogin = await new Client().post("/api/auth/login", { email: account.email, password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body?.user?.id).toBe(account.user.id);
  });
});