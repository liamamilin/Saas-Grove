# analytics · 黑盒契约（可被另一代理的验收脚本依赖）

只描述**从外部可观察**的行为。宿主实现自由，但必须满足每条 MUST。每条 MUST 依赖的**概念**由宿主在 `module-map.json` 映射到真实路径；概念未映射 = "宿主未声明"，不算通过也不算失败。启动、时钟、限流清理、夹具、outbox 取件按 `HOST.md`。

## 1. 概念与公共约定

**错误体**（所有 ≥400 响应）：`{"error":{"code":"<稳定机器码>","message":"<短句>","details":[]}}`。`code` 稳定可判；`message` 不得含堆栈、SQL、路径、主机名、密钥、原始个人数据；`details` 只放字段名/计数。

**主体**：`analytics.track`/`events`/`consent.*` 允许匿名（带 `anonymousId`）或登录（有会话）。登录时主体 = 会话用户，匿名时主体 = `anonymousId`。主体标识**永不出现在响应或存储里**，只以摘要出现（§3）。

**宿主必须映射下列概念**（方法 · 请求 · 成功响应）：

- `analytics.track` POST · 请求 `{name(必填), properties(可选对象), occurredAt(可选 ISO8601), anonymousId(无会话时必填), purpose(可选，默认 analytics), workspaceId(可选，默认当前工作区)}` · `202` `{"eventId","stored":true|false,"reason":null|"consent_not_granted"}`
- `analytics.events` GET · `?limit=` · `200` `{"events":[{"eventId","name","purpose","occurredAt","properties","subjectId","clientNetwork","hasMore"}],"count"}`
- `analytics.stats` GET · `?from&to&event&workspaceId` · `200` `{"from","to","total","uniqueSubjects","groups":[{"key","count","uniqueSubjects"}]}`
- `analytics.funnel` GET · `?steps=a,b,c&from&to&workspaceId` · `200` `{"steps":[{"name","count","uniqueSubjects","conversionFromPrev"}]}`
- `analytics.consent.get` GET · — · `200` `{"subject","purposes":{"<purpose>":{"state","decidedAt","policyVersion"}}}`
- `analytics.consent.set` POST · `{purpose, state:"granted|denied", mode:"direct|double_opt_in"}` · `200`（direct）或 `202 {"status":"confirmation_pending"}`（double_opt_in）
- `analytics.consent.verify` POST · `{purpose, token}` · `200` `{"purpose","state":"granted","decidedAt"}`
- `analytics.consent.withdraw` POST · `{purpose}` · `200` `{"purpose","state":"withdrawn","purgedAt"}`

`analytics.events` 的 `subjectId` = §3 摘要；`clientNetwork` = `/24`（IPv4）或 `/48`（IPv6）截断网段（如 `198.51.100.0/24`），绝不是完整 IP；默认最近 200 条。

**同意状态枚举**：`unknown`（从未表态）/ `granted` / `denied` / `withdrawn`。**默认拒绝**：每个 purpose 都要显式 `granted` 才落库。

**状态码表**（同一情形只用一个码）

| 状态 | 情形 → `error.code` |
|---|---|
| 202 | 事件被接受（已落库或按同意丢弃，body 内 `stored`/`reason`）；同意待邮件确认（body 内 `status`）→ 无 code |
| 400 | 事件名非法→`invalid_event_name`；缺主体→`missing_subject`；时间戳超偏移→`invalid_timestamp`；参数格式非法（含非标量属性）→`validation_failed`；用途不存在→`unknown_purpose`；状态非法→`invalid_state`；令牌无效或过期→`invalid_token` |
| 401 | 需登录的接口无有效会话→`unauthorized` |
| 403 | 跨工作区访问→`workspace_forbidden`；Origin 不在允许清单→`origin_not_allowed` |
| 409 | 幂等键同键异载荷→`idempotency_conflict`；令牌已被使用→`token_already_used` |
| 413 | 事件过大（字节或属性数超限）→`event_too_large` |
| 429 | 超限→`rate_limited`（带 `Retry-After`） |
| 500 | 未预期服务端错误→`internal_error`（无细节） |

