# auth 模块 · 黑盒契约

本文件是**可被测试计划直接断言**的契约。启动、路径映射、测试支撑见 HOST.md。

- 观测边界：HTTP、Cookie、页面、`outbox`、数据库只读查询（HOST.md §4）。
- "路径"是**概念名**，宿主在 `module-map.json` 映射；未声明者记"宿主未声明"，不计通过/失败。
- 每条 MUST 可外部观察；不可观察项见 §13。
- 数值：契约给**界限**，宿主在 `params` 声明实际值；未声明按界限测（HOST.md §2b）。

## 0. 概念清单（`module-map.json` 的 key）

方法只是建议，语义固定；未声明者记"宿主未声明"。

- **L0**：`auth.signup`｜`auth.login`｜`auth.logout`｜`auth.session.current`｜`auth.password.forgot`｜`auth.password.reset`｜`auth.email.verify.request`｜`auth.email.verify.confirm`｜`auth.page.sign_in`｜`auth.page.sign_up`｜`auth.page.password_reset`｜`auth.page.verify_email`（GET，其余 POST）
- **L1**：`auth.sessions.list`｜`auth.sessions.revoke`｜`auth.sessions.revoke_all`｜`auth.password.change`｜`auth.email.change`｜`auth.mfa.enroll.start`｜`auth.mfa.enroll.confirm`｜`auth.mfa.challenge`｜`auth.mfa.disable`｜`auth.account.disable`
- **L2**：`auth.events.list` 只读认证事件（仅 TEST_MODE；声明后 I6 的事件项才判定）

**邮件（outbox）**：`template` 只取 `auth.verify_email`｜`auth.password_reset`｜`auth.email_change_notice`；令牌放 `token`，链接放 `data.link`；域名只取 `APP_BASE_URL`（忽略 `Host` 头）。

## 1. 通用规则

- G1 只认会话 Cookie（宿主声明的等价凭据亦可）；`user_id`/`role`/`email_verified`/`workspace_id` 一律忽略。
- G2 错误体 JSON `{"error":{"code","message","fields"?}}`，`code` 取自 §2；message 不含邮箱原文、密码、令牌、堆栈、SQL、路径。
- G3 未认证 API 响应 401 + JSON，不 302 不 HTML（页面除外）。
- G4 会话 Cookie 含 `HttpOnly`/`Secure`/`SameSite=Lax`/`Path=/`，无 `Domain`；登出下发同名过期 Cookie；不无限期。
- G5 时效按服务端时钟判定（HOST clock 推进），不信客户端时间。
- G6 一次性令牌第二次使用必失败（400 `invalid_token`）且不改状态。
- G7 并发安全：同邮箱并发注册只建一个账号；同一令牌（重置/验证/备份码/challenge）并发只成功一次。
- G8 限流按源 IP 与目标账号/邮箱独立计数（实现归 `rate-limiting`）；**同一来源同一目标连续失败到界限必须 429 + `Retry-After`**：登录 ≤10 次、找回/验证申请/注册（按邮箱）≤5 次、re-auth ≤10 次；不存在账号同等对待；计数可清空。次数可由 `params` 声明（键 `<动作>_rate_limit`），未声明按界限测。
- G9 跨用户隔离：A 的凭据访问 B 的数据须 401/403，不返回 B 数据、不泄漏其存在。
- G10 账号停用/删除后全部会话下次请求即失效，不能再登录。
- G11 源 IP：直连取连接对端地址；有 `X-Forwarded-For` 时**从右向左跳过受信代理，取第一个非受信地址**（最左值可伪造，绝不采用）；受信代理名单由 `params` 声明，未声明则忽略该头。
- G12 re-auth：`auth.password.change`、`auth.email.change`、`auth.mfa.enroll.start`、`auth.mfa.disable`、`auth.account.disable` 须带凭据——无 MFA 用 `current_password`，有 MFA 用 `current_password`+`code`；缺失或错误 → 401 `reauth_required`、**无副作用**；按 G8 限流。

## 2. 状态码与错误码（一一对应，表外组合违约）

| 状态码 | `error.code` |
|---|---|
| 400 | `invalid_request`｜`invalid_email`（非法/>254）｜`weak_password`（<12 或 >128）｜`invalid_token`（无效/已用/串用途）｜`token_expired`｜`invalid_code`（enroll 码错） |
| 401 | `unauthenticated`｜`invalid_credentials`｜`mfa_required`（第二步）｜`invalid_mfa_code`｜`session_expired`（超时）｜`reauth_required`｜`account_disabled`（已有会话） |
| 403 | `forbidden`｜`email_not_verified`｜`account_disabled`（登录；注册仍统一 200，见 S3） |
| 404 | `not_found` |
| 409 | `conflict` |
| 429 | `rate_limited` |
| 500 | `internal_error`（验收不触发） |

