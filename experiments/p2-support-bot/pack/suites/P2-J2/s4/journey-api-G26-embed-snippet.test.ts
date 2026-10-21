import { expect, it } from "vitest";
import { BASE_URL } from "../../lib/client";
import { expectStatus, owner } from "../../lib/helpers";
import { widgetSettings } from "../../lib/widget";

// G26: 嵌到客户网站上的那段代码与小窗脚本。
// 依据 api.yaml：
//   WidgetSettings.embedSnippet — "(S4) Exactly one script tag:
//     <script src="<APP_BASE_URL>/widget.js" data-widget-key="<widgetKey>" async></script>"
//   GET /widget.js — "The embeddable widget script (JavaScript)."
//     （200，content: application/javascript）

it("G26: 嵌入片段恰好一个 script 标签并带上小窗密钥，脚本能取到", async () => {
  const team = await owner();
  const widget = await widgetSettings(team.client, team.ws.id);
  const snippet = String(widget.embedSnippet ?? "");

  expect(typeof widget.embedSnippet, JSON.stringify(widget)).toBe("string");
  expect(snippet.length, "the embed snippet is empty").toBeGreaterThan(0);

  // 恰好一个 script 标签
  const openings = snippet.match(/<script\b/gi) ?? [];
  const closings = snippet.match(/<\/script\s*>/gi) ?? [];
  expect(openings.length, `the embed snippet must hold exactly one script tag: ${snippet}`).toBe(1);
  expect(closings.length, `the embed snippet must hold exactly one script tag: ${snippet}`).toBe(1);

  // 标签里带上了小窗密钥和脚本地址
  expect(snippet, `the embed snippet does not carry the widget key: ${snippet}`).toContain(widget.widgetKey);
  expect(snippet, `the embed snippet does not point at /widget.js: ${snippet}`).toContain("/widget.js");
  expect(snippet, `the embed snippet does not point at the product: ${snippet}`).toContain(`${BASE_URL}/widget.js`);

  // 脚本本身能取到
  const script = await team.client.get("/widget.js");
  expectStatus(script, 200);
  expect(script.headers.get("content-type") ?? "", script.text.slice(0, 200)).toMatch(/javascript/i);
  expect(script.text.trim().length, "the widget script is empty").toBeGreaterThan(0);
});
