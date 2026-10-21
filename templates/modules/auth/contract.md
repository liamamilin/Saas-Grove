# auth 模块 · 黑盒契约

本文件是**可被测试计划直接断言**的契约。启动方式、路径映射、测试支撑接口（`outbox` / clock / rate-limits）见 HOST.md。

- 观测边界：HTTP、Cookie、页面、`outbox`、数据库只读查询（HOST.md §4）。
- 文中"路径"都是**概念名**，宿主在 `module-map.json` 映射为真实路径；未声明的概念记为"宿主未声明"，不算通过也不算失败。
- 每条规则都必须能从外部观察；"存成什么形态"见 §11。

## 0. 概念清单（`module-map.json` 的 key）

方法只是建议，语义固定；L1/L2 概念未声明即"宿主未声明"。

- **L0**：`auth.signup` POST 注册｜`auth.login` POST 密码登录｜`auth.logout` POST 登出｜`auth.session.current` GET 当前主体｜`auth.password.forgot` POST 请求重置｜`auth.password.reset` POST 令牌改密｜`auth.email.verify.request` POST 重发验证｜`auth.email.verify.confirm` POST 确认验证｜`auth.page.sign_in` / `auth.page.sign_up` GET 登录/注册页
- **L1**：`auth.sessions.list` GET 列表｜`auth.sessions.revoke` POST 吊销会话｜`auth.sessions.revoke_all` POST 吊销其余｜`auth.password.change` POST 改密码｜`auth.email.change` POST 改邮箱｜`auth.mfa.enroll.start` POST 生成因子（一次性返回）｜`auth.mfa.enroll.confirm` POST 确认码生效｜`auth.mfa.challenge` POST 第二步验证｜`auth.mfa.disable` POST 关 MFA｜`auth.account.disable` POST 停用账号
- **L2**：`auth.identity.events` POST 外部身份源事件回调（可选）

**re-auth 约定**：`auth.password.change`、`auth.email.change`、`auth.mfa.enroll.start`、`auth.mfa.disable`、`auth.account.disable` 必须带重新验证凭据（体 `current_password`；MFA 用 `code`）。缺失或错误 → 401 `reauth_required`，**无任何副作用**。

## 1. 通用规则

- G1 身份来源唯一：只认会话 Cookie（或宿主声明的等价凭据）；请求体/查询参数里的 `user_id`、`role`、`email_verified`、`workspace_id` 一律忽略。
- G2 状态码与错误码一一对应（§2），表外组合违约。
- G3 错误体形状：所有 4xx/5xx 响应体为 JSON：`{"error":{"code":"<snake_case>","message":"<string>","fields":{...}?}}`；`error.code` 取自 §2 封闭集合。
- G4 message 不泄密：不得含邮箱原文、密码、令牌、堆栈、SQL、内部路径、上游服务名。
- G5 5xx 收敛：只允许 `code`、`message` 与可选 `request_id`，不得有 `stack`/`detail`/`debug`。
- G6 API 不重定向：API 的未认证响应必须是 401 + JSON，不得 302 或 HTML（页面概念除外）。
- G7 令牌不出 Cookie：会话令牌明文只出现在 `Set-Cookie` 与客户端 Cookie，不得在响应体、`Location`、URL 查询串中。
- G8 Cookie 属性：会话 Cookie 必须含 `HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`，无 `Domain`（建议 `__Host-`）；登出下发同名过期 Cookie。
- G9 服务端时钟：时效按服务端时钟判定（HOST clock 推进），客户端时间不被信任。
- G10 一次性令牌：第二次使用必须失败，且不改变任何账号状态。
- G11 并发安全：同邮箱并发注册只产生一个账号；同令牌并发使用只有一次成功。
- G12 限流维度：至少按源 IP、账号、目标邮箱独立计数；触发时 429 + `Retry-After`；计数可清空。
- G13 跨用户隔离：A 的凭据访问 B 的数据必须 401/403，不得返回 B 数据或泄漏其存在性。
- G14 停用即失效：账号停用/删除后全部会话下一次请求即失效，且不能再登录。

## 2. 状态码与错误码

