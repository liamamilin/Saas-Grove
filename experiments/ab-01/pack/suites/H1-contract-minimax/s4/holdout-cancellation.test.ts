// Acceptance stage S4 — research job cancellation.
//
// Derived from:
//   api.yaml POST /research-jobs/{id}/cancel — "The creator, an admin
//     or the owner. No model call starts after this returns." 403 when
//     not allowed; 409 invalid_state when already finished.
//   api.yaml POST /research-jobs/{id}/retry — "Resume a failed or
//     budget_exceeded job from its first unfinished stage." 409
//     invalid_state when not allowed.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Client } from "../../lib/client";
import { COFFEE, SOLAR } from "../../lib/corpus";
import {
  addMember,
  addText,
  expectError,
  expectStatus,
  fakeModel,
  isolateFakeModel,
  signup,
  startJob,
  uid,
  usageRecords,
  waitFor,
  waitForJob,
} from "../../lib/helpers";

const LATENCY = 80;

async function boot() {
  const owner = await signup();
  const ws = await owner.client.post("/api/workspaces", { name: `Cancel-${uid()}` });
  expectStatus(ws, 201);
  const docs = [
    await addText(owner.client, ws.body.workspace.id, SOLAR),
    await addText(owner.client, ws.body.workspace.id, COFFEE),
  ];
  return { owner, ws: ws.body.workspace, docs };
}

describe("holdout: research-job cancellation (api.yaml §research-jobs/{id}/cancel)", () => {
  beforeEach(() => fakeModel.set({ latencyMs: LATENCY }));
  afterEach(() => fakeModel.reset());
  isolateFakeModel();

  test("cancel mid-run: the job reaches canceled and the model-call count plateaus (api.yaml §cancel — No model call starts after this returns)", async () => {
    const { owner, ws, docs } = await boot();
    const job = await startJob(owner.client, ws.id, docs.map((d) => d.id));
    // Wait until the worker is mid-stage so cancelling has work to interrupt.
    await waitFor(
      async () => {
        const j = await (await import("../../lib/helpers")).getJob(owner.client, ws.id, job.id);
        return j.status === "running" ? j : undefined;
      },
      { what: "job to be running" },
    );
    const before = (await usageRecords(owner.client, ws.id, { jobId: job.id })).length;

    const cancel = await owner.client.post(`/api/workspaces/${ws.id}/research-jobs/${job.id}/cancel`);
    expectStatus(cancel, 202);
    expect(cancel.body?.job?.status).toBe("canceled");

    const final = await waitForJob(owner.client, ws.id, job.id);
    expect(final.status).toBe("canceled");
    expect(final.stages.some((s: any) => s.status === "running")).toBe(false);

    // Drain long enough for any in-flight call that was past its latency-wait to land —
    // a real implementation must not START a new call after cancellation.
    await new Promise((r) => setTimeout(r, 1_500));
    const after = (await usageRecords(owner.client, ws.id, { jobId: job.id })).length;
    expect(after, `recBefore=${before} afterCancel=${after}`).toBeLessThan(5);
    expect(after).toBeLessThanOrEqual(before + 1);
  });

  test("only the creator, an admin or the owner can cancel; everyone else is 403 (member) or 404 (outsider) (api.yaml §cancel)", async () => {
    const { owner, ws, docs } = await boot();
    const admin = await addMember({ ...(owner as any), ws } as any, "admin");
    const member = await addMember({ ...(owner as any), ws } as any, "member");
    const outsider = await signup();
    const job = await startJob(owner.client, ws.id, docs.map((d) => d.id));

    expectError(
      await member.client.post(`/api/workspaces/${ws.id}/research-jobs/${job.id}/cancel`),
      403,
      "forbidden",
    );
    expectError(
      await outsider.client.post(`/api/workspaces/${ws.id}/research-jobs/${job.id}/cancel`),
      404,
      "not_found",
    );
    // Admin can cancel; we don't assert the final status because the worker might have
    // already finished by the time the request lands.
    const adminCancel = await admin.client.post(
      `/api/workspaces/${ws.id}/research-jobs/${job.id}/cancel`,
    );
    expect([202, 409]).toContain(adminCancel.status);
  });

  test("canceling a finished job returns 409 invalid_state; retry on a succeeded job returns 409 invalid_state (api.yaml §cancel + §retry)", async () => {
    const { owner, ws, docs } = await boot();
    const job = await startJob(owner.client, ws.id, docs.map((d) => d.id));
    const done = await waitForJob(owner.client, ws.id, job.id);
    expect(done.status).toBe("succeeded");
    const cancel = await owner.client.post(`/api/workspaces/${ws.id}/research-jobs/${job.id}/cancel`);
    expectError(cancel, 409, "invalid_state");
    const retry = await owner.client.post(`/api/workspaces/${ws.id}/research-jobs/${job.id}/retry`);
    expectError(retry, 409, "invalid_state");
  });
});
