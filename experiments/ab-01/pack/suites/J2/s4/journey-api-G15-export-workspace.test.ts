// G15: Export the workspace contents (admin/owner only).
// Derived from brief/contract/api.yaml:
//   - GET /api/workspaces/{ws}/export    (Admin or owner; everything in this workspace, nothing secret)
//     Response includes: exportedAt, workspace, members, documents, reports, messages, usageRecords.
// Journey: the owner signs up, creates a workspace, then exports it. The export
// must succeed and the returned payload must be the workspace itself (by id and name)
// and contain the owner as a member.
// Binary pass condition: the export is a 200 whose payload references the same workspace and lists the owner as a member.

import { describe, expect, test } from "vitest";
import { owner } from "../../lib/helpers";

describe("G15: export the workspace contents (admin/owner only)", () => {
  test("the owner can export the workspace and the payload is theirs", async () => {
    const team = await owner();

    const res = await team.client.get(`/api/workspaces/${team.ws.id}/export`);
    expect(res.status).toBe(200);

    const body = res.body as {
      exportedAt: string;
      workspace: { id: string; name: string };
      members: Array<{ userId: string; email: string; role: string }>;
      documents: unknown[];
      reports: unknown[];
      messages: unknown[];
      usageRecords: unknown[];
    };

    expect(body.exportedAt).toEqual(expect.any(String));
    expect(body.workspace.id).toBe(team.ws.id);
    expect(body.workspace.name).toBe(team.ws.name);

    expect(Array.isArray(body.members)).toBe(true);
    const ownerMember = body.members.find((m) => m.userId === team.user.id);
    expect(ownerMember, "owner should appear in exported members").toBeDefined();
    expect(ownerMember!.role).toBe("owner");
    expect(ownerMember!.email.toLowerCase()).toBe(team.email.toLowerCase());

    expect(Array.isArray(body.documents)).toBe(true);
    expect(Array.isArray(body.reports)).toBe(true);
    expect(Array.isArray(body.messages)).toBe(true);
    expect(Array.isArray(body.usageRecords)).toBe(true);
  });
});