# auth 模块 · 认知模板

> 读者：要在买方自己技术栈里实现本模块的 coding agent。买方不是专家。
> 本文讲"成熟的 auth 长什么样"，不给实现代码。文中路径是**概念名**，由宿主在 `module-map.json` 映射（见 HOST.md）。可断言的行为见 contract.md。

## 必读摘要（一页）

**一句话**：auth 只做三件事——证明你是谁、记住你是谁、让你能安全地改回你是谁。角色/权限/业务判定都不属于它。

**边界**：进来的是凭据（密码、一次性码、外部身份）；出去的是**稳定主体标识 userId** + **可即时吊销的会话**。出去之后密码、令牌明文、验证码不再出现。

**六条最容易出事故的事**（展开见 §4）：① 会话令牌明文入库 → 库被读即全员被接管；② 找回/验证令牌可重放或 GET 即消费 → 邮件扫描器替你用掉；③ 按"邮箱是否存在"给不同响应 → 用户枚举、可撞库；④ 登录不换会话 id → session fixation；⑤ 改密码/关 MFA/改邮箱不 re-auth → 拿到会话即永久接管；⑥ 外部身份的未验证邮箱自动并入已有账号 → 一次外部注册即可夺号。

**能力速览**：L0 = 注册/登录/会话/登出/改密/找回/邮箱验证/限流/错误形状/认证事件；L1 = +会话轮换与过期、踢下线、账号停用、MFA+备份码、CSRF 与重定向防护、重认证、密钥轮换；L2 = +外部身份合并、passkey、风险自适应、密钥托管、导出删除与审计。

**不做什么**：角色权限 → `workspaces-and-permissions`；邮件投递 → `email-transactional`；订阅计费 → `payments-billing`；限流实现 → `rate-limiting`；UI 美观与真实第三方接通 → HOST.md §6。

**术语**：session=一次登录的服务端记录；session token=客户端持有的高熵串（服务端只存摘要）；challenge=第二步的一次性凭据；enrollment=把因子绑定到账号（验证成功才生效）；re-auth=敏感操作前重出示凭据；枚举防护=让"账号不存在"与"密码错"外部不可区分；KDF=慢哈希算法（argon2id/bcrypt/scrypt）；pepper=混进 KDF 的服务端秘密；AEAD=带认证的加密；PKCE=一次性校验串绑授权码；nonce=一次性随机串。

## 1. 这个模块是什么

身份认证是 SaaS 的入口与止损阀，回答三问：**你是谁**（注册/登录/外部身份）、**你还被信任吗**（会话、过期、吊销、MFA、重认证）、**你能改回你是谁吗**（邮箱验证、找回、改密）。

它同时是**边界守卫**：会话一旦签发，后续模块都在"已认证主体"的假设上运行；auth 一旦出错（放错人、不认自己人、认错人），整条链都错。它**不是**授权：产出的 userId 是主体，能干什么由 `workspaces-and-permissions` 判定。

**实现形态不限**（自建或托管身份服务皆可），但对外可观察行为必须满足契约；托管形态下本地仍需维护权威 userId 与身份事件同步（`auth.identity.events`）。

## 2. 成熟版应该有什么

**L0 MVP**：**A1** 注册（邮箱+密码，邮箱唯一）｜**A2** 密码慢哈希（参数可升级）｜**A3** 登录（失败响应统一）｜**A4** 服务端会话（令牌存摘要）+ Cookie 加固｜**A5** 登出（吊销 + 清 Cookie）｜**A6** 当前身份 + 服务端守卫｜**A7** 找回密码（请求+确认）｜**A8** 邮箱验证｜**A9** 限流｜**A10** 错误形状 + 认证事件｜**A11** 密钥只进服务端。

