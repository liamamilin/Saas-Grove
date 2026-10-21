# notifications 模块契约（黑盒可验证）

只描述可从外部观察到的行为。路径是**概念名**，由宿主 `module-map.json` 映射；数值上下限由宿主 `params` 声明；启动、夹具、时钟、限流、邮件钩子见 HOST.md，本文件不重复。

## 1. 概念（宿主需映射）

| 概念 | 方法 | 用途 | 鉴权 |
|---|---|---|---|
| `notifications.list` | GET | 收件箱列表 | 需登录 |
| `notifications.unread-count` | GET | 未读数 | 需登录 |
| `notifications.mark-read` | POST | 标记已读 | 需登录 |
| `notifications.preferences.get` | GET | 读偏好 | 需登录 |
| `notifications.preferences.update` | PUT | 写偏好 | 需登录 |
| `notifications.announce` | POST | 工作区公告派发 | 需登录 + 工作区发送权限 |
| `notifications.view-token` | POST | 领取一次性查看令牌 | 需登录 |
| `notifications.view` | GET | 凭令牌看未读快照 | 免登录（令牌即凭证） |

未映射的概念记为"宿主未声明"，不判失败也不判通过。

## 2. 固定词表（合同常量，宿主不得改名）

- 分类：`announcement`（公告）、`digest`（摘要）、`system`（强制类）。宿主可增加其它分类，验收只用前三个。
- 通道：`inApp`（站内）、`email`（邮件）。
- 摘要频率：`off` / `daily` / `weekly`。
- 错误码集合（仅这五个）：`unauthenticated` / `forbidden` / `not_found` / `invalid_request` / `rate_limited`。

## 2b. 宿主可声明的参数（`module-map.json` 的 `params`）

| 键 | 含义 | 契约界限 | 未声明时 |
|---|---|---|---|
| `notifications.announceRateLimit` | 派发端点限额 `{max, windowSeconds}` | `max` ≤10 | 按 10 次/60 秒 |
| `notifications.retentionDays` | 通知保留天数 | ≤180 | 本条不适用（记为宿主未声明） |
| `notifications.viewTokenTtlSeconds` | 令牌有效期 | ≤86400 | 按 3600 秒 |
| `notifications.channels` | 可用通道列表 | 含 `inApp`；含 `email` 时邮件规则适用 | 只有 `inApp`（邮件规则不适用） |
| `notifications.trustedProxies` | 受信代理跳数或网段 | — | 0（忽略整个 `X-Forwarded-For`） |
| `digest.timezone` / `digest.weekStart` | 摘要周期时区 / 周起始 | — | UTC / 周一 |
| `csrf.mode` | `off` / `origin` / `token` | — | `off`（S1 不适用） |

## 3. 状态码（一情一码，不得混用）

| 情况 | 状态 | `error.code` |
|---|---|---|
| 成功，含幂等重放 | 200 | — |
| 未登录；令牌无效/已用/过期 | 401 | `unauthenticated` |
| 已登录但无权限（派发到非成员工作区） | 403 | `forbidden` |
| 目标资源不存在或不属于本人 | 404 | `not_found` |
| 参数/输入非法 | 400 | `invalid_request` |
| 触发限流 | 429 | `rate_limited`（另带 `Retry-After` 头） |

## 4. 数据形状

```
列表项      {"id","category","title","body","link","readAt","createdAt"}   // readAt 未读为 null；link 可为 null
            category=digest 时额外带整数 count；其它分类不带 count
list 响应   {"items":[列表项...],"limit":20,"offset":0,"hasMore":true}
unread      {"unread":3}
mark-read   请求 {"ids":["id..."]} 或 {"all":true}；响应 {"updated":2}
偏好        {"digestFrequency":"off|daily|weekly","categories":[{"category","inApp":bool,"email":bool}]}
announce    请求 {"workspaceId","title","body","link","idempotencyKey"(必填),"recipients":{"scope":"all-members"}(可省，默认全体成员)}
            响应 {"announcementId","category":"announcement","recipients":3,"created":true|false}
view-token  {"token":"...","expiresAt":"ISO-8601"}
view        {"unread":2,"categories":["announcement"]}      // 只含数量与分类名
```

## 5. 规则（MUST）

### 错误形状
- **E1** 所有 4xx/5xx 响应体是 JSON，含 `error.code` 与 `error.message`；`code` 只能取 §2 集合；不得返回 HTML 错误页；`error.message` 不得包含 SQL、内部路径、令牌明文。

