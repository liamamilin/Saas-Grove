// Held-out acceptance tests: the money - what the model calls cost and what the budget does.
//
// Contract source:
//   brief/contract/testability.md §5: "when the knowledge base has `ready` chunks, every visitor
//   question makes exactly 1 chat call (stage: "answer", retries are not new calls) ... an empty
//   knowledge base, or a budget that cannot pay, makes 0. Every attempt records its own usage."
//   "the cost of each successful chat call is FAKE_CHAT_CALL_COST_USD (default 0.01); failed
//   attempts are recorded as status: "error", costUsd: 0." "Every record of kind "chat" (failed
//   attempts included) must carry stage: "answer", conversationId and messageId."
//   brief/contract/api.yaml, POST .../messages: "A retryable model error is retried: at most 3
//   attempts per call, waiting at least 200 ms before the second attempt and at least twice that
//   before the third; a non-retryable error is not retried. Every attempt leaves its own usage
//   record, timestamped when the attempt started." "when this month's budget cannot pay for the
//   call (then the model is not called at all)" -> the fallback answer.
//   PUT /api/workspaces/{ws}/budget: "Admin or owner. null means unlimited. A new workspace starts
//   at 10." "The budget is a hard stop: spending in a month never exceeds it ... Before each model
//   call the product reserves the most that call can cost; the call is made only if spent +
//   reserved + this reservation <= budget." "Every owner and admin (not members) gets a
//   budget_warning email when this month's spend first reaches 80% of the budget (spent x 5 >= budget
//   x 4), and a budget_exhausted email the first time a question is refused for lack of budget.
//   Each kind is sent at most once per calendar month (UTC)."

import { describe, expect, it } from "vitest";
import {
  CALL_COST,
  addMember,
  expectError,
  expectStatus,
  fakeModel,
  isolateFakeModel,
  knowledgeBase,
  mails,
  setBudget,
  usageRecords,
} from "../../lib/helpers";
import { Visitor, expectAnswered, expectUnanswered, supportTeam } from "../../lib/widget";
import { Q_REFUND } from "../../lib/corpus";

isolateFakeModel();

