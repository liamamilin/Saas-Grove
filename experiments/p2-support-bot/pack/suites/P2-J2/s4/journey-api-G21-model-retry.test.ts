import { expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { addText, expectStatus, fakeModel, isolateFakeModel, owner, usageRecords } from "../../lib/helpers";
import { Visitor, expectAnswered, expectUnanswered, widgetSettings } from "../../lib/widget";

// G21: 模型出故障时的重试与兜底。
// 依据 api.yaml：
//   POST /api/widget/{key}/conversations/{id}/messages — "A retryable model error is retried: at most
//     3 attempts per call, waiting at least 200 ms before the second attempt and at least twice that
//     before the third; a non-retryable error is not retried. Every attempt leaves its own usage
//     record, timestamped when the attempt started (see UsageRecord)."
//   UsageRecord — "One record per model call ATTEMPT. When a call is retried, every failed attempt
//     gets its own record (status error, costUsd 0) and the successful attempt one more (status ok).
//     `createdAt` is the time that attempt started."
// 依据 testability.md §5：故障注入按阶段计次，transient 是可重试错误，permanent 是不可重试错误。

// 这个旅程会真的调用模型：前后都把假模型复位，免得别的用例留下的故障或延迟影响它。
isolateFakeModel();

it("G21: 可重试的错误最多试三次并退避，不可重试的错误直接兜底", async () => {
  const team = await owner();
  await addText(team.client, team.ws.id, REFUNDS);
  const widget = await widgetSettings(team.client, team.ws.id);
  const visitor = new Visitor(widget.widgetKey);
  await visitor.start();

  // 前两次调用失败，第三次成功
  await fakeModel.set({ faults: [{ stage: "answer", mode: "transient", times: 2 }] });
  const answered = await visitor.answer(Q_REFUND);
  expectAnswered(answered.message);

  // 每次尝试一条用量记录：两条失败 + 一条成功
  const records = await usageRecords(team.client, team.ws.id, { conversationId: visitor.id });
  const chat = records.filter((r) => r.kind === "chat");
  expect(chat.length, JSON.stringify(records)).toBe(3);
  const errors = chat.filter((r) => r.status === "error");
  const oks = chat.filter((r) => r.status === "ok");
  expect(errors.length, JSON.stringify(chat)).toBe(2);
  expect(oks.length, JSON.stringify(chat)).toBe(1);
  expect(errors.every((r) => r.costUsd === 0), JSON.stringify(errors)).toBe(true);
  expect(oks[0].costUsd, JSON.stringify(oks[0])).toBeGreaterThan(0);
  expect(oks[0].messageId, JSON.stringify(oks[0])).toBe(answered.message.id);
  expect(chat.every((r) => r.stage === "answer"), JSON.stringify(chat)).toBe(true);
  expect(chat.every((r) => r.conversationId === visitor.id), JSON.stringify(chat)).toBe(true);

  // 退避：第二次至少隔 200 ms，第三次至少隔 400 ms（createdAt 是这次尝试开始的时间）
  const times = chat
    .map((r) => Date.parse(r.createdAt))
    .sort((a, b) => a - b);
  for (const t of times) expect(Number.isNaN(t), "createdAt is not a timestamp").toBe(false);
  expect(times[1] - times[0], `no backoff between the attempts: ${JSON.stringify(times)}`).toBeGreaterThanOrEqual(190);
  expect(times[2] - times[1], `no longer backoff before the third attempt: ${JSON.stringify(times)}`).toBeGreaterThanOrEqual(390);

  // 不可重试的错误：不重试，直接兜底
  await fakeModel.set({ faults: [{ stage: "answer", mode: "permanent" }] });
  const before = (await usageRecords(team.client, team.ws.id, { conversationId: visitor.id })).length;
  const failed = await visitor.answer(Q_REFUND);
  expectUnanswered(failed.message, widget.fallbackMessage);

  const after = await usageRecords(team.client, team.ws.id, { conversationId: visitor.id });
  expect(after.length - before, `a non-retryable error was retried: ${JSON.stringify(after)}`).toBe(1);
  expect(after[after.length - 1].status, JSON.stringify(after[after.length - 1])).toBe("error");

  const admin = await team.client.get(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`);
  expectStatus(admin, 200);
  const message = (admin.body?.messages ?? []).find((m: any) => m.id === failed.message.id);
  expect(message, JSON.stringify(admin.body?.messages)).toBeTruthy();
  expect(message.reason, JSON.stringify(message)).toBe("model_error");
});
