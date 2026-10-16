import { describe, expect, it } from "vitest";
import {
  CALL_COST,
  EPS,
  addMember,
  expectError,
  expectStatus,
  fakeModel,
  finishedJob,
  isolateFakeModel,
  owner,
  twoDocs,
  usageRecords,
} from "../../lib/helpers";

const sum = (records: any[]) => records.reduce((t, r) => t + r.costUsd, 0);

describe("S3 usage accounting", () => {
  isolateFakeModel();

  it("records every model call with its cost, and sums it", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    const job = await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));

    const chat = (await usageRecords(team.client, team.ws.id, { jobId: job.id })).filter((r) => r.kind === "chat");
    expect(chat).toHaveLength(5);
    for (const r of chat) {
      expect(r.status).toBe("ok");
      expect(r.jobId).toBe(job.id);
      expect(Math.abs(r.costUsd - CALL_COST)).toBeLessThan(EPS);
    }

    const usage = await team.client.get(`/api/workspaces/${team.ws.id}/usage`);
    expectStatus(usage, 200);
    expect(Math.abs(usage.body.spentUsd - sum(await usageRecords(team.client, team.ws.id)))).toBeLessThan(EPS);
    expect(Math.abs(usage.body.spentUsd - 5 * CALL_COST)).toBeLessThan(EPS);
    expect(usage.body.budgetUsd).toBeNull();
    expect(Date.parse(usage.body.periodStart)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(usage.body.periodEnd)).toBeGreaterThan(Date.now());
  });

  it("records failed calls without charging for them", async () => {
    const team = await owner();
    const docs = await twoDocs(team.client, team.ws.id);
    await fakeModel.set({ faults: [{ stage: "analyze", mode: "transient", times: 2 }] });
    const job = await finishedJob(team.client, team.ws.id, docs.map((d) => d.id));

    const records = await usageRecords(team.client, team.ws.id, { jobId: job.id });
    const errors = records.filter((r) => r.status === "error");
    expect(errors).toHaveLength(2);
    for (const r of errors) expect(r.costUsd).toBe(0);
    expect(Math.abs(sum(records) - 5 * CALL_COST)).toBeLessThan(EPS);
  });

  it("keeps usage private to the workspace", async () => {
    const a = await owner();
    const b = await owner();
    const docs = await twoDocs(a.client, a.ws.id);
    const job = await finishedJob(a.client, a.ws.id, docs.map((d) => d.id));
    expect((await usageRecords(a.client, a.ws.id, { jobId: job.id })).length).toBeGreaterThan(0);

    expectError(await b.client.get(`/api/workspaces/${a.ws.id}/usage`), 404, "not_found");
    expectError(await b.client.get(`/api/workspaces/${a.ws.id}/usage/records`), 404, "not_found");
    expect(await usageRecords(b.client, b.ws.id, { jobId: job.id })).toEqual([]);
  });

  it("lets only admins and owners set the budget", async () => {
    const team = await owner();
    const admin = await addMember(team, "admin");
    const member = await addMember(team, "member");
    const url = `/api/workspaces/${team.ws.id}/budget`;

    expectError(await member.client.put(url, { monthlyUsd: 1 }), 403, "forbidden");
    const set = await admin.client.put(url, { monthlyUsd: 1.5 });
    expectStatus(set, 200);
    expect(set.body.budgetUsd).toBe(1.5);
    expect((await member.client.get(`/api/workspaces/${team.ws.id}/usage`)).body.budgetUsd).toBe(1.5);

    const cleared = await team.client.put(url, { monthlyUsd: null });
    expectStatus(cleared, 200);
    expect(cleared.body.budgetUsd).toBeNull();
    expectError(await team.client.put(url, { monthlyUsd: -1 }), 400, "validation_error");
  });
});
