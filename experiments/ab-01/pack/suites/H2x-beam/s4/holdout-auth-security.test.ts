import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { PASSWORD, newEmail, signup, login, outbox } from "../../lib/helpers";

// Clause: product.md §S1 (注册/登录/登出/找回密码; 会话 Cookie 安全属性; 登录失败限流) and architecture.md §security.
describe("holdout auth security", () => {
  it("signup sets an HttpOnly SameSite session cookie", async () => {
    // Clause: architecture.md §7 (Cookie HttpOnly + SameSite) and api.yaml /api/auth/signup.
    const account = await signup();
    const cookies = account.client.lastSetCookies.join("\n");
    expect(cookies).toMatch(/HttpOnly/i);
    expect(cookies).toMatch(/SameSite=(Lax|Strict)/i);
  });

  it("logout ends the session server-side", async () => {
    // Clause: product.md §4.1; api.yaml /api/auth/logout.
    const account = await signup();
    expect((await account.client.post("/api/auth/logout")).status).toBe(204);
    expect((await account.client.get("/api/me")).status).toBe(401);
  });

  it("a snapshot of the old cookie stops working after logout", async () => {
    // Clause: product.md §6 (会话残留).
    const account = await signup();
    const saved = account.client.snapshot();
    await account.client.post("/api/auth/logout");
    const replay = Client.withCookies(saved);
    expect((await replay.get("/api/me")).status).toBe(401);
  });

  it("password reset invalidates every existing session and allows the new password", async () => {
    // Clause: product.md §4.1; api.yaml /api/auth/password-reset/confirm.
    const account = await signup();
    const second = await login(account.email, account.password);
    await new Client().post("/api/auth/password-reset/request", { email: account.email });
    const token = (await outbox(account.email, "password_reset")).token;
    const newPassword = "new-correct-horse-battery-42";
    expect((await new Client().post("/api/auth/password-reset/confirm", { token, password: newPassword })).status).toBe(204);
    expect((await account.client.get("/api/me")).status).toBe(401);
    expect((await second.get("/api/me")).status).toBe(401);
    const fresh = await login(account.email, newPassword);
    expect((await fresh.get("/api/me")).status).toBe(200);
  });

  it("a password-reset token is single use", async () => {
    // Clause: api.yaml /api/auth/password-reset/confirm (single-use token).
    const account = await signup();
    await new Client().post("/api/auth/password-reset/request", { email: account.email });
    const token = (await outbox(account.email, "password_reset")).token;
    const newPassword = "new-correct-horse-battery-42";
    expect((await new Client().post("/api/auth/password-reset/confirm", { token, password: newPassword })).status).toBe(204);
    const again = await new Client().post("/api/auth/password-reset/confirm", { token, password: "another-password-123" });
    expect(again.status).toBe(400);
    expect(again.body?.error?.code).toBe("invalid_token");
  });

  it("password-reset request is always 202 (no account enumeration)", async () => {
    // Clause: product.md §6 (账号枚举); api.yaml /api/auth/password-reset/request.
    const existing = newEmail();
    await signup({ email: existing });
    const r1 = await new Client().post("/api/auth/password-reset/request", { email: existing });
    const r2 = await new Client().post("/api/auth/password-reset/request", { email: newEmail("nope") });
    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
  });

  it("login is rate limited after 10 failed attempts for one email", async () => {
    // Clause: product.md §S1; api.yaml /api/auth/login (10 failed / 15 min -> 429).
    const email = newEmail("ratelimit");
    const client = new Client();
    for (let i = 0; i < 11; i++) {
      const res = await client.post("/api/auth/login", { email, password: "definitely-wrong-password" });
      if (i < 10) expect(res.status).toBe(401);
      else expect(res.status).toBe(429);
    }
  });

  it("email is case-insensitive for signup and login", async () => {
    // Clause: product.md §4.1; api.yaml /api/auth/signup, /api/auth/login.
    const local = `Mixed-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `${local}@Example.Test`;
    const client = new Client();
    expect((await client.post("/api/auth/signup", { email, password: PASSWORD, name: "Mixed" })).status).toBe(201);
    const loginClient = new Client();
    expect((await loginClient.post("/api/auth/login", { email: email.toLowerCase(), password: PASSWORD })).status).toBe(200);
  });
});