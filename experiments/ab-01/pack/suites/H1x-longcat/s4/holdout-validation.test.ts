// Input validation and error shapes.
// Clause: api.yaml requestBody schemas (required fields, minLength/maxLength, minItems/maxItems,
// enums, minimum 0), the 413/415 upload limits, and the {"error":{"code","message"}} envelope.
import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import {
  addText,
  expectError,
  expectStatus,
  newEmail,
  owner,
  PASSWORD,
  signup,
  startJob,
  waitForDocument,
} from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

describe("input validation", () => {
  // api.yaml POST signup: required fields, minLength 10 password, minLength 1 name, 409 email_taken.
  it("signup validates fields and treats email case-insensitively for duplicates", async () => {
    const email = newEmail();
    const account = await signup({ email }); // guard: a valid signup succeeds
    expect(account.user.email).toBe(email);

    const c = new Client();
    expectError(await c.post("/api/auth/signup", { email, password: "short", name: "X" }), 400, "validation_error");
    expectError(
      await c.post("/api/auth/signup", { email: newEmail(), password: PASSWORD, name: "" }),
      400,
      "validation_error",
    );
    expectError(
      await c.post("/api/auth/signup", { email: "not-an-email", password: PASSWORD, name: "X" }),
      400,
      "validation_error",
    );
    // Same email in a different case is still taken.
    expectError(
      await c.post("/api/auth/signup", { email: email.toUpperCase(), password: PASSWORD, name: "X" }),
      409,
      "email_taken",
    );
  });

  // api.yaml POST login: unknown email and wrong password both 401 invalid_credentials; 429 after 10 failures.
  it("login rejects unknown and wrong credentials alike and rate-limits repeated failures", async () => {
    const account = await signup(); // guard
    const c = new Client();
    expectError(await c.post("/api/auth/login", { email: account.email, password: "wrong-password-1" }), 401, "invalid_credentials");
    expectError(await c.post("/api/auth/login", { email: newEmail(), password: PASSWORD }), 401, "invalid_credentials");
    // Correct credentials in a different case work.
    expectStatus(await c.post("/api/auth/login", { email: account.email.toUpperCase(), password: PASSWORD }), 200);

    // After 10 failed attempts for one email within 15 minutes, further attempts are 429.
    const victim = newEmail();
    let limited = false;
    for (let i = 0; i < 11; i++) {
      const r = await new Client().post("/api/auth/login", { email: victim, password: "wrong-password-1" });
      if (r.status === 429) {
        limited = true;
        break;
      }
      expect(r.status).toBe(401);
    }
    expect(limited).toBe(true);
  });

  // api.yaml POST /workspaces: name minLength 1 / maxLength 100; a non-JSON body is 415.
  it("workspace names are length-bounded and a non-JSON body is 415", async () => {
    const a = await owner(); // guard: a normal workspace is created
    expectError(await a.client.post("/api/workspaces", { name: "" }), 400, "validation_error");
    expectError(await a.client.post("/api/workspaces", { name: "x".repeat(101) }), 400, "validation_error");
    expectStatus(await a.client.post("/api/workspaces", { name: "x".repeat(100) }), 201);

    const raw = await a.client.request("POST", "/api/workspaces", {
      body: "not json",
      headers: { "content-type": "text/plain" },
    });
    expectError(raw, 415, "unsupported_media_type");
  });

  // api.yaml documents POST (text minLength 1) and research-jobs POST (question 1..2000, documentIds 1..20).
  it("documents and research jobs enforce their field boundaries", async () => {
    const a = await owner();
    expectError(await a.client.post(`/api/workspaces/${a.ws.id}/documents`, { title: "t", text: "" }), 400, "validation_error");
    const doc = await addText(a.client, a.ws.id, SOLAR); // guard: 201

    const base = `/api/workspaces/${a.ws.id}/research-jobs`;
    expectError(await a.client.post(base, { question: "", documentIds: [doc.id] }), 400, "validation_error");
    expectError(await a.client.post(base, { question: "q".repeat(2001), documentIds: [doc.id] }), 400, "validation_error");
    expectError(await a.client.post(base, { question: "ok", documentIds: [] }), 400, "validation_error");
    expectError(await a.client.post(base, { question: "ok", documentIds: Array(21).fill(doc.id) }), 400, "validation_error");
    expectStatus(await a.client.post(base, { question: "ok", documentIds: [doc.id] }), 202); // guard
  });

  // api.yaml PUT budget: monthlyUsd minimum 0, null means unlimited.
  it("budget values are validated and null means unlimited", async () => {
    const a = await owner();
    expectError(await a.client.put(`/api/workspaces/${a.ws.id}/budget`, { monthlyUsd: -1 }), 400, "validation_error");

    let res = await a.client.put(`/api/workspaces/${a.ws.id}/budget`, { monthlyUsd: 0 });
    expectStatus(res, 200);
    expect(res.body.budgetUsd).toBe(0);

    res = await a.client.put(`/api/workspaces/${a.ws.id}/budget`, { monthlyUsd: null });
    expectStatus(res, 200);
    expect(res.body.budgetUsd).toBeNull();
  });

  // api.yaml documents POST multipart: .txt/.md/.pdf only (415 otherwise), max 10 MB (413 over).
  it("uploads reject unsupported media types and files over the size limit", async () => {
    const a = await owner();
    // Guard: a small text upload works.
    const ok = await a.client.upload(`/api/workspaces/${a.ws.id}/documents`, {
      filename: "note.txt",
      content: SOLAR.text,
      mimeType: "text/plain",
      title: SOLAR.title,
    });
    expectStatus(ok, 201);
    await waitForDocument(a.client, a.ws.id, ok.body.document.id);

    const bad = await a.client.upload(`/api/workspaces/${a.ws.id}/documents`, {
      filename: "evil.exe",
      content: "MZ",
      mimeType: "application/x-msdownload",
    });
    expectError(bad, 415, "unsupported_media_type");

    const big = await a.client.upload(`/api/workspaces/${a.ws.id}/documents`, {
      filename: "big.txt",
      content: new Uint8Array(11 * 1024 * 1024),
      mimeType: "text/plain",
    });
    expectError(big, 413, "payload_too_large");
  });
});
