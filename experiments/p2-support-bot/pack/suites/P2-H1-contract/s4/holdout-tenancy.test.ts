// Held-out acceptance tests: tenant isolation.
//
// Contract source:
//   brief/contract/api.yaml, global conventions: "Anything under /api/workspaces/{ws} that the
//   caller cannot see - because they are not a member, or the resource belongs to another
//   workspace, or it does not exist - is 404 not_found. A member lacking the role is 403."
//   The widget rules: "1. {key} unknown, rotated away, or of a deleted workspace -> 404 not_found."
//   brief/contract/testability.md §5: the fake model answers from the chunks of the workspace the
//   widget belongs to.

import { describe, expect, it } from "vitest";
import { addMember, addText, expectError, expectStatus, knowledgeBase, owner } from "../../lib/helpers";
import { Visitor, supportTeam } from "../../lib/widget";
import { Q_SECRET, SECRET, SECRET_LEAKS } from "../../lib/corpus";

describe("holdout: tenant isolation", () => {
  it("hides a workspace from everybody who is not a member and never mixes the material of two workspaces", async () => {
    // Contract: the 404 rule of the global conventions, and widget rule 1; testability §5: the
    // fake model answers from the chunks of the workspace the widget belongs to.
    const mine = await supportTeam();
    const stranger = await supportTeam();
    const secretTeam = await supportTeam();
    const otherTeam = await supportTeam();
    await knowledgeBase(mine.client, mine.ws.id);
    await addText(secretTeam.client, secretTeam.ws.id, SECRET);
    await knowledgeBase(otherTeam.client, otherTeam.ws.id);

    // The positive path: the owner sees everything of their own workspace.
    expectStatus(await mine.client.get(`/api/workspaces/${mine.ws.id}/documents`), 200);
    expectStatus(await mine.client.get(`/api/workspaces/${mine.ws.id}/widget`), 200);

    expectError(await stranger.client.get(`/api/workspaces/${mine.ws.id}`), 404, "not_found");
    for (const path of [
      "documents",
      "conversations",
      "handoffs",
      "analytics/summary",
      "analytics/questions",
      "usage",
      "usage/records",
      "audit-events",
      "export",
      "widget",
    ]) {
      expectError(await stranger.client.get(`/api/workspaces/${mine.ws.id}/${path}`), 404, "not_found");
    }

    // The widget of another workspace is a different key: it answers with that workspace's material.
    expectStatus(await new Visitor(stranger.key).tryStart(), 201);

    // In the workspace that holds the memo the question is answered from it.
    const insider = await new Visitor(secretTeam.key).start();
    const answered = await insider.answer(Q_SECRET);
    expect(answered.message.outcome).toBe("answered");
    expect(answered.message.citations?.[0]?.documentId).toBe(
      (await secretTeam.client.get(`/api/workspaces/${secretTeam.ws.id}/documents`)).body.documents[0].id,
    );

    // In the other workspace there is nothing to answer it with, and nothing of the memo leaks.
    const outsider = await new Visitor(otherTeam.key).start();
    const refused = await outsider.answer(Q_SECRET);
    const content = String(refused.message.content ?? "");
    for (const leak of SECRET_LEAKS) {
      expect(content.toLowerCase(), `"${leak}" leaked into another workspace`).not.toContain(leak.toLowerCase());
    }
    expect(content.toLowerCase()).not.toContain("zebrafish");
  });

  it("lets only the owner delete a workspace, and takes its widget with it", async () => {
    // Contract: DELETE /api/workspaces/{ws} -> 204, "Owner only. Everything in the workspace
    // becomes unreachable."; the widget rule 1: the key "of a deleted workspace" -> 404.
    const team = await supportTeam();
    const member = await addMember(team, "member");
    await knowledgeBase(team.client, team.ws.id);

    expectError(await member.client.del(`/api/workspaces/${team.ws.id}`), 403, "forbidden");
    expectStatus(await team.client.del(`/api/workspaces/${team.ws.id}`), 204);

    expectError(await team.client.get(`/api/workspaces/${team.ws.id}`), 404, "not_found");
    expectError(await team.client.get(`/api/workspaces/${team.ws.id}/documents`), 404, "not_found");
    expectError(await team.client.get(`/api/workspaces/${team.ws.id}/widget`), 404, "not_found");

    const visitor = new Visitor(team.key);
    const res = await visitor.tryStart();
    expectError(res, 404, "not_found");
  });
});
