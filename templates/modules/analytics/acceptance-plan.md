# analytics · 验收计划（黑盒）

**执行前提**：按 `HOST.md` 启动宿主；概念到路径的映射读 `module-map.json`，只运行宿主声明了的 `analytics.*` 概念；未声明的概念记"宿主未声明"。所有数值阈值从 `params.analytics.*` 读；未声明时按契约默认值断言，声明值须在契约上限之内。每个用例用**全新账号（唯一邮箱）**，按 `HOST.md` 第 3 节经 auth 与 workspaces-and-permissions 的公开接口建用户/工作区，不绕过。

**通用前置**：需要事件落库的用例，先对该账号 `analytics.consent.set {purpose:"analytics", state:"granted", mode:"direct"}`；标明"未授权"的用例除外。需要 `marketing` 的用例另授该 purpose；若宿主 `params.analytics.purposes` 不含 `marketing`，相关子项记"宿主未声明"。

**通用请求头**：带会话的用例附 `Origin: <APP_BASE_URL>`（脚本从环境变量 `APP_BASE_URL` 取，等于 `params.analytics.allowedOrigins` 首个值）；负例用 `Origin: https://evil.example`。需要幂等的用例附 `Idempotency-Key`。需要推进时间的用例调 `POST /api/__test__/clock {advanceSeconds}`，**推进后重新登录**同一账号再查询（会话可能被时钟作废）；需要清限流的用例先 `DELETE /api/__test__/rate-limits`。

**表**：id | 前置 | 动作 | 期望 | 负例

