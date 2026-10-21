import { expect, it } from "vitest";
import { Client } from "../../lib/client";
import { expectError, expectStatus, newEmail, signup } from "../../lib/helpers";

// G2: 忘记密码的完整一轮。
// 依据 api.yaml：
//   POST /api/auth/password-reset/request — "Always 202, whether or not the email exists.
//     Sends a password_reset email when it does."（202）
//   POST /api/auth/password-reset/confirm — "Set a new password. Single-use token.
//     Ends every existing session of that user."（204 / 400 invalid_token）
//   POST /api/auth/login — 密码错时 401 invalid_credentials
// 依据 testability.md §6：password_reset 邮件在 outbox 里，/api/__test__/outbox?to=<email> 能取到 token。

const NEW_PASSWORD = "new-correct-horse-battery-99";

it("G2: 用重置邮件里的令牌换新密码后，旧密码和旧会话一起失效", async () => {
  const account = await signup({ email: newEmail("reset"), name: "找回密码用户" });

  // 不存在的邮箱也必须是 202：接口不能泄露账号是否存在
  const unknown = await new Client().post("/api/auth/password-reset/request", { email: newEmail("nobody") });
  expectStatus(unknown, 202);

  // 存在的邮箱：202，并且真的收到一封 password_reset 邮件
  const asked = await new Client().post("/api/auth/password-reset/request", { email: account.email });
  expectStatus(asked, 202);

  const box = await new Client().get(`/api/__test__/outbox?to=${encodeURIComponent(account.email)}`);
  expectStatus(box, 200);
  const mails = (box.body?.messages ?? []).filter((m: any) => m.template === "password_reset");
  expect(mails.length, `no password_reset email for ${account.email}`).toBeGreaterThan(0);
  const token = mails[mails.length - 1].token as string;
  expect(typeof token, "the reset email carries no token").toBe("string");
  expect(token.length).toBeGreaterThan(0);

  // 用令牌设置新密码
  const confirm = await new Client().post("/api/auth/password-reset/confirm", { token, password: NEW_PASSWORD });
  expectStatus(confirm, 204);

  // 该用户之前的所有会话都被作废
  const me = await account.client.get("/api/me");
  expect(me.status, me.text).toBe(401);
  expect(me.body?.error?.code, me.text).toBe("unauthenticated");

  // 旧密码不能再登录
  const old = await new Client().post("/api/auth/login", { email: account.email, password: account.password });
  expectError(old, 401, "invalid_credentials");

  // 新密码可以登录，而且还是同一个账号
  const fresh = await new Client().post("/api/auth/login", { email: account.email, password: NEW_PASSWORD });
  expectStatus(fresh, 200);
  expect(fresh.body?.user?.id, fresh.text).toBe(account.user.id);

  // 令牌是一次性的：再用一次必须被拒
  const reuse = await new Client().post("/api/auth/password-reset/confirm", { token, password: "another-password-123" });
  expectError(reuse, 400, "invalid_token");
});
