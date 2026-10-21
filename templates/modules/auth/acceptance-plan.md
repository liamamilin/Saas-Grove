# auth 模块 · 黑盒验收计划

本表是**验收计划**，不是可执行脚本；实现阶段按此逐条写测试。

**执行约定**（细节见 HOST.md）
- 路径来自宿主 `module-map.json` 对概念名的映射；未声明的概念记"宿主未声明"，不计入通过/失败。
- 隔离：每条用例用全新唯一邮箱与全新账号，不复用账号、不复用会话；用例之间不共享状态。
- 时效：令牌/会话/限流窗口一律用 `POST /api/__test__/clock {advanceSeconds}` 推进。
- 取令牌：从 `GET /api/__test__/outbox?to=<email>` 取 `token` 或邮件正文链接中的令牌。
- 计数：用 `DELETE /api/__test__/rate-limits` 清空限流计数，或使用独立来源标识避免互相干扰。
- 数据库只读：仅 AUTH-30 用只读查询核对存储形态（HOST.md §4）。
- "负例=是"表示该用例本身就是负向用例（隔离、重放、限流、竞态、枚举）。

| ID | 前置（given） | 动作（action） | 期望（expected） | 负例 |
|---|---|---|---|---|
| AUTH-01 | 全新唯一邮箱 | POST `auth.signup` {email, password, role:"admin"} | 200 `{"status":"accepted"}`；outbox 有验证邮件含 token；无 `Set-Cookie`；请求里的 role 被忽略，账号无任何权限 | 否 |
| AUTH-02 | 已存在账号 A | POST `auth.signup` 用 A 的邮箱 | 状态码与响应体与 AUTH-01 逐字节相同；不新增账号；仍收到同格式邮件 | 是 |
| AUTH-03 | — | 并发 5 次 POST `auth.signup` 同一邮箱 | 只存在 1 个账号；所有响应均为 200 且与 AUTH-01 一致 | 是 |
| AUTH-04 | 已注册未验证账号 | 取 outbox token → POST `auth.email.verify.confirm` | 验证前 POST `auth.login` 得 403 `email_not_verified`；验证后得 200 会话；`auth.session.current` 的 `email_verified=true` | 否 |
| AUTH-05 | 已注册且本例 token 已用过一次 | 再次 POST `auth.email.verify.confirm` 同一 token | 400 `invalid_token`；账号状态不变 | 是 |
| AUTH-06 | 已验证账号 | POST `auth.login` 正确密码 | 200 + `Set-Cookie`（含 `HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`，无 `Domain`）；响应体不含令牌明文 | 否 |
| AUTH-07 | 已验证账号 + 一个不存在的邮箱 | 分别以错密码与不存在邮箱 POST `auth.login` | 两次都是 401 `invalid_credentials`，响应体逐字节相同；无 `Set-Cookie`；库中无新增会话记录 | 是 |
| AUTH-08 | 独立来源标识的已验证账号 | 连续错密码直到触发阈值 | 429 `rate_limited` + `Retry-After`；清空 rate-limits 后可再试 | 是 |
| AUTH-09 | 已登录 | GET `auth.session.current` | 200，含 id/email/email_verified/mfa_enabled；不含密码哈希或令牌 | 否 |
| AUTH-10 | — | GET `auth.session.current` 不带 Cookie | 401 `unauthenticated`，JSON 体，不是 HTML/302 | 是 |
| AUTH-11 | 已登录 | 把会话 Cookie 改 1 字节后请求 | 401 `unauthenticated` | 是 |
| AUTH-12 | 已登录 | clock 推进超过空闲上限、再推进超过绝对上限 | 两次都是 401 `session_expired` | 是 |
| AUTH-13 | 已登录 | POST `auth.logout` 后重放旧 Cookie | 登出 200；旧 Cookie 再请求 → 401；`Set-Cookie` 已清空 | 是 |
| AUTH-14 | 同一账号两个会话 | POST `auth.sessions.revoke` 吊销其中一个 | 200；被吊销会话立即 401；另一会话仍可用 | 是 |
| AUTH-15 | 账号 A、B | A 吊销 B 的 session_id | 404 `not_found`；B 的会话仍可用，且响应不泄漏该会话是否存在 | 是 |
| AUTH-16 | 账号 A、B | 用 A 的 Cookie 请求属于 B 的资源 | 401/403；响应不含 B 的任何数据 | 是 |
| AUTH-17 | 已登录账号 | POST `auth.account.disable` 后继续用旧 Cookie | 下一次请求 401 `account_disabled`；再 POST `auth.login` → 403 `account_disabled` | 是 |
| AUTH-18 | 一个存在的邮箱 + 一个不存在的邮箱 | 分别 POST `auth.password.forgot` | 两次都是 200 `{"status":"accepted"}` 且响应体相同；不存在的邮箱没有邮件、也没有账号 | 是 |
| AUTH-19 | 独立来源标识 | 对同一邮箱连续 `auth.password.forgot` 至阈值 | 429 `rate_limited`；清空计数后恢复 | 是 |
| AUTH-20 | 已请求找回密码 | GET 邮件里的重置链接 | 账号状态不变、令牌未被消费（后续 POST `auth.password.reset` 仍可成功） | 是 |
| AUTH-21 | 已请求找回密码 | POST `auth.password.reset` {token, new_password} | 200；旧密码登录 → 401；新密码登录 → 200；重置前的旧会话全部 401 | 否 |
| AUTH-22 | 已完成重置 | 再 POST `auth.password.reset` 同一 token | 400 `invalid_token`；密码不变 | 是 |
| AUTH-23 | 已请求找回密码 | clock 推进超过令牌 TTL 后 POST `auth.password.reset` | 400 `token_expired`；密码不变 | 是 |
| AUTH-24 | 已登录，两处会话 | POST `auth.password.change`（先错 current_password，再正确） | 错密码时 401 `invalid_credentials` 且密码不变；正确时 200，当前 Cookie 轮换（旧 Cookie → 401）、另一会话失效、旧密码再登录 → 401 | 是 |
| AUTH-25 | 已登录且持有 current_password | POST `auth.mfa.enroll.start` → POST `auth.mfa.enroll.confirm` 正确码 | start 返回 secret/otpauth_uri/recovery_codes 且只出现一次；confirm 后 200，`mfa_enabled=true` | 否 |
| AUTH-26 | MFA 已启用 | POST `auth.login` 正确密码 → POST `auth.mfa.challenge` {challenge_id, code} | 第一次 401 `mfa_required` 且带 challenge_id、无会话 Cookie；第二次 200 并下发会话 Cookie | 否 |
| AUTH-27 | MFA 已启用 | POST `auth.mfa.challenge` 连续错码 5 次 | 每次 401 `invalid_mfa_code`；达上限后该 challenge 作废（400 `invalid_token`）或 429 `rate_limited`，正确码也不再放行 | 是 |
| AUTH-28 | MFA 已启用 | 用同一个 TOTP 码第二次 challenge；再用备份码两次 | 第二次 401 `invalid_mfa_code`；备份码首次 200，再次 401 `invalid_mfa_code` | 是 |
| AUTH-29 | MFA 已启用 | POST `auth.mfa.disable` 不带或带错 current_password | 401 `reauth_required`；`mfa_enabled` 仍为 true；之后登录仍需第二步 | 是 |
| AUTH-30 | 已有账号、会话与令牌 | 数据库只读查询扫描用户/会话/令牌相关表 | 搜不到密码、令牌、备份码的明文；TOTP 密钥是密文而非明文；令牌与备份码是摘要 | 是 |