| 场景 | 状态码 | `error.code` |
|---|---|---|
| 请求格式错 | 400 | `invalid_request` |
| 邮箱格式非法 | 400 | `invalid_email` |
| 密码不合策略 | 400 | `weak_password` |
| 令牌无效/已用 | 400 | `invalid_token` |
| 令牌过期 | 400 | `token_expired` |
| enroll 码错误 | 400 | `invalid_code` |
| 未认证 | 401 | `unauthenticated` |
| 凭据错误 | 401 | `invalid_credentials` |
| 需 MFA 第二步 | 401 | `mfa_required` |
| MFA 码/备份码错误 | 401 | `invalid_mfa_code` |
| 会话超时 | 401 | `session_expired` |
| re-auth 缺失/错误 | 401 | `reauth_required` |
| 无权限 | 403 | `forbidden` |
| 邮箱未验证 | 403 | `email_not_verified` |
| 账号停用 | 403 | `account_disabled` |
| 资源不存在 | 404 | `not_found` |
| 唯一冲突 | 409 | `conflict` |
| 限流/锁定 | 429 | `rate_limited` |
| 服务器错误 | 500 | `internal_error` |

- `invalid_credentials` 覆盖"账号不存在"与"密码错误"（响应完全一致）；`mfa_required`/`email_not_verified`/`account_disabled` 只在凭据正确后出现；403 与 404 按"存在但无权 → 403，否则 → 404"划分。

## 3. 注册与账号

- S1 `auth.signup` 体：`email`、`password` 必填，`name` 可选；其他字段（含 `role`/`workspace_id`/`email_verified`）忽略，不得影响账号权限或状态。
- S2 成功返回 HTTP **200**，体 `{"status":"accepted"}`；**不下发** `Set-Cookie`；必须向该邮箱投递验证邮件（令牌可在 `outbox` 的 `token` 字段或邮件链接读到）。
- S3 新邮箱与已存在邮箱：状态码、响应体、响应头（除 `Date` 等自动头）必须一致；不得对已存在邮箱返回 409/201。
- S4 密码不合策略 → 400 `weak_password`，不建号不发信；邮箱格式非法 → 400 `invalid_email`。
- S5 同邮箱并发注册：只存在一个账号记录，并发请求返回与 S2 相同响应。
- S6 注册后为未验证状态：`auth.login` 对未验证账号返回 403 `email_not_verified`（密码正确也如此）。

## 4. 登录

- L1 `auth.login` 体：`email`、`password`。
- L2 凭据正确、已验证、未启用 MFA：200 + 会话 Cookie，体 `{"user":{"id","email","email_verified","mfa_enabled","created_at"},"session":{"expires_at","idle_expires_at"}}`（可扩展，不得含令牌明文）。
- L3 凭据错误或账号不存在：401 `invalid_credentials`，不下发 Cookie、不建会话记录；两种情况响应体逐字节相同。
- L4 账号未验证：403 `email_not_verified`；L5 账号停用：403 `account_disabled`。
- L6 已启用 MFA：401 `mfa_required` 且携带 `challenge_id`；不下发会话 Cookie；未完成第二步前不得存在可用会话。
- L7 触发限流：429 `rate_limited` + `Retry-After`。
- L8 登录成功签发的会话令牌必须与该账号此前任何会话令牌不同（防会话固定）。

## 5. 会话

- C1 `auth.session.current` 带有效 Cookie → 200 `{"user":{...}}`，不得返回密码哈希或令牌。
- C2 无 Cookie / 非法 / 被篡改 Cookie → 401 `unauthenticated`（JSON）。
- C3 空闲或绝对超时 → 401 `session_expired`（用 HOST clock 推进到过期后验证）。
- C4 `auth.logout` → 200：同时清 Cookie 与吊销服务端会话；之后同一 Cookie 请求任何受保护概念 → 401。
- C5 `auth.sessions.list` → 200 `{"sessions":[{"id","created_at","last_active_at","ip","user_agent","current"}]}`，只含当前用户的会话。
- C6 `auth.sessions.revoke`（体 `session_id`）→ 200；被吊销会话立即 401；吊销他人 `session_id` → 404 `not_found`，不得泄漏其是否存在。
- C7 `auth.sessions.revoke_all` → 200；除当前会话外全部失效。

## 6. 密码

- P1 `auth.password.forgot`（体 `email`）→ 200 `{"status":"accepted"}`；存在与否响应完全一致；不存在的邮箱不得建号或收信。
- P2 限流：目标邮箱与源 IP 各自计数，超限 429 `rate_limited`。
- P3 重置令牌：单次有效、TTL 15 分钟、只存摘要，由 `outbox` 邮件交付。
- P4 邮件链接的 **GET 不得改变任何账号状态**（令牌不被消费、密码不变）；状态变更只能由 `auth.password.reset`（POST）完成。
- P5 `auth.password.reset`（体 `token`、`new_password`）：成功 200；令牌无效/已用 → 400 `invalid_token`；过期 → 400 `token_expired`；新密码不合策略 → 400 `weak_password` 且**令牌不被消耗**（修正后可重试）。
- P6 重置成功后：该用户全部会话失效（旧 Cookie → 401），旧密码不可登录、新密码可登录；不自动建新会话。
- P7 `auth.password.change`（体 `current_password`、`new_password`，需已登录）：成功 200；`current_password` 错 → 401 `invalid_credentials` 且密码不变；成功后当前令牌轮换（旧 Cookie → 401）、其余会话失效、旧密码不可登录。

