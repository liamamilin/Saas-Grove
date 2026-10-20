import { describe, expect, it } from "vitest";
import { Q_REFUND, Q_UNKNOWN, REFUNDS } from "../../lib/corpus";
import { addMember, addText, expectError, expectStatus, isolateFakeModel } from "../../lib/helpers";
import { expectAnswered, supportTeam, visitor } from "../../lib/widget";

describe("S4 conversations", () => {
  isolateFakeModel();

  it("shows the team every conversation with its transcript", async () => {
    const team = await supportTeam();
    const member = await addMember(team, "member");
    await addText(team.client, team.ws.id, REFUNDS);
    const v = await visitor(team.key);
    const answered = (await v.answer(Q_REFUND)).message;
    expectAnswered(answered);
    await v.answer(Q_UNKNOWN);

    const list = await member.client.get(`/api/workspaces/${team.ws.id}/conversations`);
    expectStatus(list, 200);
    expect(list.body.conversations.find((c: any) => c.id === v.id)).toEqual(
      expect.objectContaining({ status: "open", questionCount: 2, unansweredCount: 1 }),
    );

    const one = await member.client.get(`/api/workspaces/${team.ws.id}/conversations/${v.id}`);
    expectStatus(one, 200);
    const messages = one.body.messages;
    expect(messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages[1].id).toBe(answered.id);
    expect(messages[1].citations.length).toBeGreaterThan(0);
    expect(messages[1].reason ?? null).toBeNull();
    expect(messages[3]).toEqual(expect.objectContaining({ outcome: "unanswered", reason: "no_answer" }));

    const outsider = await supportTeam();
    expectError(await outsider.client.get(`/api/workspaces/${team.ws.id}/conversations/${v.id}`), 404, "not_found");
    expectError(await outsider.client.get(`/api/workspaces/${outsider.ws.id}/conversations/${v.id}`), 404, "not_found");
  });

  it("forgets a conversation when an admin deletes it", async () => {
    const team = await supportTeam();
    const member = await addMember(team, "member");
    const admin = await addMember(team, "admin");
    await addText(team.client, team.ws.id, REFUNDS);
    const v = await visitor(team.key);
    await v.answer(Q_REFUND);
    expectStatus(await v.handoff({ email: "forget.me@example.test" }), 201);
    const url = `/api/workspaces/${team.ws.id}/conversations/${v.id}`;
    expectStatus(await member.client.get(url), 200);

    expectError(await member.client.del(url), 403, "forbidden");
    expectStatus(await admin.client.del(url), 204);

    expectError(await team.client.get(url), 404, "not_found");
    const list = await team.client.get(`/api/workspaces/${team.ws.id}/conversations`);
    expect(list.body.conversations.map((c: any) => c.id)).not.toContain(v.id);
    const questions = await team.client.get(`/api/workspaces/${team.ws.id}/analytics/questions`);
    expectStatus(questions, 200);
    expect(questions.body.questions.map((q: any) => q.conversationId)).not.toContain(v.id);
    const handoffs = await team.client.get(`/api/workspaces/${team.ws.id}/handoffs`);
    expectStatus(handoffs, 200);
    expect(handoffs.body.handoffs.map((h: any) => h.conversationId)).not.toContain(v.id);
    // The visitor's token no longer opens it either.
    expectError(await v.request("GET", `/conversations/${v.id}`), 404, "not_found");
  });
});