describe("holdout: usage and budget", () => {
  it("books exactly one model call per question", async () => {
    // Contract: testability §5 - "exactly 1 chat call" per question, every chat record with
    // stage "answer", conversationId and messageId, cost FAKE_CHAT_CALL_COST_USD.
    const team = await supportTeam();
    await knowledgeBase(team.client, team.ws.id);
    const visitor = await new Visitor(team.key).start();

    const answer = await visitor.answer(Q_REFUND);
    expectAnswered(answer.message);

    const calls = await usageRecords(team.client, team.ws.id, { conversationId: visitor.id });
    const chats = calls.filter((r: any) => r.kind === "chat");
    expect(chats.length).toBe(1);
    expect(chats[0].status).toBe("ok");
    expect(chats[0].stage).toBe("answer");
    expect(chats[0].conversationId).toBe(visitor.id);
    expect(chats[0].messageId).toBe(answer.message.id);
    expect(chats[0].costUsd).toBeCloseTo(CALL_COST, 10);

    const usage = await team.client.get(`/api/workspaces/${team.ws.id}/usage`);
    expectStatus(usage, 200);
    expect(usage.body?.spentUsd).toBeCloseTo(CALL_COST, 10);
    expect(Number.isNaN(Date.parse(String(usage.body?.periodStart ?? "")))).toBe(false);
    expect(Number.isNaN(Date.parse(String(usage.body?.periodEnd ?? "")))).toBe(false);
  });

  it("retries a retryable model error at most three times, and never retries a permanent one", async () => {
    // Contract: "A retryable model error is retried: at most 3 attempts per call, waiting at least
    // 200 ms before the second attempt and at least twice that before the third; a non-retryable
    // error is not retried. Every attempt leaves its own usage record, timestamped when the attempt
    // started."
    const team = await supportTeam();
    await knowledgeBase(team.client, team.ws.id);
    const visitor = await new Visitor(team.key).start();

    await fakeModel.set({ faults: [{ stage: "answer", mode: "transient", times: 2 }] });
    const answered = await visitor.answer(Q_REFUND);
    expectAnswered(answered.message);

    const retried = (await usageRecords(team.client, team.ws.id, { conversationId: visitor.id })).filter(
      (r: any) => r.kind === "chat",
    );
    expect(retried.length).toBe(3);
    expect(retried.filter((r: any) => r.status === "error").length).toBe(2);
    expect(retried.filter((r: any) => r.status === "ok").length).toBe(1);
    expect(retried.filter((r: any) => r.status === "error").every((r: any) => r.costUsd === 0)).toBe(true);
    expect(retried.every((r: any) => r.stage === "answer" && r.conversationId === visitor.id)).toBe(true);

    // The attempts are spread out: at least 200 ms before the second, twice that before the third.
    const times = retried.map((r: any) => Date.parse(String(r.createdAt))).sort((a: number, b: number) => a - b);
    expect(times[1] - times[0], "the second attempt came too early").toBeGreaterThanOrEqual(190);
    expect(times[2] - times[1], "the third attempt came too early").toBeGreaterThanOrEqual(380);

    // A permanent error is not retried: one attempt, and the visitor gets the fallback.
    await fakeModel.set({ faults: [{ stage: "answer", mode: "permanent" }] });
    const other = await new Visitor(team.key).start();
    const failed = await other.answer(Q_REFUND);
    expectUnanswered(failed.message, team.widget.fallbackMessage);

    const once = (await usageRecords(team.client, team.ws.id, { conversationId: other.id })).filter(
      (r: any) => r.kind === "chat",
    );
    expect(once.length).toBe(1);
    expect(once[0].status).toBe("error");
    expect(once[0].costUsd).toBe(0);

    // The team sees why the answer is missing.
    const conversation = await team.client.get(`/api/workspaces/${team.ws.id}/conversations/${other.id}`);
    expectStatus(conversation, 200);
    const assistant = (conversation.body?.messages ?? []).find((m: any) => m.role === "assistant");
    expect(String(assistant?.reason ?? "")).toBe("model_error");
  });

  it("stops at the budget and tells the owners once", async () => {
    // Contract: PUT budget -> "Admin or owner. null means unlimited. A new workspace starts at 10";
    // "The budget is a hard stop: spending in a month never exceeds it"; "a budget_exhausted email
    // the first time a question is refused for lack of budget", sent to "every owner and admin (not
    // members)".
    const team = await supportTeam();
    const admin = await addMember(team, "admin");
    const member = await addMember(team, "member");
    await knowledgeBase(team.client, team.ws.id);

    const usage = await team.client.get(`/api/workspaces/${team.ws.id}/usage`);
    expectStatus(usage, 200);
    expect(usage.body?.budgetUsd).toBe(10);

    expectError(await member.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 1 }), 403, "forbidden");
    expectError(await admin.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: -1 }), 400, "validation_error");
    const set = await admin.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 0.01 });
    expectStatus(set, 200);
    expect(set.body?.budgetUsd).toBeCloseTo(0.01, 10);

    const visitor = await new Visitor(team.key).start();
    const first = await visitor.answer(Q_REFUND);
    expectAnswered(first.message);

    // The next question cannot be paid for: the model is not called at all.
    const second = await visitor.answer(Q_REFUND);
    expectUnanswered(second.message, team.widget.fallbackMessage);

    const calls = (await usageRecords(team.client, team.ws.id, { conversationId: visitor.id })).filter(
      (r: any) => r.kind === "chat" && r.status === "ok",
    );
    expect(calls.length, "the model was called although the budget was gone").toBe(1);

    const after = await team.client.get(`/api/workspaces/${team.ws.id}/usage`);
    expect(after.body?.spentUsd).toBeLessThanOrEqual(0.01);

    const conversation = await team.client.get(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`);
    expectStatus(conversation, 200);
    const assistant = (conversation.body?.messages ?? []).filter((m: any) => m.role === "assistant").pop();
    expect(String(assistant?.reason ?? "")).toBe("budget_exceeded");

    // The owners and admins are told once; the members are not.
    expect((await mails(team.email, "budget_exhausted")).length).toBe(1);
    expect((await mails(admin.email, "budget_exhausted")).length).toBe(1);
    expect((await mails(member.email, "budget_exhausted")).length).toBe(0);
  });

  it("warns the owners once when the spend reaches eighty per cent of the budget", async () => {
    // Contract: "Every owner and admin (not members) gets a budget_warning email when this month's
    // spend first reaches 80% of the budget (spent x 5 >= budget x 4) ... Each kind is sent at most
    // once per calendar month (UTC), even if the budget is changed during the month."
    const team = await supportTeam();
    const admin = await addMember(team, "admin");
    const member = await addMember(team, "member");
    await knowledgeBase(team.client, team.ws.id);
    await setBudget(team.client, team.ws.id, 0.1);

    const visitor = await new Visitor(team.key).start();
    for (let i = 0; i < 9; i += 1) {
      await visitor.answer(Q_REFUND);
    }

    const warnings = await mails(team.email, "budget_warning");
    expect(warnings.length, "the owners were not warned about the budget").toBe(1);
    expect((await mails(admin.email, "budget_warning")).length).toBe(1);
    expect((await mails(member.email, "budget_warning")).length).toBe(0);
  });
});
