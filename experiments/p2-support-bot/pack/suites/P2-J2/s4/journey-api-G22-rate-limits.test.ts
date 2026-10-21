import { expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { addText, expectStatus, owner, sleep } from "../../lib/helpers";
import { Visitor, widgetSettings } from "../../lib/widget";

// G22: 公开小窗接口的限流。
// 依据 api.yaml：
//   POST /api/widget/{key}/conversations — "At most 30 new conversations per hour per widget key and
//     client IP address; beyond that 429 rate_limited."
//   POST /api/widget/{key}/conversations/{id}/messages — "At most 10 questions per minute per
//     conversation; beyond that a plain 429 rate_limited JSON error."
//   错误码表 — 429 rate_limited

/** 把时钟对齐到整分钟：限流按分钟算时，别让请求跨过分钟边界。 */
async function alignToMinute(): Promise<void> {
  const wait = 60_000 - (Date.now() % 60_000);
  if (wait < 20_000) await sleep(wait + 50);
}

it("G22: 一个会话每分钟最多十个问题，一个密钥每小时最多三十个新会话", async () => {
  const team = await owner();
  await addText(team.client, team.ws.id, REFUNDS);
  const widget = await widgetSettings(team.client, team.ws.id);

  // —— 一个会话每分钟最多 10 个问题 ——
  const visitor = new Visitor(widget.widgetKey);
  await visitor.start();
  await alignToMinute();

  for (let i = 0; i < 10; i++) {
    const res = await visitor.ask(Q_REFUND);
    expect(res.status, `question ${i + 1} was refused: ${JSON.stringify(res.body ?? res.events).slice(0, 200)}`).toBe(200);
  }

  const eleventh = await visitor.ask(Q_REFUND);
  expect(eleventh.status, JSON.stringify(eleventh.body ?? eleventh.events).slice(0, 200)).toBe(429);
  expect(eleventh.body?.error?.code, JSON.stringify(eleventh.body)).toBe("rate_limited");

  // —— 一个密钥每小时最多 30 个新会话（换个工作区，计数器是按密钥算的）——
  const other = await owner();
  const otherWidget = await widgetSettings(other.client, other.ws.id);
  let created = 0;
  let refused: any = null;
  for (let i = 0; i < 31; i++) {
    const res = await new Visitor(otherWidget.widgetKey).tryStart();
    if (res.status === 201) {
      created += 1;
      continue;
    }
    refused = res;
    break;
  }
  expect(refused, "the conversation rate limit never kicked in").toBeTruthy();
  expect(refused.status, JSON.stringify(refused.body)).toBe(429);
  expect(refused.body?.error?.code, JSON.stringify(refused.body)).toBe("rate_limited");
  expect(created, "more conversations than the documented limit were allowed").toBeLessThanOrEqual(30);
});
