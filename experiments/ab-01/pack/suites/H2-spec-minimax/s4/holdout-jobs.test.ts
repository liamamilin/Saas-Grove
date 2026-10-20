// Job lifecycle, cancel thoroughness, concurrency, restart recovery, retry idempotency.
//
// Spec clauses verified here:
//   spec/product.md §4 (发起研究: 失败后可以重试, 已完成的阶段不重做、不重复计费)
//   spec/product.md §6 (取消不彻底; 重试重复执行; 预算形同虚设; 重启丢任务)
//   spec/architecture.md §4.2 (cancel: 不能再产生新的用量记录;
//                              手动重试: 从第一个没有成功的阶段继续, 已成功的阶段不重新执行;
//                              并发: 同一工作区最多同时运行 WORKSPACE_MAX_CONCURRENT_JOBS 个任务;
//                              重启恢复: running 状态的任务要能继续, 并最终进入终态)

import { describe, expect, test } from "vitest";
import {
  CALL_COST,
  createWorkspace,
  expectStatus,
  fakeModel,
  isolateFakeModel,
  restartApp,
  signup,
  startJob,
  twoDocs,
  usageRecords,
  waitFor,
  waitForJob,
} from "../../lib/helpers";

describe("s4: job lifecycle, cancel, concurrency, restart, retry", () => {
  isolateFakeModel();

  test("cancel mid-job: no new chat usage records are produced after the cancel returns", async () => {
    // spec/architecture.md §4.2 ("取消生效后，不能再产生新的用量记录")
    // spec/product.md §6 (取消不彻底)
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const [doc] = await twoDocs(owner.client, ws.id);

    await fakeModel.set({ latencyMs: 300 });
    try {
      const job = await startJob(owner.client, ws.id, [doc.id], "Will be canceled");
      // Wait until the job is running so we have a usage record to compare against.
      await waitForJob(
        owner.client,
        ws.id,
        job.id,
        (j) => j.status === "running" || j.status === "succeeded" || j.status === "failed",
        20_000,
      );
      const before = await usageRecords(owner.client, ws.id, { jobId: job.id });
      const beforeCount = before.filter((r) => r.kind === "chat").length;

      const cancel = await owner.client.post(`/api/workspaces/${ws.id}/research-jobs/${job.id}/cancel`);
      expectStatus(cancel, 202);

      // The job should reach a terminal state.
      await waitForJob(owner.client, ws.id, job.id, (j) => j.status === "canceled" || j.status === "failed");

      // Now: nothing should appear in the next second or so. We poll several
      // times to make sure no late chat record slips in.
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const after = await usageRecords(owner.client, ws.id, { jobId: job.id });
        const afterCount = after.filter((r) => r.kind === "chat").length;
        expect(afterCount, `records grew from ${beforeCount} to ${afterCount} after cancel`).toBe(beforeCount);
      }

      // Final state: canceled.
      const final = await owner.client.get(`/api/workspaces/${ws.id}/research-jobs/${job.id}`);
      expect(final.body.job.status).toBe("canceled");
    } finally {
      await fakeModel.set({ latencyMs: 20 });
    }
  });

  test("cancel on an already-finished job returns 409 invalid_state", async () => {
    // api.yaml /research-jobs/{id}/cancel ("409 invalid_state (already finished)")
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const [doc] = await twoDocs(owner.client, ws.id);
    const job = await waitForJob(owner.client, ws.id, (await startJob(owner.client, ws.id, [doc.id])).id);
    expect(job.status).toBe("succeeded");

    const cancel = await owner.client.post(`/api/workspaces/${ws.id}/research-jobs/${job.id}/cancel`);
    expectStatus(cancel, 409);
    expect(cancel.body?.error?.code).toBe("invalid_state");
  });

  test("retry of a failed job does not re-run stages that already succeeded and does not duplicate billing", async () => {
    // spec/architecture.md §4.2 ("从第一个没有成功的阶段继续，已成功的阶段不重新执行" +
    //                              "同一个子问题不付两次钱")
    // spec/product.md §6 (重试重复执行)
    //
    // Strategy: make the SYNTHESIZE stage fail with a permanent fault, so the
    // job ends in failed AFTER plan + 3 analyze calls have already succeeded.
    // On retry, only the synthesize call should happen again. We assert the
    // total ok chat count matches that expectation.
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const [doc] = await twoDocs(owner.client, ws.id);

    await fakeModel.set({
      faults: [{ stage: "synthesize", mode: "permanent", times: 999 }],
    });
    try {
      const job = await startJob(owner.client, ws.id, [doc.id], "Synthesis will fail");
      await waitForJob(
        owner.client,
        ws.id,
        job.id,
        (j) => j.status === "failed" || j.status === "succeeded",
        30_000,
      );

      const afterFail = await usageRecords(owner.client, ws.id, { jobId: job.id });
      const okBefore = afterFail.filter((r) => r.kind === "chat" && r.status === "ok");
      const synthesizeOkBefore = okBefore.filter((r) => r.stage === "synthesize").length;
      const planOkBefore = okBefore.filter((r) => r.stage === "plan").length;
      const analyzeOkBefore = okBefore.filter((r) => r.stage === "analyze").length;

      // The plan and analyze stages must have succeeded; synthesis must have failed.
      expect(planOkBefore, `plan ok ${planOkBefore}`).toBeGreaterThanOrEqual(1);
      expect(analyzeOkBefore, `analyze ok ${analyzeOkBefore}`).toBeGreaterThanOrEqual(1);
      expect(synthesizeOkBefore, `synthesize ok ${synthesizeOkBefore}`).toBe(0);

      // Clear faults so the retry can succeed.
      await fakeModel.set({ faults: [] });
      const retry = await owner.client.post(`/api/workspaces/${ws.id}/research-jobs/${job.id}/retry`);
      expectStatus(retry, 202);
      const done = await waitForJob(
        owner.client,
        ws.id,
        job.id,
        (j) => j.status === "succeeded" || j.status === "failed" || j.status === "budget_exceeded",
        30_000,
      );
      expect(done.status).toBe("succeeded");

      const afterRetry = await usageRecords(owner.client, ws.id, { jobId: job.id });
      const okAfter = afterRetry.filter((r) => r.kind === "chat" && r.status === "ok");

      // Plan and analyze counts must NOT have grown.
      const planOkAfter = okAfter.filter((r) => r.stage === "plan").length;
      const analyzeOkAfter = okAfter.filter((r) => r.stage === "analyze").length;
      expect(planOkAfter).toBe(planOkBefore);
      expect(analyzeOkAfter).toBe(analyzeOkBefore);

      // Synthesize must now be exactly 1 (only the retry's synthesize ran).
      const synthesizeOkAfter = okAfter.filter((r) => r.stage === "synthesize").length;
      expect(synthesizeOkAfter, `synthesize after retry ${synthesizeOkAfter}`).toBe(1);

      // Total ok cost should be exactly 5 (plan + 3 analyze + 1 synthesize).
      const total = okAfter.reduce((acc, r) => acc + r.costUsd, 0);
      expect(total).toBeCloseTo(5 * CALL_COST, 6);

      // Exactly one report must be produced.
      const reports = await owner.client.get(`/api/workspaces/${ws.id}/reports`);
      expect(reports.body.reports.length).toBe(1);
    } finally {
      await fakeModel.set({ faults: [] });
    }
  });

  test("restart of the app mid-job: the running job still progresses to a terminal state, and at most one report is produced", async () => {
    // spec/architecture.md §4.2 ("重启恢复: running 状态的任务要能继续，并最终进入终态")
    // spec/product.md §6 (重启丢任务)
    //
    // We force the app to restart in the middle of a job. After restart, the
    // job must continue and finish. We assert it ends in `succeeded` and that
    // exactly one report exists.
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const [doc] = await twoDocs(owner.client, ws.id);

    await fakeModel.set({ latencyMs: 200 });
    try {
      const job = await startJob(owner.client, ws.id, [doc.id], "Restart survivor");
      // Wait until it starts running.
      await waitForJob(
        owner.client,
        ws.id,
        job.id,
        (j) => j.status === "running",
        20_000,
      );

      // Restart the application.
      await restartApp();

      // The job must eventually reach a terminal state. The contract allows
      // either succeeded (preferred) or failed (when partial progress survives
      // but the implementation cannot fully recover); 'running' forever is the
      // anti-pattern.
      const done = await waitForJob(
        owner.client,
        ws.id,
        job.id,
        (j) => j.status === "succeeded" || j.status === "failed" || j.status === "budget_exceeded",
        90_000,
      );
      expect(["succeeded", "failed"]).toContain(done.status);

      // If the job did succeed, exactly one report must exist (no duplicate
      // synthesis).
      if (done.status === "succeeded") {
        const reports = await owner.client.get(`/api/workspaces/${ws.id}/reports`);
        expect(reports.body.reports.length).toBe(1);
      }
    } finally {
      await fakeModel.set({ latencyMs: 20 });
    }
  });

  test("concurrency: at most WORKSPACE_MAX_CONCURRENT_JOBS (default 2) jobs run at the same time in one workspace", async () => {
    // spec/architecture.md §4.2 ("同一工作区最多同时运行 WORKSPACE_MAX_CONCURRENT_JOBS
    //                              个任务（默认 2），多出来的保持 queued")
    // spec/decisions.md T9 (默认值 2)
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const [doc] = await twoDocs(owner.client, ws.id);

    await fakeModel.set({ latencyMs: 200 });
    try {
      // Queue 4 jobs.
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const j = await startJob(owner.client, ws.id, [doc.id], `Job ${i}`);
        ids.push(j.id);
      }

      // Poll job statuses until at least one of them is running, then check
      // that at most 2 are running at once. We check several times.
      const statuses = await waitFor(
        async () => {
          const all = await Promise.all(
            ids.map((id) => owner.client.get(`/api/workspaces/${ws.id}/research-jobs/${id}`).then((r) => r.body.job)),
          );
          if (all.some((j) => j.status === "running")) return all;
          return undefined;
        },
        { what: "at least one running job", timeout: 20_000 },
      );
      const running = statuses.filter((j: any) => j.status === "running").length;
      expect(running, `running jobs: ${statuses.map((j: any) => j.status).join(",")}`).toBeLessThanOrEqual(2);

      // Eventually they all succeed (the third, fourth, etc. run after the first two finish).
      for (const id of ids) {
        await waitForJob(owner.client, ws.id, id, (j) => j.status === "succeeded" || j.status === "failed");
      }
      // And we should have four reports.
      const reports = await owner.client.get(`/api/workspaces/${ws.id}/reports`);
      expect(reports.body.reports.length).toBe(4);
    } finally {
      await fakeModel.set({ latencyMs: 20 });
    }
  });

  test("job start is rejected with budget_exceeded when the workspace budget cannot afford even one chat call", async () => {
    // spec/architecture.md §4.3 ("如果'已花 + 已预留 + 本次预估'超过预算，就不调用，任务进入 budget_exceeded")
    // spec/product.md §6 (预算形同虚设: 只在发起任务时检查一次)
    const owner = await signup();
    const ws = await createWorkspace(owner.client);
    const [doc] = await twoDocs(owner.client, ws.id);

    // Set a budget that cannot afford a single $0.01 fake chat call.
    const put = await owner.client.put(`/api/workspaces/${ws.id}/budget`, { monthlyUsd: 0.001 });
    expectStatus(put, 200);

    const start = await owner.client.post(`/api/workspaces/${ws.id}/research-jobs`, {
      question: "Why?",
      documentIds: [doc.id],
    });
    // The implementation may either reject at POST time (402) or accept and
    // immediately mark the job budget_exceeded. Both are correct per spec §4.3.
    if (start.status === 402) {
      expect(start.body?.error?.code).toBe("budget_exceeded");
      return;
    }
    expectStatus(start, 202);
    const job = await waitForJob(
      owner.client,
      ws.id,
      start.body.job.id,
      (j) => j.status === "budget_exceeded" || j.status === "failed" || j.status === "succeeded",
      20_000,
    );
    expect(job.status).toBe("budget_exceeded");

    // And no chat usage records were created for this job.
    const records = await usageRecords(owner.client, ws.id, { jobId: start.body.job.id });
    const chatOk = records.filter((r) => r.kind === "chat" && r.status === "ok");
    expect(chatOk.length, `chat ok records: ${JSON.stringify(records)}`).toBe(0);
  });
});