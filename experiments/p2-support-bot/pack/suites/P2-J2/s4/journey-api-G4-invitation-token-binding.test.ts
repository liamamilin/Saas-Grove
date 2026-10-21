import { expect, it } from "vitest";
import { expectError, expectStatus, newEmail, outbox, owner, signup } from "../../lib/helpers";

// G4: 邀请令牌属于被邀请的那个人，而且只能用一次。
// 依据 api.yaml：
//   POST /api/invitations/accept — "Accept as the invited email (case-insensitive). Single use."
//     （200；400 invalid_token；403 "Logged in as a different email"）
//   GET /api/workspaces/{ws}/members — 只有真正加入的人才会出现在名单里

it("G4: 邀请令牌只对被邀请的人生效，而且只能用一次", async () => {
  const team = await owner();
  const invitee = await signup({ email: newEmail("invitee"), name: "被邀请的人" });
  const stranger = await signup({ email: newEmail("stranger"), name: "无关的人" });

  const invited = await team.client.post(`/api/workspaces/${team.ws.id}/invitations`, {
    email: invitee.email,
    role: "member",
  });
  expectStatus(invited, 201);
  const token = (await outbox(invitee.email, "invitation")).token;
  expect(typeof token).toBe("string");

  // 别人拿着这个令牌进不来
  const stolen = await stranger.client.post("/api/invitations/accept", { token });
  expectError(stolen, 403, "forbidden");

  // 被邀请的人可以进
  const accepted = await invitee.client.post("/api/invitations/accept", { token });
  expectStatus(accepted, 200);
  expect(accepted.body?.workspaceId, accepted.text).toBe(team.ws.id);
  expect(accepted.body?.role, accepted.text).toBe("member");

  // 令牌一次性：再用一次必须被拒
  const reuse = await invitee.client.post("/api/invitations/accept", { token });
  expectError(reuse, 400, "invalid_token");

  // 名单里只有真正加入的那个人
  const members = await team.client.get(`/api/workspaces/${team.ws.id}/members`);
  expectStatus(members, 200);
  const list = members.body?.members ?? [];
  expect(list.some((m: any) => m.email === invitee.email), JSON.stringify(list)).toBe(true);
  expect(list.some((m: any) => m.email === stranger.email), JSON.stringify(list)).toBe(false);
});
