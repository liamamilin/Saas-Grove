import { describe, expect, it } from "vitest";
import { Q_REFUND, Q_UNKNOWN, Q_WARRANTY, REFUNDS } from "../../lib/corpus";
import {
  CALL_COST,
  EPS,
  addMember,
  addText,
  answerCalls,
  expectError,
  expectStatus,
  fakeModel,
  isolateFakeModel,
  knowledgeBase,
  usageRecords,
} from "../../lib/helpers";
import { supportTeam, visitor } from "../../lib/widget";

const sum = (records: any[]) => records.reduce((t, r) => t + r.costUsd, 0);

describe("S3 usage accounting", () => {
  isolateFakeModel();

  it("records every answer call with its cost, and sums it against a default budget", async () => {
    const team = await supportTeam();
    await knowledgeBase(team.client, team.ws.id);
    const v = await visitor(team.key);
    const answers: any[] = [];
    for (const q of [Q_REFUND, Q_WARRANTY, Q_UNKNOWN]) answers.push((await v.answer(q)).message);

    const calls = await answerCalls(team.client, team.ws.id, "ok", v.id);
    expect(calls).toHaveLength(3);
    for (const r of calls) {
      expect(r.stage).toBe("answer");
      expect(r.conversationId).toBe(v.id);
      expect(Math.abs(r.costUsd - CALL_COST)).toBeLessThan(EPS);
    }
    expect(calls.map((r) => r.messageId).sort()).toEqual(answers.map((m) => m.id).sort());

    const usage = await team.client.get(`/api/workspaces/${team.ws.id}/usage`);
    expectStatus(usage, 200);
    expect(Math.abs(usage.body.spentUsd - sum(await usageRecords(team.client, team.ws.id)))).toBeLessThan(EPS);
    expect(Math.abs(usage.body.spentUsd - 3 * CALL_COST)).toBeLessThan(EPS);
    // A public widget can spend money from the first day, so a new workspace starts with a cap (decisions H9).
    expect(usage.body.budgetUsd).toBe(10);
    expect(Date.parse(usage.body.periodStart)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(usage.body.periodEnd)).toBeGreaterThan(Date.now());
  });

  it("records failed calls without charging for them", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);
    await fakeModel.set({ faults: [{ stage: "answer", mode: "transient", times: 2 }] });
    const v = await visitor(team.key);
    await v.answer(Q_REFUND);

    const records = (await usageRecords(team.client, team.ws.id, { conversationId: v.id })).filter((r) => r.kind === "chat");
    const errors = records.filter((r) => r.status === "error");
    expect(errors).toHaveLength(2);
    for (const r of errors) expect(r.costUsd).toBe(0);
    expect(Math.abs(sum(records) - CALL_COST)).toBeLessThan(EPS);
  });

  it("keeps usage private to the workspace, and from removed members", async () => {
    const a = await supportTeam();
    const member = await addMember(a, "member");
    await addText(a.client, a.ws.id, REFUNDS);
    const v = await visitor(a.key);
    await v.answer(Q_REFUND);
    expect((await usageRecords(a.client, a.ws.id, { conversationId: v.id })).length).toBeGreaterThan(0);
    expectStatus(await member.client.get(`/api/workspaces/${a.ws.id}/usage`), 200);

    const b = await supportTeam();
    expectError(await b.client.get(`/api/workspaces/${a.ws.id}/usage`), 404, "not_found");
    expectError(await b.client.get(`/api/workspaces/${a.ws.id}/usage/records`), 404, "not_found");
    expect(await usageRecords(b.client, b.ws.id, { conversationId: v.id })).toEqual([]);

    expectStatus(await a.client.del(`/api/workspaces/${a.ws.id}/members/${member.user.id}`), 204);
    expectError(await member.client.get(`/api/workspaces/${a.ws.id}/usage`), 404, "not_found");
  });

  it("lets only admins and owners set the budget", async () => {
    const team = await supportTeam();
    const admin = await addMember(team, "admin");
    const member = await addMember(team, "member");
    const url = `/api/workspaces/${team.ws.id}/budget`;

    expectError(await member.client.put(url, { monthlyUsd: 1 }), 403, "forbidden");
    const set = await admin.client.put(url, { monthlyUsd: 1.5 });
    expectStatus(set, 200);
    expect(set.body.budgetUsd).toBe(1.5);
    expect((await member.client.get(`/api/workspaces/${team.ws.id}/usage`)).body.budgetUsd).toBe(1.5);

    const cleared = await team.client.put(url, { monthlyUsd: null });
    expectStatus(cleared, 200);
    expect(cleared.body.budgetUsd).toBeNull();
    expectError(await team.client.put(url, { monthlyUsd: -1 }), 400, "validation_error");
  });
});
