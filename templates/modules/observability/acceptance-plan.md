# observability 验收计划（黑盒）

契约见 `contract.md`；本文件只列**可执行的用例计划**，不是测试代码。启动、路径映射、钩子、依赖顺序见 HOST.md，不重复。

## 0. 前置与夹具

- **启动**：按 HOST.md §1（`npm install && npm run build && npm start`，`GET /api/health` 返回 200 即就绪）。
- **映射**：概念→真实路径读宿主 `module-map.json`；概念未映射记为"宿主未声明"，记为未声明而非失败（HOST.md §2）。
- **阈值**：所有数值从 `params` 读（清单见 `contract.md` §6），未声明时用契约默认值，**不得写死在用例里**。
- **账号**：每条用例用全新唯一邮箱账号，经 auth 的公开接口注册/登录取得会话 Cookie。
- **工作区**：经 workspaces-and-permissions 的公开接口创建工作区并把自己加为成员；另注册一个账号作"非成员/非管理员"对照（不共享状态）。
- **钩子**：邮件 `GET /api/__test__/outbox?to=<email>`；时钟 `POST /api/__test__/clock {"advanceSeconds":N}`；限流计数 `DELETE /api/__test__/rate-limits`（本模块不测速率，只在清场时用）。
- **数据库只读**：仅用于契约要求的两处——"存储里不得有明文"（R-4）与"过期记录已删除"（E-4）；其余断言只看 HTTP 响应（HOST.md §4）。
- **id 来源**：事件 id、分组 id、规则 id 一律从写入接口的响应取，不要自己造。

## 1. 用例表

"否定期望"= 是表示该用例含拒绝/越权/超限/隔离类断言。

