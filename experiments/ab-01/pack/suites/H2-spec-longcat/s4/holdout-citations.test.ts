// Held-out acceptance tests: citations of reports and of follow-up answers.
//
// Clauses under test:
//   * spec/product.md §3 — Report "带编号引用 [1]、[2]。每条引用都指向一份资料"; Message "回答以流式返回，
//     同样带引用，只能引用该报告用到的资料".
//   * spec/product.md §6 — "引用造假：… 或者引用了任务之外的资料".
//   * spec/architecture.md §4.4 — "正文里每一个 [n]，在 citations 中都要有一条 marker = n 的记录".
//   * spec/product.md §4.5 — 阅读报告 (a finished job links to its report).

import { describe, expect, test } from "vitest";
import {
  addText,
  finishedJob,
  markers,
  owner,
  report as getReport,
  startJob,
  twoDocs,
  waitForJob,
} from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

const QUESTION = "What limits do these documents mention?";

describe("citations", () => {
  test("a report cites only the documents its job was given", async () => {
    // product.md §6 (引用了任务之外的资料) + §3 (每条引用都指向一份资料).
    const team = await owner();
    const [solar, coffee] = await twoDocs(team.client, team.ws.id);
    expect(coffee.id).not.toBe(solar.id);

    const job = await finishedJob(team.client, team.ws.id, [solar.id]);
    const rep = await getReport(team.client, team.ws.id, job.reportId);

    expect(Array.isArray(rep.citations)).toBe(true);
    expect(rep.citations.length).toBeGreaterThan(0); // product.md §3: 带编号引用
    for (const c of rep.citations) {
      expect(c.documentId, JSON.stringify(c)).toBe(solar.id);
      expect(typeof c.quote).toBe("string");
      expect(c.quote.length).toBeGreaterThan(0);
    }

    // the quote is taken from that document's own extracted text
    const text = await team.client.get(`/api/workspaces/${team.ws.id}/documents/${solar.id}/text`);
    expect(text.status, text.text).toBe(200);
    expect(typeof text.body?.text).toBe("string");
    for (const c of rep.citations) expect(text.body.text).toContain(c.quote);
  });

  test("every [n] in the report body has a citation with that marker", async () => {
    // architecture.md §4.4: 正文里每一个 [n]，在 citations 中都要有一条 marker = n 的记录.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    const job = await finishedJob(team.client, team.ws.id, [doc.id]);
    const rep = await getReport(team.client, team.ws.id, job.reportId);

    const used = markers(rep.markdown ?? "");
    expect(used.length, rep.markdown).toBeGreaterThan(0);
    const cited = new Set((rep.citations ?? []).map((c: any) => c.marker));
    for (const m of used) expect(cited.has(m), `marker [${m}] has no citation`).toBe(true);
  });

  test("a finished job links to its report and the report links back", async () => {
    // api.yaml Job.reportId / Report.jobId; product.md §4.5 阅读报告; architecture.md §4.2 三个阶段.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    const job = await finishedJob(team.client, team.ws.id, [doc.id]);

    expect(job.reportId).toBeTruthy();
    expect((job.stages ?? []).map((s: any) => s.name)).toEqual(["plan", "analyze", "synthesize"]);
    for (const s of job.stages ?? []) expect(s.status, JSON.stringify(s)).toBe("succeeded");

    const rep = await getReport(team.client, team.ws.id, job.reportId);
    expect(rep.jobId).toBe(job.id);
    expect(typeof rep.title).toBe("string");
    expect((rep.markdown ?? "").length).toBeGreaterThan(0);

    const list = await team.client.get(`/api/workspaces/${team.ws.id}/reports`);
    expect(list.status, list.text).toBe(200);
    expect(((list.body?.reports ?? []) as any[]).some((r) => r.id === rep.id && r.jobId === job.id)).toBe(true);
  });

  test("a follow-up answer carries citations and only cites the report's documents", async () => {
    // product.md §3 Message: 回答…同样带引用，只能引用该报告用到的资料.
    const team = await owner();
    const [solar, coffee] = await twoDocs(team.client, team.ws.id);
    const job = await finishedJob(team.client, team.ws.id, [solar.id]);
    const rep = await getReport(team.client, team.ws.id, job.reportId);

    const sse = await team.client.sse(`/api/workspaces/${team.ws.id}/reports/${rep.id}/messages`, { content: QUESTION });
    expect(sse.status, sse.body ? JSON.stringify(sse.body) : "no body").toBe(200);
    const done = sse.events.find((e) => e.event === "done");
    expect(done, `events: ${sse.events.map((e) => e.event).join(",")}`).toBeTruthy();

    const message = (done as any).data?.message;
    expect(message?.role).toBe("assistant");
    expect(Array.isArray(message.citations)).toBe(true);
    expect(message.citations.length).toBeGreaterThan(0); // product.md §3: 同样带引用
    for (const c of message.citations) {
      expect(c.documentId, JSON.stringify(c)).toBe(solar.id);
      expect(c.documentId).not.toBe(coffee.id);
    }
  });

  test("the streamed answer is stored and readable through the messages endpoint", async () => {
    // product.md §3 Message（追问）; api.yaml GET /reports/{id}/messages.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    const job = await finishedJob(team.client, team.ws.id, [doc.id]);
    const rep = await getReport(team.client, team.ws.id, job.reportId);

    const sse = await team.client.sse(`/api/workspaces/${team.ws.id}/reports/${rep.id}/messages`, { content: QUESTION });
    const done = sse.events.find((e) => e.event === "done");
    expect(done, `events: ${sse.events.map((e) => e.event).join(",")}`).toBeTruthy();
    const streamed = (done as any).data?.message?.content;
    expect(typeof streamed).toBe("string");

    const res = await team.client.get(`/api/workspaces/${team.ws.id}/reports/${rep.id}/messages`);
    expect(res.status, res.text).toBe(200);
    const messages = (res.body?.messages ?? []) as any[];
    expect(messages.some((m) => m.role === "user" && m.content === QUESTION)).toBe(true);
    expect(messages.some((m) => m.role === "assistant" && m.content === streamed)).toBe(true);
  });
});
