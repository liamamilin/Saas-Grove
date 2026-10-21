// Held-out acceptance tests: roles and member capabilities.
// Derived from spec/product.md §2.

import { describe, expect, it } from "vitest";
import { BASE_URL, Client } from "../../lib/client";
import { addMember, addText, expectError, expectStatus, isolateFakeModel, owner } from "../../lib/helpers";
import { REFUNDS } from "../../lib/corpus";

describe("roles", () => {
  isolateFakeModel();

  // product.md §2 (member row): a member deletes their own document but not another's.
  it("a member can delete their own document but not someone else's", async () => {
    const t = await owner();
    const member = await addMember(t, "member");
    const own = await addText(member.client, t.ws.id, REFUNDS);
    const other = await addText(t.client, t.ws.id, { title: "Owner doc", text: "Owner content here." });

    expectStatus(await member.client.del(`/api/workspaces/${t.ws.id}/documents/${own.id}`), 204);
    expectError(await member.client.del(`/api/workspaces/${t.ws.id}/documents/${other.id}`), 403);
  });
});