**L1 生产基线**：**B1** 会话轮换｜**B2** 会话过期、列表与吊销、"记住我"｜**B3** 改密、改邮箱（须验证新址）｜**B4** 账号停用（立即失效）｜**B5** MFA(TOTP) 绑定｜**B6** 备份码与强制策略（强制策略属 L2，验收暂不测）｜**B7** CSRF 与重定向防护｜**B8** 敏感操作 re-auth｜**B9** 失败退避｜**B10** 密钥轮换。

**L2 成熟**：**C1** 外部身份与账号合并｜**C2** 无密码/魔法链接、passkey｜**C3** 风险自适应｜**C4** 密钥托管｜**C5** 数据导出删除、审计闭环｜**C6** 条款/隐私同意记录。

## 3. 每项的正确行为

**3.1 注册与账号（A1 A2 A8 A11）**
- A1：邮箱归一（trim + 转小写）后判唯一，唯一性靠**数据库约束**（应用层查重并发下会漏）。新邮箱与已存在邮箱响应**完全一致**，都不下发 Cookie，也不发"已注册"提示。role/workspaceId/user_id/email_verified 一律忽略。注册与验证按目标邮箱限流。
- A2：慢 KDF + 每用户盐，参数入库（argon2id 起步 m=19MiB/t=2/p=1；用 bcrypt 则 cost ≥12 且先 SHA-256 预哈希）；参数提升后下次登录自动重算。密码长度 ≥12 且 ≤128。原文不进日志、错误体、审计、邮件。
- A8：验证令牌单次、TTL 24h、只存摘要；GET 不改状态，POST 才确认。未验证账号拿不到会话（403 email_not_verified）。**预占账号**：对未验证账号再次注册不新建账号，用新密码覆盖旧密码并作废旧令牌；72 小时未验证则连同令牌清理。
- A11：会话密钥、加密主密钥、pepper 只从环境变量/密钥服务读取，不下发浏览器。

**3.2 登录与会话（A3 A4 A5 A6）**
- A3：凭据正确才 200 并下发 Cookie；错密码与不存在账号响应完全一致（invalid_credentials），耗时也要相近。
- A4：服务端存会话记录（userId、最后活动/过期、IP/UA、吊销标记），令牌只存 HMAC 摘要并建索引。Cookie 必含 HttpOnly、Secure、SameSite=Lax、Path=/，无 Domain（建议 `__Host-`）；不得设无限期。
- A5：登出既清 Cookie 又吊销记录；旧 Cookie 再请求受保护接口 → 401。
- A6：未认证 API 返回 401 + JSON（不能是 HTML/302）；页面才 302 到登录页并带受校验 next。守卫必须在服务端每个受保护请求执行。

**3.3 密码生命周期（A7 B3 B8）**
- A7：请求重置对任何邮箱返回同一 200；令牌单次、TTL 15min、只存摘要；GET 只开页面、POST 才改密；成功后作废未用令牌并吊销全部会话。链接域名只取 `APP_BASE_URL`，不信 `Host`/`X-Forwarded-Host`；重置页带 `Referrer-Policy: no-referrer`。限流见 A9。
- B3：改密需当前密码，成功后轮换当前令牌、吊销其余会话，旧密码立即失效；改邮箱须验证新地址，新地址若属他人则统一 200 并通知占用方，旧地址收到通知。
- B8：改密、绑定/关闭 MFA、改邮箱、停用账号前必须 re-auth（未开 MFA 用当前密码，已开用密码 + 验证码）；失败 401 reauth_required 且**无副作用**。

**3.4 MFA（B5 B6）**
- B5：enroll = 生成密钥 → **仅此一次**返回 provisioning 信息与恢复码 → 输码确认后才写库生效（生效前不能用于第二步，登录也不要求第二步；已启用再 enroll 返回 409）。密钥用 AEAD 加密（校验需可解密，不能哈希）。TOTP 固定参数：SHA1、6 位、30 秒、容忍 ±1 步；确认用的时间步不能再用于登录第二步。
- B6：备份码 ≥10 个、单次使用、每个 ≥50 bit 熵、只存摘要（HMAC 或慢哈希）；密码正确但 MFA 未完成 → 401 mfa_required + challenge_id（不下发会话），challenge 单次、TTL ≤5 分钟、失败 5 次作废；MFA 失败按**账号**累计，不随新 challenge 清零；TOTP 拒绝已用时间步。

