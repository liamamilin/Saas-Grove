import { expect, it } from "vitest";
import { addMember, expectError, expectStatus, owner } from "../../lib/helpers";
import { Visitor, updateWidget, widgetSettings } from "../../lib/widget";

// G11: 轮换小窗的公开密钥。
// 依据 api.yaml：
//   POST /api/workspaces/{ws}/widget/rotate-key — "(S4) Admin or owner. Issues a new widget key;
//     the old key stops working at once (404 on every widget route)."（200 { widget } / 403）
//   小窗公开接口的规则 1 — "{key} unknown, rotated away, or of a deleted workspace -> 404 not_found."

it("G11: 轮换之后新密钥立刻能用，旧密钥在小窗接口上立刻 404", async () => {
  const team = await owner();
  const member = await addMember(team, "member");
  const before = await widgetSettings(team.client, team.ws.id);
  const oldKey = before.widgetKey;

  // 普通成员不能轮换
  const byMember = await member.client.post(`/api/workspaces/${team.ws.id}/widget/rotate-key`);
  expectError(byMember, 403, "forbidden");

  // 所有者轮换
  const rotated = await team.client.post(`/api/workspaces/${team.ws.id}/widget/rotate-key`);
  expectStatus(rotated, 200);
  const newKey = rotated.body?.widget?.widgetKey as string;
  expect(typeof newKey, rotated.text).toBe("string");
  expect(newKey.length).toBeGreaterThan(0);
  expect(newKey, "the widget key did not change").not.toBe(oldKey);

  // 后台看到的是新密钥
  const settings = await widgetSettings(team.client, team.ws.id);
  expect(settings.widgetKey, JSON.stringify(settings)).toBe(newKey);

  // 旧密钥在小窗的每个接口上都不再存在
  const oldConfig = await new Visitor(oldKey).request("GET", "/config");
  expectError(oldConfig, 404, "not_found");

  const oldStart = await new Visitor(oldKey).request("POST", "/conversations", {});
  expectError(oldStart, 404, "not_found");

  // 新密钥照常工作
  const fresh = await new Visitor(newKey).request("GET", "/config");
  expectStatus(fresh, 200);
  expect(typeof fresh.body?.botName, fresh.text).toBe("string");
  expect(typeof fresh.body?.greeting, fresh.text).toBe("string");

  // 轮换不影响别的设置
  const after = await updateWidget(team.client, team.ws.id, { botName: "轮换之后还在" });
  expect(after.botName, JSON.stringify(after)).toBe("轮换之后还在");
  expect(after.widgetKey, JSON.stringify(after)).toBe(newKey);
});
