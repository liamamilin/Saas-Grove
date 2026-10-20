import { describe, expect, it } from "vitest";
import { Client, BASE_URL } from "../../lib/client";
import { PASSWORD, owner, addText, twoDocs, startJob, waitForJob, finishedJob, report, usageRecords, expectStatus, newEmail } from "../../lib/helpers";
import { MockModel, realModeEnv, replyCostUsd } from "../../lib/mock-model";
import { launch, stopInstance, withInstance, teamAt } from "../../lib/instance";

// Clause: architecture.md §5.1-5.2 (real mode config, max_tokens, usage-based billing).
describe("holdout real mode", () => {
  it("complete real-mode config starts and hides test routes", async () => {
    // Clause: architecture.md §5.2 point 1; §6 (test routes 404 outside test mode).
    const mock = await MockModel.start(() => ({ content: "[]", promptTokens: 1, completionTokens: 1 }));
    try {
      await withInstance({ ...realModeEnv(mock, { inputPerMTok: 1, outputPerMTok: 1 }, "key-123"), TEST_MODE: null }, async (base) => {
        const client = new Client(base);
        expectStatus(await client.post("/api/auth/signup", { email: newEmail("real"), password: PASSWORD, name: "Real" }), 201);
        expect((await client.get("/api/__test__/outbox?to=x@y.com")).status).toBe(404);
      }, 120);
    } finally {
      await mock.close();
    }
  });

  it("missing MODEL_PROVIDER prevents startup", async () => {
    // Clause: architecture.md §5.1 (缺配置就拒绝启动).
    const res = await launch({ MODEL_PROVIDER: null }, 30);
    expect(res.healthy).toBe(false);
    if (res.id) await stopInstance(res.id);
  });

  it("real mode sends Authorization, model and max_tokens, and bills by usage", async () => {
    // Clause: architecture.md §5.1 (max_tokens; 按 usage 记账); §5.2 point 3.
    const mock = await MockModel.start((req) => {
      if (req.callNo === 1) return { content: JSON.stringify(["a", "b", "c"]), promptTokens: 5, completionTokens: 7 };
      return { content: "result [1]", promptTokens: 3, completionTokens: 4 };
    });
    try {
      await withInstance(realModeEnv(mock, { inputPerMTok: 2, outputPerMTok: 3 }, "secret-key"), async (base) => {
        const { client, ws } = await teamAt(base);
        const doc = await addText(client, ws.id, { title: "Solar", text: "hello world" });
        const job = await startJob(client, ws.id, [doc.id]);
        const final = await waitForJob(client, ws.id, job.id);
        expect(mock.requests.length).toBeGreaterThanOrEqual(1);
        for (const r of mock.requests) {
          expect(r.headers.authorization).toBe("Bearer secret-key");
          expect(r.body.model).toBe("mock-model");
          expect(typeof r.cap).toBe("number");
          expect(r.cap as number).toBeGreaterThan(0);
        }
        const records = await usageRecords(client, ws.id, { jobId: job.id });
        const recordedCost = records.filter((r: any) => r.status === "ok").reduce((s: number, r: any) => s + r.costUsd, 0);
        const mockCost = mock.replies.reduce((s, reply) => s + replyCostUsd(reply, 2, 3), 0);
        expect(recordedCost).toBeCloseTo(mockCost, 6);
      }, 120);
    } finally {
      await mock.close();
    }
  });

  it("real mode does not issue a request the budget cannot cover", async () => {
    // Clause: architecture.md §5.1 (余额不够就不发); §5.2 point 4.
    const mock = await MockModel.start(() => ({ content: "x [1]", promptTokens: 1, completionTokens: 1 }));
    try {
      await withInstance(realModeEnv(mock, { inputPerMTok: 1, outputPerMTok: 1 }, "key"), async (base) => {
        const { client, ws } = await teamAt(base);
        await client.put(`/api/workspaces/${ws.id}/budget`, { monthlyUsd: 0.000001 });
        const doc = await addText(client, ws.id, { title: "Solar", text: "hello world" });
        const res = await client.post(`/api/workspaces/${ws.id}/research-jobs`, { question: "q", documentIds: [doc.id] });
        if (res.status === 402) {
          expect(mock.requests.length).toBe(0);
        } else {
          expectStatus(res, 202);
          const job = await waitForJob(client, ws.id, res.body.job.id);
          expect(job.status).toBe("budget_exceeded");
          expect(mock.requests.length).toBe(0);
        }
      }, 120);
    } finally {
      await mock.close();
    }
  });
});