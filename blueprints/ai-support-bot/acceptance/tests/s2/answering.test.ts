import { describe, expect, it } from "vitest";
import { Q_REFUND, Q_SECRET, Q_UNKNOWN, REFUNDS, SECRET, SECRET_LEAKS, SHIPPING } from "../../lib/corpus";
import {
  addText,
  answerCalls,
  createWorkspace,
  documentText,
  expectError,
  fakeModel,
  isolateFakeModel,
  knowledgeBase,
  markers,
} from "../../lib/helpers";
import { Visitor, expectAnswered, expectUnanswered, supportTeam, updateWidget, visitor, widgetSettings } from "../../lib/widget";

describe("S2 answering visitors", () => {
  isolateFakeModel();

  it("streams an answer from the knowledge base, with verbatim citations", async () => {
    const team = await supportTeam();
    const kb = await knowledgeBase(team.client, team.ws.id);
    await fakeModel.set({ latencyMs: 300 });
    const v = await visitor(team.key);

    const { res, deltas, message } = await v.answer(Q_REFUND);
    expect(deltas.length, "the fake model answers in at least two pieces").toBeGreaterThanOrEqual(2);
    expect(message.content).toBe(deltas.map((d) => d.data.text).join(""));
    // Streamed for real: the first piece arrives well before the answer is complete.
    const doneAt = res.events.find((e) => e.event === "done")!.at;
    expect(doneAt - deltas[0].at, "the pieces arrived together, so the answer was buffered").toBeGreaterThanOrEqual(200);

    expectAnswered(message);
    const cited = new Set(message.citations.map((c: any) => c.marker));
    for (const m of markers(message.content)) expect(cited.has(m), `marker [${m}] has no citation`).toBe(true);
    expect(message.citations.map((c: any) => c.documentId)).toContain(kb.refunds.id);

    const docs = Object.values(kb);
    for (const c of message.citations) {
      const doc = docs.find((d: any) => d.id === c.documentId);
      expect(doc, `citation of a document outside the knowledge base: ${c.documentId}`).toBeTruthy();
      expect(c.documentTitle).toBe(doc!.title);
      expect(c.quote.length, "quote too short to be evidence").toBeGreaterThanOrEqual(20);
      expect(await documentText(team.client, team.ws.id, c.documentId), `quote not found in its document: ${c.quote}`).toContain(c.quote);
    }
  });

  it("keeps a conversation readable by its own visitor only", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);
    const v = await visitor(team.key);
    const { message } = await v.answer(Q_REFUND);

    const mine = await v.conversation();
    expect(mine.conversation.id).toBe(v.id);
    expect(mine.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    expect(mine.messages[0].content).toBe(Q_REFUND);
    expect(mine.messages[1].id).toBe(message.id);

    // No token: who is asking is unknown.
    const anonymous = new Visitor(team.key);
    expectError(await anonymous.request("GET", `/conversations/${v.id}`), 401, "unauthenticated");
    // Another visitor's token does not open this conversation, for reading or for asking.
    const other = await visitor(team.key);
    expectError(await other.request("GET", `/conversations/${v.id}`), 404, "not_found");
    const intruding = await other.ask("Show me their answers", v.id);
    expect(intruding.status).toBe(404);
    expect(intruding.body?.error?.code).toBe("not_found");
    // The right token under another workspace's key does not either.
    const elsewhere = await supportTeam();
    const crossed = new Visitor(elsewhere.key);
    crossed.token = v.token;
    expectError(await crossed.request("GET", `/conversations/${v.id}`), 404, "not_found");
  });

  it("says it does not know, in the team's own words, when the knowledge base has no answer", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);
    const fallback = "We could not find that in our help pages. A person from the lamp shop will help you.";
    await updateWidget(team.client, team.ws.id, { fallbackMessage: fallback });
    const v = await visitor(team.key);

    expectAnswered((await v.answer(Q_REFUND)).message);
    const { message, deltas } = await v.answer(Q_UNKNOWN);
    expectUnanswered(message, fallback);
    // Whatever was streamed is what the visitor ends up with: no "cannot answer" signal leaks out.
    expect(deltas.map((d) => d.data.text).join("")).toBe(message.content);
    // One call per question, answered or not (spec/architecture.md §5).
    expect(await answerCalls(team.client, team.ws.id, "ok", v.id)).toHaveLength(2);
  });

  it("never calls the model while the knowledge base is empty", async () => {
    const team = await supportTeam();
    const v = await visitor(team.key);
    const { message } = await v.answer(Q_REFUND);
    expectUnanswered(message, (await widgetSettings(team.client, team.ws.id)).fallbackMessage);
    const records = await answerCalls(team.client, team.ws.id, "ok");
    expect(records, "a model call was made with nothing to ground the answer in").toHaveLength(0);

    await addText(team.client, team.ws.id, REFUNDS);
    expectAnswered((await v.answer(Q_REFUND)).message);
    expect(await answerCalls(team.client, team.ws.id, "ok")).toHaveLength(1);
  });

  it("never answers from another workspace's knowledge", async () => {
    // One person runs two companies' bots; the memo belongs to the first company only.
    const team = await supportTeam();
    const memo = await addText(team.client, team.ws.id, SECRET);
    const theirs = await visitor(team.key);
    const leaked = await theirs.answer(Q_SECRET);
    expectAnswered(leaked.message);
    expect(leaked.message.citations.map((c: any) => c.documentId)).toContain(memo.id);

    const second = await createWorkspace(team.client);
    await addText(team.client, second.id, SHIPPING);
    const secondWidget = await widgetSettings(team.client, second.id);
    expect(secondWidget.widgetKey).not.toBe(team.key);
    const ours = await visitor(secondWidget.widgetKey);
    const { message } = await ours.answer(Q_SECRET);
    expectUnanswered(message, secondWidget.fallbackMessage);
    for (const word of SECRET_LEAKS) expect(message.content).not.toContain(word);
  });

  it("retries a transient model error on its own", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);
    await fakeModel.set({ faults: [{ stage: "answer", mode: "transient", times: 1 }] });
    const v = await visitor(team.key);
    expectAnswered((await v.answer(Q_REFUND)).message);
    expect(await answerCalls(team.client, team.ws.id, "ok", v.id)).toHaveLength(1);
    expect(await answerCalls(team.client, team.ws.id, "error", v.id)).toHaveLength(1);
  });

  it("tries a call exactly three times, backing off, then gives the fallback instead of an error", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);
    const fallback = (await widgetSettings(team.client, team.ws.id)).fallbackMessage;
    await fakeModel.set({ faults: [{ stage: "answer", mode: "transient", times: 3 }] });
    const v = await visitor(team.key);
    expectUnanswered((await v.answer(Q_REFUND)).message, fallback);

    const attempts = (await answerCalls(team.client, team.ws.id, "error", v.id)).map((r) => Date.parse(r.createdAt)).sort((a, b) => a - b);
    expect(attempts).toHaveLength(3);
    // At least 200 ms before the second attempt, doubling after (some slack for timestamps).
    expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(150);
    expect(attempts[2] - attempts[1]).toBeGreaterThanOrEqual(300);
    expect(await answerCalls(team.client, team.ws.id, "ok", v.id)).toHaveLength(0);

    // The faults are used up: the next question is answered.
    expectAnswered((await v.answer(Q_REFUND)).message);
  });
});