- `invalid_credentials` 覆盖"账号不存在"与"密码错"；`mfa_required`/`email_not_verified`/`account_disabled` 只在凭据正确后出现。
- 403/404 按"存在但无权 → 403，否则 → 404"划分；**例外**：他人资源 ID 一律 404 `not_found`，不泄漏存在性（C6）。

## 3. 注册与账号

- S1 `auth.signup` 体：`email`+`password` 必填，`name` 可选，其余忽略。
- S2 200 `{"status":"accepted"}`；**不下发 Cookie**；投 `auth.verify_email`（令牌在 `token`/`data.link`）；按邮箱限流（G8）。
- S3 新邮箱与已存在邮箱（含**停用**账号）响应一致（码/体/头，忽略 `Date`/`request_id`）；不 409/201；**不发"已注册"信**。
- S4 密码不合策略 → 400 `weak_password`（<12 或 >128），不建号不发信；邮箱非法/>254 → 400 `invalid_email`。
- S5 同邮箱并发注册只建一个账号，响应同 S2。
- S6 未验证账号 `auth.login` 密码正确也 403 `email_not_verified`，不签发会话。
- S7 **预占账号**：对未验证账号再次注册**不新建账号、不改写密码**（防预占劫持），作废旧验证/重置令牌（400 `invalid_token`）；邮箱所有者认领靠 `auth.password.forgot`→`auth.password.reset` 设自己的密码（同时标记已验证）。
- S8 未验证账号 ≤72 小时未验证则连同令牌清理，之后该邮箱注册视为新账号。
- S9 **验证须证明密码（防预占劫持）**：`auth.email.verify.confirm` 必须带 `token`+当前密码，或带有效会话；否则 401 `invalid_credentials`、**令牌不被消费**（可重试）。抢注账号的受害者点验证邮件也过不了这关。

## 4. 登录

- L1 `auth.login` 体：`email`、`password`；可选 `remember_me`（默认 false）。
- L2 凭据正确、已验证、无 MFA：200 + 会话 Cookie，体含 `user{id,email,email_verified,mfa_enabled}`、`session{expires_at,idle_expires_at}`，无令牌明文。
- L3 凭据错误或账号不存在：401 `invalid_credentials`，无 Cookie、不建会话；两种响应体逐字节相同（忽略 `Date`/`request_id`）。
- L4 未验证 → 403 `email_not_verified`；停用 → 403 `account_disabled`。
- L5 已启用 MFA：401 `mfa_required`+`challenge_id`，无 Cookie；第二步前无可用会话。
- L6 触发限流：429 `rate_limited`+`Retry-After`。
- L7 令牌必新签发：登录后 `Set-Cookie` 与该账号此前任何会话令牌不同；请求自带 Cookie（含预置值）也须下发新 Cookie，预置值失效。
- L8 令牌长 ≥22 个 base64url 字符（≥16 字节），不含邮箱、用户 id、时间戳等可推导片段。

## 5. 会话

- C1 `auth.session.current` 带有效 Cookie → 200 `{"user":{...}}`，无密码哈希或令牌。
- C2 无/非法/篡改 Cookie → 401 `unauthenticated`。
- C3 空闲或绝对超时 → 401 `session_expired`（用 HOST clock 推进后验证）。
- C4 `auth.logout` → 200：清 Cookie + 吊销会话；同一 Cookie 再请求受保护概念 → 401 `unauthenticated`。
- C5 `auth.sessions.list` → 200 `{"sessions":[{"id","created_at","last_active_at","ip","user_agent","current"}]}`，只含自己的会话；`id` 不可猜测、**不等于令牌或摘要**。
- C6 `auth.sessions.revoke`（体 `session_id`）→ 200；被吊销会话立即 401 `unauthenticated`；他人或不存在的 `session_id` → 404 `not_found`，响应一致。
- C7 `auth.sessions.revoke_all` → 200；除当前会话外全部失效。
- C8 期限界限：空闲 ≤7 天；绝对 ≤24 小时（默认）或 ≤30 天（`remember_me=true`）；取先到者；Cookie 不无限期。
- C9 轮换：登录成功、提权（完成 MFA 第二步）、**启用 MFA**、改密后下发**新**令牌，旧令牌立即失效（401 `unauthenticated`）。

## 6. 密码

