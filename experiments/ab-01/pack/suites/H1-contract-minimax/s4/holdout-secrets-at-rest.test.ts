// Acceptance stage S4 — secrets at rest (testability.md §9).
//
// Each test reads the live database through `lib/db.ts` to verify the
// product stores secrets the way the contract requires:
//   - The freshly signed-up user's email appears in some non-outbox
//     table in the runner-provided database.
//   - Passwords are stored as argon2id or bcrypt with cost ≥ 12; no
//     bcrypt cost below 12 anywhere; plaintext passwords nowhere.
//   - Invitation tokens are stored cleartext only in tables whose
//     name contains "outbox".
//   - The same is true for password-reset tokens.

import { describe, expect, test } from "vitest";
import { passwordHashes, whereStored } from "../../lib/db";
import {
  PASSWORD,
  expectStatus,
  outbox,
  signup,
  uid,
} from "../../lib/helpers";

const REAL_PASSWORD = PASSWORD;

describe("holdout: secrets at rest (testability.md §9)", () => {
  test("the freshly signed-up user's email appears in the runner's database (testability.md §9 — 验收确认新注册用户的邮箱出现在这个库里)", async () => {
    const acc = await signup();
    expectStatus(await acc.client.post("/api/workspaces", { name: `Sec-${uid()}` }), 201);
    const hits = whereStored(acc.email);
    expect(
      hits.length,
      `email ${acc.email} must appear in some table; got: ${JSON.stringify(hits)}`,
    ).toBeGreaterThan(0);
  });

  test("passwords are stored as argon2id or bcrypt cost ≥ 12; never as plaintext; no low-cost bcrypt anywhere (testability.md §9)", async () => {
    await signup();
    const { accepted, weakBcrypt } = passwordHashes();
    expect(weakBcrypt, "no bcrypt cost < 12 anywhere").toBe(0);
    expect(accepted, "at least one accepted password hash for our signup").toBeGreaterThanOrEqual(1);
    const plaintextHits = whereStored(REAL_PASSWORD);
    expect(
      plaintextHits,
      `plaintext password must not be stored anywhere; found in: ${JSON.stringify(plaintextHits)}`,
    ).toEqual([]);
  });

  test("invitation tokens and password-reset tokens are stored in clear text only in tables whose name contains \"outbox\" (testability.md §9)", async () => {
    // Invitation: invite a candidate and capture the token from the outbox.
    const owner = await signup();
    const wsRes = await owner.client.post("/api/workspaces", { name: `Inv-${uid()}` });
    expectStatus(wsRes, 201);
    const wsId = wsRes.body.workspace.id;
    const candidate = await signup();
    const helpers = await import("../../lib/helpers");
    const inviteToken = await helpers.invite(owner.client, wsId, candidate.email, "member");
    expect(typeof inviteToken, "invite token is a string").toBe("string");
    expect(inviteToken.length).toBeGreaterThan(8);
    const inviteHits = whereStored(inviteToken);
    expect(inviteHits.length, "invitation token must be persisted (in outbox)").toBeGreaterThanOrEqual(1);
    for (const loc of inviteHits) {
      expect(
        loc.toLowerCase().includes("outbox"),
        `invitation token plaintext must live only in an "outbox" table; found in ${loc}`,
      ).toBe(true);
    }

    // Password reset: request one and capture the token.
    const resetUser = await signup();
    expectStatus(
      await new (await import("../../lib/client")).Client().post(
        "/api/auth/password-reset/request",
        { email: resetUser.email },
      ),
      202,
    );
    const msg = await outbox(resetUser.email, "password_reset");
    const resetToken = msg.token;
    expect(resetToken.length).toBeGreaterThan(8);
    const resetHits = whereStored(resetToken);
    expect(resetHits.length, "reset token must be persisted (in outbox)").toBeGreaterThanOrEqual(1);
    for (const loc of resetHits) {
      expect(
        loc.toLowerCase().includes("outbox"),
        `reset token plaintext must live only in an "outbox" table; found in ${loc}`,
      ).toBe(true);
    }
  });
});
