import { describe, expect, it } from "vitest";
import { Q_REFUND, Q_UNKNOWN, REFUNDS } from "../../lib/corpus";
import {
  addMember,
  addText,
  expectError,
  expectStatus,
  isolateFakeModel,
  outbox,
  waitFor,
  mails,
} from "../../lib/helpers";
import { expectAnswered, supportTeam, visitor } from "../../lib/widget";

describe("S3 visitor feedback", () => {
  isolateFakeModel();

  it("lets a visitor rate the bot's answers, and nothing else", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);
    const v = await visitor(team.key);
    const { message } = await v.answer(Q_REFUND);
    expectAnswered(message);

    const up = await v.feedback(message.id, "up");
    expectStatus(up, 200);
    expect(up.body.message.id).toBe(message.id);
    expect(up.body.message.rating).toBe("up");
    const down = await v.feedback(message.id, "down");
    expectStatus(down, 200);
    expect(down.body.message.rating).toBe("down");
    const stored = await v.conversation();
    expect(stored.messages.find((m: any) => m.id === message.id)?.rating).toBe("down");

    expectError(await v.feedback(message.id, "meh"), 400, "validation_error");
    const question = stored.messages.find((m: any) => m.role === "user");
    expectError(await v.feedback(question.id, "up"), 400, "validation_error");
    // Another visitor cannot rate a message of this conversation through their own.
    const other = await visitor(team.key);
    expectError(await other.feedback(message.id, "down"), 404, "not_found");
  });
});

describe("S3 handoff to a person", () => {
  isolateFakeModel();

  it("hands a conversation to the team with the visitor's contact details", async () => {
    const team = await supportTeam();
    const member = await addMember(team, "member");
    await addText(team.client, team.ws.id, REFUNDS);
    const v = await visitor(team.key);
    await v.answer(Q_UNKNOWN);

    const res = await v.handoff({ name: "Mila Visitor", email: "mila.visitor@example.test", note: "Please call me back." });
    expectStatus(res, 201);
    expect(res.body.handoff.status).toBe("open");
    const handoffId = res.body.handoff.id;
    expect((await v.conversation()).conversation.status).toBe("handed_off");

    for (const who of [team.email, member.email]) {
      await waitFor(async () => (await mails(who, "handoff")).length > 0, { timeout: 10_000, what: `handoff email to ${who}` });
      const mail = await outbox(who, "handoff");
      expect(mail.data?.handoffId).toBe(handoffId);
      expect(mail.data?.conversationId).toBe(v.id);
    }

    const list = await member.client.get(`/api/workspaces/${team.ws.id}/handoffs`);
    expectStatus(list, 200);
    const listed = list.body.handoffs.find((h: any) => h.id === handoffId);
    expect(listed).toEqual(expect.objectContaining({ conversationId: v.id, status: "open", email: "mila.visitor@example.test", name: "Mila Visitor" }));

    const one = await member.client.get(`/api/workspaces/${team.ws.id}/handoffs/${handoffId}`);
    expectStatus(one, 200);
    expect(one.body.handoff.note).toBe("Please call me back.");
    expect(one.body.messages.map((m: any) => m.content)).toContain(Q_UNKNOWN);
    expect(one.body.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
  });

  it("takes a handoff without contact details, refuses a bad email, and allows one per conversation", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);
    const v = await visitor(team.key);
    await v.answer(Q_REFUND);

    expectError(await v.handoff({ email: "not an email" }), 400, "validation_error");
    const anonymous = await v.handoff({});
    expectStatus(anonymous, 201);
    expectError(await v.handoff({ email: "late@example.test" }), 409, "invalid_state");

    const list = await team.client.get(`/api/workspaces/${team.ws.id}/handoffs`);
    expectStatus(list, 200);
    const mine = list.body.handoffs.filter((h: any) => h.conversationId === v.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].email ?? null).toBeNull();
  });

  it("lets members resolve handoffs, and hides them from other workspaces", async () => {
    const team = await supportTeam();
    const member = await addMember(team, "member");
    const v = await visitor(team.key);
    const created = await v.handoff({ email: "who@example.test" });
    expectStatus(created, 201);
    const id = created.body.handoff.id;
    const base = `/api/workspaces/${team.ws.id}/handoffs`;
    expectStatus(await team.client.get(`${base}/${id}`), 200);

    const outsider = await supportTeam();
    expectError(await outsider.client.get(`${base}/${id}`), 404, "not_found");
    expectError(await outsider.client.get(`/api/workspaces/${outsider.ws.id}/handoffs/${id}`), 404, "not_found");
    expectError(await outsider.client.patch(`/api/workspaces/${outsider.ws.id}/handoffs/${id}`, { status: "resolved" }), 404, "not_found");

    const resolved = await member.client.patch(`${base}/${id}`, { status: "resolved" });
    expectStatus(resolved, 200);
    expect(resolved.body.handoff.status).toBe("resolved");
    expectError(await member.client.patch(`${base}/${id}`, { status: "closed-ish" }), 400, "validation_error");

    const open = await team.client.get(`${base}?status=open`);
    expectStatus(open, 200);
    expect(open.body.handoffs.map((h: any) => h.id)).not.toContain(id);
    const done = await team.client.get(`${base}?status=resolved`);
    expectStatus(done, 200);
    expect(done.body.handoffs.map((h: any) => h.id)).toContain(id);
  });
});
