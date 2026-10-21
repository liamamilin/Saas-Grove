// Held-out acceptance tests: the public widget API and its rules.
//
// Contract source: brief/contract/api.yaml, the rules written above the widget routes:
//   1. "{key} unknown, rotated away, or of a deleted workspace -> 404 not_found."
//   2. "The request's Origin header must be one of the widget's allowedOrigins, or the product's
//      own origin (APP_BASE_URL, for its in-app preview). Otherwise -> 403 origin_not_allowed. A
//      request WITHOUT an Origin header is refused the same way (fail closed)."
//   3. "Widget disabled (enabled: false) -> 403 widget_disabled."
//   4. "Allowed responses carry Access-Control-Allow-Origin: <that origin> (echoed, never `*`) and
//      Vary: Origin. Refused ones carry no Access-Control-Allow-Origin."
//   5. "Routes under /conversations/{id} need Authorization: Bearer <visitorToken> ... missing -> 401
//      unauthenticated; a token that does not belong to this conversation of this widget -> 404
//      not_found."
//   6. "Bodies are JSON (Content-Type application/json ...); anything else -> 415
//      unsupported_media_type."
//   Plus OPTIONS /api/widget/{key}/{path} ("For an allowed origin (rules 1-3): 204 with
//   Access-Control-Allow-Origin echoing the origin, Access-Control-Allow-Methods including GET and
//   POST, and Access-Control-Allow-Headers including content-type and authorization") and
//   POST /api/workspaces/{ws}/widget/rotate-key ("Admin or owner. Issues a new widget key; the old
//   key stops working at once (404 on every widget route)").

import { describe, expect, it } from "vitest";
import { addMember, expectError, expectStatus } from "../../lib/helpers";
import { OWN_ORIGIN, Visitor, supportTeam, updateWidget } from "../../lib/widget";

const SHOP = "https://shop.example.test";
const EVIL = "https://evil.example.test";

describe("holdout: the public widget API", () => {
  it("refuses an unknown key and the key of a rotated widget", async () => {
    // Contract: widget rule 1 and POST widget/rotate-key ("Admin or owner ... the old key stops
    // working at once (404 on every widget route)").
    const team = await supportTeam();

    expectError(await new Visitor("no-such-widget-key").tryStart(), 404, "not_found");
    expectStatus(await new Visitor(team.key).tryStart(), 201);

    const member = await addMember(team, "member");
    expectError(await member.client.post(`/api/workspaces/${team.ws.id}/widget/rotate-key`), 403, "forbidden");

    const rotated = await team.client.post(`/api/workspaces/${team.ws.id}/widget/rotate-key`);
    expectStatus(rotated, 200);
    const newKey = String(rotated.body?.widget?.widgetKey ?? "");
    expect(newKey).not.toBe("");
    expect(newKey).not.toBe(team.key);

    expectError(await new Visitor(team.key).tryStart(), 404, "not_found");
    expectStatus(await new Visitor(newKey).tryStart(), 201);
  });

  it("refuses a foreign origin, a request without an origin and a disabled widget", async () => {
    // Contract: widget rules 2 and 3 - the origin must be allowed, a request without an Origin
    // header is refused the same way (fail closed), and a disabled widget is widget_disabled.
    const team = await supportTeam();

    expectError(await new Visitor(team.key, EVIL).tryStart(), 403, "origin_not_allowed");
    expectError(await new Visitor(team.key, null).tryStart(), 403, "origin_not_allowed");

    // The product's own origin always works.
    expectStatus(await new Visitor(team.key).tryStart(), 201);

    await updateWidget(team.client, team.ws.id, { enabled: false });
    expectError(await new Visitor(team.key).tryStart(), 403, "widget_disabled");

    await updateWidget(team.client, team.ws.id, { enabled: true });
    expectStatus(await new Visitor(team.key).tryStart(), 201);
  });

  it("echoes the allowed origin, varies on it and answers the preflight", async () => {
    // Contract: widget rule 4 and the OPTIONS preflight.
    const team = await supportTeam();
    await updateWidget(team.client, team.ws.id, { allowedOrigins: [SHOP] });

    const allowed = new Visitor(team.key, SHOP);
    const res = await allowed.request("GET", "/config");
    expectStatus(res, 200);
    expect(res.headers.get("access-control-allow-origin")).toBe(SHOP);
    expect(String(res.headers.get("vary") ?? "").toLowerCase()).toContain("origin");

    // A refused response carries no Access-Control-Allow-Origin at all.
    const refused = await new Visitor(team.key, EVIL).request("GET", "/config");
    expectError(refused, 403, "origin_not_allowed");
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();

    const preflight = await allowed.http.request("OPTIONS", allowed.path("/config"), {
      headers: {
        ...allowed.headers({ "access-control-request-method": "POST" }),
        "content-type": "application/json",
      },
    });
    expectStatus(preflight, 204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(SHOP);
    const methods = String(preflight.headers.get("access-control-allow-methods") ?? "").toUpperCase();
    expect(methods).toContain("GET");
    expect(methods).toContain("POST");
    const allowHeaders = String(preflight.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(allowHeaders).toContain("content-type");
    expect(allowHeaders).toContain("authorization");

    const badPreflight = await new Visitor(team.key, EVIL).http.request("OPTIONS", new Visitor(team.key, EVIL).path("/config"), {
      headers: { origin: EVIL, "access-control-request-method": "POST" },
    });
    expect(badPreflight.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("only lets the owner of a conversation read it, and only accepts JSON", async () => {
    // Contract: widget rules 5 and 6.
    const team = await supportTeam();
    const mine = await new Visitor(team.key).start();
    const other = await new Visitor(team.key).start();

    const withoutToken = await mine.http.request("GET", mine.path(`/conversations/${mine.id}`), {
      headers: { origin: OWN_ORIGIN },
    });
    expectError(withoutToken, 401, "unauthenticated");

    const withForeignToken = await mine.http.request("GET", mine.path(`/conversations/${mine.id}`), {
      headers: { origin: OWN_ORIGIN, authorization: `Bearer ${other.token}` },
    });
    expectError(withForeignToken, 404, "not_found");

    const wrongType = await mine.http.request("POST", mine.path(`/conversations/${mine.id}/messages`), {
      body: "content=hello",
      headers: {
        origin: OWN_ORIGIN,
        authorization: `Bearer ${mine.token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    expectError(wrongType, 415, "unsupported_media_type");
  });
});
