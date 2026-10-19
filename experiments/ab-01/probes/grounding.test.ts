import { describe, expect, it } from "vitest";
import { addText, startJob, waitForJob } from "../../lib/helpers";
import { teamAt, withInstance } from "../../lib/instance";
import { MockModel, realModeEnv, type MockReply } from "../../lib/mock-model";

// Analysis probe (not part of the template): does text of an uploaded document reach the model?
const NONCE = "QZX7741";
const PLAN = JSON.stringify(["What was observed?", "At what temperature?", "How does it relate?"]);

describe("grounding probe", () => {
  it("document text reaches the model", async () => {
    const mock = await MockModel.start((r): MockReply => ({
      content: r.callNo === 1 ? PLAN : "The documents report a resonance [1].",
      promptTokens: 50, completionTokens: 50,
    }));
    try {
      await withInstance(realModeEnv(mock, { inputPerMTok: 1, outputPerMTok: 4 }, "probe-key-1234"), async (base) => {
        const { client, ws } = await teamAt(base);
        const d1 = await addText(client, ws.id, { title: "Quartz lattice study", text: `The quartz-lattice resonance ${NONCE} was observed at 310 kelvin in every sample. The resonance weakened above 400 kelvin. ` + "Lattice vibrations were measured with a laser interferometer. ".repeat(6) });
        const d2 = await addText(client, ws.id, { title: "Coffee roasting", text: "Dark roasts lose chlorogenic acid faster than light roasts. ".repeat(8) });
        const job = await startJob(client, ws.id, [d1.id, d2.id], "What was observed in the quartz lattice study?");
        await waitForJob(client, ws.id, job.id, undefined, 90_000);
        const all = mock.requests.map((r) => JSON.stringify(r.body?.messages ?? "")).join("\n");
        const hits = mock.requests.filter((r) => JSON.stringify(r.body?.messages ?? "").includes(NONCE)).length;
        console.log(`PROBE requests=${mock.requests.length} withNonce=${hits}`);
        expect(all.includes(NONCE), `no request to the model contained text of the uploaded document (${mock.requests.length} requests)`).toBe(true);
      });
    } finally {
      await mock.close();
    }
  }, 240_000);
});
