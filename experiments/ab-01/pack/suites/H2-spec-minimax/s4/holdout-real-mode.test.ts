// Real-mode (MODEL_PROVIDER=real) behaviour (S4).
//
// Spec clauses verified here:
//   spec/architecture.md §5.1 (env vars MODEL_BASE_URL / API_KEY / INPUT_USD_PER_MTOK /
//                               OUTPUT_USD_PER_MTOK)
//   spec/architecture.md §5.2 ("缺配置就拒绝启动" + "每次聊天调用都带 max_tokens" +
//                               "按模型返回的 usage 记账" + "不能发出余额付不起输出上限的请求")
//   brief/contract/testability.md §5, §5.2
//
// All tests spin up a SECOND instance of the product on its own port and a
// brand-new database via runner control, with TEST_MODE intentionally absent.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "../../lib/client";
import { MockModel, realModeEnv, replyCostUsd } from "../../lib/mock-model";
import { expectStatus, newEmail, PASSWORD } from "../../lib/helpers";
import { describeLaunch, launch, stopInstance, withInstance } from "../../lib/instance";

const API_KEY = "test-key-not-a-real-secret";

async function waitForJobStatus(
  c: Client,
  wsId: string,
  jobId: string,
  allowed: string[],
  timeoutMs: number,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any;
  while (Date.now() < deadline) {
    const j = await c.get(`/api/workspaces/${wsId}/research-jobs/${jobId}`);
    last = j.body.job;
    if (allowed.includes(last.status)) return j.body.job;
    await new Promise((r) => setTimeout(r, 200));
  }
  return last;
}

