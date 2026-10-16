import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import {
  PASSWORD,
  secretKeys,
  expectError,
  expectStatus,
  login,
  newEmail,
  outbox,
  signup,
} from "../../lib/helpers";

describe("S1 accounts and sessions", () => {
  // Health is part of the start contract and is checked by run.mjs before any test runs.

  it("signs up into a session whose user carries no secrets", async () => {
    const { client, email, user } = await signup({ name: "Ada" });
    expect(user.email).toBe(email);
    expect(user.name).toBe("Ada");

    const me = await client.get("/api/me");
    expectStatus(me, 200);
    expect(me.body.user.id).toBe(user.id);
    expect(me.body.memberships).toEqual([]);
    expect(secretKeys(me.body)).toEqual([]);
  });

  it("sets the session cookie HttpOnly and SameSite", async () => {
    const client = new Client();
    const res = await client.post("/api/auth/signup", { email: newEmail(), password: PASSWORD, name: "C" });
    expectStatus(res, 201);
    const cookies = client.lastSetCookies;
    expect(cookies.length, "signup sets no cookie").toBeGreaterThan(0);
    expect(cookies.some((c) => /httponly/i.test(c) && /samesite=(lax|strict)/i.test(c)), cookies.join(" | ")).toBe(true);
  });

  it("treats email addresses case-insensitively for uniqueness", async () => {
    const email = newEmail("Case");
    await signup({ email });
    const again = await new Client().post("/api/auth/signup", { email: email.toUpperCase(), password: PASSWORD, name: "Dup" });
    expectError(again, 409, "email_taken");
  });

  it("rejects invalid signups with validation_error", async () => {
    await signup(); // the endpoint works for valid input
    const c = new Client();
    expectError(await c.post("/api/auth/signup", { email: newEmail(), password: "short-pw1", name: "X" }), 400, "validation_error");
    expectError(await c.post("/api/auth/signup", { email: "not-an-email", password: PASSWORD, name: "X" }), 400, "validation_error");
    expectError(await c.post("/api/auth/signup", { email: newEmail(), password: PASSWORD }), 400, "validation_error");
  });

  it("logs in, and gives one indistinguishable error for bad credentials", async () => {
    const { email } = await signup();
    const good = await login(email);
    expectStatus(await good.get("/api/me"), 200);

    const wrongPassword = await new Client().post("/api/auth/login", { email, password: "wrong-password-123" });
    const unknownEmail = await new Client().post("/api/auth/login", { email: newEmail(), password: PASSWORD });
    expectError(wrongPassword, 401, "invalid_credentials");
    expectError(unknownEmail, 401, "invalid_credentials");
  });

  it("ends the session on the server at logout", async () => {
    const { client } = await signup();
    expectStatus(await client.get("/api/me"), 200);
    const stolen = client.snapshot();

    expectStatus(await client.post("/api/auth/logout"), 204);
    expectError(await client.get("/api/me"), 401, "unauthenticated");
    // The old cookie value must be dead on the server, not just cleared in the browser.
    expectError(await Client.withCookies(stolen).get("/api/me"), 401, "unauthenticated");
  });

  it("rate limits repeated failed logins per email", async () => {
    const victim = await signup();
    const bystander = await signup();
    for (let i = 0; i < 10; i++) {
      const res = await new Client().post("/api/auth/login", { email: victim.email, password: `wrong-password-${i}` });
      expectError(res, 401, "invalid_credentials");
    }
    const blocked = await new Client().post("/api/auth/login", { email: victim.email, password: "wrong-password-x" });
    expectError(blocked, 429, "rate_limited");
    // The limit is per email: other accounts can still sign in.
    expectStatus(await new Client().post("/api/auth/login", { email: bystander.email, password: PASSWORD }), 200);
  });

  it("resets a password once, and ends other sessions", async () => {
    const account = await signup();
    expectStatus(await account.client.get("/api/me"), 200);

    expectStatus(await new Client().post("/api/auth/password-reset/request", { email: account.email }), 202);
    // No account enumeration: unknown emails get the same answer.
    expectStatus(await new Client().post("/api/auth/password-reset/request", { email: newEmail() }), 202);

    const { token } = await outbox(account.email, "password_reset");
    const newPassword = "a-brand-new-password-7";
    expectStatus(await new Client().post("/api/auth/password-reset/confirm", { token, password: newPassword }), 204);

    expectError(await account.client.get("/api/me"), 401, "unauthenticated");
    expectError(await new Client().post("/api/auth/login", { email: account.email, password: PASSWORD }), 401, "invalid_credentials");
    await login(account.email, newPassword);
    expectError(
      await new Client().post("/api/auth/password-reset/confirm", { token, password: "yet-another-password-8" }),
      400,
      "invalid_token",
    );
  });

  it("refuses unauthenticated access", async () => {
    const { client } = await signup();
    expectStatus(await client.get("/api/workspaces"), 200);

    const anon = new Client();
    expectError(await anon.get("/api/me"), 401, "unauthenticated");
    expectError(await anon.get("/api/workspaces"), 401, "unauthenticated");
    expectError(await anon.post("/api/workspaces", { name: "nope" }), 401, "unauthenticated");
  });
});
