// Acceptance stage S4 — restart recovery.
//
// Derived from testability.md §7 — "验收会在测试中途重启应用，并保留数据
// 库，用来检验重启恢复."
//
// We bounce the product via the runner's control API and confirm the
// session survives and a previously-queued job still completes.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { COFFEE, SOLAR } from "../../lib/corpus";
import {
  addText,
  expectStatus,
  fakeModel,
  isolateFakeModel,
  restartApp,
  signup,
  startJob,
  uid,
  waitForJob,
} from "../../lib/helpers";

const LATENCY = 60;

async function boot() {
  const owner = await signup();
  const ws = await owner.client.post("/api/workspaces", { name: `Restart-${uid()}` });
  expectStatus(ws, 201);
  return { owner, ws: ws.body.workspace };
}

describe("holdout: restart recovery (testability.md §7)", () => {
  beforeEach(() => fakeModel.set({ latencyMs: LATENCY }));
  afterEach(() => fakeModel.reset());
  isolateFakeModel();

  test("after a restart the same session cookie still authenticates and the workspace is intact (testability.md §7)", async () => {
    const { owner, ws } = await boot();
    expectStatus(await owner.client.get("/api/me"), 200);
    expectStatus(await owner.client.get(`/api/workspaces/${ws.id}`), 200);
    await restartApp();
    expectStatus(await owner.client.get("/api/me"), 200);
    expectStatus(await owner.client.get(`/api/workspaces/${ws.id}`), 200);
  });

  test("a job queued before the restart still reaches a terminal state afterwards (testability.md §7)", async () => {
    const { owner, ws } = await boot();
    const docs = [
      await addText(owner.client, ws.id, SOLAR),
      await addText(owner.client, ws.id, COFFEE),
    ];
    const job = await startJob(owner.client, ws.id, docs.map((d) => d.id));
    await restartApp();
    const final = await waitForJob(owner.client, ws.id, job.id, undefined, 90_000);
    expect(["succeeded", "failed", "canceled", "budget_exceeded"]).toContain(final.status);
  });
});
