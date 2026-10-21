// Held-out acceptance tests: what the bot answers, and how.
//
// Contract source:
//   brief/contract/api.yaml, POST /api/widget/{key}/conversations/{id}/messages:
//   "The visitor's question is stored as a `user` message, then answered from the workspace's
//   knowledge base. Events: `event: delta` with `data: {"text": "..."}`, each flushed as soon as it
//   is produced, then `event: done` with `data: {"message": VisitorMessage}` (the assistant
//   message). Its `content` is exactly the concatenation of the delta texts.
//   * answered: `outcome: "answered"`, at least one citation, every `[n]` in the content has a
//     citation with `marker: n`, every quote is verbatim from the cited document's text.
//   * unanswered: `outcome: "unanswered"`, `citations: []`, `content` is exactly the widget's
//     `fallbackMessage`. This happens when the knowledge base cannot answer (including an empty
//     knowledge base, which never calls the model) ... The visitor is never shown an error, a
//     made-up answer or the reason.
//   At most 10 questions per minute per conversation; beyond that a plain 429 rate_limited JSON
//   error." POST /api/widget/{key}/conversations: "At most 30 new conversations per hour per widget
//   key and client IP address; beyond that 429 rate_limited."
//   POST .../messages/{messageId}/feedback: "Rating again replaces the rating", 400 "validation_error
//   (bad rating, or the message is the visitor's own question)".
//   brief/contract/testability.md §5: the fake model answers with "[n]" in at least two parts,
//   spaced by latencyMs; the citation quote is at least 20 characters long.

import { describe, expect, it } from "vitest";
import { documentText, expectError, expectStatus, fakeModel, isolateFakeModel, knowledgeBase, markers, usageRecords } from "../../lib/helpers";
import { Visitor, expectAnswered, expectUnanswered, supportTeam, updateWidget } from "../../lib/widget";
import { Q_REFUND, Q_UNKNOWN, REFUNDS } from "../../lib/corpus";

isolateFakeModel();

const FALLBACK = "I do not know that yet. A human colleague will answer you.";

