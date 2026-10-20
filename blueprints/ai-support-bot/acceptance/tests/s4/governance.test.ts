import { describe, expect, it } from "vitest";
import { Q_REFUND, Q_SECRET, REFUNDS, SECRET, SECRET_PHRASE, SHIPPING, WARRANTY } from "../../lib/corpus";
import {
  addMember,
  addText,
  createWorkspace,
  expectError,
  expectStatus,
  isolateFakeModel,
  knowledgeBase,
  secretKeys,
  signup,
} from "../../lib/helpers";
import { Visitor, expectAnswered, expectUnanswered, supportTeam, updateWidget, visitor, widgetSettings } from "../../lib/widget";

describe("S4 audit log and export", () => {
  isolateFakeModel();

  it("records sensitive actions in the audit log, newest first", async () => {
    const team = await supportTeam();
    const ws = team.ws.id;
    const member = await addMember(team, "member"); // member.invited + member.joined
    expectStatus(await team.client.patch(`/api/workspaces/${ws}/members/${member.user.id}`, { role: "admin" }), 200);
    expectStatus(await team.client.put(`/api/workspaces/${ws}/budget`, { monthlyUsd: 5 }), 200);
    await updateWidget(team.client, ws, { greeting: "Welcome to the lamp shop" });
    expectStatus(await team.client.post(`/api/workspaces/${ws}/widget/rotate-key`), 200);

    const doc = await addText(member.client, ws, SHIPPING);
    expectStatus(await team.client.del(`/api/workspaces/${ws}/documents/${doc.id}`), 204);
    const key = (await widgetSettings(team.client, ws)).widgetKey;
    const v = await visitor(key);
    expectStatus(await team.client.del(`/api/workspaces/${ws}/conversations/${v.id}`), 204);

    expectStatus(await team.client.get(`/api/workspaces/${ws}/export`), 200);
    expectStatus(await team.client.del(`/api/workspaces/${ws}/members/${member.user.id}`), 204);

    const res = await team.client.get(`/api/workspaces/${ws}/audit-events`);
    expectStatus(res, 200);
    const events = res.body.events;
    const types = new Set(events.map((e: any) => e.type));
    for (const t of [
      "member.invited",
      "member.joined",
      "member.role_changed",
      "budget.updated",
      "widget.updated",
      "widget.key_rotated",
      "document.deleted",
      "conversation.deleted",
      "export.created",
      "member.removed",
    ]) {
      expect(types.has(t), `missing audit event ${t}`).toBe(true);
    }
    for (const e of events) expect(e.actorUserId).toBeTruthy();
    expect(events.find((e: any) => e.type === "member.joined").actorUserId).toBe(member.user.id);
    expect(events.find((e: any) => e.type === "widget.key_rotated").actorUserId).toBe(team.user.id);
    const times = events.map((e: any) => Date.parse(e.createdAt));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeLessThanOrEqual(times[i - 1]);
  });

  it("keeps the audit log away from plain members", async () => {
    const team = await supportTeam();
    const member = await addMember(team, "member");
    expectStatus(await team.client.get(`/api/workspaces/${team.ws.id}/audit-events`), 200);
    expectError(await member.client.get(`/api/workspaces/${team.ws.id}/audit-events`), 403, "forbidden");
  });

  it("exports the workspace's data and nothing secret", async () => {
    const team = await supportTeam();
    const member = await addMember(team, "member");
    const elsewhere = await createWorkspace(team.client);
    await addText(team.client, elsewhere.id, SECRET);

    const kb = await knowledgeBase(team.client, team.ws.id);
    const v = await visitor(team.key);
    await v.answer(Q_REFUND);
    expectStatus(await v.handoff({ name: "Export Visitor", email: "export.visitor@example.test" }), 201);

    expectError(await member.client.get(`/api/workspaces/${team.ws.id}/export`), 403, "forbidden");
    const res = await team.client.get(`/api/workspaces/${team.ws.id}/export`);
    expectStatus(res, 200);
    const data = res.body;
    expect(data.workspace.id).toBe(team.ws.id);
    expect(data.members.map((m: any) => m.userId).sort()).toEqual([team.user.id, member.user.id].sort());
    expect(data.documents.map((d: any) => d.id).sort()).toEqual(Object.values(kb).map((d: any) => d.id).sort());
    expect(data.documents.every((d: any) => typeof d.text === "string" && d.text.length > 0)).toBe(true);
    expect(data.widget.widgetKey).toBe(team.key);
    const conversation = data.conversations.find((c: any) => c.id === v.id);
    expect(conversation, "the visitor's conversation is in the export").toBeTruthy();
    expect(conversation.messages.map((m: any) => m.content)).toContain(Q_REFUND);
    expect(data.handoffs.find((h: any) => h.conversationId === v.id)?.email).toBe("export.visitor@example.test");
    expect(data.usageRecords.length).toBeGreaterThanOrEqual(1);

    expect(secretKeys(data)).toEqual([]);
    expect(res.text).not.toContain(v.token);
    expect(res.text).not.toContain(SECRET_PHRASE);
  });
});

