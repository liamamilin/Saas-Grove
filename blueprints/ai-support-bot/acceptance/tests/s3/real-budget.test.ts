import { describe, expect, it } from "vitest";
import { Q_REFUND, Q_SHIPPING, Q_WARRANTY } from "../../lib/corpus";
import { EPS, expectStatus, knowledgeBase } from "../../lib/helpers";
import { teamAt, withInstance } from "../../lib/instance";
import { MockModel, promptChars, realModeEnv, replyCostUsd, type MockReply } from "../../lib/mock-model";
import { visitor, widgetSettings } from "../../lib/widget";

// The money path in real mode (spec/architecture.md §5.1–§5.2), on the visitor's answer: the fake model cannot
// show whether the product caps what a call may cost. Prices are whole USD per million tokens, so every cost is
// a whole number of micro-USD.

const KEY = "mock-key-3c9e51a7b2d8f604";

describe("S3 budget in real mode", () => {
  it("never sends a call whose output cap the remaining budget cannot pay for", async () => {
    // §5.1: max_tokens <= 1000, and the input is estimated at one token per character of the messages.
    // The first call always fits: 1000 × $20/M + 12,000 characters × $1/M = $0.032 <= $0.035.
    // A second call at the full cap of 1000 does not: $0.035 − $0.020 < $0.020.
    const PRICES = { inputPerMTok: 1, outputPerMTok: 20 };
    const BUDGET_USD = 0.035;
    let paid = 0; // by the mock's own books: the usage it reported so far
    const problems: string[] = [];
    const mock = await MockModel.start((r): MockReply => {
      const left = BUDGET_USD - paid;
      if (r.cap === null || !(r.cap > 0)) {
        problems.push(`call ${r.callNo} had no max_tokens, so the model could run on without limit`);
      } else if ((r.cap * PRICES.outputPerMTok) / 1_000_000 > left + EPS) {
        problems.push(`call ${r.callNo} allowed up to ${r.cap} output tokens ($${((r.cap * PRICES.outputPerMTok) / 1e6).toFixed(6)}) with only $${left.toFixed(6)} of the budget left`);
      }
      // A model that uses everything it is allowed: the worst case a reservation has to cover.
      const reply: MockReply = {
        content: "Our documentation answers this [1].",
        promptTokens: 1, // next to nothing: this test is about the output cap, not about estimating the prompt
        completionTokens: r.cap ?? 1_000_000,
      };
      paid += replyCostUsd(reply, PRICES.inputPerMTok, PRICES.outputPerMTok);
      return reply;
    });
    try {
      await withInstance(realModeEnv(mock, PRICES, KEY), async (base) => {
        const { client, ws } = await teamAt(base);
        await knowledgeBase(client, ws.id);
        expectStatus(await client.put(`/api/workspaces/${ws.id}/budget`, { monthlyUsd: BUDGET_USD }), 200);
        const key = (await widgetSettings(client, ws.id)).widgetKey;
        const v = await visitor(key, new URL(base).origin, base);

        // Nine questions (under the limit of ten a minute): a product that reserved nothing would overspend
        // with any cap of 200 tokens or more (9 × 200 × $20/M = $0.036).
        const outcomes: string[] = [];
        for (const q of [Q_REFUND, Q_SHIPPING, Q_WARRANTY, Q_REFUND, Q_SHIPPING, Q_WARRANTY, Q_REFUND, Q_SHIPPING, Q_WARRANTY]) {
          const res = await v.ask(q);
          expect(res.status, `asking "${q}"`).toBe(200);
          outcomes.push(res.events.find((e) => e.event === "done")?.data?.message?.outcome ?? `no done event: ${JSON.stringify(res.events).slice(0, 200)}`);
        }

        expect(mock.requests.length, `no call reached the model at all; outcomes ${outcomes.join(", ")}`).toBeGreaterThan(0);
        expect(problems, `outcomes: ${outcomes.join(", ")}`).toEqual([]);
        const usage = await client.get(`/api/workspaces/${ws.id}/usage`);
        expectStatus(usage, 200);
        expect(usage.body.spentUsd as number, "money spent must stay within the budget").toBeLessThanOrEqual(BUDGET_USD + EPS);
      });
    } finally {
      await mock.close();
    }
  }, 240_000);

  it("reserves for the prompt at one token per character, so a long prompt cannot overspend", async () => {
    // Input is the expensive side here, so an estimate below one token per character (say, four characters
    // per token) reserves too little. The mock reports exactly as many prompt tokens as the messages have
    // characters: the most §5.1 allows, and what the reservation must cover.
    const PRICES = { inputPerMTok: 20, outputPerMTok: 1 };
    let budget = Number.POSITIVE_INFINITY; // the default budget ($10) is far above anything here
    let paid = 0;
    const problems: string[] = [];
    const mock = await MockModel.start((r): MockReply => {
      const chars = promptChars(r.body);
      const left = budget - paid;
      if (r.cap === null || !(r.cap > 0)) {
        problems.push(`call ${r.callNo} had no max_tokens`);
      } else {
        const worst = (chars * PRICES.inputPerMTok + r.cap * PRICES.outputPerMTok) / 1_000_000;
        if (worst > left + EPS) {
          problems.push(`call ${r.callNo}: ${chars} characters of messages and max_tokens ${r.cap} can cost $${worst.toFixed(6)}, with only $${left.toFixed(6)} of the budget left`);
        }
      }
      const reply: MockReply = { content: "Our documentation answers this [1].", promptTokens: chars, completionTokens: r.cap ?? 1_000_000 };
      paid += replyCostUsd(reply, PRICES.inputPerMTok, PRICES.outputPerMTok);
      return reply;
    });
    try {
      await withInstance(realModeEnv(mock, PRICES, KEY), async (base) => {
        const { client, ws } = await teamAt(base);
        await knowledgeBase(client, ws.id);
        const key = (await widgetSettings(client, ws.id)).widgetKey;
        const ask = async () => {
          // A fresh visitor each time, so the prompt does not grow with the conversation's history.
          const v = await visitor(key, new URL(base).origin, base);
          const res = await v.ask(Q_REFUND);
          expect(res.status, `asking "${Q_REFUND}"`).toBe(200);
          return (res.events.find((e) => e.event === "done")?.data?.message?.outcome as string) ?? `no done event: ${JSON.stringify(res.events).slice(0, 200)}`;
        };

        // One call on the default budget shows what a call costs with this product's prompt.
        const first = await ask();
        const firstCalls = mock.requests.length;
        expect(firstCalls, `no call reached the model on the default budget; outcome ${first}`).toBeGreaterThan(0);
        const oneCall = mock.replies.reduce((t, r) => t + replyCostUsd(r, PRICES.inputPerMTok, PRICES.outputPerMTok), 0);
        const before = await client.get(`/api/workspaces/${ws.id}/usage`);
        expectStatus(before, 200);
        // Room for one and a half more calls like it: the next one fits, the one after it does not.
        budget = Math.round(((before.body.spentUsd as number) + 1.5 * oneCall) * 1e6) / 1e6;
        expectStatus(await client.put(`/api/workspaces/${ws.id}/budget`, { monthlyUsd: budget }), 200);

        const outcomes = [first];
        for (let i = 0; i < 3; i++) outcomes.push(await ask());

        expect(problems, `outcomes: ${outcomes.join(", ")}`).toEqual([]);
        expect(mock.requests.length, `a second question's call fits in the budget; outcomes ${outcomes.join(", ")}`).toBeGreaterThan(firstCalls);
        expect(outcomes.slice(1), "half a call's worth of budget left must refuse the question").toContain("unanswered");
        const usage = await client.get(`/api/workspaces/${ws.id}/usage`);
        expectStatus(usage, 200);
        expect(usage.body.spentUsd as number, "money spent must stay within the budget").toBeLessThanOrEqual(budget + EPS);
      });
    } finally {
      await mock.close();
    }
  }, 240_000);
});
