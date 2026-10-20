// Security at rest and real mode.
// Clause: testability.md §5.1/§5.2 (real mode refuses to start without its configuration; every
// chat call carries the bearer key, the model name and max_tokens; usage is billed from the
// model's reported usage; the budget is never overspent), §6 (the test routes are 404 outside
// TEST_MODE; invitation/reset token plaintext may only live in an `outbox` table), and §9
// (session and reset tokens are stored hashed, passwords are argon2id or bcrypt cost >= 12,
// and no password appears in clear text).
import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { passwordHashes, whereStored } from "../../lib/db";
import { launch, teamAt, withInstance } from "../../lib/instance";
import { MockModel, realModeEnv, replyCostUsd } from "../../lib/mock-model";
import {
  addText,
  expectError,
  expectStatus,
  login,
  newEmail,
  outbox,
  PASSWORD,
  signup,
  startJob,
  usageRecords,
  waitForJob,
} from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

describe("secrets at rest", () => {
  // testability.md §9: session tokens are stored hashed and no password appears in clear text.
  it("the session cookie and the password are stored hashed, never in clear text", async () => {
    const account = await signup(); // guard: signup works
    expectStatus(await account.client.get("/api/me"), 200); // guard: the session works

    const cookies = [...account.client.snapshot().values()];
    expect(cookies.length).toBeGreaterThan(0);
    for (const value of cookies) {
      expect(whereStored(value), "a session value was found in the database").toEqual([]);
    }

    const hashes = passwordHashes();
    expect(hashes.accepted).toBeGreaterThanOrEqual(1);
    expect(hashes.weakBcrypt).toBe(0);
    expect(whereStored(PASSWORD), "the password appears in clear text in the database").toEqual([]);
  });

  // api.yaml password-reset/confirm: single-use, ends every existing session; §6: reset token plaintext only in outbox.
  it("password reset is single-use, ends every existing session, and may only live in the outbox", async () => {
    const account = await signup(); // guard
    const other = await login(account.email); // a second live session
    expectStatus(await account.client.get("/api/me"), 200);
    expectStatus(await other.get("/api/me"), 200);

    const newPassword = "brand-new-password-7";
    // Always 202, even for an unknown address.
    expectStatus(await new Client().post("/api/auth/password-reset/request", { email: newEmail() }), 202);
    expectStatus(await account.client.post("/api/auth/password-reset/request", { email: account.email }), 202);
    const { token } = await outbox(account.email, "password_reset");

    const stored = whereStored(token);
    expect(stored.length).toBeGreaterThan(0);
    for (const table of stored) expect(table).toContain("outbox");

    expectStatus(
      await new Client().post("/api/auth/password-reset/confirm", { token, password: newPassword }),
      204,
    );
    // Every existing session stops working.
    expectError(await account.client.get("/api/me"), 401, "unauthenticated");
    expectError(await other.get("/api/me"), 401, "unauthenticated");
    // The new password works, the old one does not.
    expectStatus(await login(account.email, newPassword).then((c) => c.get("/api/me")), 200);
    expectError(
      await new Client().post("/api/auth/login", { email: account.email, password: PASSWORD }),
      401,
      "invalid_credentials",
    );
    // The token is single-use.
    expectError(
      await new Client().post("/api/auth/password-reset/confirm", { token, password: "another-password-9" }),
      400,
      "invalid_token",
    );
  });
});

describe("real mode", () => {
  // testability.md §6: /api/__test__/* must be 404 outside TEST_MODE.
  it("the test routes are 404 when TEST_MODE is not set", async () => {
    const mock = await MockModel.start(() => ({ content: "[]", promptTokens: 1, completionTokens: 1 }));
    try {
      await withInstance(realModeEnv(mock, { inputPerMTok: 1, outputPerMTok: 1 }, "k"), async (base) => {
        const client = new Client(base);
        expectStatus(await client.get("/api/health"), 200); // guard: the instance is up
        // Guard: a normal request of the real product is answered.
        expectStatus(
          await client.post("/api/auth/signup", { email: newEmail(), password: PASSWORD, name: "Real" }),
          201,
        );
        expectError(await client.get("/api/__test__/outbox?to=x@example.test"), 404, "not_found");
        expectError(await client.put("/api/__test__/fake-model", {}), 404, "not_found");
      });
    } finally {
      await mock.close();
    }
  });

  // testability.md §5.1: missing MODEL_PROVIDER or any required MODEL_* makes the process exit.
  it("real mode refuses to start when the model configuration is incomplete", async () => {
    const base = {
      MODEL_BASE_URL: "http://127.0.0.1:9/v1",
      MODEL_INPUT_USD_PER_MTOK: "1",
      MODEL_OUTPUT_USD_PER_MTOK: "1",
    };
    // No MODEL_PROVIDER at all.
    const noProvider = await launch({}, 20);
    expect(noProvider.healthy).toBe(false);
    // MODEL_PROVIDER=real but no API key.
    const noKey = await launch({ ...base, MODEL_PROVIDER: "real" }, 20);
    expect(noKey.healthy).toBe(false);
  });

  // testability.md §5.1: bearer key, model name, max_tokens on every call; §5.2: bill from usage, never overspend.
  it("real mode authenticates the model call, sets max_tokens, bills from usage, and respects the budget", async () => {
    const inputPerMTok = 2;
    const outputPerMTok = 10;
    const promptTokens = 100;
    const completionTokens = 50;
    const mock = await MockModel.start((req) =>
      req.callNo === 1
        ? { content: JSON.stringify(["q1", "q2", "q3"]), promptTokens, completionTokens }
        : { content: "Answer [1] with text.", promptTokens, completionTokens },
    );
    try {
      await withInstance(realModeEnv(mock, { inputPerMTok, outputPerMTok }, "real-secret-key"), async (base) => {
        const team = await teamAt(base);
        const doc = await addText(team.client, team.ws.id, SOLAR);
        const job = await startJob(team.client, team.ws.id, [doc.id]);
        await waitForJob(team.client, team.ws.id, job.id);

        expect(mock.requests.length).toBeGreaterThan(0);
        for (const req of mock.requests) {
          expect(req.headers.authorization).toBe("Bearer real-secret-key");
          expect(req.body.model).toBe("mock-model");
          expect(typeof req.cap).toBe("number");
          expect(req.cap).toBeGreaterThan(0);
        }

        const expected = mock.replies.reduce((s, r) => s + replyCostUsd(r, inputPerMTok, outputPerMTok), 0);
        const records = await usageRecords(team.client, team.ws.id, { jobId: job.id });
        const billed = records
          .filter((r) => r.kind === "chat" && r.status === "ok")
          .reduce((s, r) => s + r.costUsd, 0);
        expect(Math.abs(billed - expected)).toBeLessThan(1e-6);

        // A zero budget must not let the product send another call.
        expectStatus(await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 0 }), 200);
        const before = mock.requests.length;
        expectError(await startJob(team.client, team.ws.id, [doc.id]), 402, "budget_exceeded");
        expect(mock.requests.length).toBe(before);
      });
    } finally {
      await mock.close();
    }
  });
});
