// Held-out acceptance tests: what the product keeps at rest.
//
// Contract source: brief/contract/testability.md §9:
//   - "the business data (users, workspaces, material, conversations, usage, ...) must live in the
//     Postgres that DATABASE_URL points at. The acceptance first confirms that the email of a newly
//     registered user appears in that database";
//   - "session tokens, invitation tokens, password reset tokens and visitor tokens may only be
//     stored hashed. The acceptance searches all schemas and all tables (text columns, JSON, byte
//     columns) for the plain text of the token taken from the cookie and from the outbox. Only a
//     table whose name contains `outbox` may hold invitation tokens and reset tokens; session
//     tokens and visitor tokens may not be plain text in any table, not even in the outbox.";
//   - "passwords are stored with argon2id, or bcrypt with a cost of at least 12, as a text column
//     ... both the registration and the password reset write paths must satisfy this; any bcrypt
//     hash with a cost below 12 in the database is a failure. No plain text password may appear
//     anywhere in the database (including the outbox)."

import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { passwordHashes, whereStored } from "../../lib/db";
import { expectStatus, invite, newEmail, outbox, signup } from "../../lib/helpers";
import { Visitor, supportTeam } from "../../lib/widget";

const isOutbox = (table: string) => /outbox/i.test(table);

describe("holdout: what is stored", () => {
  it("keeps the session token and the visitor token out of the database in plain text", async () => {
    // Contract: testability §9 - session tokens and visitor tokens are only stored hashed.
    const account = await signup();
    const cookies = [...account.client.snapshot().values()].filter((v) => v.length >= 12);
    expect(cookies.length, "no session cookie was handed out").toBeGreaterThan(0);
    for (const value of cookies) {
      expect(whereStored(value), "the session token was stored in plain text").toEqual([]);
    }

    const team = await supportTeam();
    const visitor = await new Visitor(team.key).start();
    expect(visitor.token.length).toBeGreaterThanOrEqual(16);
    expect(whereStored(visitor.token), "the visitor token was stored in plain text").toEqual([]);
  });

  it("keeps the invitation and reset tokens in the outbox only, and the passwords hashed", async () => {
    // Contract: testability §9 - only a table whose name contains "outbox" may hold invitation and
    // reset tokens; the passwords are argon2id or bcrypt with a cost of at least 12, on both write
    // paths, and never in plain text.
    const account = await signup();

    const hashes = passwordHashes();
    expect(hashes.accepted, "no argon2id or bcrypt(cost >= 12) password hash was found").toBeGreaterThanOrEqual(1);
    expect(hashes.weakBcrypt, "a bcrypt hash with a cost below 12 was found").toBe(0);
    expect(whereStored(account.password), "the password was stored in plain text").toEqual([]);

    // The reset path writes a password of the same quality.
    await new Client().post("/api/auth/password-reset/request", { email: account.email });
    const mail = await outbox(account.email, "password_reset");
    const newPassword = "another-strong-passphrase-7";
    expectStatus(
      await new Client().post("/api/auth/password-reset/confirm", { token: mail.token, password: newPassword }),
      204,
    );
    const after = passwordHashes();
    expect(after.weakBcrypt, "the reset wrote a bcrypt hash with a cost below 12").toBe(0);
    expect(whereStored(newPassword), "the new password was stored in plain text").toEqual([]);
    expect(whereStored(account.password), "the old password was kept in plain text").toEqual([]);

    // The tokens of the invitation and of the reset live in the outbox, nowhere else.
    const team = await supportTeam();
    const guest = newEmail("guest");
    const invitation = await invite(team.client, team.ws.id, guest, "member");
    for (const token of [String(invitation), String(mail.token)]) {
      const hits = whereStored(token);
      expect(
        hits.filter((table) => !isOutbox(table)),
        "the token was stored in a table that is not an outbox",
      ).toEqual([]);
    }

    // And the business data really is in the database.
    const users = whereStored(account.email);
    expect(users.length, "the new user was not stored in the database").toBeGreaterThan(0);
    expect(users.some((table) => !isOutbox(table)), "the user is only in the outbox").toBe(true);
  });
});