**参数**（宿主在 `module-map.json` 的 `params` 声明实际值；未声明按默认值验收，声明值须在括号内的**上限**内）

| params 键 | 默认（上限） | 含义 |
|---|---|---|
| `analytics.purposes` | `["analytics","marketing"]` | 记录的目的，每个都需显式授权 |
| `analytics.maxEventBytes` | 2048（16384） | 单事件字节上限 |
| `analytics.maxPropertiesPerEvent` | 32（128） | 单事件属性数上限 |
| `analytics.maxEventSkewSeconds` | 300（86400） | 时间戳允许偏移 |
| `analytics.idempotencyTtlSeconds` | 86400（604800） | 幂等键去重窗口 |
| `analytics.trackRateLimitPerMinute` | 60（6000） | 单主体每分钟采集上限 |
| `analytics.purgeDeadlineSeconds` | 60（3600） | 撤回后清除时限 |
| `analytics.consentTokenTtlSeconds` | 86400（604800） | 一次性令牌有效期 |
| `analytics.purgeMode` | `sync` | `sync`=响应前已清除，`deferred`=随后清除 |
| `analytics.retentionDays` | 90（730） | 原始事件保留天数 |
| `analytics.funnelWindowSeconds` | 86400（2592000） | 漏斗步骤间隔上限 |
| `analytics.allowedOrigins` | `[APP_BASE_URL]` | 允许的浏览器来源 |
| `analytics.trustForwardedFor` | `false` | 直连对端是否受信（受信才采信 XFF） |
| `analytics.trustedProxyCidrs` | `[]` | XFF 受信代理网段 |
| `analytics.tables` | 未声明 | 分析数据表名（供只读扫描） |

## 2. MUST 规则

### 2.1 采集（`analytics.track`）
- **R-T1**：合法事件 → `202`（body 见 §1）；`eventId` 非空、稳定、无明文主体。
- **R-T2**：`name` 不匹配 `^[a-z][a-z0-9_.-]{0,63}$` → `400 invalid_event_name`，不落库。**R-T3**：无会话且无 `anonymousId` → `400 missing_subject`。
- **R-T4**：`properties` 序列化后 > `analytics.maxEventBytes`，或属性个数 > `analytics.maxPropertiesPerEvent` → `413 event_too_large`。**R-T5**：`properties` 的值只接受标量（字符串/数字/布尔/null），嵌套对象或数组 → `400 validation_failed`。
- **R-T6**：`occurredAt` 与服务器时间之差 > `analytics.maxEventSkewSeconds` → `400 invalid_timestamp`；缺省用服务器时间。**R-T7**：带 `Origin` 头时其值须在 `analytics.allowedOrigins` 内，否则 `403 origin_not_allowed`；无该头（服务端到服务端）放行。
- **R-T8**（同意闸门，默认拒绝）：事件的 `purpose` 未对该主体 `granted` → `202` `{"stored":false,"reason":"consent_not_granted"}`，**不落库、不计数、读不回**；对每个 purpose 适用。`purpose` 不在 `analytics.purposes` 内 → `400 unknown_purpose`。
- **R-T9**（脱敏）：属性键命中敏感名单（不区分大小写、去 `_-.` 后比较：`email,mail,phone,mobile,tel,password,passwd,pwd,token,accesstoken,refreshtoken,secret,apikey,authorization,cookie,sessionid,ssn,socialsecurity,creditcard,cardnumber,cvv,iban,address,fullname,firstname,lastname,dob,latitude,longitude`）→ 该键值对落库前丢弃、落库后读不回；余下属性保留。
- **R-T10**（幂等）：带 `Idempotency-Key` 头，窗口内同键同载荷 → 返回**同一个** `eventId` 且只产生**一条**事件；同键异载荷 → `409 idempotency_conflict`。
- **R-T11**（限流）：单主体每分钟提交超过 `analytics.trackRateLimitPerMinute` → `429 rate_limited` + `Retry-After`；未超限不得误伤；限额按主体计，换账号不共享计数。**R-T12**（保留）：事件落库超过 `analytics.retentionDays` 后不得读回、不再计入聚合。