describe("S4 deletion", () => {
  isolateFakeModel();

  it("stops answering from a deleted document at once", async () => {
    const team = await supportTeam();
    const ws = team.ws.id;
    const refunds = await addText(team.client, ws, REFUNDS);
    await addText(team.client, ws, WARRANTY);
    const fallback = (await widgetSettings(team.client, ws)).fallbackMessage;
    const v = await visitor(team.key);
    const before = await v.answer(Q_REFUND);
    expectAnswered(before.message);
    expect(before.message.citations.map((c: any) => c.documentId)).toContain(refunds.id);

    expectStatus(await team.client.del(`/api/workspaces/${ws}/documents/${refunds.id}`), 204);
    const list = await team.client.get(`/api/workspaces/${ws}/documents`);
    expect(list.body.documents.map((d: any) => d.id)).not.toContain(refunds.id);
    expectError(await team.client.get(`/api/workspaces/${ws}/documents/${refunds.id}`), 404, "not_found");

    const after = await v.answer(Q_REFUND);
    expectUnanswered(after.message, fallback);
  });

  it("lets members delete only their own documents", async () => {
    const team = await supportTeam();
    const member = await addMember(team, "member");
    const admin = await addMember(team, "admin");
    const ws = team.ws.id;
    const own = await addText(member.client, ws, SHIPPING);
    const owners = await addText(team.client, ws, WARRANTY);

    expectError(await member.client.del(`/api/workspaces/${ws}/documents/${owners.id}`), 403, "forbidden");
    expectStatus(await member.client.del(`/api/workspaces/${ws}/documents/${own.id}`), 204);
    expectStatus(await admin.client.del(`/api/workspaces/${ws}/documents/${owners.id}`), 204);
  });

  it("makes everything in a deleted workspace unreachable, the widget included", async () => {
    const team = await supportTeam();
    const admin = await addMember(team, "admin");
    const ws = team.ws.id;
    const memo = await addText(team.client, ws, SECRET);
    const v = await visitor(team.key);
    expectAnswered((await v.answer(Q_SECRET)).message);

    expectError(await admin.client.del(`/api/workspaces/${ws}`), 403, "forbidden");
    expectStatus(await team.client.del(`/api/workspaces/${ws}`), 204);

    for (const client of [team.client, admin.client]) {
      expectError(await client.get(`/api/workspaces/${ws}`), 404, "not_found");
      expectError(await client.get(`/api/workspaces/${ws}/documents/${memo.id}`), 404, "not_found");
      expectError(await client.get(`/api/workspaces/${ws}/conversations/${v.id}`), 404, "not_found");
      const mine = await client.get("/api/workspaces");
      expect(mine.body.workspaces.map((w: any) => w.id)).not.toContain(ws);
    }
    expectError(await new Visitor(team.key).tryStart(), 404, "not_found");
    expectError(await v.request("GET", `/conversations/${v.id}`), 404, "not_found");
    // Their accounts still work.
    expectStatus(await team.client.get("/api/me"), 200);
    expect((await signup()).user.id).toBeTruthy();
  });
});
