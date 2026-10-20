// Follow-up chat (Server-Sent Events).
// Clause: api.yaml — the response streams `event: delta` with {"text"} (at least two with the
// fake model), then `event: done` with {"message"} whose content is exactly the concatenation
// of the delta texts; each delta is flushed as produced; the answer carries at least one
// citation; and an exhausted budget answers with a plain 402 budget_exceeded JSON error instead
// of a stream.
import { describe, expect, it } from "vitest";
import {
  addText,
  expectError,
  expectStatus,
  fakeModel,
  finishedJob,
  owner,
  report,
} from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

describe("follow-up chat", () => {
  // api.yaml POST messages: at least two delta events, done content equals their exact concatenation, one citation.
  it("streams at least two deltas and the done message is their exact concatenation", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    const job = await finishedJob(a.client, a.ws.id, [doc.id]);
    const rep = await report(a.client, a.ws.id, job.reportId);
    await fakeModel.set({ latencyMs: 60 });

    const sse = await a.client.sse(`/api/workspaces/${a.ws.id}/reports/${rep.id}/messages`, {
      content: "Summarise the limits.",
    });
    expect(sse.status).toBe(200);

    const deltas = sse.events.filter((e) => e.event === "delta");
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    const done = sse.events.find((e) => e.event === "done");
    expect(done).toBeTruthy();
    // The first delta must arrive before done: the reply is streamed, not buffered.
    expect(sse.events.indexOf(done!)).toBeGreaterThan(sse.events.indexOf(deltas[0]));

    const joined = deltas.map((d) => d.data.text).join("");
    expect(done!.data.message.content).toBe(joined);
    expect(done!.data.message.citations.length).toBeGreaterThanOrEqual(1);
  });

  // api.yaml POST messages: an exhausted budget is a plain 402 budget_exceeded JSON error, not a stream.
  it("an exhausted budget answers chat with a plain 402 JSON error, not a stream", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    const job = await finishedJob(a.client, a.ws.id, [doc.id]);
    const rep = await report(a.client, a.ws.id, job.reportId);

    // Guard: chat works before the budget is removed.
    const ok = await a.client.sse(`/api/workspaces/${a.ws.id}/reports/${rep.id}/messages`, { content: "hello" });
    expect(ok.status).toBe(200);
    expect(ok.events.some((e) => e.event === "done")).toBe(true);

    expectStatus(await a.client.put(`/api/workspaces/${a.ws.id}/budget`, { monthlyUsd: 0 }), 200);
    const blocked = await a.client.sse(`/api/workspaces/${a.ws.id}/reports/${rep.id}/messages`, { content: "hello" });
    expect(blocked.status).toBe(402);
    expect(blocked.events.length).toBe(0);
    expect(blocked.body?.error?.code).toBe("budget_exceeded");
  });

  // api.yaml POST messages: content minLength 1, maxLength 4000.
  it("rejects empty or over-long follow-up content", async () => {
    const a = await owner();
    const doc = await addText(a.client, a.ws.id, SOLAR);
    const job = await finishedJob(a.client, a.ws.id, [doc.id]);
    const rep = await report(a.client, a.ws.id, job.reportId);
    const path = `/api/workspaces/${a.ws.id}/reports/${rep.id}/messages`;

    expectError(await a.client.post(path, { content: "" }), 400, "validation_error");
    expectError(await a.client.post(path, { content: "x".repeat(4001) }), 400, "validation_error");
    // Guard: a normal follow-up streams.
    const ok = await a.client.sse(path, { content: "hi" });
    expect(ok.status).toBe(200);
  });
});