### 收件箱
- **F1** 除 `notifications.view` 外全部概念需登录；未登录一律 401 `unauthenticated`，且响应体不得含任何通知数据。
- **F2** 列表只含当前用户自己的通知；按 `createdAt` 降序；`createdAt` 相同时次序必须稳定（连续两次读取顺序完全一致）；不得出现他人数据。
- **F3** `limit` 必须是 1..100 的整数（缺省 20），`offset` 必须是 ≥0 的整数；非整数或越界 → 400 `invalid_request`；`items` 长度 ≤ `limit`；`offset` 超出数据量 → 200 且 `items` 为空数组。
- **F4** 无任何通知时：列表 200 且 `items=[]`，未读数 200 且 `unread=0`。
- **F5** 标记已读只作用于本人；已读项重复标记 → 200 且 `readAt` 保留**首次**时间（既不清空也不改写）；未读数减少量 = 本次真正由未读变已读的条数；`all=true` 只清本人；`ids` 为空数组、或既无 `ids` 又无 `all` → 400 `invalid_request`。
- **F6** 标记"不存在的 id"、"属于他人的 id"、"属于已禁用或未验证账号的 id" → 一律 404 `not_found`，且三者的 `code` 与 `message` 完全一致；不得用 403 泄露通知是否存在。
- **F7** 每个列表项必须含 `id`、`category`、`title`、`body`、`createdAt`、`readAt`、`link` 七个字段。

### 偏好
- **P1** `notifications.preferences.get` 返回宿主支持的全部分类及其当前值，外加 `digestFrequency`；从未设置过的用户返回默认值 `inApp=true`、`email=false`、`digestFrequency=off`；不得 404，不得返回空集合。
- **P2** 写入是**部分更新**：只改请求里出现的分类/字段，未出现的保持原值；成功后再次 GET 必须回显同样的值。
- **P3** 非法更新（未知分类、非法频率、非布尔值、未知字段）→ 400 `invalid_request`，且已有设置**完全不变**（原子失败）。
- **P4** 关闭某分类 `inApp` 后，**之后**派发的该分类通知不产生：不进列表、不计入未读数；关闭前已存在的通知仍然可见。
- **P5** 某分类 `email` 关闭 → 不再为该分类产生邮件消息；`email` 开启 → 必须产生该分类的邮件消息（宿主 `params.notifications.channels` 含 `email` 时适用）。
- **P6** 偏好按用户隔离：改 A 不影响 B。
- **P7** `system` 分类强制 `inApp=true`：更新请求里写 `false` 仍回显 `true`，且 `system` 类通知始终送达。

### 摘要
- **D1** `digestFrequency=off` 时，跨过任何周期边界都不产生 `digest` 通知。
- **D2** 跨过周期边界后（`daily` 推进 ≥48 小时、`weekly` 推进 ≥8 天；宿主可在 `params` 声明时区与周起始日）必须物化摘要：列表出现 `category=digest` 的通知，其 `count` = 该周期内该用户**未读**通知数。
- **D3** 同一周期内（多次读取、多次推进时钟）最多一条 `digest` 通知。
- **D4** 摘要不改变被摘要通知的 `readAt`（摘要不代替已读）。
- **D5** 周期内没有未读通知 → 不产生摘要（不产生空摘要）。

### 一次性查看令牌
- **T1** `notifications.view-token` 需登录，返回 `token` 与 `expiresAt`；`token` 长度 ≥32 字符且只含 URL 安全字符；同一用户两次领取得到**不同** `token`；有效期 ≤24 小时。
- **T2** 凭 `token` 请求 `notifications.view` → 200，响应体只含本人的未读数量与分类名；**不得**含通知标题、正文、链接、他人数据或任何账号凭证。
- **T3** 令牌的"不存在"、"已使用"、"已过期"三种失败，响应必须完全一致：401 + `code=unauthenticated` + 同一 `message`；过期以 `expiresAt` 为准。
- **T4** 同一令牌并发使用 → 恰好一个 200，其余 401。
- **T5** 库中令牌只存 `sha-256(token)` 的小写十六进制（64 字符）；明文令牌只允许出现在**名字含 `outbox`** 的表；通知表、偏好表、令牌表都不得出现明文。
- **T6** `notifications.view` 响应头必须含 `Cache-Control: no-store` 与 `Referrer-Policy: no-referrer`。
- **T7** 令牌不是会话：带 `token` 访问其它需登录的概念 → 401。

