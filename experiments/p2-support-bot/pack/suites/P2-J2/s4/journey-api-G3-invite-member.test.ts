import { expect, it } from "vitest";
import { Client } from "../../lib/client";
import { expectStatus, newEmail, owner, signup } from "../../lib/helpers";

// G3: 邀请一个同事加入工作区。
// 依据 api.yaml：
//   POST /api/workspaces/{ws}/invitations — "Admin or owner. Sends an `invitation` email carrying a token."
//     （201，返回 { invitation: { id, email, role, expiresAt } }）
//   POST /api/invitations/accept — "Accept as the invited email (case-insensitive). Single use."
//     （200，返回 { workspaceId, role }）
//   GET /api/workspaces/{ws}/members — members[]，每项 { userId, email, role }

/** 邀请邮件在 outbox 里；to 会不会被产品归一化大小写没有写死，所以两种写法都找一遍。 */
async function invitationToken(email: string): Promise<string> {
  for (const to of [email, email.toLowerCase(), email.toUpperCase()]) {
    const res = await new Client().get(`/api/__test__/outbox?to=${encodeURIComponent(to)}`);
    expectStatus(res, 200);
    const found = (res.body?.messages ?? []).filter((m: any) => m.template === "invitation");
    if (found.length) return found[found.length - 1].token as string;
  }
  throw new Error(`no invitation email for ${email}`);
}

it("G3: 邀请邮件里的令牌能把同事带进工作区", async () => {
  const team = await owner();
  const email = newEmail("invitee");
  const invitee = await signup({ email, name: "被邀请的同事" });

  // 所有者发邀请。地址写成大写：接受邀请时邮箱不区分大小写（api.yaml：case-insensitive）
  const invited = await team.client.post(`/api/workspaces/${team.ws.id}/invitations`, {
    email: email.toUpperCase(),
    role: "member",
  });
  expectStatus(invited, 201);
  expect(invited.body?.invitation?.id, invited.text).toBeTruthy();
  expect(invited.body?.invitation?.email, invited.text).toBeTruthy();
  expect(invited.body?.invitation?.role, invited.text).toBe("member");
  expect(typeof invited.body?.invitation?.expiresAt, invited.text).toBe("string");

  // 被邀请的人收到邮件，里面有令牌
  const token = await invitationToken(email);
  expect(typeof token).toBe("string");
  expect(token.length).toBeGreaterThan(0);

  // 用令牌接受邀请
  const accepted = await invitee.client.post("/api/invitations/accept", { token });
  expectStatus(accepted, 200);
  expect(accepted.body?.workspaceId, accepted.text).toBe(team.ws.id);
  expect(accepted.body?.role, accepted.text).toBe("member");

  // 成员名单里多了他
  const members = await team.client.get(`/api/workspaces/${team.ws.id}/members`);
  expectStatus(members, 200);
  const list = members.body?.members ?? [];
  const row = list.find((m: any) => m.email === email);
  expect(row, JSON.stringify(list)).toBeTruthy();
  expect(row.userId).toBe(invitee.user.id);
  expect(row.role).toBe("member");

  // 他现在能进这个工作区，并看到自己的角色
  const ws = await invitee.client.get(`/api/workspaces/${team.ws.id}`);
  expectStatus(ws, 200);
  expect(ws.body?.role, ws.text).toBe("member");
});
