import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { expectError, expectStatus, owner, PASSWORD, newEmail } from "../../lib/helpers";
import { whereStored, passwordHashes } from "../../lib/db";

// Contract: testability.md §9 (secrets at rest), api.yaml auth.

describe("holdout security", () => {
  it("unauthenticated access to protected endpoints 401 (S1)", async () => {
    const c = new Client();
    expectError(await c.get("/api/me"), 401);
    expectError(await c.get("/api/workspaces"), 401);
  });

  it("invalid/expired session cookie rejected (S1)", async () => {
    const c = new Client();
    // inject a bogus cookie by making a request with cookie header
    const res = await c.request("GET", "/api/me", { headers: { cookie: "session=not-a-real-token" } });
    expectError(res, 401);
  });

  it("injection: SQL-like email does not break signup/login (S1)", async () => {
    const email = `inj'--${Date.now()}@example.test`;
    const c = new Client();
    const res = await c.post("/api/auth/signup", { email, password: PASSWORD, name: "Inj" });
    // either accepts (sanitized) or rejects validation; must not 500/404
    expect([201, 400].includes(res.status)).toBe(true);
    if (res.status === 201) {
      const login = await new Client().post("/api/auth/login", { email, password: PASSWORD });
      expect(login.status).toBe(200);
    }
  });

  it("XSS payload in document title/text is stored, not executed (S2)", async () => {
    const t = await owner();
    const xss = "<script>alert(1)</script>";
    const r = await t.client.post(`/api/workspaces/${t.ws.id}/documents`, { title: xss, text: xss });
    // must not 500/404
    expect([201, 400].includes(r.status)).toBe(true);
    if (r.status === 201) {
      const doc = await (await import("../../lib/helpers")).waitForDocument(t.client, t.ws.id, r.body.document.id);
      // title returned escaped or raw but no crash
      expect(typeof doc.title).toBe("string");
    }
  });

  it("password hash uses argon2id or bcrypt cost>=12 (§9)", async () => {
    const email = newEmail("hash");
    const c = new Client();
    expectStatus(await c.post("/api/auth/signup", { email, password: PASSWORD, name: "H" }), 201);
    const h = passwordHashes();
    expect(h.accepted).toBeGreaterThan(0);
    expect(h.weakBcrypt).toBe(0);
  });

});