import { describe, expect, it } from "vitest";
import { PASSWORD, expectStatus, invite, newEmail, outbox, owner, signup } from "../../lib/helpers";
import { Client } from "../../lib/client";
import { countAcceptedPasswordHashes, whereStored } from "../../lib/db";

// The only table that may hold a token in plain text is the test-mode mailbox behind
// GET /api/__test__/outbox (spec/architecture.md §6): its name contains "outbox".
const allowedPlain = (table: string) => /outbox/i.test(table);

/** Pieces of a cookie value that are long enough to be a credential. */
function credentialPieces(value: string): string[] {
  const decoded = decodeURIComponent(value);
  return [decoded, ...decoded.split(/[.:]/)].filter((piece, i, all) => piece.length >= 20 && all.indexOf(piece) === i);
}

describe("S1 secrets at rest", () => {
  it("keeps the product's data in the database it was given", async () => {
    // Guard for the two tests below: they look for secrets in DATABASE_URL, which proves nothing
    // unless the product really stores its data there (spec/architecture.md §3).
    const account = await signup();
    const where = whereStored(account.email);
    expect(
      where,
      "the new user's email is not in the database the runner gave the product (DATABASE_URL): business data must live there",
    ).not.toEqual([]);
  });

  it("never stores session, invitation or reset tokens, or passwords, in plain text", async () => {
    const team = await owner();
    expect(whereStored(team.email), "guard: the product's data must be in DATABASE_URL").not.toEqual([]);

    // A second session for the same user, so both cookies are in play.
    const second = new Client();
    expectStatus(await second.post("/api/auth/login", { email: team.email, password: PASSWORD }), 200);

    const invited = newEmail("invitee");
    const invitationToken = await invite(team.client, team.ws.id, invited, "member");
    expectStatus(await new Client().post("/api/auth/password-reset/request", { email: team.email }), 202);
    const resetToken = (await outbox(team.email, "password_reset")).token;

    const secrets: { what: string; value: string }[] = [
      { what: "invitation token", value: invitationToken },
      { what: "password reset token", value: resetToken },
    ];
    for (const client of [team.client, second]) {
      for (const value of client.snapshot().values()) {
        for (const piece of credentialPieces(value)) secrets.push({ what: "session cookie", value: piece });
      }
    }
    expect(secrets.filter((s) => s.what === "session cookie").length, "no session cookie was set").toBeGreaterThan(0);

    for (const { what, value } of secrets) {
      expect(whereStored(value, allowedPlain), `the ${what} is stored in plain text`).toEqual([]);
    }
    expect(whereStored(PASSWORD), "the password is stored in plain text, even in the mailbox").toEqual([]);
  });

  it("hashes passwords with argon2id or bcrypt", async () => {
    await signup();
    expect(
      countAcceptedPasswordHashes(),
      "no stored value looks like an argon2id or bcrypt hash ($argon2id$… or $2a$/$2b$/$2y$…), stored as text",
    ).toBeGreaterThan(0);
  });
});
