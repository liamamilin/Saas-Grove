import { expect, it } from "vitest";
import { Client } from "../../lib/client";
import { PASSWORD, expectStatus, newEmail, signup } from "../../lib/helpers";

// G1: 退出登录之后，服务端不再认这个会话。
// 依据 api.yaml：
//   POST /api/auth/logout — "End the session server-side; the old cookie stops working."（204）
//   全局约定 — 团队成员用 session cookie（HttpOnly，SameSite=Lax 或 Strict）
//   错误码表 — 401 用 unauthenticated。

it("G1: 退出登录后旧会话立即失效，账号仍可重新登录", async () => {
  const account = await signup({ email: newEmail("logout"), name: "登出用户" });

  // 登录时下发的是一个加固过的会话 Cookie（api.yaml 全局约定）
  const setCookie = account.client.lastSetCookies.join(" | ");
  expect(setCookie, `no hardened session cookie: ${setCookie}`).toMatch(/httponly/i);
  expect(setCookie, `no hardened session cookie: ${setCookie}`).toMatch(/samesite=(lax|strict)/i);

  // 退出登录
  const out = await account.client.post("/api/auth/logout");
  expectStatus(out, 204);

  // 旧 Cookie 立刻作废：同一个 client 再访问受保护的接口必须被拒
  const me = await account.client.get("/api/me");
  expect(me.status, me.text).toBe(401);
  expect(me.body?.error?.code, me.text).toBe("unauthenticated");

  // 账号本身没有坏：还能用同一个密码重新登录
  const again = await new Client().post("/api/auth/login", { email: account.email, password: PASSWORD });
  expectStatus(again, 200);
  expect(again.body?.user?.id, again.text).toBe(account.user.id);
});
