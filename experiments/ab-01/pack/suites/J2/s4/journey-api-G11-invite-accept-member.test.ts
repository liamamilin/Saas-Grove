// G11: Invite a member by email, the invitee accepts, and the member appears with the assigned role.
// Derived from brief/contract/api.yaml:
//   - POST /api/workspaces/{ws}/invitations  (Admin or owner; sends invitation email carrying a token)
//   - POST /api/invitations/accept           (Accept as the invited email, case-insensitive; single use)
//   - GET  /api/workspaces/{ws}/members      (returns the members list, each with role)
// Journey: the owner signs up, creates a workspace, invites an email with role "member";
// the invitee (a separately-registered account on that email) accepts via the outbox token;
// the owner then lists members and sees the invitee present with role "member".
// Binary pass condition: GET /api/workspaces/{ws}/members includes the invitee with role "member".

import { describe, expect, test } from "vitest";
import { addMember, owner } from "../../lib/helpers";

describe("G11: invite a member by email, invitee accepts, member appears with role", () => {
  test("the new member appears in the workspace with the role the owner assigned", async () => {
    const team = await owner();
    const invitee = await addMember(team, "member");

    const res = await team.client.get(`/api/workspaces/${team.ws.id}/members`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.members)).toBe(true);

    const found = (res.body.members as Array<{ userId: string; email: string; role: string }>).find(
      (m) => m.userId === invitee.user.id,
    );
    expect(found, `invitee ${invitee.email} should appear in members`).toBeDefined();
    expect(found!.email.toLowerCase()).toBe(invitee.email.toLowerCase());
    expect(found!.role).toBe("member");
  });
});