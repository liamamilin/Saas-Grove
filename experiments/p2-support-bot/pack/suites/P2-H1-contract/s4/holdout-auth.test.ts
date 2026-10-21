// Held-out acceptance tests: accounts, sessions and passwords.
//
// Contract source:
//   brief/contract/api.yaml: POST /api/auth/signup ("Create an account and start a session. Email is
//   case-insensitive.", 201, 400, 409 email_taken), POST /api/auth/login ("Unknown email and wrong
//   password both give invalid_credentials", "After 10 failed attempts for one email within 15
//   minutes, further attempts get 429 rate_limited"), POST /api/auth/logout ("End the session
//   server-side; the old cookie stops working", 204), GET /api/me (200 { user, memberships }, 401
//   unauthenticated), POST /api/auth/password-reset/* ("Always 202, whether or not the email
//   exists", "Single-use token. Ends every existing session of that user").
//   The global conventions: "Errors are {"error": {"code", "message"}}", "a session cookie
//   (HttpOnly, SameSite=Lax or Strict)", User "Never carries password hashes, session tokens or
//   reset tokens".
//   brief/contract/testability.md §6: the password_reset email carries the token.

import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import {
  PASSWORD,
  allKeys,
  expectError,
  expectStatus,
  mails,
  newEmail,
  outbox,
  signup,
} from "../../lib/helpers";

/** Keys that would carry a credential. */
const credentialKeys = (value: unknown) =>
  allKeys(value).filter((key) => /pass(word)?|hash|salt|token|secret/i.test(key));

/** The cookie of the client, with its attributes. */
function cookieOf(raw: string): { name: string; value: string; attrs: string[] } | undefined {
  const [pair, ...attrs] = raw.split(";");
  const eq = pair.indexOf("=");
  if (eq < 0) return undefined;
  return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), attrs: attrs.map((a) => a.trim()) };
}

/**
 * The cookie that opens the session: the one that alone lets /api/me answer. The name of the cookie
 * is up to the product, so the candidates are tried out.
 */
async function sessionCookie(client: Client): Promise<{ name: string; value: string; attrs: string[] } | undefined> {
  const cookies = client.lastSetCookies.map(cookieOf).filter((c): c is NonNullable<typeof c> => Boolean(c));
  for (const cookie of cookies) {
    const probe = Client.withCookies(new Map([[cookie.name, cookie.value]]));
    const res = await probe.get("/api/me");
    if (res.status === 200) return cookie;
  }
  return undefined;
}

