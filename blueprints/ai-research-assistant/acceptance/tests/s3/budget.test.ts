import { describe, expect, it } from "vitest";
import {
  CALL_COST,
  EPS,
  callsByStage,
  expectError,
  expectStatus,
  fakeModel,
  isolateFakeModel,
  owner,
  sleep,
  startJob,
  twoDocs,
  usageRecords,
  waitForJob,
} from "../../lib/helpers";

async function spent(client: any, wsId: string) {
  const res = await client.get(`/api/workspaces/${wsId}/usage`);
  expectStatus(res, 200);
  return res.body.spentUsd as number;
}

describe("S3 budget enforcement", () => {
  isolateFakeModel();

  it("stops a running job before it overspends", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    // Room for three calls (plan + two analyses), not for the fourth.
    expectStatus(await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 0.035 }), 200);

    const job = await startJob(team.client, team.ws.id, docs.map((d) => d.id));
    const stopped = await waitForJob(team.client, team.ws.id, job.id);
    expect(stopped.status).toBe("budget_exceeded");
    expect(stopped.error?.code).toBe("budget_exceeded");
    expect(stopped.reportId ?? null).toBeNull();
    expect(await spent(team.client, team.ws.id)).toBeLessThanOrEqual(0.035 + EPS);

    const before = (await usageRecords(team.client, team.ws.id, { jobId: job.id })).length;
    await sleep(1_000);
    expect((await usageRecords(team.client, team.ws.id, { jobId: job.id })).length).toBe(before);
  });

  it("keeps concurrent jobs within one call per job of the budget", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const ids = docs.map((d) => d.id);
    expectStatus(await team.client.put(`/api/workspaces/${team.ws.id}/budget`, { monthlyUsd: 0.045 }), 200);
    await fakeModel.set({ latencyMs: 100 });

    const a = await startJob(team.client, team.ws.id, ids);
    const b = await startJob(team.client, team.ws.id, ids);
    const statuses = [
      (await waitForJob(team.client, team.ws.id, a.id)).status,
      (await waitForJob(team.client, team.ws.id, b.id)).status,
    ];
    // Ten calls are needed and four and a half fit, so at least one job must stop.
    expect(statuses).toContain("budget_exceeded");
    expect(await spent(team.client, team.ws.id)).toBeLessThanOrEqual(0.045 + 2 * CALL_COST + EPS);
  });

  it("refuses new jobs once the budget is spent, and resumes after it is raised", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const ids = docs.map((d) => d.id);
    const budget = `/api/workspaces/${team.ws.id}/budget`;
    expectStatus(await team.client.put(budget, { monthlyUsd: 0.025 }), 200);

    const job = await startJob(team.client, team.ws.id, ids);
    const stopped = await waitForJob(team.client, team.ws.id, job.id);
    expect(stopped.status).toBe("budget_exceeded");
    const paidSoFar = await callsByStage(team.client, team.ws.id, job.id);
    expect(paidSoFar.plan).toBe(1);

    expectStatus(await team.client.put(budget, { monthlyUsd: 0.015 }), 200); // below what is already spent
    const refused = await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs`, { question: "More?", documentIds: ids });
    expectError(refused, 402, "budget_exceeded");

    expectStatus(await team.client.put(budget, { monthlyUsd: null }), 200);
    expectStatus(await team.client.post(`/api/workspaces/${team.ws.id}/research-jobs/${job.id}/retry`), 202);
    const done = await waitForJob(team.client, team.ws.id, job.id);
    expect(done.status, JSON.stringify(done.error)).toBe("succeeded");
    // Work already paid for is not bought twice.
    expect(await callsByStage(team.client, team.ws.id, job.id)).toEqual({ plan: 1, analyze: 3, synthesize: 1 });
    expect(Math.abs((await spent(team.client, team.ws.id)) - 5 * CALL_COST)).toBeLessThan(EPS);
  });
});