| id | 前置 | 动作 | 期望 | 负例 |
|---|---|---|---|---|
| AC-01 | 已登录的新账号，已授 `analytics` 同意 | POST `analytics.track` `{name:"report_created", properties:{template:"weekly"}}`；再 GET `analytics.events` 与 `analytics.stats?event=report_created` | 202 `stored:true`、`eventId` 非空；`analytics.events` 出现该事件、`subjectId` 非空、`clientNetwork` 是 /24 或 /48 形式；该事件名在 `analytics.events` 的条数 = `analytics.stats` 的 `count` | 否 |
| AC-02 | 匿名 | POST `analytics.track` `{name:"Bad Name"}`；再 POST 不带 `anonymousId` 的 `{name:"report_created"}`；再 POST `{name:"report_created", purpose:"not_a_purpose"}` | 依次 400 `invalid_event_name`、400 `missing_subject`、400 `unknown_purpose`；三次都不落库；错误体形如 `{"error":{"code","message","details"}}`，message 不含堆栈/SQL/路径/内部 id | 是 |
| AC-03 | 已授同意 | POST `analytics.track`，`properties` 序列化后 > `params.analytics.maxEventBytes`；再 POST 一个属性个数 > `params.analytics.maxPropertiesPerEvent` 的事件 | 两次都 413 `event_too_large`，都不落库 | 是 |
| AC-04 | 已授同意 | POST `analytics.track` `{name:"x", properties:{nested:{a:1}}}` | 400 `validation_failed`（属性值只接受标量），不落库 | 是 |
| AC-05 | 已授同意 | POST `analytics.track` `{name:"x", occurredAt:"2020-01-01T00:00:00Z"}`；再 POST 一个 `occurredAt` 为最近 1 小时的 | 前者 400 `invalid_timestamp`（早于任何 `maxEventSkewSeconds` 上限，必超界）；后者 202 `stored:true` | 是 |
| AC-06 | 已授同意 | POST `analytics.track`，头 `Origin: https://evil.example` | 403 `origin_not_allowed`，不落库 | 是 |
| AC-07 | 已登录的新账号，未授 `analytics` 同意 | POST `analytics.track` `{name:"report_created"}` | 202 `stored:false`、`reason:"consent_not_granted"`；`analytics.events` 与 `analytics.stats` 都查不到 | 是 |
| AC-08 | 新账号，只授 `analytics` 同意 | POST `analytics.track` `{name:"newsletter_click", purpose:"marketing"}`；再授 `marketing` 后重发 | 未授时 202 `stored:false`；授后 202 `stored:true` 且可读回 | 是 |
| AC-09 | 已授同意 | POST `analytics.track` `{name:"signup", properties:{email:"a@b.com", plan:"pro", password:"x"}}` | 202；读回事件中 `email`/`password` 键与其值都不存在，`plan:"pro"` 仍在 | 是 |
| AC-10 | 已授同意 | 并发发出 3 个相同 `Idempotency-Key` + 相同载荷的请求 | 都 202 且 `eventId` 相同；`analytics.events` 中该事件只有 1 条 | 是 |
| AC-11 | 已授同意 | 同一 `Idempotency-Key` 换载荷再发 | 409 `idempotency_conflict` | 是 |
| AC-12 | 已授同意，限流计数已清 | 连续提交超过 `params.analytics.trackRateLimitPerMinute` 次；再用**另一个**账号提交同样次数 | 超限那次 429 `rate_limited` 且有 `Retry-After`，之前的都 202；另一账号不 429（限额按主体计） | 是 |
| AC-13 | 已授同意并采集 1 条事件 | `POST /api/__test__/clock {advanceSeconds: params.analytics.retentionDays*86400 + 3600}`，重新登录后 GET `analytics.events` 与 `analytics.stats` | 事件读不回，聚合不再计入 | 是 |
| AC-14 | 新账号 | GET `analytics.consent.get` | 200；`purposes` 含 `analytics`、`marketing`，两者 `state:"unknown"`、`decidedAt` 为 null；与另一账号响应同形 | 否 |
| AC-15 | 新账号 | POST `analytics.consent.set` `{purpose:"analytics", state:"granted", mode:"direct"}`；再 POST 一次 `{purpose:"not_a_purpose", state:"granted"}` 与一次 `{purpose:"analytics", state:"maybe"}` | 前者 200，该 purpose `state:"granted"`、`decidedAt` 非空，随后采集 `stored:true`；后两次分别 400 `unknown_purpose`、400 `invalid_state`，且同意状态未被改动 | 是 |
| AC-16 | 新账号，有可收信邮箱 | POST `analytics.consent.set` `{purpose:"marketing", state:"granted", mode:"double_opt_in"}`；再 GET `GET /api/__test__/outbox?to=<email>` | 202 `confirmation_pending`；该 purpose `state` 仍 `unknown`；outbox 恰有 1 封 `template:"analytics.consent_confirm"`，`data.link` 非空、令牌明文只在 `token` 字段 | 否 |
| AC-17 | 已有 AC-16 的令牌 | POST `analytics.consent.verify` `{purpose:"marketing", token:<明文>}` | 200；`state` 变 `granted`、`decidedAt` 非空 | 否 |
| AC-18 | 同一令牌 | 再 POST 一次 `analytics.consent.verify`；另用未发出过的令牌 POST 一次；再 `POST /api/__test__/clock {advanceSeconds: params.analytics.consentTokenTtlSeconds + 60}` 后用一枚新令牌 POST 一次 | 已用令牌 → 409 `token_already_used` 且 `state` 不变；未知令牌 → 400 `invalid_token`；超期令牌 → 400 `invalid_token` 且 `state` 仍 `unknown` | 是 |
| AC-19 | 已有 AC-16 的令牌 | 并发两次 POST `analytics.consent.verify`（同一令牌） | 恰好 1 个 200，其余 409 `token_already_used`；`state` 只被改一次 `granted` | 是 |
| AC-20 | 已授同意并采集 3 条事件 | POST `analytics.consent.withdraw` `{purpose:"analytics"}`；若 `params.analytics.purgeMode=deferred` 则 `POST /api/__test__/clock {advanceSeconds: params.analytics.purgeDeadlineSeconds + 60}` 并重新登录 | 200 `state:"withdrawn"`、`purgedAt` 非空；该主体该 purpose 的事件在 `analytics.events`/`stats`/`funnel` 三处同时消失 | 是 |
| AC-21 | AC-20 之后 | POST `analytics.consent.set` `{purpose:"analytics", state:"granted", mode:"direct"}`；再采集 | 200 `state:"granted"`；新事件 `stored:true`；旧事件不复活 | 否 |
| AC-22 | 工作区 W 内账号 A 产生 2 条 `report_created`，同工作区账号 B 产生 1 条 | GET `analytics.stats?event=report_created` | `count`=3、`uniqueSubjects`=2；`groups` 中该 key 的 count 与之一致 | 否 |
| AC-23 | 账号 X 只属于 W1；账号 Y 只属于 W2；两人各已授权 | X GET `analytics.stats?workspaceId=<W2>`；Y 在 W2 采集 1 条后，X GET 不带 `workspaceId` 的 `analytics.stats` | 前者 403 `workspace_forbidden`；后者只含 W1 的事件，不含 Y 在 W2 采的那条 | 是 |
| AC-24 | 账号 A 依次产生 `view_item`、`add_to_cart`、`checkout`；账号 B 只产生 `view_item`；账号 C 乱序产生 `checkout` 再 `view_item` | GET `analytics.funnel?steps=view_item,add_to_cart,checkout` | 逐步 `uniqueSubjects` 单调不增；C 的乱序不计入 `checkout`；`conversionFromPrev` 在 [0,1] | 否 |
| AC-25 | 已登录 | GET `analytics.funnel?steps=only_one`；再 GET `?steps=a,<非法名>` | 两次都 400 `validation_failed` | 是 |
| AC-26 | 无会话 | GET `analytics.stats`；再 GET `analytics.funnel?steps=a,b` | 两次都 401 `unauthorized`，body 形如 `{"error":{"code","message","details"}}`，message 不含堆栈/SQL/路径 | 是 |
| AC-27 | 随机从未出现过的 `anonymousId`；已注册但从未表态的账号；auth 模块能构造出的每种账号状态（未验证、已禁用）各一个 | 对每个主体 GET `analytics.consent.get` | 全部 200 且 body 结构、字段集合完全同形，只有 `state`/`decidedAt` 取值不同；不得 404，不得出现"存在/不存在"类文案；auth 未暴露某状态的构造方式时该子项记"宿主未声明" | 是 |
| AC-28 | 已登录账号，已知其 user id 与邮箱 | GET `analytics.events`；并对 `params.analytics.tables` 声明的表做只读查询 | `subjectId` ≠ user id 且 ≠ 邮箱，是固定长度摘要；同账号两次采集摘要相同、不同账号摘要不同；表中任一列都不含 user id 明文、邮箱明文、完整 IP 明文、明文令牌、明文幂等键 | 是 |
| AC-29 | 已登录 | 请求带 `X-Forwarded-For: 203.0.113.9, 198.51.100.7`，读回该事件的 `clientNetwork` | `params.analytics.trustForwardedFor=false` 时 `clientNetwork` 既不等于 `203.0.113.0/24` 也不等于 `198.51.100.0/24`（XFF 被忽略）；为 `true` 时等于脚本按 `params.analytics.trustedProxyCidrs` 算出的**最右侧非受信跳**的 /24（受信网段为空时即 `198.51.100.0/24`，绝不取 `203.0.113.0/24`）；任何情况下都不是完整 IP | 是 |
| AC-30 | 工作区 W 有两个成员账号 | 账号 A GET `analytics.events` | 只含 A 自己的事件，不含同工作区账号 B 的事件（但 `analytics.stats` 能统计到 B 的贡献） | 是 |

**未覆盖（黑盒不可测，写在契约第 5 节）**：密钥轮换与双密钥并行校验、采样率与批处理、保留期清理作业调度、地理编码、事件 schema 注册表。

**隔离要求**：全部用例互不共享账号。AC-07/AC-08/AC-14~AC-21/AC-27 各用独立新账号，避免同意状态串味；AC-10~AC-13/AC-22~AC-24/AC-28~AC-30 各自独立账号，避免事件与计数串味。AC-12/AC-23 的"另一个账号"是本用例内新建的第二账号。