**3.5 防滥用（A9 B7 B9）**
- A9：按 IP + 账号/目标邮箱多维计数，超限 429 + Retry-After；**不存在账号同样计数**（否则可探测账号）；计数可清空。**限流键由 auth 定，实现归 rate-limiting**。
- B7：Cookie 认证的写操作校验 Origin/Referer，跨站 403 且无副作用（CSRF 令牌体系归 `web-security`）；跳转只允许站内相对路径：URL 解析后 origin 必须等于 `APP_BASE_URL`，拒绝协议相对 URL、反斜杠与控制字符。
- B9：连续失败按账号指数退避 + 短暂锁定，**不做永久硬锁定**（会被用来批量锁死他人）；成功即清零。

**3.6 事件与运维（A10 B1 B2 B4 B10）**
- A10：所有错误同一 JSON 形状，code 封闭集合，message 不含敏感值；登录成功/失败、登出、找回、改密、改邮箱、MFA 变更、账号停用都产生事件（主体 id、结果、IP/UA、时间），不含密码/令牌明文。事件能否外部观察取决于宿主是否声明 `auth.events.list`（仅 TEST_MODE）；未声明则**不测**。
- B1：登录成功、提权（完成 MFA 第二步）、改密后轮换令牌，旧令牌立即作废（防会话固定）。
- B2：空闲 ≤7 天 + 绝对超时（默认 ≤24 小时，"记住我"才 ≤30 天）按服务端时间判定，超期 401 session_expired；会话列表只暴露自己的会话，可吊销单个/全部且立即生效；会话 id 不得是令牌或其摘要；禁无限期 Cookie。
- B4：账号停用 → 已有会话下次请求即 401 account_disabled，登录/注册尝试 → 403 account_disabled，拒绝重置邮件。管理员停用走 `workspaces-and-permissions` 后台接口，效果相同。
- B10：令牌摘要用 HMAC-SHA-256（**不加盐**，否则无法按令牌查找）并带 key_id，新旧密钥并存，轮换时重算存量摘要；`key_id:salt:hash` 只用于密码哈希。

**3.7 成熟层补充（C1–C6：L2，验收暂不测）**
- C1：外部身份登录校验 state/nonce；只有外部邮箱**已验证**且与已有账号同邮箱才合并，否则要显式登录再合并。
- C2：魔法链接令牌单次、TTL 10min、只存摘要、GET 只渲染 POST 才消费；passkey 注册校验签名，登录校验 origin 与一次性 challenge。
- C3：新设备/异地登录触发二次验证或通知；风险高时重新 MFA 并吊销旧会话。
- C4：主密钥放密钥服务/环境变量，版本化可轮换，不进代码库。
- C5：属主可导出/删除个人数据，停用后按保留策略清除并写审计；**执行归 `audit-and-data-export`，auth 只给主体 id、停用标记与入口**。
- C6：注册时记录同意的条款版本与时间戳。

## 4. 容易做错的地方

