import { describe, expect, it } from "vitest";
import { COFFEE, SECRET, SECRET_PHRASE } from "../../lib/corpus";
import {
  CALL_COST,
  EPS,
  addText,
  createWorkspace,
  expectError,
  expectStatus,
  fakeModel,
  finishedJob,
  isolateFakeModel,
  owner,
  twoDocs,
  usageRecords,
} from "../../lib/helpers";

async function reportOf(team: any) {
  const docs = await twoDocs(team.client, team.ws.id);
  const job = await finishedJob(team.client, team.ws.id, docs.map((d: any) => d.id));
  return { job, url: `/api/workspaces/${team.ws.id}/reports/${job.reportId}/messages` };
}

describe("S4 follow-up chat", () => {
  isolateFakeModel();

  it("streams an answer with citations and keeps the conversation", async () => {
    const team = await owner();
    const { job, url } = await reportOf(team);
    await fakeModel.set({ latencyMs: 300 });

    const res = await team.client.sse(url, { content: "Which finding is best supported?" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/event-stream/);
    const deltas = res.events.filter((e) => e.event === "delta");
    const done = res.events.find((e) => e.event === "done");
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    expect(done, JSON.stringify(res.events)).toBeTruthy();
    // Streamed for real: the first piece arrives well before the answer is complete.
    expect(done!.at - deltas[0].at).toBeGreaterThanOrEqual(200);
    const message = done!.data.message;
    expect(message.role).toBe("assistant");
    expect(message.content).toBe(deltas.map((d) => d.data.text).join(""));
    expect(message.citations.length).toBeGreaterThan(0);
    for (const c of message.citations) expect(job.documentIds).toContain(c.documentId);

    const history = await team.client.get(url);
    expectStatus(history, 200);
    expect(history.body.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    expect(history.body.messages[1].id).toBe(message.id);
  });

  it("charges chat to the budget and refuses it when the budget is spent", async () => {
    const team = await owner();
    const { job, url } = await reportOf(team);
    const ok = await team.client.sse(url, { content: "Summarise in one line." });
    expect(ok.status).toBe(200);

    const chat = (await usageRecords(team.client, team.ws.id, { reportId: job.reportId })).filter((r) => r.stage === "chat");
    expect(chat).toHaveLength(1);
    expect(Math.abs(chat[0].costUsd - CALL_COST)).toBeLessThan(EPS);

    expectStatus(await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 0.01 }), 200);
    const refused = await team.client.sse(url, { content: "One more?" });
    expect(refused.status).toBe(402);
    expect(refused.body?.error?.code).toBe("budget_exceeded");
  });

  it("answers only from the report's own documents", async () => {
    const team = await owner();
    // The same user keeps a confidential document in a second workspace.
    const other = await createWorkspace(team.client);
    await addText(team.client, other.id, SECRET);

    const ours = await addText(team.client, team.ws.id, COFFEE);
    const job = await finishedJob(team.client, team.ws.id, [ours.id]);
    const url = `/api/workspaces/${team.ws.id}/reports/${job.reportId}/messages`;
    const res = await team.client.sse(url, { content: `What does the ${SECRET_PHRASE} say about beacon logs?` });
    expect(res.status).toBe(200);
    const message = res.events.find((e) => e.event === "done")!.data.message;
    for (const c of message.citations) expect(c.documentId).toBe(ours.id);
    expect(message.content).not.toContain("beacon logs");

    const outsider = await owner();
    expectError(await outsider.client.post(url, { content: "hi" }), 404, "not_found");
  });
});
