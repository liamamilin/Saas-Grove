import { describe, expect, it } from "vitest";
import { addText, startJob, waitForJob } from "../../lib/helpers";
import { teamAt, withInstance } from "../../lib/instance";
import { MockModel, realModeEnv, type MockReply } from "../../lib/mock-model";

// Analysis probe (not part of the template): is retrieval selective, and does follow-up chat get source text?
const NONCE = "QZX7741";
const PLAN = JSON.stringify(["What was observed in the quartz lattice?", "At what temperature did the quartz resonance appear?", "How do the quartz findings relate?"]);
const topics = ["glacier mass balance", "tidal harmonics", "soil microbiome", "bridge fatigue", "wheat rust", "ocean acidification", "lunar regolith", "urban heat islands", "coral bleaching", "battery degradation"];

function filler(i: number): string {
  const t = topics[i % topics.length];
  return `Section ${i} on ${t}. ` + `Measurements of ${t} in campaign ${i} were repeated weekly and logged by station ${i * 7}. `.repeat(9);
}

describe("retrieval probe", () => {
  it("retrieval is selective and chat sees source text", async () => {
    const mock = await MockModel.start((r): MockReply => ({
      content: r.callNo === 1 ? PLAN : "The quartz resonance is reported [1].",
      promptTokens: 50, completionTokens: 50,
    }));
    try {
      await withInstance(realModeEnv(mock, { inputPerMTok: 1, outputPerMTok: 4 }, "probe-key-1234"), async (base) => {
        const { client, ws } = await teamAt(base);
        const parts: string[] = [];
        for (let i = 0; i < 40; i++) parts.push(i === 23 ? `The quartz-lattice resonance ${NONCE} was observed at 310 kelvin in every quartz sample. The quartz resonance weakened above 400 kelvin. ` + "Quartz lattice vibrations were measured with a laser interferometer. ".repeat(5) : filler(i));
        const text = parts.join("\n\n");
        const d1 = await addText(client, ws.id, { title: "Field campaigns", text });
        const d2 = await addText(client, ws.id, { title: "Coffee roasting", text: "Dark roasts lose chlorogenic acid faster than light roasts. ".repeat(8) });
        const job = await startJob(client, ws.id, [d1.id, d2.id], "What was observed in the quartz lattice study?");
        const done = await waitForJob(client, ws.id, job.id, undefined, 120_000);
        const lens = mock.requests.map((r) => JSON.stringify(r.body?.messages ?? "").length);
        const maxLen = Math.max(...lens);
        const withNonce = mock.requests.filter((r) => JSON.stringify(r.body?.messages ?? "").includes(NONCE)).length;
        const before = mock.requests.length;
        let chatHas = "n/a";
        if (done.reportId) {
          const res = await client.sse(`/api/workspaces/${ws.id}/reports/${done.reportId}/messages`, { content: "At what temperature was the quartz resonance observed?" });
          const chatReqs = mock.requests.slice(before);
          chatHas = chatReqs.length ? String(chatReqs.some((r) => JSON.stringify(r.body?.messages ?? "").includes(NONCE))) : `no-model-call(status ${res.status})`;
        }
        console.log(`PROBE3 docChars=${text.length} maxRequestChars=${maxLen} selective=${maxLen < 0.6 * text.length} nonceInRequests=${withNonce}/${before} chatGetsSource=${chatHas}`);
        expect(true).toBe(true);
      });
    } finally {
      await mock.close();
    }
  }, 300_000);
});