### 公告派发
- **AN1** 派发前必须通过工作区权限检查：未登录 → 401；非目标工作区成员或无发送权限 → 403 `forbidden`（不区分工作区是否存在，避免枚举）。
- **AN2** 派发成功 → 200，响应含 `announcementId`、`category=announcement`、`recipients` 数、`created`；目标工作区每个**未关闭该分类 `inApp`** 的成员，其列表出现该通知、未读数 +1（关闭者按 P4 不产生）。
- **AN3** 非目标工作区的成员收不到该通知，其未读数不变。
- **AN4** 同一 `(工作区, idempotencyKey)` 再次派发 → 200，`announcementId` 与首次相同、`created=false`、不产生任何新通知、未读数不变。
- **AN5** 同一 `(工作区, idempotencyKey)` 并发派发 → 只产生一组通知（不重复），两次响应的 `announcementId` 相同。
- **AN6** 输入校验：`link` 必须是以单个 `/` 开头的站内相对路径（`//host`、绝对 URL、`javascript:`、`data:`、含 CR/LF 或控制字符 → 400 `invalid_request`）；`title` ≤200 字符、`body` ≤2000 字符，超限同样 400；校验失败**不产生任何通知**。
- **AN7** 邮件通道可用时（`params.notifications.channels` 含 `email`）：outbox 出现模板 `notifications.announcement`（公告）或 `notifications.digest`（摘要）的消息，链接放在 `data.link`，带令牌的放在 `token` 字段。

### 限流
- **L1** 派发端点必须受限流约束（由 rate-limiting 提供或本模块自带）：超过声明值（未声明时按 60 秒内 10 次）→ 429 + `code=rate_limited` + `Retry-After` 头；未超限的请求不受影响。
- **L2** 限流键中的客户端 IP 取自 `X-Forwarded-For` **最右侧的非受信跳**（宿主声明的受信代理段之后的第一跳）；未声明受信代理时整个 `X-Forwarded-For` 忽略，使用连接源 IP；最左侧的值永远不被采用；改最左跳不得获得新桶。

### 生命周期与安全
- **S1** 宿主在 `params` 声明 `csrf.mode` 且不为 `off` 时：写接口缺少或不匹配声明的 CSRF 凭据 → 403 `forbidden` 且**不产生任何状态变更**。
- **S2** 宿主声明 `notifications.retentionDays`（上限 180 天）时，超过保留期的通知不再出现在列表与未读数中（未声明则本条记为宿主未声明）。
- **S3** `auth` 的删除账号接口已映射时，账号删除后本模块的该用户通知与偏好在库中被清除（可由只读查询验证）。

## 6. 必须哈希存储的数据

- 一次性查看令牌：`sha-256(token)` 小写十六进制；明文只在签发响应与 outbox 消息中出现一次。令牌熵足够，无需加盐；**不得**用"从库里重算"的方式兼容旧令牌，需要并存时并行校验两套哈希直到旧令牌自然过期。
- 幂等键不是凭证，可明文存；收件人邮箱若被复制进本模块存储，属个人数据，账号删除时必须清除（S3）。

## 7. 不变量

- 同一过滤条件下，`unread` == 列表中 `readAt` 为 null 的条数。
- 通知归属只有一个用户；列表、未读数、标记已读三处的归属判定完全一致。
- `readAt` 只写一次，之后不再变化。
- 同一 `(工作区, idempotencyKey)` 最多一组通知。
- 令牌最多被成功消费一次（即使未过期）。
- 摘要的 `count` == 物化时刻被覆盖的未读通知数。
- 一处偏好变更不影响其它用户的任何可见状态。

## 8. 建议，验收不测

- 客户端渲染通知标题/正文时必须转义（防存储型 XSS）；本模块只保证原样返回纯文本。
- 投递失败的重试与退避由 async-jobs 负责；站内与邮件通道互不阻塞。
- 令牌哈希可加盐/换算法（会改变 T5 的精确值要求，变更需同步改契约）。
- 通知文案的多语言来源由 internationalization 提供。
- 日志与错误信息里不得打印令牌明文与通知正文。
- 建议索引 `(user_id, created_at)` 与 `(user_id, category, read_at)`。
- 实时推送（websocket）属可选增强，不在契约内。
- 建议保留期 90 天、摘要默认 `off`（理由见 decisions.md）。

## 9. 规则 → 用例追溯

| 规则 | 用例 |
|---|---|
| E1 | A01 |
| F1 | A01 |
| F2 | A03 |
| F3 | A04 |
| F4 | A02 |
| F5 | A05 |
| F6 | A06 |
| F7 | A02 |
| P1 | A07 |
| P2 | A07 |
| P3 | A08 |
| P4 | A09 |
| P5 | A25 |
| P6 | A10 |
| P7 | A09 |
| D1 | A11 |
| D2 | A12,A28 |
| D3 | A12 |
| D4 | A12 |
| D5 | A13 |
| T1 | A14 |
| T2 | A14 |
| T3 | A15 |
| T4 | A16 |
| T5 | A17 |
| T6 | A18 |
| T7 | A18 |
| AN1 | A19 |
| AN2 | A20 |
| AN3 | A20 |
| AN4 | A21 |
| AN5 | A22 |
| AN6 | A23 |
| AN7 | A25,A28 |
| L1 | A24 |
| L2 | A24 |
| S1 | A26 |
| S2 | A27 |
| S3 | A27 |