describe("holdout: what the bot answers", () => {
  it("answers from the right document, cites it verbatim and streams the answer", async () => {
    // Contract: the answered case of the widget message route; Citation.quote is a "Verbatim
    // substring of the cited document's extracted text, at least 20 characters"; the deltas are
    // "flushed as soon as it is produced" and the done message is their concatenation.
    const team = await supportTeam();
    const kb = await knowledgeBase(team.client, team.ws.id);
    const visitor = await new Visitor(team.key).start();

    await fakeModel.set({ latencyMs: 2000 });
    const answer = await visitor.answer(Q_REFUND);
    expectAnswered(answer.message);

    // Every marker in the text has a citation.
    const used = markers(String(answer.message.content ?? ""));
    expect(used.length).toBeGreaterThanOrEqual(1);
    for (const marker of used) {
      const citation = (answer.message.citations ?? []).find((c: any) => c.marker === marker);
      expect(citation, `the marker [${marker}] has no citation`).toBeTruthy();
    }

    // The citation points at the document the question is about and quotes it word for word.
    const citation = (answer.message.citations ?? []).find((c: any) => c.documentId === kb.refunds.id);
    expect(citation, "the answer does not cite the document the question is about").toBeTruthy();
    expect(String(citation?.documentTitle ?? "")).toBe(REFUNDS.title);
    expect(String(citation?.quote ?? "").length).toBeGreaterThanOrEqual(20);
    const source = await documentText(team.client, team.ws.id, kb.refunds.id);
    expect(source, "the quote is not in the cited document").toContain(citation?.quote);

    // The answer is streamed in at least two parts, and they arrive one after the other.
    expect(answer.deltas.length).toBeGreaterThanOrEqual(2);
    expect(answer.deltas.map((d) => String(d.data?.text ?? "")).join("")).toBe(answer.message.content);
    const first = Math.min(...answer.deltas.map((d) => d.at));
    const doneAt = answer.res.events.find((e) => e.event === "done")?.at ?? Number.MAX_SAFE_INTEGER;
    expect(first, "the first part only arrived at the end of the answer").toBeLessThan(3500);
    expect(doneAt - first, "the parts were not produced one after the other").toBeGreaterThan(800);

    // The question and the answer are kept in the conversation, oldest first.
    const conversation = await visitor.conversation();
    expect(conversation.messages.length).toBe(2);
    expect(conversation.messages[0].role).toBe("user");
    expect(conversation.messages[0].content).toBe(Q_REFUND);
    expect(conversation.messages[1].role).toBe("assistant");
    expect(conversation.messages[1].content).toBe(answer.message.content);
  });

  it("falls back without a citation when the knowledge base cannot answer", async () => {
    // Contract: the unanswered case - "content is exactly the widget's fallbackMessage",
    // "citations: []", and "the visitor is never shown an error, a made-up answer or the reason";
    // "including an empty knowledge base, which never calls the model" (testability §5: 0 calls).
    const team = await supportTeam();
    await knowledgeBase(team.client, team.ws.id);
    await updateWidget(team.client, team.ws.id, { fallbackMessage: FALLBACK });

    const visitor = await new Visitor(team.key).start();
    const answer = await visitor.answer(Q_UNKNOWN);
    expectUnanswered(answer.message, FALLBACK);
    expect(String(answer.message.content ?? "")).not.toContain("submarine");

    // The team sees why the answer is missing.
    const conversation = await team.client.get(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`);
    expectStatus(conversation, 200);
    const assistant = (conversation.body?.messages ?? []).filter((m: any) => m.role === "assistant").pop();
    expect(String(assistant?.reason ?? "")).toBe("no_answer");

    // With an empty knowledge base the model is not called at all.
    const empty = await supportTeam();
    const other = await new Visitor(empty.key).start();
    const nothing = await other.answer(Q_REFUND);
    expectUnanswered(nothing.message, empty.widget.fallbackMessage);
    const records = await usageRecords(empty.client, empty.ws.id);
    expect(records.filter((r: any) => r.kind === "chat").length, "the model was called anyway").toBe(0);
  });

  it("takes a rating, replaces it, and refuses a bad one", async () => {
    // Contract: POST .../messages/{messageId}/feedback -> 200 { message }; "Rating again replaces
    // the rating"; 400 validation_error for "a bad rating, or the message is the visitor's own
    // question".
    const team = await supportTeam();
    await knowledgeBase(team.client, team.ws.id);
    const visitor = await new Visitor(team.key).start();
    const answer = await visitor.answer(Q_REFUND);
    const messageId = String(answer.message.id ?? "");
    expect(messageId).not.toBe("");

    const up = await visitor.feedback(messageId, "up");
    expectStatus(up, 200);
    expect(up.body?.message?.rating).toBe("up");

    const down = await visitor.feedback(messageId, "down");
    expectStatus(down, 200);
    expect(down.body?.message?.rating).toBe("down");

    expectError(await visitor.feedback(messageId, "sideways"), 400, "validation_error");

    const conversation = await visitor.conversation();
    const ownQuestion = conversation.messages.find((m: any) => m.role === "user");
    expectError(await visitor.feedback(String(ownQuestion?.id ?? ""), "up"), 400, "validation_error");
  });

  it("rate limits the questions of a conversation and the conversations of a widget", async () => {
    // Contract: "At most 10 questions per minute per conversation; beyond that a plain 429
    // rate_limited JSON error." and "At most 30 new conversations per hour per widget key and client
    // IP address; beyond that 429 rate_limited."
    const questions = await supportTeam();
    const visitor = await new Visitor(questions.key).start();
    for (let i = 0; i < 10; i += 1) {
      const res = await visitor.ask("Do you have a refund policy?");
      expect(res.status, `question ${i + 1}: ${res.status}`).toBe(200);
    }
    const tooMany = await visitor.ask("And one more question about refunds?");
    expect(tooMany.status).toBe(429);
    expect(tooMany.body?.error?.code).toBe("rate_limited");
    expect(tooMany.events.length).toBe(0);

    const conversations = await supportTeam();
    for (let i = 0; i < 30; i += 1) {
      expectStatus(await new Visitor(conversations.key).tryStart(), 201);
    }
    const blocked = await new Visitor(conversations.key).tryStart();
    expectError(blocked, 429, "rate_limited");
  });
});