| id | 规则 | given | action | expected | 否定期望 |
|---|---|---|---|---|---|
| OBS-01 | A-1 | 未登录（不带 Cookie） | POST `logs.ingest`，1 条合法事件 | 401，`error.code=unauthenticated`，响应只有错误信封；随后 `logs.query` 查不到该事件 | 是 |
| OBS-02 | A-2 | 账号 B（非工作区 A 成员）；另取一个随机 workspaceId | GET `logs.query` 分别指定 A 与随机 id | 两次都 404，`error.code=not_found`，且两个响应体逐字节相同 | 是 |
| OBS-03 | A-3, I-1 | 工作区 A、B 各有成员，A 有 1 条错误事件 | B 成员 GET `errors.get`（A 的事件 id）；再 GET `errors.query`（B） | 都 404 且与随机 id 响应逐字节相同；B 的结果不含 A 的 id 或 message | 是 |
| OBS-04 | A-4 | A 有管理员账号与普通成员账号（用 workspaces-and-permissions 建的） | 普通成员 POST `alerts.rule.create`；管理员 POST 同一条 | 普通成员 403 `forbidden`；管理员 201 并返回 rule（宿主角色模型无普通成员时跳过前半段，记宿主未声明） | 是 |
| OBS-05 | A-5 | 账号被禁用或未验证（宿主若映射了账号状态概念） | 用该账号会话 GET `logs.query` | 与未认证完全一致的 401 与响应体，不泄露账号状态差异（未映射则跳过） | 是 |
| OBS-06 | R-1, R-2 | 默认脱敏集按 `contract.md` §4 | POST `logs.ingest`：字段名 `password`/`authorization`/`cookie`/`token`，值含 `sk-…`、`eyJ….e30.sig`、`AKIA…`、私钥块、`Bearer …`、`password=hunter2` | 读回时这些值全是 `[REDACTED]`；明文不出现在任何响应与数据库只读结果里 | 是 |
| OBS-07 | R-3 | 同 OBS-06 的秘密 | 把秘密分别放进嵌套对象、数组元素、headers 映射、cookies 串、URL 查询串 | 全部被抹除；同条事件里相邻的非敏感字段逐字节保持原值 | 是 |
| OBS-08 | R-4, R-5 | 事件含 1 处明文秘密 | ingest 后读回 + 数据库只读查该行 | 库里与 API 返回都是 `[REDACTED]`；字段仍在、类型不变；其余字段与提交一致 | 是 |
| OBS-09 | R-6 | 同 OBS-06 的事件 | 看 POST `logs.ingest` 的响应体 | 响应体不含提交的原文，只含 `accepted`/`ids`/`rejected`；`rejected[].message` 也不含原值 | 是 |
| OBS-10 | R-7 | `message` 含 `\n2026-01-01T00:00:00Z ERROR forged` | ingest 后读回 | `message` 内无 CR/LF；伪造行未成为第二条事件；查询结果只多 1 条 | 是 |
| OBS-11 | L-1, I-3 | 工作区成员 | 一批含 `level=trace`（非法）与 1 条合法的日志 | 202；`rejected[0].code=invalid_level` 且 `index=0`；只入库 1 条；再发同类非法批次，码仍是 `invalid_level` | 是 |
| OBS-12 | L-2 | `params.clockSkewSeconds`；`config.serverTime` | ingest 一条 `timestamp=serverTime+2h`，一条不带 timestamp | 前者 `rejected[].code=timestamp_out_of_window`；后者入库且 `timestamp` 与 `config.serverTime` 相差 ≤ 60s | 是 |
| OBS-13 | L-3, I-2 | 已写入 5 条不同 level/时间的日志 | `logs.query`：`limit=2` 逐页取完；再按 level+时间+q 过滤；再 `limit=params.maxPageSize+1` | 遍历得全部 5 条、无重复无遗漏、按时间倒序；过滤只回匹配项；超限请求 400 `limit_exceeded` | 是 |
| OBS-14 | L-4 | 客户端固定 `eventId` | 同一 `eventId` 连发 2 次 ingest | 两次都 202 且 `ids[0]` 相同；`logs.query` 中该 `eventId` 只有 1 条 | 是 |
| OBS-15 | L-4 | 同一 `eventId` | 并发 20 次 ingest | 最终只入库 1 条，20 个响应的 `ids[0]` 全相同 | 是 |
| OBS-16 | L-5 | 请求带 `X-Request-Id: attacker-1` | ingest 一条事件 | 事件 `requestId` ≠ `attacker-1`；响应里的 request id 为服务端生成 | 是 |
| OBS-17 | E-1 | 工作区成员 | 同一错误（`type`+`stack`+`route` 相同、`message` 不同）capture 2 次 | 两次 202；`groupId` 相同；`errors.query` 里该分组 `count=2`，`sampleEventId` 可 `errors.get` 到详情 | 否 |
| OBS-18 | R-1 | 错误的 `message` 与 `stack` 含 `sk-` 形态密钥 | capture 后 `errors.get` | `message`/`stack` 里密钥为 `[REDACTED]`，其余内容保留 | 是 |
| OBS-19 | F-1, E-3 | `params.maxStackFrames`、`maxMessageLength`、`maxPageSize` | capture 一条 stack 帧数超限的错误；`errors.query` 与 `logs.query` 都用 `limit=maxPageSize+1` | 前者 202 且 `rejected[].code=field_too_long`；两次查询都 400 `limit_exceeded`（同一上限） | 是 |
| OBS-20 | E-2, C-1, C-2 | 工作区成员 | GET `config` | 含各项上限、`retention`、`redaction.mask`/`fieldNames`/`valuePatterns`、`sampling.errorSampleRate`、`serverTime`；`errorSampleRate=1`（除非 params 声明别的）；响应内无任何密钥形态字符串 | 否 |
| OBS-21 | E-4 | `params.logRetentionSeconds`、`errorRetentionSeconds` | 写入 1 条日志与 1 条错误；POST `/api/__test__/clock {"advanceSeconds":保留期+60}` | 两类记录在 `logs.query`/`errors.query` 都查不到；数据库只读也查不到这两行 | 是 |
| OBS-22 | M-1, F-1 | 工作区成员 | `metrics.record` 4 点：非法 `name`、非法 label 键、counter 负值、histogram 负值 | 202；`rejected[].code` 依次为 `invalid_metric_name`、`invalid_label`、`invalid_value`、`invalid_value`；合法点被接受 | 是 |
| OBS-23 | M-2 | `params.maxSeriesPerMetric=N` | 写入 N 个不同 label 组合，再写第 N+1 个 | 第 N+1 点 `rejected[].code=metric_cardinality_limit`；`metrics.query` 返回的 series 数 ≤ N | 是 |
| OBS-24 | M-3, M-4 | `params.maxQueryRangeSeconds`、`maxResultSeries` | `metrics.query` 区间超上限；另造一个 series 数超 `maxResultSeries` 的指标再查 | 前者 400 `range_too_large`；后者 400 `result_limit_exceeded` | 是 |
| OBS-25 | M-3, M-5 | 工作区成员 | counter 写 2、4、6；gauge 写 5 | 聚合结果 `count=3`、`sum=12`、`avg=4`、`min=2`、`max=6`、`p50∈[2,6]`；gauge `count=1`、`avg=5` | 否 |
| OBS-26 | T-1, T-2, T-3 | 规则：`metric=orders_total`、`comparator=gt`、`threshold=100`、`targetEmail`=工作区成员邮箱；另有一个非成员邮箱 | 先用非成员邮箱建规则 → 400 `invalid_alert_target`；再用成员邮箱建规则 → 201；随后记录 metric 值 150 | outbox（`GET /api/__test__/outbox?to=成员邮箱`）出现 `template=observability.alert.fired`、`to`=成员邮箱、`data.link` 以 `APP_BASE_URL` 开头且不含令牌/凭据、`token` 缺省 | 是 |
| OBS-27 | T-4 | OBS-26 的规则与已触发的告警 | 冷却期内再记录一次 150 | outbox 里该 `template` 的消息仍只有 1 封；告警记录里的收件人是 `targetMemberId`/哈希，不是明文邮箱 | 是 |
| OBS-28 | X-1, X-2 | `params.maxBodyBytes`、`maxBatchSize` | 发一个超过 `maxBodyBytes` 的请求体；再发 `events` 条数 > `maxBatchSize` 的请求；随后 GET `/api/health` | 前者 413 `payload_too_large`；后者 400 `batch_too_large`；health 仍 200；全程无 5xx | 是 |
| OBS-29 | A-6 | `params.trustedProxyCidrs` | 3 个请求分别带 `X-Forwarded-For`：`203.0.113.7, 198.51.100.9` / `198.51.100.9` / `198.51.100.8` | 若 `trustedProxyCidrs` 含回环网段（127.0.0.1/32 或 ::1/128）：前两个请求的 `clientIpHash` 相同、第三个不同；若不含：三者 hash 全相同；hash 必须是 32 位小写十六进制，且不等于任何明文 IP | 是 |
| OBS-30 | A-7 | `params.allowedOrigins`（未声明则取 `APP_BASE_URL` 的 origin） | 写入请求分别带 `Origin: https://evil.example` 与 `Origin: <allowedOrigins[0]>`，再发一个不带 Origin 的 | 前者 403 `cross_origin_blocked` 且未入库；后两者 202 成功 | 是 |

## 2. 覆盖与统计

- 每条 MUST 规则至少一条用例，规则→用例的精确对照见 `contract.md` §8，本表不重复。
- 硬否定期望覆盖：跨租户隔离（02/03）、权限（04）、账号状态枚举（05）、重放与幂等（14）、并发竞态（15）、体积与批量上限（28）、基数上限（23）、分页与区间上限（13/19/24）、冷却去重（27）、保留期删除（21）、邮件中继（26）、XFF 投毒（29）、跨站写入（30）。
- 记为"宿主未声明"（跳过，不计失败也不计通过）的只有 OBS-04 的普通成员角色与 OBS-05 的账号状态概念。
