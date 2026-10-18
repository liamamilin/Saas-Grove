import { describe, expect, it } from "vitest";
import { EPS, expectStatus, twoDocs, waitForJob } from "../../lib/helpers";
import { withInstance, teamAt } from "../../lib/instance";
import { MockModel, realModeEnv, replyCostUsd, type MockReply } from "../../lib/mock-model";

// The money path in real mode (spec/architecture.md §5.1–§5.2): the fake model cannot show whether the
// product caps what a call may cost. This mock answers every call with as many tokens as the product allowed.

const KEY = "mock-key-3c9e51a7b2d8f604";
const PRICES = { inputPerMTok: 1, outputPerMTok: 10 };
const BUDGET_USD = 0.02; // a cap of 4096 output tokens costs $0.04096 and cannot fit; a cap of 1000 costs $0.01 and can

describe("S3 budget in real mode", () => {
  it("never sends a call whose output cap the remaining budget cannot pay for", async () => {
    let spent = 0; // by the mock's own books: the usage it reported so far
    const problems: string[] = [];
    const mock = await MockModel.start((r): MockReply => {
      const left = BUDGET_USD - spent;
      if (r.cap === null || !(r.cap > 0)) {
        problems.push(`call ${r.callNo} had no max_tokens, so the model could run on without limit`);
      } else if ((r.cap * PRICES.outputPerMTok) / 1_000_000 > left + EPS) {
        problems.push(`call ${r.callNo} allowed up to ${r.cap} output tokens ($${((r.cap * PRICES.outputPerMTok) / 1e6).toFixed(5)}) with only $${left.toFixed(5)} of the budget left`);
      }
      // A model that uses everything it is allowed: the worst case a reservation has to cover.
      const reply: MockReply = {
        content: r.callNo === 1 ? JSON.stringify(["First question?", "Second question?", "Third question?"]) : "The documents support this [1].",
        promptTokens: 500,
        completionTokens: r.cap ?? 1_000_000,
      };
      spent += replyCostUsd(reply, PRICES.inputPerMTok, PRICES.outputPerMTok);
      return reply;
    });
    try {
      await withInstance(realModeEnv(mock, PRICES, KEY), async (base) => {
        const { client, ws } = await teamAt(base);
        const docs = await twoDocs(client, ws.id);
        expectStatus(await client.put(`/api/workspaces/${ws.id}/budget`, { monthlyUsd: BUDGET_USD }), 200);

        // A product may also refuse the job outright when it cannot afford it: then it has sent nothing, which is safe.
        const started = await client.post(`/api/workspaces/${ws.id}/research-jobs`, { question: "What do these documents say?", documentIds: docs.map((d) => d.id) });
        let ended = `refused with ${started.status}`;
        if (started.status !== 402) {
          expectStatus(started, 202);
          ended = (await waitForJob(client, ws.id, started.body.job.id, undefined, 90_000)).status;
        }

        expect(problems, `the job ended: ${ended}`).toEqual([]);
        const usage = await client.get(`/api/workspaces/${ws.id}/usage`);
        expectStatus(usage, 200);
        expect(usage.body.spentUsd as number, "money spent must stay within the budget").toBeLessThanOrEqual(BUDGET_USD + EPS);
      });
    } finally {
      await mock.close();
    }
  }, 240_000);
});
