import { describe, expect, it } from "vitest";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { whereStored } from "../../lib/db";
import { addMember, addText, expectError, expectStatus, isolateFakeModel } from "../../lib/helpers";
import { Visitor, expectAnswered, supportTeam, updateWidget, visitor } from "../../lib/widget";

const SHOP = "https://shop.example.com";
const EVIL = "https://evil.example.net";

describe("S2 public widget API", () => {
  isolateFakeModel();

  it("refuses unknown widget keys and bodies that are not JSON", async () => {
    const team = await supportTeam();
    const ok = new Visitor(team.key);
    expectStatus(await ok.tryStart(), 201);
    expectStatus(await ok.request("GET", "/config"), 200);

    const unknown = new Visitor(`${team.key}x`);
    expectError(await unknown.tryStart(), 404, "not_found");
    expectError(await unknown.request("GET", "/config"), 404, "not_found");

    const form = await ok.http.request("POST", ok.path("/conversations"), {
      body: "hello=world",
      headers: ok.headers({ "content-type": "application/x-www-form-urlencoded" }),
    });
    expectError(form, 415, "unsupported_media_type");
  });

  it("serves only allowed origins, and echoes them in CORS headers", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);

    // A new widget only works on the product's own origin.
    const early = await new Visitor(team.key, SHOP).tryStart();
    expectError(early, 403, "origin_not_allowed");
    expect(early.headers.get("access-control-allow-origin")).toBeNull();

    await updateWidget(team.client, team.ws.id, { allowedOrigins: [SHOP] });
    const shop = new Visitor(team.key, SHOP);
    const started = await shop.tryStart();
    expectStatus(started, 201);
    expect(started.headers.get("access-control-allow-origin")).toBe(SHOP);
    expect(started.headers.get("vary") ?? "").toMatch(/origin/i);
    shop.id = started.body.conversation.id;
    shop.token = started.body.visitorToken;
    const { res, message } = await shop.answer(Q_REFUND);
    expectAnswered(message);
    expect(res.headers.get("access-control-allow-origin"), "the answer stream must be readable by the allowed page").toBe(SHOP);

    for (const [what, v] of [
      ["an origin that is not on the list", new Visitor(team.key, EVIL)],
      ["no Origin header at all", new Visitor(team.key, null)],
    ] as const) {
      const refused = await v.tryStart();
      expect(refused.status, `${what}: ${refused.status} ${refused.text.slice(0, 200)}`).toBe(403);
      expect(refused.body?.error?.code, what).toBe("origin_not_allowed");
      expect(refused.headers.get("access-control-allow-origin"), what).toBeNull();
      expectError(await v.request("GET", "/config"), 403, "origin_not_allowed");
    }
    // Every route checks, not only the first one: a stolen token is no use from another origin.
    const thief = new Visitor(team.key, EVIL);
    thief.id = shop.id;
    thief.token = shop.token;
    expectError(await thief.request("GET", `/conversations/${shop.id}`), 403, "origin_not_allowed");
    const asked = await thief.ask(Q_REFUND);
    expect(asked.status).toBe(403);
  });

  it("answers CORS preflight only for allowed origins", async () => {
    const team = await supportTeam();
    await updateWidget(team.client, team.ws.id, { allowedOrigins: [SHOP] });
    const preflight = (origin: string) =>
      new Visitor(team.key, origin).http.request("OPTIONS", `/api/widget/${encodeURIComponent(team.key)}/conversations`, {
        headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type,authorization" },
      });

    const allowed = await preflight(SHOP);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(SHOP);
    expect(allowed.headers.get("access-control-allow-methods") ?? "").toMatch(/POST/i);
    const allowHeaders = (allowed.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(allowHeaders).toContain("content-type");
    expect(allowHeaders).toContain("authorization");

    const refused = await preflight(EVIL);
    expect(refused.status).toBe(403);
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("lets every member read the widget settings and only admins change them", async () => {
    const team = await supportTeam();
    const member = await addMember(team, "member");
    const admin = await addMember(team, "admin");
    const url = `/api/workspaces/${team.ws.id}/widget`;

    const seen = await member.client.get(url);
    expectStatus(seen, 200);
    expect(seen.body.widget.widgetKey).toBe(team.key);
    expect(seen.body.widget.enabled).toBe(true);
    expect(seen.body.widget.allowedOrigins).toEqual([]);
    expectError(await member.client.patch(url, { greeting: "Hello from a member" }), 403, "forbidden");

    const changed = await admin.client.patch(url, { botName: "Lampbot", greeting: "Ask me about lamps!" });
    expectStatus(changed, 200);
    expect(changed.body.widget.greeting).toBe("Ask me about lamps!");
    const config = await new Visitor(team.key).request("GET", "/config");
    expectStatus(config, 200);
    expect(config.body).toEqual(expect.objectContaining({ botName: "Lampbot", greeting: "Ask me about lamps!" }));

    for (const bad of [["shop.example.com"], ["https://shop.example.com/help"], ["ftp://shop.example.com"]]) {
      expectError(await admin.client.patch(url, { allowedOrigins: bad }), 400, "validation_error");
    }
    expectError(await admin.client.patch(url, { fallbackMessage: "" }), 400, "validation_error");
  });

  it("turns visitors away while the widget is disabled", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);
    const v = await visitor(team.key);

    await updateWidget(team.client, team.ws.id, { enabled: false });
    expectError(await new Visitor(team.key).tryStart(), 403, "widget_disabled");
    const asked = await v.ask(Q_REFUND);
    expect(asked.status).toBe(403);
    expect(asked.body?.error?.code).toBe("widget_disabled");

    await updateWidget(team.client, team.ws.id, { enabled: true });
    expectAnswered((await v.answer(Q_REFUND)).message);
  });

  it("limits questions per conversation and new conversations per address", async () => {
    const team = await supportTeam();
    await addText(team.client, team.ws.id, REFUNDS);
    const chatty = await visitor(team.key);
    for (let i = 0; i < 10; i++) {
      const res = await chatty.ask(`${Q_REFUND} (${i})`);
      expect(res.status, `question ${i + 1} of 10`).toBe(200);
    }
    const blocked = await chatty.ask(Q_REFUND);
    expect(blocked.status).toBe(429);
    expect(blocked.body?.error?.code).toBe("rate_limited");
    // The limit is per conversation: another visitor is still served.
    const calm = await visitor(team.key);
    expectAnswered((await calm.answer(Q_REFUND)).message);

    // Two conversations so far; 28 more reach the hourly limit of 30 for this key and address.
    for (let i = 0; i < 28; i++) expectStatus(await new Visitor(team.key).tryStart(), 201);
    expectError(await new Visitor(team.key).tryStart(), 429, "rate_limited");
    // Another company's widget is not affected.
    const other = await supportTeam();
    expectStatus(await new Visitor(other.key).tryStart(), 201);
  });

  it("stores visitor tokens only as hashes", async () => {
    const team = await supportTeam();
    expect(whereStored(team.email), "guard: the product's data must be in DATABASE_URL").not.toEqual([]);
    const v = await visitor(team.key);
    expectStatus(await v.request("GET", `/conversations/${v.id}`), 200);
    expect(whereStored(v.token), "the visitor token is stored in plain text").toEqual([]);
  });
});
