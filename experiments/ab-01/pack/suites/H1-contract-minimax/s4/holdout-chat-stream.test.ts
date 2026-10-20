// Acceptance stage S4 — chat follow-up streaming.
//
// Every test derives from the api.yaml description of POST
// /api/workspaces/{ws}/reports/{id}/messages (line ~230-248) and the
// fake-model behaviour in testability.md §5 (chat returns ≥2 streaming
// pieces, the server flushes each piece as soon as it is produced,
// the done message's content equals the concatenation of the delta
// texts, and each successful chat call records a single usage row with
// stage=chat and reportId set).

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Client } from "../../lib/client";
import { COFFEE, SOLAR } from "../../lib/corpus";
import {
  CALL_COST,
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

const LATENCY = 200;

async function bootstrap() {
  const team = await signup();
  const ws = await team.client.post("/api/workspaces", { name: `Chat-${uid()}` });
  expectStatus(ws, 201);
  return { team, ws: ws.body.workspace };
}

async function readyReport(
  team: { client: Client; user: { id: string }; email: string; password: string },
  wsId: string,
) {
  const d1 = await addText(team.client, wsId, SOLAR);
  const d2 = await addText(team.client, wsId, COFFEE);
  const job = await startJob(team.client, wsId, [d1.id, d2.id], "Summarise these documents");
  const done = await waitForJob(team.client, wsId, job.id);
  expect(done.status, JSON.stringify(done.error)).toBe("succeeded");
  return { docs: [d1, d2], job, reportId: done.reportId! };
}

describe("holdout: chat streaming (api.yaml chat POST; testability.md §5)", () => {
  beforeEach(async () => {
    await fakeModel.set({ latencyMs: LATENCY });
  });
  afterEach(() => fakeModel.reset());
  isolateFakeModel();

  test("stream shape: ≥2 delta events + a single done event; final content == concatenation of deltas (api.yaml chat POST description; testability.md §5)", async () => {
    const { team, ws } = await bootstrap();
    const { reportId } = await readyReport(team, ws.id);
    const sse = await team.client.sse(
      `/api/workspaces/${ws.id}/reports/${reportId}/messages`,
      { content: "Tell me about perovskite" },
    );
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type") ?? "").toContain("text/event-stream");
    const deltas = sse.events.filter((e) => e.event === "delta");
    const dones = sse.events.filter((e) => e.event === "done");
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    expect(dones.length).toBe(1);
    const text = deltas.map((e) => String(e.data?.text ?? "")).join("");
    expect(String(dones[0].data?.message?.content ?? "")).toBe(text);
  });

  test("streaming is incremental: the first delta reaches the client strictly before done (api.yaml chat POST — Each delta is flushed to the client as soon as it is produced)", async () => {
    const { team, ws } = await bootstrap();
    const { reportId } = await readyReport(team, ws.id);
    const sse = await team.client.sse(
      `/api/workspaces/${ws.id}/reports/${reportId}/messages`,
      { content: "Now talk about coffee" },
    );
    expect(sse.status).toBe(200);
    const deltas = sse.events.filter((e) => e.event === "delta");
    const done = sse.events.find((e) => e.event === "done");
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    expect(done).toBeTruthy();
    // The most direct signal the contract promises: the first delta is on the wire
    // before done — a buffered implementation would arrive at the same time.
    expect(
      deltas[0].at,
      `first delta at ${deltas[0].at} must precede done at ${done!.at}`,
    ).toBeLessThan(done!.at);
    expect(deltas[deltas.length - 1].at).toBeLessThan(done!.at);
  });

  test("the streamed assistant message carries at least one citation; the citation's quote is a verbatim substring of the cited document's text and the document belongs to the workspace (api.yaml Citation schema — Verbatim substring of the document's extracted text)", async () => {
    const { team, ws } = await bootstrap();
    const { reportId, docs } = await readyReport(team, ws.id);
    const sse = await team.client.sse(
      `/api/workspaces/${ws.id}/reports/${reportId}/messages`,
      { content: "Anything else?" },
    );
    expect(sse.status).toBe(200);
    const msg = sse.events.find((e) => e.event === "done")?.data?.message;
    expect(msg).toBeTruthy();
    const citations = msg.citations;
    expect(Array.isArray(citations)).toBe(true);
    expect(citations.length).toBeGreaterThanOrEqual(1);
    const byId = new Map(docs.map((d) => [d.id, d]));
    for (const c of citations) {
      expect(typeof c.marker).toBe("number");
      expect(c.marker).toBeGreaterThanOrEqual(1);
      expect(typeof c.quote).toBe("string");
      expect(c.quote.length).toBeGreaterThan(0);
      const doc = byId.get(c.documentId);
      expect(doc, "citation's document is one of the workspace's docs").toBeTruthy();
      // The quote must be a verbatim substring of the document's extracted text.
      const textRes = await team.client.get(
        `/api/workspaces/${ws.id}/documents/${doc!.id}/text`,
      );
      expectStatus(textRes, 200);
      expect(textRes.body?.text ?? "").toContain(c.quote);
    }
  });

  test("chat input validation: missing content is 400 validation_error; messages over 4000 chars are refused (api.yaml chat POST schema)", async () => {
    const { team, ws } = await bootstrap();
    const { reportId } = await readyReport(team, ws.id);
    const empty = await team.client.post(
      `/api/workspaces/${ws.id}/reports/${reportId}/messages`,
      {},
    );
    expectError(empty, 400, "validation_error");
    const tooLong = await team.client.post(
      `/api/workspaces/${ws.id}/reports/${reportId}/messages`,
      { content: "q".repeat(4001) },
    );
    expectError(tooLong, 400, "validation_error");
  });

  test("exactly one chat call per accepted question — one usage record, stage=chat, reportId set, costUsd = FAKE_CHAT_CALL_COST_USD (testability.md §5)", async () => {
    const { team, ws } = await bootstrap();
    const { reportId } = await readyReport(team, ws.id);
    const beforeRecords = await usageRecords(team.client, ws.id, { reportId });
    const beforeChat = beforeRecords.filter((r) => r.kind === "chat" && r.reportId === reportId);
    const spentBefore = Number((await team.client.get(`/api/workspaces/${ws.id}/usage`)).body.spentUsd);

    const sse = await team.client.sse(
      `/api/workspaces/${ws.id}/reports/${reportId}/messages`,
      { content: "One final question" },
    );
    expect(sse.status).toBe(200);

    const afterRecords = await usageRecords(team.client, ws.id, { reportId });
    const afterChat = afterRecords.filter((r) => r.kind === "chat" && r.reportId === reportId);
    // Exactly one chat call was charged for this question.
    expect(afterChat.length - beforeChat.length).toBe(1);
    const added = afterChat.find((r) => !beforeChat.some((b) => b.id === r.id));
    expect(added).toBeTruthy();
    expect(added!.stage).toBe("chat");
    expect(added!.status).toBe("ok");

    const spentAfter = Number((await team.client.get(`/api/workspaces/${ws.id}/usage`)).body.spentUsd);
    expect(spentAfter - spentBefore).toBeCloseTo(CALL_COST, 6);
  });
});
