// Held-out acceptance tests: the real mode of the product.
//
// Contract source: brief/contract/testability.md §5.1 and §5.2 - the acceptance does not talk to a
// real model, it starts the product against a local OpenAI-compatible service:
//   1. with a complete configuration the product must start, and "/api/__test__/* must all be 404";
//   2. "remove one of the required settings -> the start must fail";
//   3. it must send "Authorization: Bearer <MODEL_API_KEY>", "model" equal to MODEL_NAME and a
//      max_tokens; the retrieved passage has to reach the model; the model's answer has to reach the
//      visitor; and every usage record has to cost what the model's own usage says.
//   §5.1: "the input tokens are estimated at one per character of the text of the messages of this
//   request", "every chat call carries max_tokens (a positive integer, not more than 1000)".

import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { describeLaunch, launch, stopInstance, teamAt } from "../../lib/instance";
import { MockModel, promptChars, realModeEnv } from "../../lib/mock-model";
import { expectStatus, usageRecords, waitFor, waitForDocument } from "../../lib/helpers";
import { Visitor, expectUnanswered, widgetSettings } from "../../lib/widget";
import { CANARY, LONG_QUESTION, ZH_QUESTION, longChineseManual, longManual } from "../../lib/corpus";

const API_KEY = "acceptance-api-key-do-not-log";
const INPUT_PER_MTOK = 100;
const OUTPUT_PER_MTOK = 10;
// The mock reports a small number of output tokens, so that the price of the call is clearly
// different from the worst case the product has to reserve.
const COMPLETION_TOKENS = 10;

describe("holdout: the real mode", () => {
  it("calls the model the way the contract says and books what the model reports", async () => {
    // Contract: testability §5.1 and §5.2 items 1 and 3.
    const nonce = "ZX-9917";
    const mock = await MockModel.start((req) => ({
      content: req.promptText.includes(nonce)
        ? "根据展厅手册，黄铜咖啡阀门的除垢方法如下 [1]。"
        : "Our manual says that a refund is given within thirty days [1].",
      promptTokens: promptChars(req.body),
      completionTokens: COMPLETION_TOKENS,
    }));

    let instanceId: string | null = null;
    try {
      const started = await launch(
        realModeEnv(mock, { inputPerMTok: INPUT_PER_MTOK, outputPerMTok: OUTPUT_PER_MTOK }, API_KEY),
        60,
      );
      expect(started.healthy, describeLaunch(started)).toBe(true);
      if (!started.healthy || !started.base || !started.id) throw new Error("the instance did not start");
      instanceId = started.id;
      const base = started.base;
      const origin = new URL(base).origin;

      // Outside test mode the test routes do not exist.
      const outside = new Client(base);
      expect((await outside.get("/api/__test__/fake-model")).status).toBe(404);
      expect((await outside.get("/api/__test__/outbox?to=a@b.test")).status).toBe(404);

      const { client: user, ws } = await teamAt(base);
      const widget = await widgetSettings(user, ws.id);
      const visitor = new Visitor(widget.widgetKey, origin, base);
      await visitor.start();

      // A long manual with one relevant paragraph that carries a canary.
      const manual = longManual();
      const doc = await user.post(`/api/workspaces/${ws.id}/documents`, {
        title: manual.title,
        text: manual.text,
      });
      expectStatus(doc, 201);
      await waitForDocument(user, ws.id, String(doc.body?.document?.id ?? ""));

      const answer = await visitor.answer(LONG_QUESTION);
      // The answer of the model reaches the visitor.
      expect(String(answer.message.content ?? "")).toContain("Our manual says that a refund is given within thirty days");

      // The request carries the key, the model and a token cap, and the retrieved passage.
      const request = mock.requests[mock.requests.length - 1];
      expect(request.headers.authorization).toBe(`Bearer ${API_KEY}`);
      expect(request.body?.model).toBe("mock-model");
      expect(request.cap ?? 0, "the request carried no max_tokens").toBeGreaterThan(0);
      expect(request.cap ?? 0, "max_tokens is larger than 1000").toBeLessThanOrEqual(1000);
      expect(request.promptText, "the canary paragraph did not reach the model").toContain(CANARY);
      expect(request.promptText.length, "the whole manual was sent to the model").toBeLessThan(12000);

      // The usage is booked with the price of the model's own usage: one record per attempt.
      const records = (await usageRecords(user, ws.id))
        .filter((r: any) => r.kind === "chat")
        .sort((a: any, b: any) => Date.parse(String(a.createdAt)) - Date.parse(String(b.createdAt)));
      expect(records.length).toBe(mock.requests.length);
      for (let i = 0; i < records.length; i += 1) {
        const reply = mock.replies[i];
        const expected =
          (reply.promptTokens * INPUT_PER_MTOK + reply.completionTokens * OUTPUT_PER_MTOK) / 1_000_000;
        expect(records[i].status).toBe("ok");
        expect(records[i].costUsd).toBeCloseTo(expected, 8);
      }

      // The same in Chinese: the retrieval has to handle it.
      const chinese = longChineseManual(nonce);
      const zhDoc = await user.post(`/api/workspaces/${ws.id}/documents`, {
        title: chinese.title,
        text: chinese.text,
      });
      expectStatus(zhDoc, 201);
      await waitForDocument(user, ws.id, String(zhDoc.body?.document?.id ?? ""));

      const zhAnswer = await visitor.answer(ZH_QUESTION);
      expect(String(zhAnswer.message.content ?? "")).toContain("根据展厅手册");
      const zhRequest = mock.requests[mock.requests.length - 1];
      expect(zhRequest.promptText, "the Chinese passage did not reach the model").toContain(nonce);
      expect((zhAnswer.message.citations ?? []).length).toBeGreaterThanOrEqual(1);
      expect(chinese.text, "the Chinese quote is not in the Chinese original").toContain(
        zhAnswer.message.citations[0].quote,
      );

      // A budget that cannot pay: the model is not called at all.
      await user.put(`/api/workspaces/${ws.id}/budget`, { monthlyUsd: 0.001 });
      const before = mock.requests.length;
      const refused = await visitor.answer(LONG_QUESTION);
      expectUnanswered(refused.message, widget.fallbackMessage);
      expect(mock.requests.length, "the model was called although the budget was gone").toBe(before);
    } finally {
      if (instanceId) await stopInstance(instanceId);
      await mock.close();
    }
  });

  it("refuses to start in real mode when a required setting is missing", async () => {
    // Contract: testability §5.1 - "without MODEL_API_KEY ... the product must fail to start (the
    // process exits)"; §5.2 item 2.
    const started = await launch(
      {
        MODEL_PROVIDER: "real",
        MODEL_BASE_URL: "http://127.0.0.1:9/v1",
        MODEL_INPUT_USD_PER_MTOK: String(INPUT_PER_MTOK),
        MODEL_OUTPUT_USD_PER_MTOK: String(OUTPUT_PER_MTOK),
      },
      45,
    );
    expect(started.healthy, describeLaunch(started)).toBe(false);
  });
});
