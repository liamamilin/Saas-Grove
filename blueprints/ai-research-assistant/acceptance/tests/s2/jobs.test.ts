import { describe, expect, it } from "vitest";
import {
  addMember,
  callsByStage,
  expectError,
  expectStatus,
  fakeModel,
  finishedJob,
  getJob,
  isolateFakeModel,
  owner,
  restartApp,
  sleep,
  startJob,
  twoDocs,
  usageRecords,
  waitFor,
  waitForJob,
} from "../../lib/helpers";

const STAGES = ["plan", "analyze", "synthesize"];

async function reportsOfJob(client: any, wsId: string, jobId: string) {
  const res = await client.get(`/api/workspaces/${wsId}/reports`);
  expectStatus(res, 200);
  return res.body.reports.filter((r: any) => r.jobId === jobId);
}

describe("S2 research jobs", () => {
  isolateFakeModel();

  it("runs plan, analyze and synthesize, and links a report", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await startJob(team.client, team.ws.id, docs.map((d) => d.id), "How do these topics compare?");
    expect(["queued", "running"]).toContain(job.status);
    expect(job.stages.map((s: any) => s.name)).toEqual(STAGES);

    const done = await waitForJob(team.client, team.ws.id, job.id);
    expect(done.status, JSON.stringify(done.error)).toBe("succeeded");
    expect(done.stages.map((s: any) => s.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(done.progress).toBe(100);
    expect(done.reportId).toBeTruthy();
    expect(await callsByStage(team.client, team.ws.id, job.id)).toEqual({ plan: 1, analyze: 3, synthesize: 1 });

    const list = await team.client.get(`/api/workspaces/${team.ws.id}/research-jobs`);
    expect(list.body.jobs.map((j: any) => j.id)).toContain(job.id);
  });

  it("reports progress that never goes backwards", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    await fakeModel.set({ latencyMs: 150 });
    const job = await startJob(team.client, team.ws.id, docs.map((d) => d.id));

    const seen: { status: string; progress: number }[] = [];
    await waitFor(
      async () => {
        const j = await getJob(team.client, team.ws.id, job.id);
        seen.push({ status: j.status, progress: j.progress });
        return ["succeeded", "failed", "canceled", "budget_exceeded"].includes(j.status);
      },
      { interval: 40, what: "job to finish" },
    );
    expect(seen.some((s) => s.status === "running"), JSON.stringify(seen)).toBe(true);
    for (let i = 1; i < seen.length; i++) expect(seen[i].progress).toBeGreaterThanOrEqual(seen[i - 1].progress);
    expect(seen[seen.length - 1]).toEqual({ status: "succeeded", progress: 100 });
  });

  it("stops calling the model once a job is canceled", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    await fakeModel.set({ latencyMs: 400 });
    const job = await startJob(team.client, team.ws.id, docs.map((d) => d.id));
    await waitFor(async () => (await callsByStage(team.client, team.ws.id, job.id)).plan === 1, { what: "plan to finish" });

    const cancel = await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs/${job.id}/cancel`);
    expectStatus(cancel, 202);
    const canceled = await waitForJob(team.client, team.ws.id, job.id, (j) => j.status === "canceled", 10_000);
    expect(canceled.reportId ?? null).toBeNull();

    await sleep(600); // let an in-flight call settle
    const settled = (await usageRecords(team.client, team.ws.id, { jobId: job.id })).length;
    await sleep(2_000);
    expect((await usageRecords(team.client, team.ws.id, { jobId: job.id })).length).toBe(settled);
    const ok = await callsByStage(team.client, team.ws.id, job.id);
    expect(ok.synthesize ?? 0).toBe(0);
    expect((await getJob(team.client, team.ws.id, job.id)).status).toBe("canceled");
  });

  it("aborts the call in flight when a job is canceled", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    await fakeModel.set({ latencyMs: 3_000 });
    const job = await startJob(team.client, team.ws.id, docs.map((d) => d.id));
    // The plan call finishes after its 3 s wait; the first analyze call then starts waiting.
    await waitFor(async () => (await callsByStage(team.client, team.ws.id, job.id)).plan === 1, {
      what: "plan to finish",
      timeout: 20_000,
    });
    // Cancel while that call is waiting: once the job reports analyze as running (not every product reports
    // it promptly, so only wait a little), plus a moment for the call itself to start. Well inside the 3 s.
    const waitingSince = Date.now();
    while (Date.now() - waitingSince < 1_500) {
      if ((await getJob(team.client, team.ws.id, job.id)).stages?.[1]?.status === "running") break;
      await sleep(100);
    }
    await sleep(500);

    expectStatus(await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs/${job.id}/cancel`), 202);
    await waitForJob(team.client, team.ws.id, job.id, (j) => j.status === "canceled", 10_000);
    await sleep(400);
    const atCancel = (await usageRecords(team.client, team.ws.id, { jobId: job.id })).length;

    // Longer than the latency: an analyze call that was not aborted finishes now and is recorded.
    await sleep(4_000);
    const later = await usageRecords(team.client, team.ws.id, { jobId: job.id });
    expect(later.length, "a call that was running when the job was canceled still produced a usage record").toBe(atCancel);
    expect((await callsByStage(team.client, team.ws.id, job.id)).analyze ?? 0).toBe(0);
  });

  it("cancels a queued job before it ever runs", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const ids = docs.map((d) => d.id);
    await fakeModel.set({ latencyMs: 500 });
    const first = await startJob(team.client, team.ws.id, ids);
    const second = await startJob(team.client, team.ws.id, ids);
    const third = await startJob(team.client, team.ws.id, ids);
    // At most two run at once, so the third waits.
    await waitFor(async () => (await getJob(team.client, team.ws.id, first.id)).status === "running", { what: "first job to run" });
    expect((await getJob(team.client, team.ws.id, third.id)).status).toBe("queued");

    expectStatus(await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs/${third.id}/cancel`), 202);
    await waitForJob(team.client, team.ws.id, third.id, (j) => j.status === "canceled", 10_000);
    await waitForJob(team.client, team.ws.id, first.id);
    await waitForJob(team.client, team.ws.id, second.id);
    expect((await getJob(team.client, team.ws.id, third.id)).status).toBe("canceled");
    expect(await usageRecords(team.client, team.ws.id, { jobId: third.id })).toEqual([]);
  });

  it("refuses to cancel a finished job", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const done = await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));
    expectError(await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs/${done.id}/cancel`), 409, "invalid_state");
  });

  it("retries transient model errors on its own", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    await fakeModel.set({ faults: [{ stage: "analyze", mode: "transient", times: 1 }] });
    const done = await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));
    expect(await callsByStage(team.client, team.ws.id, done.id)).toEqual({ plan: 1, analyze: 3, synthesize: 1 });
    expect(await callsByStage(team.client, team.ws.id, done.id, "error")).toEqual({ analyze: 1 });
  });

  it("retries a failed job from the failed stage without redoing earlier ones", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    await fakeModel.set({ faults: [{ stage: "synthesize", mode: "permanent" }] });
    const job = await startJob(team.client, team.ws.id, docs.map((d) => d.id));
    const failed = await waitForJob(team.client, team.ws.id, job.id);
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("model_error");
    expect(failed.stages.map((s: any) => s.status)).toEqual(["succeeded", "succeeded", "failed"]);

    await fakeModel.reset();
    expectStatus(await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs/${job.id}/retry`), 202);
    const done = await waitForJob(team.client, team.ws.id, job.id);
    expect(done.status, JSON.stringify(done.error)).toBe("succeeded");
    expect(await callsByStage(team.client, team.ws.id, job.id)).toEqual({ plan: 1, analyze: 3, synthesize: 1 });
    expect(await reportsOfJob(team.client, team.ws.id, job.id)).toHaveLength(1);
  });

  it("tries one call exactly three times, backing off, before failing the job", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    await fakeModel.set({ faults: [{ stage: "analyze", mode: "transient", times: 3 }] });
    const job = await startJob(team.client, team.ws.id, docs.map((d) => d.id));
    const failed = await waitForJob(team.client, team.ws.id, job.id);
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("model_error");

    const attempts = (await usageRecords(team.client, team.ws.id, { jobId: job.id }))
      .filter((r) => r.kind === "chat" && r.stage === "analyze" && r.status === "error")
      .map((r) => Date.parse(r.createdAt))
      .sort((a, b) => a - b);
    expect(attempts).toHaveLength(3);
    // At least 200 ms before the second attempt, doubling after (some slack for timestamps).
    expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(150);
    expect(attempts[2] - attempts[1]).toBeGreaterThanOrEqual(300);
  });

  it("refuses to retry a job that did not fail", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const done = await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));
    expectError(await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs/${done.id}/retry`), 409, "invalid_state");
  });

  it("runs at most two jobs at once per workspace", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    await fakeModel.set({ latencyMs: 250 });
    const jobs: any[] = [];
    for (let i = 0; i < 4; i++) jobs.push(await startJob(team.client, team.ws.id, docs.map((d) => d.id)));

    let maxRunning = 0;
    await waitFor(
      async () => {
        const res = await team.client.get(`/api/workspaces/${team.ws.id}/research-jobs`);
        const mine = res.body.jobs.filter((j: any) => jobs.some((x) => x.id === j.id));
        maxRunning = Math.max(maxRunning, mine.filter((j: any) => j.status === "running").length);
        return mine.length === 4 && mine.every((j: any) => j.status === "succeeded");
      },
      { interval: 60, timeout: 90_000, what: "all four jobs to succeed" },
    );
    expect(maxRunning).toBeGreaterThan(0);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it("finishes a job that was running when the application restarted, without redoing finished steps", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    await fakeModel.set({ latencyMs: 500 });
    const job = await startJob(team.client, team.ws.id, docs.map((d) => d.id));
    await waitFor(async () => ((await callsByStage(team.client, team.ws.id, job.id)).analyze ?? 0) >= 2, {
      what: "two analyses to finish",
    });

    await restartApp();

    const done = await waitForJob(team.client, team.ws.id, job.id, undefined, 120_000);
    expect(done.status, JSON.stringify(done.error)).toBe("succeeded");
    const calls = await callsByStage(team.client, team.ws.id, job.id);
    expect(calls.plan).toBe(1);
    // Two analyses were paid for before the restart; at most the one in flight may be redone.
    expect(calls.analyze).toBeGreaterThanOrEqual(3);
    expect(calls.analyze).toBeLessThanOrEqual(4);
    expect(calls.synthesize).toBe(1);
    expect(await reportsOfJob(team.client, team.ws.id, job.id)).toHaveLength(1);
  });

  it("hides a job from other workspaces", async () => {
    const a = await owner();
    const b = await owner();
    const docs = await twoDocs(a.client, a.ws.id);
    const done = await finishedJob(a.client, a.ws.id, docs.map((d) => d.id));
    expectStatus(await a.client.get(`/api/workspaces/${a.ws.id}/research-jobs/${done.id}`), 200);

    expectError(await b.client.get(`/api/workspaces/${a.ws.id}/research-jobs/${done.id}`), 404, "not_found");
    expectError(await b.client.get(`/api/workspaces/${b.ws.id}/research-jobs/${done.id}`), 404, "not_found");
    expectError(await b.client.post(`/api/workspaces/${b.ws.id}/research-jobs/${done.id}/cancel`), 404, "not_found");
    expectError(await b.client.post(`/api/workspaces/${b.ws.id}/research-jobs/${done.id}/retry`), 404, "not_found");
  });

  it("lets members cancel only their own jobs, and admins any job", async () => {
    const team = await owner();
    const member = await addMember(team, "member");
    const admin = await addMember(team, "admin");
    const docs = await twoDocs(team.client, team.ws.id);
    const ids = docs.map((d) => d.id);
    await fakeModel.set({ latencyMs: 400 });
    const ownersJob = await startJob(team.client, team.ws.id, ids);
    const membersJob = await startJob(member.client, team.ws.id, ids);
    const base = `/api/workspaces/${team.ws.id}/research-jobs`;

    expectError(await member.client.post(`${base}/${ownersJob.id}/cancel`), 403, "forbidden");
    expectStatus(await member.client.post(`${base}/${membersJob.id}/cancel`), 202);
    expectStatus(await admin.client.post(`${base}/${ownersJob.id}/cancel`), 202);
    await waitForJob(team.client, team.ws.id, ownersJob.id, (j) => j.status === "canceled", 10_000);
  });
});