- P1 `auth.password.forgot`（体 `email`）→ 200 `{"status":"accepted"}`；存在与否响应一致；不存在的邮箱不建号不收信。
- P2 找回/注册/验证申请按目标邮箱与源 IP 计数，超限 429；不存在的账号同样计（G8）。
- P3 重置令牌：单次、TTL ≤15 分钟（参数 `reset_token_ttl_seconds`）、只存摘要，由 `auth.password_reset` 邮件交付；到期前 1 分钟可用，过期 400 `token_expired`。
- P4 邮件链接 **GET 不改状态**（令牌不被消费、密码不变）；改密只由 `auth.password.reset`（POST）。
- P5 `auth.password.reset`（体 `token`、`new_password`）：成功 200；令牌无效/已用 → 400 `invalid_token`；过期 → 400 `token_expired`；新密码不合策略 → 400 `weak_password`，**令牌不消耗**，可重试。
- P6 重置后：全部会话失效（旧 Cookie → 401 `unauthenticated`）、旧密码不可登录、新密码可登录；不自动建会话；该邮箱**视为已验证**；已开 MFA 的账号**仍需第二步**。
- P7 `auth.password.change`（体 `current_password`、`new_password`，需已登录）：成功 200；re-auth 缺失或错误 → 401 `reauth_required`、密码不变；成功后当前令牌轮换（旧 Cookie → 401）、其余会话失效、旧密码失效。
- P8 用途绑定：重置令牌只用于 `auth.password.reset`，验证令牌只用于 `auth.email.verify.confirm`；串用途 → 400 `invalid_token`；同用途新令牌签发后旧令牌失效。

## 7. 邮箱验证与变更

- V1 `auth.email.verify.request` → 200 `{"status":"accepted"}`，同 `auth.password.forgot`；可重复调用；按邮箱限流。
- V2 `auth.email.verify.confirm`（体 `token`、`password`）→ 200；令牌单次、TTL ≤24 小时（参数 `verify_token_ttl_seconds`）、只存摘要；无效/已用 → 400 `invalid_token`；过期 → 400 `token_expired`；密码不符且无会话 → 401 `invalid_credentials`、令牌不消费（S9）。
- V3 验证成功后 `auth.session.current` 与 `auth.login` 反映 `email_verified=true`。
- V4 `auth.email.change`（体 `new_email`，需已登录+re-auth）→ 200 `{"status":"accepted"}`，向新邮箱投 `auth.verify_email`；新地址被他人占用时**响应与成功一致**（不 409），不投验证邮件，改投 `auth.email_change_notice` 给占用方。
- V5 确认前旧地址仍有效；确认新地址的令牌（同 V2）后新地址生效、旧地址收到 `auth.email_change_notice`；此后当前令牌轮换（旧 Cookie → 401），其余会话吊销。

## 8. MFA

- M1 `auth.mfa.enroll.start`（需已登录+re-auth）→ 200 `{"secret","otpauth_uri","recovery_codes":[...]}`；只返回这一次，不可再取，不进日志；已启用再调用 → 409 `conflict`。
- M2 `auth.mfa.enroll.confirm`（体 `code`）→ 200；码错 → 400 `invalid_code`；确认前 `mfa_enabled` 仍 false、登录**不要**第二步，此时无 `challenge_id`，未确认的备份码**不生效**。
- M3 `auth.mfa.challenge`（体 `challenge_id`、`code`）→ 200 + **新**会话 Cookie；码错 → 401 `invalid_mfa_code`；`challenge_id` 无效/已用/过期/不属本账号 → 400 `invalid_token`（不泄漏存在性）。
- M4 TOTP 固定参数 SHA1、6 位、30 秒，容忍 ±1 步；同一时间步的码只可成功用一次；`auth.mfa.enroll.confirm` 用掉的步不能再 challenge（→ 401 `invalid_mfa_code`）。
- M5 备份码：≥10 个、每个长 ≥10 字符（熵 ≥50 bit）、单次使用、只存摘要（HMAC 或慢哈希）；用后再用 → 401 `invalid_mfa_code`。
- M6 challenge 单次、TTL ≤5 分钟（参数 `challenge_ttl_seconds`）、5 次失败即作废（之后 400 `invalid_token`）；并发只成功一次。
- M7 `auth.mfa.disable`（需 re-auth）→ 200，之后登录不要第二步；re-auth 缺失或错误 → 401 `reauth_required`，`mfa_enabled` 保持 true。
- M8 MFA 失败按**账号**累计，不随新 challenge 重置；账号级上限 ≤10 次（参数 `mfa_fail_limit`）达限后新的 `auth.mfa.challenge` 一律 429 `rate_limited`，直到计数窗口过期（≤24 小时）。

## 9. 账号停用

- Z1 `auth.account.disable`（需 re-auth）→ 200；管理员停用走 `workspaces-and-permissions` 后台，效果相同。
- Z2 停用后：全部会话下次请求即 401 `account_disabled`；`auth.login` → 403 `account_disabled`；`auth.password.forgot` 仍统一 200 但**不投递邮件**；`auth.mfa.challenge` → 400 `invalid_token`；`auth.signup` 仍统一 200（S3）。

