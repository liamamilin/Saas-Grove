import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { expectError, expectStatus, owner, addMember, twoDocs, finishedJob, waitForJob, usageRecords, callsByStage, CALL_COST, EPS, uid, isolateFakeModel } from "../../lib/helpers";
import { SOLAR, COFFEE } from "../../lib/corpus";

// Contract: api.yaml research-jobs, reports; testability.md §5 (fake model call counts).

describe("holdout research", () => {
  isolateFakeModel();

  it("job succeeds with 3 stages in order and progress bounds (S2)", async () => {
    const t = await owner();
    const docs = await twoDocs(t.client, t.ws.id);
    const ids = docs.map((d) => d.id);
    const job = await (async () => {
      const r = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "What?", documentIds: ids });
      expectStatus(r, 202);
      return r.body.job;
    })();
    expect(job.stages.map((s: any) => s.name)).toEqual(["plan", "analyze", "synthesize"]);
    const done = await waitForJob(t.client, t.ws.id, job.id);
    expect(done.status).toBe("succeeded");
    expect(done.reportId).toBeTruthy();
    expect(typeof done.progress).toBe("number");
    expect(done.progress).toBeGreaterThanOrEqual(0);
    expect(done.progress).toBeLessThanOrEqual(100);
    for (const s of done.stages) expect(["pending", "running", "succeeded", "failed", "skipped"]).toContain(s.status);
  });

  it("fake model call counts: plan1 analyze3 synthesize1 = 5 ok (S2, §5)", async () => {
    const t = await owner();
    const docs = await twoDocs(t.client, t.ws.id);
    const ids = docs.map((d) => d.id);
    const job = await (async () => {
      const r = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "q", documentIds: ids });
      expectStatus(r, 202);
      return r.body.job;
    })();
    const done = await waitForJob(t.client, t.ws.id, job.id);
    expect(done.status).toBe("succeeded");
    const counts = await callsByStage(t.client, t.ws.id, job.id, "ok");
    expect(counts.plan).toBe(1);
    expect(counts.analyze).toBe(3);
    expect(counts.synthesize).toBe(1);
    const records = await usageRecords(t.client, t.ws.id, { jobId: job.id });
    expect(records.length).toBe(5);
    for (const r of records) {
      expect(r.kind).toBe("chat");
      expect(r.jobId).toBe(job.id);
      expect(r.costUsd).toBeCloseTo(CALL_COST, 6);
      expect(typeof r.stage).toBe("string");
    }
  });

  it("report citations are verbatim substrings of document text (S2)", async () => {
    const t = await owner();
    const docs = await twoDocs(t.client, t.ws.id);
    const ids = docs.map((d) => d.id);
    const job = await (async () => {
      const r = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "q", documentIds: ids });
      expectStatus(r, 202);
      return r.body.job;
    })();
    const done = await waitForJob(t.client, t.ws.id, job.id);
    expect(done.status).toBe("succeeded");
    const rep = await (async () => {
      const r = await t.client.get(`/api/workspaces/${t.ws.id}/reports/${done.reportId}`);
      expectStatus(r, 200);
      return r.body.report;
    })();
    expect(typeof rep.markdown).toBe("string");
    expect(rep.markdown).toMatch(/\[\d+\]/);
    expect(Array.isArray(rep.citations)).toBe(true);
    expect(rep.citations.length).toBeGreaterThan(0);
    // fetch doc texts
    const texts: Record<string, string> = {};
    for (const d of docs) {
      const tr = await t.client.get(`/api/workspaces/${t.ws.id}/documents/${d.id}/text`);
      expectStatus(tr, 200);
      texts[d.id] = tr.body.text;
    }
    for (const c of rep.citations) {
      expect(typeof c.marker).toBe("number");
      expect(c.marker).toBeGreaterThanOrEqual(1);
      expect(texts[c.documentId]).toBeTruthy();
      expect(texts[c.documentId].includes(c.quote)).toBe(true);
    }
    // markers in markdown subset of citation markers? at least one
    const ms = [...rep.markdown.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    expect(ms.length).toBeGreaterThan(0);
  });

  it("research job validation: question length, documentIds bounds, unknown doc (S2)", async () => {
    const t = await owner();
    const docs = await twoDocs(t.client, t.ws.id);
    const ids = docs.map((d) => d.id);
    // empty question
    expectError(await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "", documentIds: ids }), 400, "validation_error");
    // too long question
    expectError(await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "a".repeat(2001), documentIds: ids }), 400, "validation_error");
    // empty documentIds
    expectError(await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "q", documentIds: [] }), 400, "validation_error");
    // too many
    const many = Array(21).fill(ids[0]);
    expectError(await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "q", documentIds: many }), 400, "validation_error");
    // unknown doc
    expectError(await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "q", documentIds: [ids[0], "no-such-doc"] }), 404, "not_found");
  });

  it("cancel stops the job and no further model calls (S2, §5)", async () => {
    const t = await owner();
    // set high latency
    await (await import("../../lib/helpers")).fakeModel.set({ latencyMs: 300 });
    const docs = await twoDocs(t.client, t.ws.id);
    const ids = docs.map((d) => d.id);
    const job = await (async () => {
      const r = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "q", documentIds: ids });
      expectStatus(r, 202);
      return r.body.job;
    })();
    // wait until running
    const running = await waitForJob(t.client, t.ws.id, job.id, (j) => j.status === "running" || (j.stages ?? []).some((s: any) => s.status === "running"), 30_000);
    expect(running).toBeTruthy();
    // cancel
    const cr = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs/${job.id}/cancel`);
    expectStatus(cr, 202);
    const canceled = await waitForJob(t.client, t.ws.id, job.id, (j) => ["canceled", "succeeded", "failed", "budget_exceeded"].includes(j.status), 30_000);
    expect(canceled.status).toBe("canceled");
    // no further records after a short poll
    const before = (await usageRecords(t.client, t.ws.id, { jobId: job.id })).length;
    await (await import("../../lib/helpers")).sleep(500);
    const after = (await usageRecords(t.client, t.ws.id, { jobId: job.id })).length;
    expect(after).toBe(before);
    await (await import("../../lib/helpers")).fakeModel.reset();
  });

  it("retry invalid_state on succeeded job (S2)", async () => {
    const t = await owner();
    const docs = await twoDocs(t.client, t.ws.id);
    const ids = docs.map((d) => d.id);
    const job = await finishedJob(t.client, t.ws.id, ids);
    const r = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs/${job.id}/retry`);
    expectError(r, 409, "invalid_state");
  });

  it("cancel permissions and invalid_state (S2, S4)", async () => {
    const t = await owner();
    const member = await addMember(t, "member");
    const helpers = await import("../../lib/helpers");
    await helpers.fakeModel.set({ latencyMs: 200 });
    const docs = await twoDocs(t.client, t.ws.id);
    const ids = docs.map((d) => d.id);
    const job = await (async () => {
      const r = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "q", documentIds: ids });
      expectStatus(r, 202);
      return r.body.job;
    })();
    // member cannot cancel (not creator/admin/owner)
    expectError(await member.client.post(`/api/workspaces/${t.ws.id}/research-jobs/${job.id}/cancel`), 403);
    await waitForJob(t.client, t.ws.id, job.id);
    // after finished, cancel -> 409
    const r = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs/${job.id}/cancel`);
    expectError(r, 409, "invalid_state");
    await helpers.fakeModel.reset();
  });

  it("budget exceeded job status when budget 0 (S3)", async () => {
    const t = await owner();
    await t.client.put(`/api/workspaces/${t.ws.id}/budget`, { monthlyUsd: 0 });
    const docs = await twoDocs(t.client, t.ws.id);
    const ids = docs.map((d) => d.id);
    const res = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "q", documentIds: ids });
    if (res.status === 402) {
      expectError(res, 402, "budget_exceeded");
    } else {
      expectStatus(res, 202);
      const done = await waitForJob(t.client, t.ws.id, res.body.job.id);
      expect(done.status).toBe("budget_exceeded");
    }
  });
  it("retry a failed (permanent fault) job succeeds after reset (S2, §5)", async () => {
    const { owner, twoDocs, waitForJob } = await import("../../lib/helpers");
    const t = await owner();
    const docs = await twoDocs(t.client, t.ws.id);
    const ids = docs.map((d: any) => d.id);
    const helpers = await import("../../lib/helpers");
    await helpers.fakeModel.set({ faults: [{ stage: "synthesize", mode: "permanent" }] });
    const res = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs`, { question: "q", documentIds: ids });
    helpers.expectStatus(res, 202);
    const failed = await waitForJob(t.client, t.ws.id, res.body.job.id, (j: any) => j.status === "failed", 30000);
    expect(failed.status).toBe("failed");
    await helpers.fakeModel.reset();
    const rr = await t.client.post(`/api/workspaces/${t.ws.id}/research-jobs/${res.body.job.id}/retry`);
    helpers.expectStatus(rr, 202);
    const done = await waitForJob(t.client, t.ws.id, res.body.job.id, (j: any) => ["succeeded","failed","budget_exceeded","canceled"].includes(j.status), 30000);
    expect(done.status).toBe("succeeded");
  });

});