describe("holdout: accounts and sessions", () => {
  it("signs up into a session that identifies the user, and ends it on logout", async () => {
    // Contract: POST /api/auth/signup -> 201 "Sets the session cookie"; the session cookie is
    // "HttpOnly, SameSite=Lax or Strict"; GET /api/me -> 200 { user, memberships }; POST
    // /api/auth/logout -> 204 and "the old cookie stops working".
    const client = new Client();
    const email = newEmail("session");
    const res = await client.post("/api/auth/signup", { email, password: PASSWORD, name: "Session User" });

    expectStatus(res, 201);
    expect(String(res.body?.user?.id ?? "")).not.toBe("");
    expect(String(res.body?.user?.email ?? "").toLowerCase()).toBe(email.toLowerCase());
    expect(String(res.body?.user?.name ?? "")).toBe("Session User");
    expect(credentialKeys(res.body?.user ?? {})).toEqual([]);

    const cookie = await sessionCookie(client);
    expect(cookie, "sign-up did not set a session cookie").toBeTruthy();
    const attrs = cookie?.attrs ?? [];
    expect(attrs.some((a) => /^httponly$/i.test(a)), "the session cookie is not HttpOnly").toBe(true);
    const sameSite = attrs.find((a) => /^samesite=/i.test(a));
    expect(sameSite, "the session cookie has no SameSite attribute").toBeTruthy();
    expect(/^samesite=(lax|strict)$/i.test(String(sameSite))).toBe(true);

    const me = await client.get("/api/me");
    expectStatus(me, 200);
    expect(me.body?.user?.id).toBe(res.body?.user?.id);
    expect(Array.isArray(me.body?.memberships), "GET /api/me does not return a memberships array").toBe(true);
    expect(credentialKeys(me.body?.user ?? {})).toEqual([]);

    const cookies = client.snapshot();
    const out = await client.post("/api/auth/logout");
    expectStatus(out, 204);

    const replay = Client.withCookies(cookies);
    expectError(await replay.get("/api/me"), 401, "unauthenticated");
  });

  it("refuses invalid sign-up payloads and a duplicate email", async () => {
    // Contract: POST /api/auth/signup requires [email, password, name], password minLength 10, name
    // minLength 1, email is a format:email address; 400 validation_error; a duplicate is 409
    // email_taken, and "Email is case-insensitive".
    const client = new Client();
    const email = newEmail("dup");

    expectError(await client.post("/api/auth/signup", { email, password: "short", name: "X" }), 400, "validation_error");
    expectError(await client.post("/api/auth/signup", { email, password: PASSWORD }), 400, "validation_error");
    expectError(await client.post("/api/auth/signup", { email, password: PASSWORD, name: "" }), 400, "validation_error");
    expectError(
      await client.post("/api/auth/signup", { email: "not-an-address", password: PASSWORD, name: "X" }),
      400,
      "validation_error",
    );

    expectStatus(await client.post("/api/auth/signup", { email, password: PASSWORD, name: "First" }), 201);
    expectError(
      await client.post("/api/auth/signup", { email: email.toUpperCase(), password: PASSWORD, name: "Second" }),
      409,
      "email_taken",
    );
  });

  it("answers a wrong password and an unknown email with the same error, and rate limits a brute force", async () => {
    // Contract: POST /api/auth/login -> "Unknown email and wrong password both give
    // invalid_credentials"; "After 10 failed attempts for one email within 15 minutes, further
    // attempts get 429 rate_limited".
    const account = await signup();

    expectError(
      await new Client().post("/api/auth/login", { email: newEmail("ghost"), password: PASSWORD }),
      401,
      "invalid_credentials",
    );

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const res = await new Client().post("/api/auth/login", {
        email: account.email,
        password: "definitely-not-the-password",
      });
      expect(res.status, `failed attempt ${attempt}: ${res.text.slice(0, 200)}`).toBe(401);
      expect(res.body?.error?.code).toBe("invalid_credentials");
    }
    expectError(
      await new Client().post("/api/auth/login", { email: account.email, password: "definitely-not-the-password" }),
      429,
      "rate_limited",
    );

    // The limit belongs to that email, not to the whole installation.
    const other = await signup();
    expectStatus(await new Client().post("/api/auth/login", { email: other.email, password: other.password }), 200);
  });

  it("resets a password with a single-use token and ends every session of that user", async () => {
    // Contract: POST /api/auth/password-reset/request -> "Always 202, whether or not the email
    // exists. Sends a password_reset email when it does."; POST .../confirm -> 204, "Single-use
    // token. Ends every existing session of that user."
    const account = await signup();

    const ghostEmail = newEmail("ghost");
    expectStatus(await new Client().post("/api/auth/password-reset/request", { email: ghostEmail }), 202);
    expect((await mails(ghostEmail, "password_reset")).length, "a mail was sent to an unknown address").toBe(0);

    expectStatus(await new Client().post("/api/auth/password-reset/request", { email: account.email }), 202);
    const mail = await outbox(account.email, "password_reset");
    expect(String(mail.token ?? "")).not.toBe("");

    const newPassword = "a-brand-new-passphrase-99";
    expectStatus(
      await new Client().post("/api/auth/password-reset/confirm", { token: mail.token, password: newPassword }),
      204,
    );

    // The token is single use.
    const again = await new Client().post("/api/auth/password-reset/confirm", {
      token: mail.token,
      password: newPassword,
    });
    expectError(again, 400);
    expect(["invalid_token", "validation_error"]).toContain(again.body?.error?.code);

    // Every existing session of that user is gone.
    expectError(await account.client.get("/api/me"), 401, "unauthenticated");
    expectError(
      await new Client().post("/api/auth/login", { email: account.email, password: account.password }),
      401,
      "invalid_credentials",
    );
    expectStatus(await new Client().post("/api/auth/login", { email: account.email, password: newPassword }), 200);
  });
});