| 做错 | 会出的事故 |
|---|---|
| 会话令牌明文入库 | 库被读 = 全员会话接管 |
| 登录不轮换会话 id | 会话固定：预置 Cookie 后被接管 |
| Cookie 缺 HttpOnly / Secure / SameSite | XSS 即可偷走会话，或被 CSRF 跨站写 |
| 会话令牌放进 URL | 泄漏到 Referer、日志、截图、历史 |
| 找回链接 GET 直接改密码 | 邮件扫描器先消费令牌，用户永远失败 |
| 重置令牌不过期或可重放 | 旧邮件长期可改密码，并发双用都成功 |
| 错误提示区分"邮箱不存在" | 用户枚举 → 撞库、钓鱼 |
| 并发注册同邮箱没靠唯一约束 | 两个账号，配额与数据分裂 |
| 改密码不吊销其他会话 | 密码泄漏后用户无法止损 |
| 关 MFA / 改邮箱不 re-auth | 拿到会话 = 永久接管账号 |
| 外部身份未验证邮箱直接合并 | 同名邮箱即可夺走老账号 |
| MFA 允许同一 TOTP 码重用 | 30 秒窗口内被重放 |
| TOTP 密钥/备份码明文存储 | 库泄漏即 MFA 形同虚设 |
| 重置链接用请求里的 Host 拼域名 | 邮件链接可被投毒成钓鱼站 |
| 5xx 回显堆栈 / SQL / 路径 | 泄漏内部结构与拓扑 |

## 5. 与其他模块的接口

| 模块 | auth 给它 | 它给 auth |
|---|---|---|
| workspaces-and-permissions | userId、邮箱唯一性、停用事件、管理员停用入口 | 组织与角色（MFA 策略） |
| rate-limiting | 需要计数的动作（登录/找回/MFA） | 计数与封禁状态 |
| email-transactional | 收件人、模板、令牌 | 投递结果与 outbox 令牌 |
| notifications | 登录/新设备/MFA 变更事件 | 站内通知 |
| web-security | Cookie 策略、Origin/Referer 校验需求 | CSRF 令牌签发与校验、CORS 与头 |
| audit-and-data-export | 认证事件、导出/删除请求 | 审计写入、导出删除执行 |
| observability | 登录成功率、MFA 失败率、枚举指标 | 指标管道与告警 |
| feature-flags | 强制 MFA、密码策略、会话时长开关 | 开关取值 |
| usage-metering-and-budgets | 主体/会话标识 | 配额/预算判定 |
| async-jobs | 过期会话与令牌清理、删号任务 | 任务执行与重试 |
| internationalization | 稳定 error.code + message | 邮件与文案语言 |

依赖顺序：auth → workspaces-and-permissions → 其余（HOST.md §5）。

## 6. 不做什么

- 不实现角色、权限、组织结构 → `workspaces-and-permissions`。
- 不实现邮件发送基础设施 → `email-transactional`；auth 只给"发给谁、发什么、令牌是什么"。
- 不实现限流器与风控引擎 → `rate-limiting`。
- 不实现订阅、账单、额度 → `payments-billing`、`usage-metering-and-budgets`。
- 不做 UI 视觉与登录页设计（HOST.md §6）；只要求页面可达与条款链接。
- 不直接接真实第三方（邮件服务商、身份服务、支付），按 HOST.md §6 用假实现。
- 不自研密码学：KDF、加密、随机数用成熟算法与库。
- 不做头像与附件存储 → `file-storage`；不实现审计留存与导出 → `audit-and-data-export`。

## 7. 实现顺序与最小数据模型（参考）

**顺序**：① 数据与密钥 → ② 注册/登录/会话 → ③ 找回/验证/改密 → ④ MFA（enroll→确认→challenge）→ ⑤ 限流与退避 → ⑥ re-auth 与轮换 → ⑦ L2 能力；每步先跑通最小闭环。

**数据模型**（草图）：`users(id, email_normalized UNIQUE, password_hash, email_verified, mfa_enabled, totp_ciphertext, status)`｜`sessions(id, user_id, token_digest, key_id, idle_expires_at, absolute_expires_at, revoked_at)`｜`auth_tokens(id, user_id, purpose, token_digest, key_id, expires_at, consumed_at)`（purpose=reset/verify/email_change）｜`recovery_codes(id, user_id, code_digest, used_at)`｜`auth_events(id, user_id, type, result, created_at)`

**一次登录**：校验凭据 → 生成 ≥16 字节 CSPRNG 令牌 → 存 `HMAC(key, token)`+key_id → 下发 `__Host-` Cookie → 之后查摘要、校验双超时 → 返回 userId。