## 7. 邮箱验证与变更

- V1 `auth.email.verify.request` → 200 `{"status":"accepted"}`，与 `auth.password.forgot` 同样统一；可重复调用。
- V2 `auth.email.verify.confirm`（体 `token`）→ 200；令牌单次、TTL 24 小时、只存摘要；无效/已用 → 400 `invalid_token`；过期 → 400 `token_expired`。
- V3 验证成功后 `auth.session.current` 与 `auth.login` 反映 `email_verified=true`。
- V4 `auth.email.change`（体 `new_email`，需已登录 + re-auth）→ 200/202 且必须向新邮箱发验证邮件；新地址属他人账号 → 409 `conflict`；验证完成前旧地址仍有效。

## 8. MFA

- M1 `auth.mfa.enroll.start`（需已登录 + re-auth）→ 200 `{"secret","otpauth_uri","recovery_codes":[...]}`；只返回这一次，之后不可再取，不得进日志或错误体。
- M2 `auth.mfa.enroll.confirm`（体 `code`）→ 200；码错 → 400 `invalid_code`；确认前 `mfa_enabled` 仍为 false，且该码不能用于 `auth.mfa.challenge`。
- M3 `auth.mfa.challenge`（体 `challenge_id`、`code`）→ 200 + 会话 Cookie；码错 → 401 `invalid_mfa_code`；`challenge_id` 无效/已用/过期 → 400 `invalid_token`；属于其他账号 → 403 `forbidden`。
- M4 同一 TOTP 码不得成功使用两次（第二次 401 `invalid_mfa_code`）。
- M5 备份码单次使用（用后再用 → 401 `invalid_mfa_code`）并立即失效；重新生成后旧码全失效。
- M6 `challenge_id` 最多接受 5 次失败尝试，之后作废（400 `invalid_token`），需重新登录。
- M7 `auth.mfa.disable`（需 re-auth）→ 200，之后登录不再需要第二步；re-auth 缺失或错误 → 401 `reauth_required`，`mfa_enabled` 保持 true（无副作用）。

## 9. 账号停用

- Z1 `auth.account.disable`（需 re-auth）→ 200。
- Z2 停用后：全部会话下一次请求即 401 `account_disabled`；`auth.login` → 403 `account_disabled`；`auth.password.forgot` 仍返回统一 200 但不投递邮件。

## 10. 外部身份事件（可选概念）

- X1 `auth.identity.events`：必须校验签名/HMAC（时间戳，重放窗口 ≤5 分钟），失败 → 401；同一事件 id 重复投递幂等；事件可创建/更新/停用账号；未验证邮箱不得自动并入已有账号。

## 11. 存储形态（数据库只读检查）

- 密码：慢 KDF（argon2id/bcrypt/scrypt）+ 每用户盐，参数随记录存；禁止明文或可逆加密。
- 会话/重置/验证令牌、魔法链接、state/PKCE、MFA 备份码：只存摘要（SHA-256 或 HMAC-SHA-256），禁止明文。
- MFA TOTP 密钥：AEAD 加密 + 完整性校验（校验需可解密，不能哈希），禁止明文。

验收以数据库只读查询扫描相关表确认无明文（HOST.md §4）。

## 12. 不变量

- I1 一个邮箱最多一个活跃账号（唯一约束，大小写不敏感）；未验证账号不能持有可用会话。
- I2 库中不存在密码、令牌、备份码、TOTP 密钥的明文。
- I3 一次性令牌最多成功使用一次，并发时只有一次成功。
- I4 会话令牌明文只存在于客户端 Cookie，服务端/响应体/URL 中均无。
- I5 每个会话同时受空闲与绝对超时约束，以服务端时钟为准。
- I6 账号停用、改密、重置密码后，对应会话在下一次请求即失效。
- I7 启用 MFA 时，未完成第二步的凭据不能访问任何受保护资源。
- I8 错误响应符合 G3–G5，不泄漏账号存在性（除 §2 三类）。
- I9 限流计数按维度独立，清空即恢复。
- I10 登录/登出/找回/改密/改邮箱/MFA 变更/停用都产生事件，不含密码/令牌明文。
- I11 登录成功、提权、改密后签发的会话令牌与此前不同。
