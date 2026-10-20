// Held-out acceptance tests: automatic retries, non-retryable failures, manual retry and
// step-level idempotency of research jobs.
//
// Clauses under test:
//   * spec/architecture.md §4.2 — "可重试的模型错误（429、5xx、超时），同一次调用最多尝试 3 次
//     （不多不少）… 仍然失败，或者遇到不可重试的错误，任务就进入 failed，error.code = model_error";
//     "手动重试：只允许对 failed 和 budget_exceeded 状态的任务重试。从第一个没有成功的阶段继续，
//     已成功的阶段不重新执行"; "步骤级幂等：… 重试或重启后，只补做没完成的子问题，同一个子问题不付两次钱".
//   * spec/architecture.md §5 / contract testability.md §5 — transient faults fail the next `times`
//     attempts of a stage, permanent faults fail every attempt.
//   * spec/product.md §4.4 — "失败后可以重试，已完成的阶段不重做、不重复计费".

import { describe, expect, test } from "vitest";
import {
  CALL_COST,
  addText,
  fakeModel,
  isolateFakeModel,
  owner,
  startJob,
  usageRecords,
  waitForJob,
} from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";

/** Successful (or failed) chat calls of one job, counted per stage. */
function chatByStage(records: any[], status: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of records) {
    if (r.kind !== "chat" || r.status !== status) continue;
    counts[r.stage] = (counts[r.stage] ?? 0) + 1;
  }
  return counts;
}

describe("research jobs: retries and step-level idempotency", () => {
  isolateFakeModel();

  test("a stage that keeps failing transiently fails the job after exactly three attempts", async () => {
    // architecture.md §4.2: 最多尝试 3 次（不多不少）; §5: transient × 3 fails three attempts.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    await fakeModel.set({ faults: [{ stage: "analyze", mode: "transient", times: 3 }] });

    const job = await startJob(team.client, team.ws.id, [doc.id]);
    const done = await waitForJob(team.client, team.ws.id, job.id);

    expect(done.status).toBe("failed");
    expect(done.error?.code).toBe("model_error");

    const records = (await usageRecords(team.client, team.ws.id, { jobId: job.id })) ?? [];
    const failed = chatByStage(records, "error");
    const ok = chatByStage(records, "ok");
    expect(failed.analyze).toBe(3); // three attempts, not four
    expect(ok.analyze ?? 0).toBe(0);
    expect(ok.plan).toBe(1); // plan had already succeeded and was not repeated
    expect(ok.synthesize ?? 0).toBe(0);

    // api.yaml Job.stages: always the three stages, in order.
    expect((done.stages ?? []).map((s: any) => s.name)).toEqual(["plan", "analyze", "synthesize"]);
    expect(done.stages?.[0]?.status).toBe("succeeded");
  });

  test("a permanent fault is not retried: the job fails after a single call", async () => {
    // architecture.md §4.2: 遇到不可重试的错误，任务就进入 failed; §5: permanent 是不可重试错误.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    await fakeModel.set({ faults: [{ stage: "plan", mode: "permanent" }] });

    const job = await startJob(team.client, team.ws.id, [doc.id]);
    const done = await waitForJob(team.client, team.ws.id, job.id);

    expect(done.status).toBe("failed");
    expect(done.error?.code).toBe("model_error");

    const records = (await usageRecords(team.client, team.ws.id, { jobId: job.id })) ?? [];
    expect(records.filter((r: any) => r.kind === "chat").length).toBe(1);
    expect(chatByStage(records, "error").plan).toBe(1);
  });

  test("retrying a failed job resumes at the first unfinished stage without re-running plan", async () => {
    // architecture.md §4.2 手动重试; product.md §4.4: 已完成的阶段不重做、不重复计费.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    await fakeModel.set({ faults: [{ stage: "analyze", mode: "transient", times: 3 }] });

    const job = await startJob(team.client, team.ws.id, [doc.id]);
    const failed = await waitForJob(team.client, team.ws.id, job.id);
    expect(failed.status).toBe("failed");

    await fakeModel.reset();
    const retry = await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs/${job.id}/retry`);
    expect(retry.status, retry.text).toBe(202);

    const done = await waitForJob(team.client, team.ws.id, job.id, (j) => j.status === "succeeded", 90_000);
    expect(done.status).toBe("succeeded");

    const ok = chatByStage((await usageRecords(team.client, team.ws.id, { jobId: job.id })) ?? [], "ok");
    expect(ok.plan).toBe(1); // the succeeded stage was not paid for again
    expect(ok.analyze).toBe(3); // only the unfinished sub-questions were done
    expect(ok.synthesize).toBe(1);
  });

  test("retrying a budget_exceeded job does not repeat or re-charge completed stages", async () => {
    // architecture.md §4.3 (budget_exceeded) + §4.2 (resume at first unfinished stage);
    // product.md §4.4: 已完成的阶段不重做、不重复计费.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    const set = await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 2 * CALL_COST });
    expect(set.status, set.text).toBe(200);

    const job = await startJob(team.client, team.ws.id, [doc.id]);
    const stopped = await waitForJob(team.client, team.ws.id, job.id);
    expect(stopped.status).toBe("budget_exceeded");

    const before = chatByStage((await usageRecords(team.client, team.ws.id, { jobId: job.id })) ?? [], "ok");
    expect(before.plan).toBe(1); // the job really started before the budget stopped it

    const raised = await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: null });
    expect(raised.status, raised.text).toBe(200);

    const retry = await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs/${job.id}/retry`);
    expect(retry.status, retry.text).toBe(202);

    const done = await waitForJob(team.client, team.ws.id, job.id, (j) => j.status === "succeeded", 90_000);
    expect(done.status).toBe("succeeded");

    const ok = chatByStage((await usageRecords(team.client, team.ws.id, { jobId: job.id })) ?? [], "ok");
    expect(ok.plan).toBe(1); // not re-run
    expect(ok.analyze).toBe(3);
    expect(ok.synthesize).toBe(1);
    // five charged chat calls in total, i.e. the completed stages were not charged twice
    expect((ok.plan ?? 0) + (ok.analyze ?? 0) + (ok.synthesize ?? 0)).toBe(5);
  });

  test("a single transient failure is retried automatically and the job still succeeds", async () => {
    // architecture.md §4.2: 可重试的模型错误…最多尝试 3 次; product.md §7: 临时错误自动重试.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    await fakeModel.set({ faults: [{ stage: "analyze", mode: "transient", times: 1 }] });

    const job = await startJob(team.client, team.ws.id, [doc.id]);
    const done = await waitForJob(team.client, team.ws.id, job.id, (j) => j.status === "succeeded", 90_000);
    expect(done.status, JSON.stringify(done.error)).toBe("succeeded");

    const records = (await usageRecords(team.client, team.ws.id, { jobId: job.id })) ?? [];
    const ok = chatByStage(records, "ok");
    const err = chatByStage(records, "error");
    expect(ok).toEqual({ plan: 1, analyze: 3, synthesize: 1 });
    expect(err.analyze).toBe(1); // the one failed attempt was retried
  });
});
