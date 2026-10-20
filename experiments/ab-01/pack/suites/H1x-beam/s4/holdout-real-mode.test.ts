import { describe, expect, it } from "vitest";
import { Client } from "../../lib/client";
import { launch, stopInstance, describeLaunch, teamAt } from "../../lib/instance";
import { expectError, expectStatus } from "../../lib/helpers";
import { PASSWORD, newEmail } from "../../lib/helpers";
import { MockModel as MM, realModeEnv, replyCostUsd } from "../../lib/mock-model";

// Contract: testability.md §5.1, §5.2.

describe("holdout real mode", () => {
  it("missing MODEL_PROVIDER / config: product refuses to start (§5.1, §5.2)", async () => {
    // no model provider at all
    const r0 = await launch({}, 30);
    expect(r0.healthy).toBe(false);
    if (r0.id) await stopInstance(r0.id);
    // real provider but missing each required var
    const baseEnv = {
      MODEL_PROVIDER: "real",
      MODEL_BASE_URL: "http://127.0.0.1:1/v1",
      MODEL_API_KEY: "key",
      MODEL_NAME: "mock-model",
      MODEL_INPUT_USD_PER_MTOK: "1",
      MODEL_OUTPUT_USD_PER_MTOK: "1",
      EMBEDDING_PROVIDER: "local",
    };
    const required = ["MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_INPUT_USD_PER_MTOK", "MODEL_OUTPUT_USD_PER_MTOK"];
    for (const key of required) {
      const env = { ...baseEnv };
      delete (env as any)[key];
      const r = await launch(env, 30);
      expect(r.healthy, `should not start without ${key}: ${describeLaunch(r)}`).toBe(false);
      if (r.id) await stopInstance(r.id);
    }
    // MODEL_PROVIDER=real explicitly required; remove MODEL_PROVIDER
    const env2 = { ...baseEnv };
    delete (env2 as any).MODEL_PROVIDER;
    const r2 = await launch(env2, 30);
    expect(r2.healthy).toBe(false);
    if (r2.id) await stopInstance(r2.id);
  });

  it("complete config starts and test routes are 404 (§5.2)", async () => {
    const mock = await MM.start((req) => ({ content: "[]", promptTokens: 1, completionTokens: 1 }));
    const env = realModeEnv(mock, { inputPerMTok: 1, outputPerMTok: 1 }, "secret-key");
    const started = await launch(env, 60);
    expect(started.healthy, describeLaunch(started)).toBe(true);
    const base = started.base!;
    const c = new Client(base);
    expectStatus(await c.get("/api/health"), 200);
    // test routes 404
    expectError(await c.get("/api/__test__/outbox?to=x@y"), 404);
    expectError(await new Client(base).put("/api/__test__/fake-model", {}), 404);
    // prove it is a real app, not the empty one
    const { teamAt } = await import("../../lib/instance");
    const t = await teamAt(base);
    expect(t.ws.id).toBeTruthy();
    await stopInstance(started.id!);
    await mock.close();
  });

  it("requests carry Authorization, model, max_tokens; usage cost matches reply (§5.2)", async () => {
    const mock = await MM.start((req) => {
      if (req.callNo === 1) return { content: JSON.stringify(["q1", "q2", "q3"]), promptTokens: 5, completionTokens: 7 };
      return { content: "Answer with [1] citation.", promptTokens: 10, completionTokens: 20 };
    });
    const prices = { inputPerMTok: 2, outputPerMTok: 3 };
    const env = realModeEnv(mock, prices, "sk-test-123");
    const started = await launch(env, 60);
    expect(started.healthy, describeLaunch(started)).toBe(true);
    const base = started.base!;
    const { client, ws } = await teamAt(base);
    // add doc
    const dr = await client.post(`/api/workspaces/${ws.id}/documents`, { title: "d", text: "some text here" });
    expectStatus(dr, 201);
    const docId = dr.body.document.id;
    // wait ready
    const { waitForDocument } = await import("../../lib/helpers");
    await waitForDocument(client, ws.id, docId);
    // start job
    const jr = await client.post(`/api/workspaces/${ws.id}/research-jobs`, { question: "q", documentIds: [docId] });
    // may be 202
    if (jr.status === 202) {
      const { waitForJob } = await import("../../lib/helpers");
      await waitForJob(client, ws.id, jr.body.job.id);
    }
    // inspect requests
    expect(mock.requests.length).toBeGreaterThan(0);
    for (const r of mock.requests) {
      expect(r.headers.authorization).toBe("Bearer sk-test-123");
      expect(r.body.model).toBe("mock-model");
      expect(typeof r.cap).toBe("number");
      expect((r.cap as number) > 0).toBe(true);
    }
    const { usageRecords } = await import("../../lib/helpers");
    let jobId: string | null = null;
    if (jr.status === 202) jobId = jr.body.job.id;
    const recs = jobId ? await usageRecords(client, ws.id, { jobId }) : [];
    const okRecs = recs.filter((x: any) => x.status === "ok");
    const replyCosts = mock.replies.map((rep) => replyCostUsd(rep, prices.inputPerMTok, prices.outputPerMTok));
    expect(okRecs.length).toBe(5);
    const sumRecs = okRecs.reduce((a: number, r: any) => a + r.costUsd, 0);
    const sumReplies = replyCosts.reduce((a: number, c: number) => a + c, 0);
    expect(sumRecs).toBeCloseTo(sumReplies, 6);
    await stopInstance(started.id!);
    await mock.close();
  });

  it("small budget: product does not exceed budget (output cap) (§5.2)", async () => {
    const { MockModel, realModeEnv } = await import("../../lib/mock-model");
    const mock = await MockModel.start((req: any) => ({ content: "x", promptTokens: 1, completionTokens: req.cap ?? 10 }));
    const prices = { inputPerMTok: 1, outputPerMTok: 1000 };
    const env = realModeEnv(mock, prices, "key");
    const { launch, stopInstance, describeLaunch } = await import("../../lib/instance");
    const started = await launch(env, 60);
    if (!started.healthy) throw new Error(describeLaunch(started));
    const base = started.base!;
    const { teamAt } = await import("../../lib/instance");
    const { client, ws } = await teamAt(base);
    await client.put(`/api/workspaces/${ws.id}/budget`, { monthlyUsd: 0.005 });
    const dr = await client.post(`/api/workspaces/${ws.id}/documents`, { title: "d", text: "text" });
    const { waitForDocument } = await import("../../lib/helpers");
    await waitForDocument(client, ws.id, dr.body.document.id);
    await client.post(`/api/workspaces/${ws.id}/research-jobs`, { question: "q", documentIds: [dr.body.document.id] });
    const u = await client.get(`/api/workspaces/${ws.id}/usage`);
    expect((u.body.spentUsd as number)).toBeLessThanOrEqual(0.005 + 1e-9);
    await stopInstance(started.id!);
    await mock.close();
  });

});