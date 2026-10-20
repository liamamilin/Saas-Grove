// Acceptance stage S4 — chat budget enforcement and message visibility.
//
// Derived from:
//   api.yaml POST /reports/{id}/messages — "If the budget is already
//     exhausted the response is a plain 402 budget_exceeded JSON error
//     instead of a stream."
//   api.yaml GET /reports/{id}/messages — returns user and assistant
//     messages in chronological order.
//   api.yaml §workspaces/{ws} general rule — "404 not_found when the
//     caller is not a member."

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Client } from "../../lib/client";
import { COFFEE, SOLAR } from "../../lib/corpus";
import {
  addMember,
  addText,
  expectError,
  expectStatus,
  fakeModel,
  isolateFakeModel,
  signup,
  startJob,
  uid,
  usageRecords,
  waitForJob,
} from "../../lib/helpers";

const LATENCY = 60;

async function boot() {
  const owner = await signup();
  const ws = await owner.client.post("/api/workspaces", { name: `CB-${uid()}` });
  expectStatus(ws, 201);
  return { owner, ws: ws.body.workspace };
}

async function makeReport(c: Client, wsId: string) {
  const d1 = await addText(c, wsId, SOLAR);
  const d2 = await addText(c, wsId, COFFEE);
  const job = await startJob(c, wsId, [d1.id, d2.id]);
  const done = await waitForJob(c, wsId, job.id);
  expect(done.status, JSON.stringify(done.error)).toBe("succeeded");
  return done.reportId!;
}

describe("holdout: chat budget & access (api.yaml chat + budget + visibility)", () => {
  beforeEach(() => fakeModel.set({ latencyMs: LATENCY }));
  afterEach(() => fakeModel.reset());
  isolateFakeModel();

  test("with budget=0 every chat request is refused with a plain 402 budget_exceeded JSON (no SSE stream) (api.yaml chat POST description)", async () => {
    const { owner, ws } = await boot();
    const reportId = await makeReport(owner.client, ws.id);
    expectStatus(await owner.client.put(`/api/workspaces/${ws.id}/budget`, { monthlyUsd: 0 }), 200);

    const sse = await owner.client.sse(
      `/api/workspaces/${ws.id}/reports/${reportId}/messages`,
      { content: "I want to ask something" },
    );
    expect(sse.status).toBe(402);
    expect(sse.headers.get("content-type") ?? "").not.toContain("text/event-stream");
    expect(sse.body?.error?.code).toBe("budget_exceeded");
    expect(sse.events.length).toBe(0);

    const records = await usageRecords(owner.client, ws.id, { reportId });
    const chats = records.filter((r) => r.kind === "chat" && r.reportId === reportId);
    expect(chats.length, "no chat usage when budget=0").toBe(0);
  });

  test("setting budget back to null restores unlimited chat and a follow-up arrives in full (api.yaml §budget — null means unlimited)", async () => {
    const { owner, ws } = await boot();
    const reportId = await makeReport(owner.client, ws.id);
    expectStatus(await owner.client.put(`/api/workspaces/${ws.id}/budget`, { monthlyUsd: 0 }), 200);
    const blocked = await owner.client.sse(
      `/api/workspaces/${ws.id}/reports/${reportId}/messages`,
      { content: "Will this send?" },
    );
    expect(blocked.status).toBe(402);
    const restore = await owner.client.put(`/api/workspaces/${ws.id}/budget`, { monthlyUsd: null });
    expectStatus(restore, 200);
    expect(restore.body?.budgetUsd).toBeNull();

    const sse = await owner.client.sse(
      `/api/workspaces/${ws.id}/reports/${reportId}/messages`,
      { content: "Tell me about coffee" },
    );
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type") ?? "").toContain("text/event-stream");
    const done = sse.events.find((e) => e.event === "done");
    expect(String(done?.data?.message?.content ?? "")).length.toBeGreaterThan(0);
  });

  test("a non-member's chat request is 404 not_found; a member's request succeeds (api.yaml §workspaces/{ws} — 404 not_found when caller is not a member)", async () => {
    const { owner, ws } = await boot();
    const reportId = await makeReport(owner.client, ws.id);
    const member = await addMember({ ...(owner as any), ws }, "member");
    const memberOk = await member.client.sse(
      `/api/workspaces/${ws.id}/reports/${reportId}/messages`,
      { content: "I am a member" },
    );
    expect(memberOk.status).toBe(200);

    const outsider = await signup();
    const blocked = await outsider.client.sse(
      `/api/workspaces/${ws.id}/reports/${reportId}/messages`,
      { content: "I am not a member" },
    );
    expectError(blocked, 404, "not_found");
  });
});
