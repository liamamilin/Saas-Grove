// Held-out acceptance tests: governance - the audit log and the export.
//
// Contract source:
//   brief/contract/api.yaml:
//   - GET /api/workspaces/{ws}/audit-events: "Admin or owner. Newest first."; AuditEvent.type is one
//     of member.invited, member.joined, member.role_changed, member.removed, budget.updated,
//     document.deleted, widget.updated, widget.key_rotated, conversation.deleted, export.created;
//     "actorUserId is whoever performed the action (for member.joined, the user who joined)".
//   - GET /api/workspaces/{ws}/export: "Admin or owner. Everything in this workspace, and nothing
//     secret (no password hashes, session, invitation, reset or visitor tokens)." with exportedAt,
//     workspace, members, documents (with their text), widget, conversations (with their messages),
//     handoffs and usageRecords.

import { describe, expect, it } from "vitest";
import {
  addMember,
  addText,
  expectError,
  expectStatus,
  knowledgeBase,
  secretKeys,
  setBudget,
} from "../../lib/helpers";
import { Visitor, supportTeam, updateWidget } from "../../lib/widget";
import { Q_REFUND, REFUNDS } from "../../lib/corpus";

describe("holdout: governance", () => {
  it("keeps an audit log of what happened in the workspace, newest first", async () => {
    // Contract: the AuditEvent schema and the audit-events endpoint.
    const team = await supportTeam();
    const member = await addMember(team, "member");
    const plain = await addMember(team, "member");

    await team.client.patch(`/api/workspaces/${team.ws.id}/members/${member.user.id}`, { role: "admin" });
    await setBudget(team.client, team.ws.id, 5);
    const doc = await addText(team.client, team.ws.id, REFUNDS);
    await team.client.del(`/api/workspaces/${team.ws.id}/documents/${doc.id}`);
    await updateWidget(team.client, team.ws.id, { botName: "Lamp Bot" });
    // The key changes: the old one stops working at once, so the conversation is opened with the
    // new key.
    const rotated = await team.client.post(`/api/workspaces/${team.ws.id}/widget/rotate-key`);
    expectStatus(rotated, 200);
    const newKey = String(rotated.body?.widget?.widgetKey ?? "");
    expect(newKey).not.toBe("");
    expect(newKey).not.toBe(team.key);

    const visitor = await new Visitor(newKey).start();
    const admin = await addMember(team, "admin");
    await admin.client.del(`/api/workspaces/${team.ws.id}/conversations/${visitor.id}`);

    await team.client.get(`/api/workspaces/${team.ws.id}/export`);

    const res = await team.client.get(`/api/workspaces/${team.ws.id}/audit-events`);
    expectStatus(res, 200);
    const events = res.body?.events ?? [];
    expect(Array.isArray(res.body?.events)).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(8);

    const types = events.map((e: any) => e.type);
    for (const type of [
      "member.invited",
      "member.joined",
      "member.role_changed",
      "budget.updated",
      "document.deleted",
      "widget.updated",
      "widget.key_rotated",
      "conversation.deleted",
      "export.created",
    ]) {
      expect(types, `the audit log has no ${type}`).toContain(type);
    }

    for (const event of events) {
      expect(String(event.actorUserId ?? "")).not.toBe("");
      expect(Number.isNaN(Date.parse(String(event.createdAt ?? "")))).toBe(false);
    }
    // "actorUserId is whoever performed the action (for member.joined, the user who joined)." Three
    // people joined, and the log is newest first, so every joiner has to be in it.
    const joiners = events.filter((e: any) => e.type === "member.joined").map((e: any) => e.actorUserId);
    expect(joiners).toContain(member.user.id);
    expect(joiners).toContain(plain.user.id);
    expect(joiners).toContain(admin.user.id);
    // The last one to join is the first of them in the log.
    expect(joiners[0]).toBe(admin.user.id);

    // "Newest first."
    const times = events.map((e: any) => Date.parse(String(e.createdAt)));
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i - 1], "the audit log is not sorted newest first").toBeGreaterThanOrEqual(times[i]);
    }

    // Only an admin or the owner may read it.
    expectError(await plain.client.get(`/api/workspaces/${team.ws.id}/audit-events`), 403, "forbidden");
  });

  it("exports everything of the workspace and nothing secret", async () => {
    // Contract: GET export -> exportedAt, workspace, members, documents (with text), widget,
    // conversations (with messages), handoffs, usageRecords; "Admin or owner"; "nothing secret".
    const team = await supportTeam();
    await knowledgeBase(team.client, team.ws.id);
    const visitor = await new Visitor(team.key).start();
    await visitor.answer(Q_REFUND);
    await visitor.handoff({ name: "Ada", email: "ada@example.test" });

    const res = await team.client.get(`/api/workspaces/${team.ws.id}/export`);
    expectStatus(res, 200);
    const body = res.body ?? {};
    for (const key of [
      "exportedAt",
      "workspace",
      "members",
      "documents",
      "widget",
      "conversations",
      "handoffs",
      "usageRecords",
    ]) {
      expect(Object.keys(body), `the export has no ${key}`).toContain(key);
    }
    expect(Number.isNaN(Date.parse(String(body.exportedAt ?? "")))).toBe(false);
    expect(body.workspace?.id).toBe(team.ws.id);
    expect((body.members ?? []).some((m: any) => m.userId === team.user.id)).toBe(true);
    expect((body.documents ?? []).length).toBe(3);
    expect((body.documents ?? []).every((d: any) => typeof d.text === "string" && d.text.length > 0)).toBe(true);
    expect((body.widget?.widgetKey ?? "") !== "").toBe(true);
    expect((body.conversations ?? []).length).toBe(1);
    expect((body.conversations ?? [])[0]?.messages?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect((body.handoffs ?? []).length).toBe(1);
    expect((body.usageRecords ?? []).length).toBeGreaterThanOrEqual(1);

    // Nothing secret travels with the export: no password hash, no session, invitation, reset or
    // visitor token. (Token *counts* of a usage record are no credentials.)
    expect(secretKeys(body)).toEqual([]);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(team.password);
    for (const value of team.client.snapshot().values()) {
      if (value.length < 12) continue;
      expect(serialised).not.toContain(value);
    }
    expect(serialised).not.toContain(visitor.token);
  });
});
