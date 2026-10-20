// G13: Delete a workspace as owner; it is no longer reachable.
// Derived from brief/contract/api.yaml:
//   - DELETE /api/workspaces/{ws}        (Owner only; everything in the workspace becomes unreachable)
//   - GET    /api/workspaces/{ws}        (404 when the resource does not exist / not visible)
// Journey: the owner signs up, creates a workspace, deletes it as owner, then
// confirms the workspace is unreachable by trying to read it back.
// Binary pass condition: the DELETE returns 204 AND the subsequent GET returns 404.

import { describe, expect, test } from "vitest";
import { owner } from "../../lib/helpers";

describe("G13: delete a workspace as owner; it is no longer reachable", () => {
  test("after the owner deletes the workspace, the workspace is unreachable", async () => {
    const team = await owner();

    const del = await team.client.del(`/api/workspaces/${team.ws.id}`);
    expect(del.status).toBe(204);

    const after = await team.client.get(`/api/workspaces/${team.ws.id}`);
    expect(after.status).toBe(404);
    expect(after.body?.error?.code).toBe("not_found");
  });
});