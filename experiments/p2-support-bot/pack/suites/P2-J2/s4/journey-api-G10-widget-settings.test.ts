import { expect, it } from "vitest";
import { addMember, expectError, expectStatus, owner } from "../../lib/helpers";
import { updateWidget, widgetSettings } from "../../lib/widget";

// G10: 小窗设置。
// 依据 api.yaml：
//   GET /api/workspaces/{ws}/widget — "The workspace's widget settings, including its public widget
//     key. Any member."（200 { widget }）
//   PATCH /api/workspaces/{ws}/widget — "Change some settings. Admin or owner."
//     "Every field is optional; fields not sent keep their value. `allowedOrigins` replaces the list;
//      each entry is an origin (`http://` or `https://`, host, optional port, no path, no trailing
//      slash), otherwise 400 validation_error. `fallbackMessage` is 1–500 characters."（200 / 400 / 403）
//   WidgetSettings: widgetKey、enabled（默认 true）、allowedOrigins（默认空）、botName、greeting、
//     fallbackMessage、embedSnippet

it("G10: 任何成员能读小窗设置，只有管理员和所有者能改", async () => {
  const team = await owner();
  const member = await addMember(team, "member");

  // 任何成员都能读
  const read = await member.client.get(`/api/workspaces/${team.ws.id}/widget`);
  expectStatus(read, 200);
  const widget = read.body?.widget;
  expect(typeof widget?.widgetKey, JSON.stringify(read.body)).toBe("string");
  expect(widget.widgetKey.length).toBeGreaterThan(0);
  expect(widget.enabled, JSON.stringify(widget)).toBe(true);
  expect(Array.isArray(widget.allowedOrigins), JSON.stringify(widget)).toBe(true);
  expect(typeof widget.botName, JSON.stringify(widget)).toBe("string");
  expect(widget.botName.length).toBeGreaterThan(0);
  expect(typeof widget.greeting, JSON.stringify(widget)).toBe("string");
  expect(widget.greeting.length).toBeGreaterThan(0);
  expect(typeof widget.fallbackMessage, JSON.stringify(widget)).toBe("string");
  expect(widget.fallbackMessage.length).toBeGreaterThan(0);
  expect(typeof widget.embedSnippet, JSON.stringify(widget)).toBe("string");

  // 普通成员改不了
  const byMember = await member.client.patch(`/api/workspaces/${team.ws.id}/widget`, { botName: "我自己改" });
  expectError(byMember, 403, "forbidden");

  // 所有者改：四个字段一起
  const patched = await updateWidget(team.client, team.ws.id, {
    botName: "小灯助手",
    greeting: "您好，有什么可以帮您？",
    fallbackMessage: "这个问题我暂时答不上来，已经帮您转人工。",
    allowedOrigins: ["https://shop.example.test"],
  });
  expect(patched.botName, JSON.stringify(patched)).toBe("小灯助手");
  expect(patched.greeting, JSON.stringify(patched)).toBe("您好，有什么可以帮您？");
  expect(patched.fallbackMessage, JSON.stringify(patched)).toBe("这个问题我暂时答不上来，已经帮您转人工。");
  expect(patched.allowedOrigins, JSON.stringify(patched)).toEqual(["https://shop.example.test"]);

  // 改过之后能读回来
  const reread = await widgetSettings(team.client, team.ws.id);
  expect(reread.botName, JSON.stringify(reread)).toBe("小灯助手");
  expect(reread.allowedOrigins, JSON.stringify(reread)).toEqual(["https://shop.example.test"]);

  // 没传的字段保持原值
  const partial = await updateWidget(team.client, team.ws.id, { botName: "另一个名字" });
  expect(partial.botName, JSON.stringify(partial)).toBe("另一个名字");
  expect(partial.greeting, JSON.stringify(partial)).toBe("您好，有什么可以帮您？");
  expect(partial.fallbackMessage, JSON.stringify(partial)).toBe("这个问题我暂时答不上来，已经帮您转人工。");
  expect(partial.allowedOrigins, JSON.stringify(partial)).toEqual(["https://shop.example.test"]);
  expect(partial.widgetKey, JSON.stringify(partial)).toBe(reread.widgetKey);

  // 非法值：来源不是一个 origin
  const badOrigin = await team.client.patch(`/api/workspaces/${team.ws.id}/widget`, {
    allowedOrigins: ["https://shop.example.test/some/path"],
  });
  expectError(badOrigin, 400, "validation_error");

  // 非法值：兜底文案超过 500 个字符
  const longFallback = await team.client.patch(`/api/workspaces/${team.ws.id}/widget`, {
    fallbackMessage: "x".repeat(501),
  });
  expectError(longFallback, 400, "validation_error");

  // 可以把小窗关掉
  const off = await updateWidget(team.client, team.ws.id, { enabled: false });
  expect(off.enabled, JSON.stringify(off)).toBe(false);
});
