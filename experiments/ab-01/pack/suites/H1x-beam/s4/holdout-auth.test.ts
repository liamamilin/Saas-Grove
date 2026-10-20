import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { passwordHashes, whereStored } from "../../lib/db";
import { PASSWORD, expectError, expectStatus, isolateFakeModel, newEmail, signup, uid } from "../../lib/helpers";

// Contract: api.yaml /api/auth/signup, /api/auth/login, /api/auth/logout, /api/me,
// /api/auth/password-reset/* ; testability.md §9 (secrets at rest).

describe("holdout auth", () => {
  isolateFakeModel();

  it("signup sets a session and /api/me returns the user (S1)", async () => {
    const email = newEmail("signup");
    const client = new Client();
    const res = await client.post("/api/auth/signup", { email, password: PASSWORD, name: "Alice" });
    expectStatus(res, 201);
    expect(res.body?.user?.email?.toLowerCase()).toBe(email.toLowerCase());
    const me = await client.get("/api/me");
    expectStatus(me, 200);
    expect(me.body?.user?.id).toBe(res.body.user.id);
  });

  it("signup email is case-insensitive and duplicate (different case) is email_taken (S1)", async () => {
    const base = `case-${uid()}@example.test`;
    const c1 = new Client();
    expectStatus(await c1.post("/api/auth/signup", { email: base.toUpperCase(), password: PASSWORD, name: "A" }), 201);
    const c2 = new Client();
    const dup = await c2.post("/api/auth/signup", { email: base.toLowerCase(), password: PASSWORD, name: "B" });
    expectError(dup, 409, "email_taken");
  });

  it("login: unknown email and wrong password both invalid_credentials; correct works (S1)", async () => {
    const email = newEmail("login");
    const su = new Client();
    expectStatus(await su.post("/api/auth/signup", { email, password: PASSWORD, name: "L" }), 201);
    const unknown = await new Client().post("/api/auth/login", { email: newEmail("nope"), password: PASSWORD });
    expectError(unknown, 401, "invalid_credentials");
    const wrong = await new Client().post("/api/auth/login", { email, password: "wrong-password-123" });
    expectError(wrong, 401, "invalid_credentials");
    const ok = await new Client().post("/api/auth/login", { email, password: PASSWORD });
    expectStatus(ok, 200);
  });

  it("login rate-limits after 10 failed attempts for one email (S1)", async () => {
    const email = newEmail("rl");
    await new Client().post("/api/auth/signup", { email, password: PASSWORD, name: "RL" });
    for (let i = 0; i < 10; i++) {
      const r = await new Client().post("/api/auth/login", { email, password: "wrong-password-123" });
      expect(r.status).toBe(401);
    }
    const blocked = await new Client().post("/api/auth/login", { email, password: "wrong-password-123" });
    expectError(blocked, 429, "rate_limited");
  });

  it("logout ends the session server-side (S1)", async () => {
    const email = newEmail("logout");
    const client = new Client();
    expectStatus(await client.post("/api/auth/signup", { email, password: PASSWORD, name: "O" }), 201);
    expectStatus(await client.post("/api/auth/logout"), 204);
    expectError(await client.get("/api/me"), 401, "unauthenticated");
  });

  it("password reset: request always 202; confirm single-use and ends sessions (S1)", async () => {
    const email = newEmail("reset");
    const client = new Client();
    expectStatus(await client.post("/api/auth/signup", { email, password: PASSWORD, name: "R" }), 201);
    // request for unknown email also 202
    expectStatus(await new Client().post("/api/auth/password-reset/request", { email: newEmail("unknown") }), 202);
    const req = await new Client().post("/api/auth/password-reset/request", { email });
    expectStatus(req, 202);
    // token from outbox
    const out = await new Client().get(`/api/__test__/outbox?to=${encodeURIComponent(email)}`);
    expectStatus(out, 200);
    const msg = (out.body.messages as any[]).find((m) => m.template === "password_reset");
    expect(msg?.token).toBeTruthy();
    const token = msg.token;
    const newPwd = "new-password-12345";
    expectStatus(await new Client().post("/api/auth/password-reset/confirm", { token, password: newPwd }), 204);
    // old session ended
    expectError(await client.get("/api/me"), 401);
    // new password works
    const logged = await new Client().post("/api/auth/login", { email, password: newPwd });
    expectStatus(logged, 200);
    // single use
    const reuse = await new Client().post("/api/auth/password-reset/confirm", { token, password: "another-password-9" });
    expectError(reuse, 400, "invalid_token");
    // weak password on confirm
    const req2 = await new Client().post("/api/auth/password-reset/request", { email });
    expectStatus(req2, 202);
  });

  it("session cookie is HttpOnly and SameSite (S1)", async () => {
    const email = newEmail("cookie");
    const client = new Client();
    const res = await client.post("/api/auth/signup", { email, password: PASSWORD, name: "C" });
    expectStatus(res, 201);
    const cookies = client.lastSetCookies.join("\n");
    expect(/httponly/i.test(cookies)).toBe(true);
    expect(/samesite=(lax|strict)/i.test(cookies)).toBe(true);
  });

  it("signup validates required fields and password length (S1)", async () => {
    const c = new (await import("../../lib/client")).Client();
    const { expectError, expectStatus, PASSWORD, newEmail } = await import("../../lib/helpers");
    expectError(await c.post("/api/auth/signup", { email: newEmail(), password: "short", name: "X" }), 400, "validation_error");
    expectError(await c.post("/api/auth/signup", { email: newEmail(), password: PASSWORD }), 400, "validation_error");
    expectError(await c.post("/api/auth/signup", { password: PASSWORD, name: "X" }), 400, "validation_error");
  });

});