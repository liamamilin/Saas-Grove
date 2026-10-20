import { describe, expect, it } from "vitest";
import { BASE_URL } from "../../lib/client";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";
import { addMember, addText, expectError, expectStatus, isolateFakeModel } from "../../lib/helpers";
import { Visitor, expectAnswered, supportTeam, visitor, widgetSettings } from "../../lib/widget";

describe("S4 widget key and embedding", () => {
  isolateFakeModel();

  it("rotates a leaked widget key: the old one stops working at once", async () => {
    const team = await supportTeam();
    const member = await addMember(team, "member");
    await addText(team.client, team.ws.id, REFUNDS);
    const old = await visitor(team.key);
    expectAnswered((await old.answer(Q_REFUND)).message);
    const url = `/api/workspaces/${team.ws.id}/widget/rotate-key`;

    expectError(await member.client.post(url), 403, "forbidden");
    const rotated = await team.client.post(url);
    expectStatus(rotated, 200);
    const fresh = rotated.body.widget.widgetKey;
    expect(typeof fresh).toBe("string");
    expect(fresh).not.toBe(team.key);
    expect((await widgetSettings(team.client, team.ws.id)).widgetKey).toBe(fresh);

    expectError(await new Visitor(team.key).tryStart(), 404, "not_found");
    expectError(await old.request("GET", `/conversations/${old.id}`), 404, "not_found");
    expectAnswered((await (await visitor(fresh)).answer(Q_REFUND)).message);
  });

  it("gives a one-line embed snippet and serves the widget script", async () => {
    const team = await supportTeam();
    const snippet = (await widgetSettings(team.client, team.ws.id)).embedSnippet ?? "";
    expect(snippet).toContain(`src="${BASE_URL}/widget.js"`);
    expect(snippet).toContain(`data-widget-key="${team.key}"`);
    expect(snippet.trim().startsWith("<script")).toBe(true);

    const script = await new Visitor(team.key).http.get("/widget.js");
    expectStatus(script, 200);
    expect(script.headers.get("content-type") ?? "").toMatch(/javascript/);
    expect(script.text.length).toBeGreaterThan(0);
  });
});
