import { describe, expect, it } from "vitest";
import { addText, startJob, waitForJob, report } from "../../lib/helpers";
import { teamAt, withInstance } from "../../lib/instance";
import { MockModel, realModeEnv, type MockReply } from "../../lib/mock-model";

// Analysis probe (not part of the template): does what the model answers end up in the report?
const MARK = "ZZMARK9913";
const PLAN = JSON.stringify(["What was observed?", "At what temperature?", "How does it relate?"]);

describe("output-used probe", () => {
  it("the model's synthesize answer is in the report", async () => {
    const mock = await MockModel.start((r): MockReply => ({
      content: r.callNo === 1 ? PLAN : `Findings: the resonance holds, code ${MARK} [1].`,
      promptTokens: 50, completionTokens: 50,
    }));
    try {
      await withInstance(realModeEnv(mock, { inputPerMTok: 1, outputPerMTok: 4 }, "probe-key-1234"), async (base) => {
        const { client, ws } = await teamAt(base);
        const d1 = await addText(client, ws.id, { title: "Quartz lattice study", text: "The quartz-lattice resonance was observed at 310 kelvin in every sample. " + "Lattice vibrations were measured with a laser interferometer. ".repeat(6) });
        const d2 = await addText(client, ws.id, { title: "Coffee roasting", text: "Dark roasts lose chlorogenic acid faster than light roasts. ".repeat(8) });
        const job = await startJob(client, ws.id, [d1.id, d2.id], "What was observed in the quartz lattice study?");
        const done = await waitForJob(client, ws.id, job.id, undefined, 90_000);
        expect(done.reportId, `job ended as ${done.status}`).toBeTruthy();
        const rep = await report(client, ws.id, done.reportId as string);
        const md = JSON.stringify(rep);
        console.log(`PROBE2 markInReport=${md.includes(MARK)}`);
        expect(md.includes(MARK), "the model's synthesize answer is not in the report").toBe(true);
      });
    } finally {
      await mock.close();
    }
  }, 240_000);
});