### 2.2 同意（`analytics.consent.get` / `.set` / `.verify` / `.withdraw`）
- **R-C1**（读）：`analytics.consent.get` → `200`（body 见 §1）；每个 purpose 项为 `{"state","decidedAt","policyVersion"}`，`state` 取 §1 枚举，`decidedAt` 为时间或 null；`analytics.purposes` 里每个 purpose 都出现。
- **R-C2**（写）：`analytics.consent.set` body `{purpose, state:"granted|denied", mode:"direct|double_opt_in"}`。purpose 不在 `analytics.purposes` 内 → `400 unknown_purpose`；`state` 非法 → `400 invalid_state`。`direct` → `200`，该 purpose `state` 变为所请求值、`decidedAt` 为服务器时间。`double_opt_in` → `202` `{"status":"confirmation_pending"}`，该 purpose `state` 仍 `unknown`，并发出**一封**邮件：模板 `analytics.consent_confirm`，令牌明文放 outbox 的 `token`，链接放 `data.link`。
- **R-C3**（确认）：`analytics.consent.verify` body `{purpose, token}`：令牌有效且未用过 → `200`（body 见 §1），该 purpose `state` 变 `granted`、令牌标记已用；已用过 → `409 token_already_used`；不存在/超 `analytics.consentTokenTtlSeconds`/与 purpose 不匹配 → `400 invalid_token`。
- **R-C4**（单次令牌）：同一令牌只允许成功一次；并发确认时**恰好一个** `200`，其余 `409 token_already_used`。
- **R-C5**（撤回）：`analytics.consent.withdraw` body `{purpose}` → `200`（body 见 §1）；该主体该 purpose 的所有事件（含其他工作区的）必须在 `analytics.purgeDeadlineSeconds` 内从 `analytics.events`、`analytics.stats`、`analytics.funnel` 三处同时消失（聚合只反映仍留存的事件，不得用失效的预聚合值把已删事件算回）；`purgeMode=sync` 时响应前已清除，`deferred` 时用 `POST /api/__test__/clock` 推进后复查。撤回后再 `analytics.consent.set` → `state` 复原。
- **R-C6**（枚举安全）：对**任意**主体标识（随机 `anonymousId`、已存在账号、已禁用账号曾用过的 `anonymousId`），`analytics.consent.get` 必须返回**同形**的 `200`（`state:"unknown"`），不得 404，不得用 message/`details` 区分存在与否。

### 2.3 查询（`analytics.stats` / `analytics.funnel`）
- **R-Q1**（聚合）：`analytics.stats?from&to&event` → `200`（body 见 §1）；`count`=事件条数，`uniqueSubjects`=去重主体数（同一人两次触发算 1 个）；缺省窗口 = 最近 24 小时；`from`/`to` 非法 → `400 validation_failed`。
- **R-Q2**（工作区隔离）：聚合与漏斗只统计调用者所属工作区的数据；`workspaceId` 指向非成员工作区 → `403 workspace_forbidden`；不带该参数时结果不得含别的工作区。
- **R-Q3**（漏斗）：`analytics.funnel?steps=a,b,c&from&to` → `200`（body 见 §1）；按**主体**计数且必须**按序**发生（后一步落在同一主体的前一步之后，间隔 ≤ `analytics.funnelWindowSeconds`）；`count` 与 `uniqueSubjects` **单调不增**；`conversionFromPrev` ∈ [0,1]（首步 1）；`steps` 少于 2 个、多于 10 个或含非法名 → `400 validation_failed`。
- **R-Q4**（需登录）：`analytics.stats` 与 `analytics.funnel` 必须要求有效会话，无会话 → `401 unauthorized`；`analytics.track`/`events`/`consent.*` 可匿名。

### 2.4 隐私与隔离
- **R-P1**（哈希存储，详见 §3）：主体标识、令牌、幂等键在存储中只有摘要形式。**R-P2**（不存邮箱）：MUST NOT 存储邮箱明文；邮箱类属性按 R-T9 丢弃。**R-P3**（不存全文 IP）：MUST NOT 存储或返回完整客户端 IP；只允许 `/24`（IPv4）、`/48`（IPv6）截断网段。
- **R-P4**（代理后取 IP）：`trustForwardedFor=true` 时，客户端 IP 取 `X-Forwarded-For` 中**最右侧的不受信跳**（受信 = 落在 `analytics.trustedProxyCidrs`），MUST NOT 取最左侧那跳；`trustForwardedFor=false` 时**完全忽略** `X-Forwarded-For`，用直连地址。两分支都只记 §1 截断网段。
- **R-P5**（跨主体不可读）：`analytics.events` 只返回**调用者自己**的事件；同工作区其他成员只看得到聚合值。