describe("s4: real mode", () => {
  let mock: MockModel;
  beforeAll(async () => {
    mock = await MockModel.start((req) => {
      if (req.callNo === 1) {
        return { content: '["sub one", "sub two", "sub three"]', promptTokens: 10, completionTokens: 8 };
      }
      return { content: "Findings include [1].", promptTokens: 12, completionTokens: 6 };
    });
  });
  afterAll(async () => {
    await mock.close();
  });

  test("real mode with full config starts, accepts signups, and /api/__test__/* are 404", async () => {
    // spec/architecture.md §5.2 #1
    const env = realModeEnv(mock, { inputPerMTok: 0.27, outputPerMTok: 1.1 }, API_KEY);
    await withInstance(env, async (base) => {
      expectStatus(await new Client(base).get("/api/health"), 200);
      const signup = await new Client(base).post("/api/auth/signup", {
        email: newEmail("real"),
        password: PASSWORD,
        name: "Real",
      });
      expectStatus(signup, 201);
      expect(signup.body?.user?.id).toBeTruthy();

      expectStatus(await new Client(base).put("/api/__test__/fake-model", { latencyMs: 50 }), 404);
      expectStatus(
        await new Client(base).get(`/api/__test__/outbox?to=${newEmail("x")}`),
        404,
      );
    });
  });

  test.each([
    ["MODEL_BASE_URL"],
    ["MODEL_API_KEY"],
    ["MODEL_INPUT_USD_PER_MTOK"],
    ["MODEL_OUTPUT_USD_PER_MTOK"],
  ])("real mode without %s refuses to start", async (key) => {
    // spec/architecture.md §5.1 / §5.2 #2 — each of these vars is required.
    const env = realModeEnv(mock, { inputPerMTok: 0.27, outputPerMTok: 1.1 }, API_KEY);
    delete (env as any)[key];
    const r = await launch(env, 30);
    expect(r.healthy, describeLaunch(r)).toBe(false);
  });

  test("real mode sends Authorization: Bearer <key>, model=MODEL_NAME, and max_tokens on every chat call", async () => {
    // spec/architecture.md §5.2 #3
    const env = realModeEnv(mock, { inputPerMTok: 0.27, outputPerMTok: 1.1 }, API_KEY);
    env.MODEL_NAME = "deepseek-v4.1-flash";
    await withInstance(env, async (base) => {
      const c = new Client(base);
      const su = await c.post("/api/auth/signup", { email: newEmail("real"), password: PASSWORD, name: "Real" });
      expectStatus(su, 201);
      const ws = await c.post("/api/workspaces", { name: "Real WS" });
      expectStatus(ws, 201);
      const doc = await c.post(`/api/workspaces/${ws.body.workspace.id}/documents`, {
        title: "Doc",
        text: "Some text content for the document.",
      });
      expectStatus(doc, 201);
      const start = await c.post(`/api/workspaces/${ws.body.workspace.id}/research-jobs`, {
        question: "What does it say?",
        documentIds: [doc.body.document.id],
      });
      expectStatus(start, 202);
      const job = await waitForJobStatus(
        c,
        ws.body.workspace.id,
        start.body.job.id,
        ["succeeded", "failed", "canceled", "budget_exceeded"],
        30_000,
      );
      expect(job.status, `job ${JSON.stringify(job)}`).toBe("succeeded");
    });

    // Every chat request the mock saw must carry the right headers and body fields.
    expect(mock.requests.length).toBeGreaterThanOrEqual(5);
    for (const req of mock.requests) {
      const auth = req.headers["authorization"];
      expect(auth, `call #${req.callNo}`).toBe(`Bearer ${API_KEY}`);
      expect(req.body?.model, `call #${req.callNo}`).toBe("deepseek-v4.1-flash");
      expect(req.cap, `no max_tokens on call #${req.callNo}: ${JSON.stringify(req.body)}`).not.toBeNull();
      expect(req.cap!).toBeGreaterThan(0);
    }
  });

  test("real mode records usage whose cost equals prompt_tokens*input + completion_tokens*output per call", async () => {
    // spec/architecture.md §5.1 ("按模型返回的 usage 记账") + §5.2 #3
    const prices = { inputPerMTok: 2.5, outputPerMTok: 7.5 };
    const env = realModeEnv(mock, prices, API_KEY);
    await withInstance(env, async (base) => {
      const c = new Client(base);
      const su = await c.post("/api/auth/signup", { email: newEmail("real"), password: PASSWORD, name: "R" });
      expectStatus(su, 201);
      const ws = await c.post("/api/workspaces", { name: "RW" });
      expectStatus(ws, 201);
      const doc = await c.post(`/api/workspaces/${ws.body.workspace.id}/documents`, {
        title: "D",
        text: "Hello world body content for the doc.",
      });
      expectStatus(doc, 201);
      const start = await c.post(`/api/workspaces/${ws.body.workspace.id}/research-jobs`, {
        question: "What?",
        documentIds: [doc.body.document.id],
      });
      expectStatus(start, 202);
      const job = await waitForJobStatus(
        c,
        ws.body.workspace.id,
        start.body.job.id,
        ["succeeded", "failed", "canceled", "budget_exceeded"],
        30_000,
      );
      expect(job.status).toBe("succeeded");

      const records = await c.get(`/api/workspaces/${ws.body.workspace.id}/usage/records?jobId=${job.id}`);
      expectStatus(records, 200);
      const chat = (records.body.records as any[]).filter((r) => r.kind === "chat" && r.status === "ok");
      expect(chat.length).toBeGreaterThanOrEqual(5);

      const expectedTotal = mock.replies.reduce(
        (acc, r) => acc + replyCostUsd(r, prices.inputPerMTok, prices.outputPerMTok),
        0,
      );
      const actualTotal = chat.reduce((acc, r) => acc + r.costUsd, 0);
      expect(Math.abs(actualTotal - expectedTotal)).toBeLessThan(1e-9);
    });
  });

  test("real mode refuses to overspend the budget (job ends in budget_exceeded when the budget cannot cover a call)", async () => {
    // spec/architecture.md §5.1 ("余额不够，就不发这次调用 ... 或者先调低 max_tokens 再发")
    // + §5.2 #4
    const tinyMock = await MockModel.start((req) => {
      const cap = req.cap ?? 200;
      return { content: "x".repeat(cap), promptTokens: 1, completionTokens: cap };
    });
    try {
      const prices = { inputPerMTok: 1, outputPerMTok: 1 };
      const env = realModeEnv(tinyMock, prices, API_KEY);
      const started = await launch(env, 60);
      expect(started.healthy, describeLaunch(started)).toBe(true);
      try {
        const c = new Client(started.base!);
        const su = await c.post("/api/auth/signup", { email: newEmail("real"), password: PASSWORD, name: "B" });
        expectStatus(su, 201);
        const ws = await c.post("/api/workspaces", { name: "Tiny" });
        expectStatus(ws, 201);
        const doc = await c.post(`/api/workspaces/${ws.body.workspace.id}/documents`, {
          title: "Doc",
          text: "Some content.",
        });
        expectStatus(doc, 201);
        // Budget of 0 USD — no call can be afforded, however tiny.
        expectStatus(await c.put(`/api/workspaces/${ws.body.workspace.id}/budget`, { monthlyUsd: 0 }), 200);

        const start = await c.post(`/api/workspaces/${ws.body.workspace.id}/research-jobs`, {
          question: "Why?",
          documentIds: [doc.body.document.id],
        });
        let final: any;
        if (start.status === 402) {
          final = { status: "budget_exceeded" };
        } else {
          expectStatus(start, 202);
          final = await waitForJobStatus(
            c,
            ws.body.workspace.id,
            start.body.job.id,
            ["succeeded", "failed", "canceled", "budget_exceeded"],
            15_000,
          );
        }
        expect(final?.status, `final ${JSON.stringify(final)}`).toBe("budget_exceeded");
      } finally {
        if (started.id) await stopInstance(started.id);
      }
    } finally {
      await tinyMock.close();
    }
  });
});