import { expect, it } from "vitest";
import { expectError, expectStatus, owner } from "../../lib/helpers";
import { Visitor, hostPage, updateWidget, widgetSettings } from "../../lib/widget";

// G12: 小窗公开接口的来源与 CORS 规则。
// 依据 api.yaml（写在公开小窗接口上面的规则）：
//   1. {key} unknown, rotated away, or of a deleted workspace -> 404 not_found.
//   2. "The request's Origin header must be one of the widget's allowedOrigins, or the product's own
//      origin (APP_BASE_URL, for its in-app preview). Otherwise -> 403 origin_not_allowed.
//      A request WITHOUT an Origin header is refused the same way (fail closed)."
//   3. Widget disabled (enabled: false) -> 403 widget_disabled.
//   4. "Allowed responses carry `Access-Control-Allow-Origin: <that origin>` (echoed, never `*`) and
//      `Vary: Origin`. Refused ones carry no Access-Control-Allow-Origin."
//   OPTIONS 预检 — "For an allowed origin (rules 1–3): 204 with Access-Control-Allow-Origin echoing the
//      origin, Access-Control-Allow-Methods including GET and POST, and Access-Control-Allow-Headers
//      including content-type and authorization. For any other origin or key: no
//      Access-Control-Allow-Origin (status 403 or 404)."

it("G12: 小窗只认白名单里的来源，并按 CORS 规则回显", async () => {
  const team = await owner();
  const widget = await widgetSettings(team.client, team.ws.id);
  const key = widget.widgetKey;

  // 客户自己的网站：另一个端口就是另一个来源
  const site = await hostPage("<!doctype html><title>shop</title>");
  try {
    // 默认只认产品自己的来源：客户网站的来源被拒
    const refused = await new Visitor(key, site.origin).tryStart();
    expectError(refused, 403, "origin_not_allowed");
    expect(
      refused.headers.get("access-control-allow-origin"),
      "a refused response must not carry Access-Control-Allow-Origin",
    ).toBeNull();

    // 没有 Origin 头也要被拒（fail closed）
    const noOrigin = await new Visitor(key, null).tryStart();
    expectError(noOrigin, 403, "origin_not_allowed");

    // 把客户的网站加进白名单
    await updateWidget(team.client, team.ws.id, { allowedOrigins: [site.origin] });

    // 现在可以了，而且 CORS 头回显这个来源（不是 *）
    const allowed = await new Visitor(key, site.origin).tryStart();
    expectStatus(allowed, 201);
    expect(allowed.headers.get("access-control-allow-origin"), "the origin must be echoed").toBe(site.origin);
    expect(allowed.headers.get("vary"), "Vary: Origin is required").toMatch(/origin/i);

    // 预检：允许的来源拿到 204 和完整的允许头
    const preflight = await new Visitor(key, site.origin).request("OPTIONS", "/conversations", undefined, {
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type, authorization",
    });
    expectStatus(preflight, 204);
    expect(preflight.headers.get("access-control-allow-origin"), "the origin must be echoed").toBe(site.origin);
    expect(preflight.headers.get("access-control-allow-methods") ?? "", "GET and POST must be allowed").toMatch(/GET/);
    expect(preflight.headers.get("access-control-allow-methods") ?? "", "GET and POST must be allowed").toMatch(/POST/);
    const allowedHeaders = (preflight.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(allowedHeaders, "content-type must be allowed").toContain("content-type");
    expect(allowedHeaders, "authorization must be allowed").toContain("authorization");

    // 不在白名单的来源：预检也不给 CORS 头
    const other = await hostPage("<!doctype html><title>other</title>");
    try {
      const badPreflight = await new Visitor(key, other.origin).request("OPTIONS", "/conversations", undefined, {
        "access-control-request-method": "POST",
      });
      expect(badPreflight.headers.get("access-control-allow-origin"), "a refused preflight must not allow the origin").toBeNull();
      expect([403, 404], `unexpected preflight status ${badPreflight.status}`).toContain(badPreflight.status);
    } finally {
      await other.close();
    }

    // 关掉小窗：谁都不能再问
    await updateWidget(team.client, team.ws.id, { enabled: false });
    const disabled = await new Visitor(key, site.origin).tryStart();
    expectError(disabled, 403, "widget_disabled");
    expect(disabled.headers.get("access-control-allow-origin"), "a refused response must not carry Access-Control-Allow-Origin").toBeNull();

    // 未知密钥：404
    const unknown = await new Visitor("no-such-widget-key", site.origin).tryStart();
    expectError(unknown, 404, "not_found");
  } finally {
    await site.close();
  }
});
