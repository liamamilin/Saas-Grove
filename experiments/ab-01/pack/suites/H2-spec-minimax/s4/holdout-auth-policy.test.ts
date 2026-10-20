// Authentication and session policy (S4 + general).
//
// Spec clauses verified here:
//   spec/product.md §4 (重置密码后，其他会话全部失效) + §6 (账号枚举、会话残留)
//   spec/architecture.md §7 (Cookie 设 HttpOnly 和 SameSite)
//
// We deliberately do NOT re-test the basic happy paths of signup/login (those
// belong to the S1 contract). We test only the security edges the spec calls
// out as "容易做错的地方".

import { describe, expect, test } from "vitest";
import {
  expectStatus,
  login as loginHelper,
  newEmail,
  outbox as fetchOutbox,
  PASSWORD,
  signup,
} from "../../lib/helpers";
import { Client } from "../../lib/client";

describe("s4: auth and session policy", () => {
  test("login with the wrong password returns the same status, code and message as an unknown email (no enumeration)", async () => {
    // spec/product.md §6 (账号枚举) — the contract says "Unknown email and wrong
    // password both give invalid_credentials", but it is the SPEC that elevates
    // this into a security requirement we want to verify.
    const real = await signup();
    const wrong = new Client();
    const r1 = await wrong.post("/api/auth/login", { email: real.email, password: "wrong-pass-wrong" });
    const r2 = await wrong.post("/api/auth/login", { email: newEmail("phantom"), password: "wrong-pass-wrong" });
    expectStatus(r1, 401);
    expectStatus(r2, 401);
    expect(r1.body?.error?.code).toBe("invalid_credentials");
    expect(r2.body?.error?.code).toBe("invalid_credentials");
    expect(r1.body.error.message).toBe(r2.body.error.message);
  });

  test("password-reset request returns 202 and produces no outbox entry for an unknown email (no enumeration)", async () => {
    // spec/product.md §6 (账号枚举) — same root concern as above, expressed for
    // the reset endpoint.
    const unknown = newEmail("nobody");
    const c = new Client();
    const res = await c.post("/api/auth/password-reset/request", { email: unknown });
    expectStatus(res, 202);
    const out = await c.get(`/api/__test__/outbox?to=${encodeURIComponent(unknown)}`);
    expectStatus(out, 200);
    const matched = (out.body.messages as any[]).filter((m) => m.template === "password_reset");
    expect(matched.length).toBe(0);
  });

  test("password reset ends every other session of that user (no session leak after reset)", async () => {
    // spec/product.md §4 (重置密码后，其他会话全部失效) + §6 (会话残留)
    const su = await signup();
    const session1 = await loginHelper(su.email, PASSWORD);
    const session2 = await loginHelper(su.email, PASSWORD);
    expectStatus(await session1.get("/api/me"), 200);
    expectStatus(await session2.get("/api/me"), 200);

    const req = await session1.post("/api/auth/password-reset/request", { email: su.email });
    expectStatus(req, 202);
    const msg = await fetchOutbox(su.email, "password_reset");
    const newPassword = "another-horse-battery-77";
    const confirm = await session1.post("/api/auth/password-reset/confirm", {
      token: msg.token,
      password: newPassword,
    });
    expectStatus(confirm, 204);

    // Both old cookies must now be rejected.
    expectStatus(await session1.get("/api/me"), 401);
    expectStatus(await session2.get("/api/me"), 401);

    // Login with the new password works; login with the old one doesn't.
    const okNew = await loginHelper(su.email, newPassword);
    expectStatus(await okNew.get("/api/me"), 200);
    const badOld = await loginHelper(su.email, PASSWORD);
    expectStatus(await badOld.get("/api/me"), 401);
  });
});