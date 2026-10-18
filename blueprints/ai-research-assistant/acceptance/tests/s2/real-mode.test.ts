import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { twoDocs, usageRecords, startJob, waitForJob } from "../../lib/helpers";
import { describeLaunch, launch, stopInstance, teamAt, withInstance } from "../../lib/instance";
import { MockModel, realModeEnv, replyCostUsd, type MockReply } from "../../lib/mock-model";

// Outside test mode, with a model service that is not the fake one (spec/architecture.md §5.1–§5.2).
// The product is started again through the runner on its own database; the main instance is not used.

const KEY = "mock-key-3c9e51a7b2d8f604";
const PRICES = { inputPerMTok: 1, outputPerMTok: 4 }; // whole micro-dollars per token, so costs are exact

const PLAN = JSON.stringify(["What do the documents report?", "What limits do they mention?", "How do the findings relate?"]);

describe("S2 real model mode", () => {
  it("starts with a complete configuration, and refuses to start with an incomplete one", async () => {
    const idle = await MockModel.start(() => ({ content: "unused", promptTokens: 1, completionTokens: 1 }));
    try {
      const complete = realModeEnv(idle, PRICES, KEY);

      // Guard: without it, a product that cannot start outside test mode at all would pass every refusal below.
      const good = await launch(complete, 90);
      expect(good.healthy, `a complete real-mode configuration must start: ${describeLaunch(good)}`).toBe(true);
      try {
        // Outside test mode there are no test routes (§6).
        const client = new Client(good.base!);
        expect((await client.get("/api/__test__/outbox?to=nobody@example.com")).status, "GET /api/__test__/outbox outside test mode").toBe(404);
        expect((await client.put("/api/__test__/fake-model", {})).status, "PUT /api/__test__/fake-model outside test mode").toBe(404);
        expect((await client.del("/api/__test__/fake-model")).status, "DELETE /api/__test__/fake-model outside test mode").toBe(404);
      } finally {
        await stopInstance(good.id!);
      }

      const incomplete: [string, Record<string, string | null>][] = [
        ["MODEL_PROVIDER not set (it must never default to the fake model)", { MODEL_PROVIDER: null }],
        ["MODEL_BASE_URL missing", { MODEL_BASE_URL: null }],
        ["MODEL_API_KEY missing", { MODEL_API_KEY: null }],
        ["MODEL_INPUT_USD_PER_MTOK missing (it must not bill at 0)", { MODEL_INPUT_USD_PER_MTOK: null }],
        ["MODEL_OUTPUT_USD_PER_MTOK missing (it must not bill at 0)", { MODEL_OUTPUT_USD_PER_MTOK: null }],
      ];
      // Refusing is quick, but "never healthy" only counts as a refusal after a window well beyond the
      // time the complete configuration needed, so a slow starter cannot pass by being slow.
      const window = Math.min(90, Math.max(30, Math.ceil(good.seconds * 3)));
      for (const [what, change] of incomplete) {
        const attempt = await launch({ ...complete, ...change }, window);
        if (attempt.id) await stopInstance(attempt.id);
        expect(attempt.healthy, `the product must refuse to start outside test mode with ${what}, but it served /api/health`).toBe(false);
      }
    } finally {
      await idle.close();
    }
  }, 700_000);

  it("bills every call by the usage the model reports", async () => {
    // Each reply reports different token counts, so a flat or estimated price cannot match them all.
    const mock = await MockModel.start((r): MockReply => ({
      content: r.callNo === 1 ? PLAN : "The documents support this finding [1].",
      promptTokens: 1000 + 13 * r.callNo,
      completionTokens: 200 + 31 * r.callNo,
    }));
    try {
      await withInstance(realModeEnv(mock, PRICES, KEY), async (base) => {
        const { client, ws } = await teamAt(base);
        const docs = await twoDocs(client, ws.id);
        const job = await startJob(client, ws.id, docs.map((d) => d.id));
        const done = await waitForJob(client, ws.id, job.id, undefined, 90_000);

        // The product must really talk to the configured service, the way an OpenAI-compatible client does.
        expect(mock.requests.length, `no call reached MODEL_BASE_URL; the job ended as ${done.status} ${JSON.stringify(done.error)}`).toBeGreaterThan(0);
        for (const r of mock.requests) {
          expect(r.headers.authorization, `call ${r.callNo}: Authorization header`).toBe(`Bearer ${KEY}`);
          expect(r.body?.model, `call ${r.callNo}: model`).toBe("mock-model");
          expect(Array.isArray(r.body?.messages) && r.body.messages.length > 0, `call ${r.callNo}: messages`).toBe(true);
          expect(Number.isInteger(r.cap) && (r.cap as number) > 0, `call ${r.callNo}: every call carries a positive integer max_tokens`).toBe(true);
        }

        // A 200 reply is billed whatever the product makes of it, and by the usage in that reply.
        const recorded = (await usageRecords(client, ws.id, { jobId: job.id })).filter((r) => r.kind === "chat");
        const paid = recorded.filter((r) => r.status === "ok");
        expect(paid.length, `${mock.requests.length} calls were answered with 200; ${JSON.stringify(recorded.map((r) => [r.stage, r.status, r.costUsd]))}`).toBe(mock.requests.length);
        const expected = mock.replies.map((r) => replyCostUsd(r, PRICES.inputPerMTok, PRICES.outputPerMTok)).sort((a, b) => a - b);
        const actual = paid.map((r) => r.costUsd as number).sort((a, b) => a - b);
        actual.forEach((cost, i) => expect(cost, `cost of billed call #${i + 1} (sorted), expected from the reported usage`).toBeCloseTo(expected[i], 7));
      });
    } finally {
      await mock.close();
    }
  }, 240_000);
});