## 3. 必须哈希化存储的数据

| 编号 | 数据 | 存储形式 | 观察方式 |
|---|---|---|---|
| H1 | 登录用户 id | 服务端密钥的 HMAC 摘要（非裸 SHA-256） | `subjectId` ≠ user id；同用户多次相同，不同用户不同 |
| H2 | 用户邮箱 | **不存储**（连摘要都不存） | 表内无邮箱明文 |
| H3 | `anonymousId` | HMAC 摘要 | `subjectId` ≠ 其明文 |
| H4 | 客户端 IP | 只存 `/24`（IPv4）或 `/48`（IPv6）截断网段 | 响应与表中无完整 IP |
| H5 | 一次性令牌 | 服务端密钥 + 每令牌随机盐的摘要；明文只在 outbox | 响应不回显明文；表内无明文 |
| H6 | `Idempotency-Key` | 带服务端密钥的摘要 | 表内无明文 |

只读扫描：宿主若在 `params.analytics.tables` 声明表名，验收对该表只读查询，断言表中**没有任何一列**出现测试用的 user id、邮箱、完整 IP、明文令牌、明文幂等键。未声明表名时该子项记"宿主未声明"，其余断言仍须成立。

## 4. 不变量（对任意时刻成立）
- **INV1**：摘要相同 ⟺ 同一主体；不同主体摘要必不同。**INV2**：同一工作区内只有该账号的事件时，`analytics.events` 中同名事件条数 = `analytics.stats` 中该事件名的 `count`。**INV3**：漏斗每步 `uniqueSubjects` 单调不增，最后一步 ≥ 0。**INV4**：`analytics.consent.get` 对任何主体返回的结构完全相同。**INV5**：令牌用过后永久为"已用"，重复使用不再改变同意状态。**INV6**：撤回后该主体该 purpose 的事件在 `analytics.purgeDeadlineSeconds` 内从读回、聚合、漏斗三处同时消失。

## 5. 建议，验收不测（黑盒看不到）
- 密钥轮换：换 HMAC 密钥时**不要重算存量摘要**；旧令牌过期前用双密钥并行校验。
- 账号状态（disabled / unverified / 不存在）的枚举安全由 auth 层保证，analytics 不得追加可区分字段。
- 事件 schema 注册表与命名治理、采样率、批量落库队列、预聚合表、地理编码、同意文案版本化、保留期清理调度。

## 6. 规则 → 验收用例追溯

| 规则 | 用例 |
|---|---|
| R-T1 | AC-01 |
| R-T1 / INV2 | AC-01 |
| R-T2 / R-T3 | AC-02 |
| R-T4 / R-T5 | AC-03, AC-04 |
| R-T6 | AC-05 |
| R-T7 | AC-06 |
| R-T8 | AC-07, AC-08 |
| R-T9 | AC-09 |
| R-T10 | AC-10, AC-11 |
| R-T11 | AC-12 |
| R-T12 | AC-13 |
| R-C1 | AC-14, AC-27 |
| R-C2 | AC-15, AC-16 |
| R-C3 | AC-17, AC-18 |
| R-C4 | AC-19 |
| R-C5 | AC-20, AC-21 |
| R-C6 / INV4 | AC-27 |
| R-Q1 | AC-22 |
| R-Q2 | AC-23 |
| R-Q3 | AC-24, AC-25 |
| R-Q4 | AC-26 |
| R-P1 / R-P2 / H1 / H2 / H3 / INV1 | AC-28 |
| R-P3 / R-P4 / H4 | AC-28, AC-29 |
| R-P5 | AC-30 |
| H5 | AC-16, AC-28 |
| H6 | AC-10, AC-28 |
| INV3 | AC-24 |
| INV5 | AC-17, AC-18, AC-19 |
| INV6 | AC-20 |