## 10. 存储形态（数据库只读检查）

- T1 密码：慢 KDF + 每用户盐，**标准 PHC 串**（自带盐与参数，如 `$argon2id$v=19$m=19456,t=2,p=1$…`）；bcrypt cost ≥12 且先 SHA-256 预哈希再 base64（避免 72 字节截断）；禁明文或可逆加密。
- T2 会话/重置/验证/challenge/备份码令牌：只存 `HMAC-SHA-256(key, 令牌)` 摘要并带 `key_id`，**不加盐**（加盐会破坏查找）；不得存明文。
- T3 密钥轮换：新令牌用新 key，旧 key **只校验存量摘要、不重算**，保留到存量令牌自然过期（≤最大 TTL）；密码哈希不用 `key_id:salt:hash`，格式见 T1。
- T4 TOTP 密钥：AEAD 加密存储，密文 ≠ 明文密钥。
- T5 检查做法：枚举 `information_schema` 本模块所有表（排除含 `outbox` 的表），逐列搜已知明文（密码/令牌/备份码/TOTP 密钥）须零命中；同密码两账号哈希须不同。

## 11. 不变量

I1 邮箱唯一、未验证账号无会话、一次性令牌只成功一次；I2 库中无明文（令牌明文只在 Cookie）；I3 空闲与绝对超时同时生效、限流计数可清空；I4 停用 401 `account_disabled`、改密/重置后旧会话 401；I5 MFA 第二步前不可访问受保护资源、错误体不泄漏存在性；I6 事件齐备且无明文、令牌必轮换且不跨用途。

## 12. 页面、跳转与响应头

- R1 四个 `auth.page.*` GET → 200 页面（表单或提示）。
- R2 `next` 只接受站内相对路径：**URL 解析后** origin 必须等于 `APP_BASE_URL` 的 origin，否则回落默认页；拒绝 `//`、`/\`、反斜杠、控制符；**登录后跳转同样在站内**。
- R3 `auth.page.password_reset`（带 `token`）→ 200 且状态不变；响应头含 `Referrer-Policy: no-referrer` 与 `Cache-Control: no-store`。
- R4 Cookie 认证的写操作校验 `Origin`/`Referer`：**跨站 origin** → 403 `forbidden` 且无副作用；**缺失**不因此拒绝；同站放行。CSRF 令牌体系归 `web-security`。

## 13. 建议，验收不测

- 登录失败与"账号不存在"的**耗时相近**（黑盒只看量级差）。
- 令牌由 CSPRNG 生成且熵 ≥128 bit（黑盒只测长度与可推导性，见 L8）。
- AEAD **完整性校验**、**假哈希**、KDF 参数是否随硬件升级：人工审。
- 5xx 响应体收敛（`stack`/`detail` 不外泄）：验收不主动触发 5xx。
- 全部敏感响应带 `Cache-Control: no-store`（R3 是 MUST）；认证事件内容完整性仅在宿主声明 `auth.events.list` 时可断言。
- 备份码字符集与随机源（M5）、受信代理名单粒度（G11）、KDF 升级时机（T1）：人工审。

## 14. 追溯表（规则→用例）

用例列省略 `AUTH-`。

|规则|用例|规则|用例|规则|用例|
|---|---|---|---|---|---|
|G1|01|G2|12|G3|15|
|G4|10 18 19|G5|07 16 17 30 56|G6|06 31|
|G7|03 06 31 45 56|G8|13 27 35 47 50 59 64|G9|23|
|G10|24|G11|63|G12|25 34 41 48 64|
|S1 S2|01 02|S3|02|S4|04|
|S5|03|S6|05 08|S7|08 65|
|S8|09|S9|65|L1 L2|05 10|
|L3|11|L4|05 24|L5|43|
|L6|13|L7 L8|14|C1|15|
|C2|15|C3|16 17|C4|19|
|C5|20|C6|21|C7|22|
|C8|16 17 18|C9|14 33 43 57|P1|26|
|P2|27 35 50 59|P3|30|P4|28|
|P5|29 31|P6|29 49|P7|25 33|
|P8|32 58|V1|35|V2|05 06 07 37 58|
|V3|05|V4|36|V5|37|
|M1|38 41 42|M2|39 40|M3|43 56|
|M4|40 44 62|M5|38 45|M6|46 56|
|M7|48 61|M8|47|Z1|25|
|Z2|24 60|T1–T5|54|R1|28 52 55|
|R2|52|R3|28|R4|51|
|I1|03 05 06 08 09 31 45|I2|54|I3|13 16 17 18 27 50 59|
|I4|24 29 33|I5|11 12 43 46|I6|14 32 33 43 53 57 58|
