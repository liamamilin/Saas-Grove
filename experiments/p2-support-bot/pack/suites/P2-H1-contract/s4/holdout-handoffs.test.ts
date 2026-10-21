// Held-out acceptance tests: asking for a human.
//
// Contract source:
//   brief/contract/api.yaml, POST /api/widget/{key}/conversations/{id}/handoff: "Ask for a person.
//   Contact details are optional; an email, if given, must be valid." "Creates an open handoff for
//   the conversation, sets the conversation's status to `handed_off`, and sends a `handoff` email to
//   every member of the workspace. A conversation has at most one handoff: asking again gives 409
//   invalid_state. The bot keeps answering questions in a handed-off conversation."
//   GET /api/workspaces/{ws}/handoffs: "Any member. Newest first."; GET .../handoffs/{id}: "Any
//   member. The handoff and the whole conversation, oldest message first."; PATCH .../handoffs/{id}:
//   "Any member. Mark resolved (or reopen)."
//   brief/contract/testability.md §6: the handoff email carries data { handoffId, conversationId }.

import { describe, expect, it } from "vitest";
import { addMember, expectError, expectStatus, knowledgeBase, mails } from "../../lib/helpers";
import { Visitor, supportTeam } from "../../lib/widget";
import { Q_REFUND } from "../../lib/corpus";

describe("holdout: handoffs", () => {
  it("creates an open handoff, hands the conversation over and tells every member", async () => {
    // Contract: POST .../handoff -> 201 { handoff: { id, status: "open" } }; the conversation's
    // status becomes "handed_off"; a "handoff" email goes to every member of the workspace.
    const team = await supportTeam();
    const member = await addMember(team, "member");
    const visitor = await new Visitor(team.key).start();

    const res = await visitor.handoff({ name: "Ada", email: "ada@example.test", note: "My lamp is broken." });
    expectStatus(res, 201);
    const handoffId = String(res.body?.handoff?.id ?? "");
    expect(handoffId).not.toBe("");
    expect(res.body?.handoff?.status).toBe("open");
    expect(String(res.body?.handoff?.createdAt ?? "")).not.toBe("");

    const conversation = await visitor.conversation();
    expect(conversation.conversation.status).toBe("handed_off");

    for (const address of [team.email, member.email]) {
      const sent = await mails(address, "handoff");
      expect(sent.length, `no handoff email to ${address}`).toBe(1);
      expect(String(sent[0].data?.handoffId ?? "")).toBe(handoffId);
      expect(String(sent[0].data?.conversationId ?? "")).toBe(visitor.id);
    }
  });

  it("allows only one handoff per conversation and refuses a broken email", async () => {
    // Contract: "A conversation has at most one handoff: asking again gives 409 invalid_state";
    // "an email, if given, must be valid" -> 400.
    const team = await supportTeam();
    const visitor = await new Visitor(team.key).start();

    expectStatus(await visitor.handoff({ name: "Ada", email: "ada@example.test" }), 201);
    expectError(await visitor.handoff({ name: "Ada again" }), 409, "invalid_state");

    const other = await new Visitor(team.key).start();
    expectError(await other.handoff({ email: "not-an-address" }), 400, "validation_error");
  });

  it("lets the team read, resolve and reopen the handoffs", async () => {
    // Contract: GET handoffs "Newest first", GET handoff/{id} with "the whole conversation, oldest
    // message first", PATCH handoff/{id} "Mark resolved (or reopen)"; the bot keeps answering.
    const team = await supportTeam();
    await knowledgeBase(team.client, team.ws.id);
    const visitor = await new Visitor(team.key).start();
    const asked = await visitor.answer(Q_REFUND);
    expectStatus(await visitor.handoff({ name: "Ada", email: "ada@example.test" }), 201);

    const list = await team.client.get(`/api/workspaces/${team.ws.id}/handoffs`);
    expectStatus(list, 200);
    const handoffs = list.body?.handoffs ?? [];
    expect(handoffs.length).toBe(1);
    expect(handoffs[0].status).toBe("open");
    expect(String(handoffs[0].conversationId ?? "")).toBe(visitor.id);

    const open = await team.client.get(`/api/workspaces/${team.ws.id}/handoffs?status=open`);
    expectStatus(open, 200);
    expect((open.body?.handoffs ?? []).length).toBe(1);

    const resolved = await team.client.patch(`/api/workspaces/${team.ws.id}/handoffs/${handoffs[0].id}`, {
      status: "resolved",
    });
    expectStatus(resolved, 200);
    expect(resolved.body?.handoff?.status).toBe("resolved");

    const stillOpen = await team.client.get(`/api/workspaces/${team.ws.id}/handoffs?status=open`);
    expect((stillOpen.body?.handoffs ?? []).length).toBe(0);
    const nowResolved = await team.client.get(`/api/workspaces/${team.ws.id}/handoffs?status=resolved`);
    expect((nowResolved.body?.handoffs ?? []).length).toBe(1);

    const one = await team.client.get(`/api/workspaces/${team.ws.id}/handoffs/${handoffs[0].id}`);
    expectStatus(one, 200);
    expect(one.body?.handoff?.id).toBe(handoffs[0].id);
    const messages = one.body?.messages ?? [];
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe(Q_REFUND);

    expectError(
      await team.client.patch(`/api/workspaces/${team.ws.id}/handoffs/${handoffs[0].id}`, { status: "maybe" }),
      400,
      "validation_error",
    );

    // The bot keeps answering in a handed-off conversation.
    const answered = await visitor.answer(Q_REFUND);
    expect(answered.message.outcome).toBe("answered");
    expect(asked.message.outcome).toBe("answered");
  });
});
