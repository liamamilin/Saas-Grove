# observability 模块契约（黑盒）

只描述**外部可观察**的行为；启动、路径映射、测试钩子、依赖顺序见 HOST.md（不重复）。路径是**概念名**，宿主在 `module-map.json` 映射（HOST §2）；数值见 §6，未声明则用默认值（HOST §2b）。**mask** 恒为 `[REDACTED]`。

## 1. 概念与数据结构

概念名省略前缀 `observability.`；每个概念都带 `workspaceId`（可放路径或查询参数）：缺失或格式非法 → 400 `invalid_request`，格式合法但不存在/非成员 → 404（A-2）；未映射的概念按 HOST §2 记为未声明。

| 概念 | 请求 | 响应 |
|---|---|---|
| `logs.ingest` | POST body `events[]`：`level`、`message` | `{accepted, ids[], rejected[]}` |
| `logs.query` | GET query：`level`/`from`/`to`/`q`/`limit`/`cursor`（L-3） | `{items[], nextCursor}` |
| `errors.capture` | POST body：`type`、`message` | `{id, groupId}` |
| `errors.query` | GET query：`level`/`type`/`groupId`/`from`/`to`/`q`/`limit`/`cursor`（E-3） | `{items[], nextCursor}` |
| `errors.get` | GET query `id` | errorEvent |
| `metrics.record` | POST body `points[]`：`name`、`type`、`value` | `{accepted, rejected[]}` |
| `metrics.query` | GET query：`metric`、`from`、`to`、`groupBy`、`agg`（M-3） | `{metric, type, series[]}` |
| `alerts.rule.create` | POST body：`metric`、`comparator`、`threshold`、`targetEmail`、`windowSeconds`、`cooldownSeconds` | rule |
| `config` | GET — | §6 参数 |

写入类事件可另带可选字段 `fields`/`tags`/`route`/`timestamp`/`eventId`/`stack`/`labels`/`requestId`（见 §3）；`from`/`to` 为 ISO-8601。写入类回 202，`alerts.rule.create` 回 201，其余 200。

**logEvent** `{id, workspaceId, timestamp, level, message, fields, requestId, clientIpHash, eventId?}`（`id` 服务端主键、`eventId` 客户端幂等键，不得混用）；**errorEvent** `{id, groupId, timestamp, level, type, message, stack?, requestId}`；**errors.query 的 item**（分组摘要）`{groupId, type, message, level, count, sampleEventId}`；**series** `{labels, count, sum, avg, min, max, quantiles}`；**rule** `{id, metric, comparator, threshold, windowSeconds, targetMemberId, recipientEmailHash}`。

## 2. 响应约定

**错误信封**（所有非 2xx）：`{"error":{"code":"<machine_code>","message":"<短句>","requestId":"<服务端 id>","details":{…}}}`。`code` 稳定且唯一（I-3）；`message` 不含秘密、堆栈、路径、他租户标识；`details` 不得含原值（R-6）。

| 情形 | 码 | `error.code` |
|---|---|---|
| 读成功 / 创建规则 / 接受写入（含拒绝） | 200 / 201 / 202 | — |
| 未认证 | 401 | `unauthenticated` |
| 权限不足 / 跨源写入 | 403 | `forbidden` / `cross_origin_blocked` |
| 工作区/对象不存在、非成员、跨租户 id | 404 | `not_found` |
| 方法不支持 | 405 | `method_not_allowed` |
| 重复告警规则（同 metric+comparator+threshold+target） | 409 | `duplicate_rule` |
| 请求体超字节上限 | 413 | `payload_too_large` |
| 非 JSON 内容类型 | 415 | `unsupported_media_type` |
| 请求级参数错误 | 400 | `invalid_request` / `limit_exceeded` / `range_too_large` / `batch_too_large` / `invalid_alert_target` |

**优先级**（一个请求只回一个码）：401→403→404→415→413→400→202/201/200；500/503 不属本契约（违反 X-2）。

**条目级拒绝**：整批合法、个别条目非法时仍回 202，非法项进 `rejected[]`：`{index, code, message}`，`index` 为请求数组下标；`code` 取值见 §3（另允许 `invalid_field_type`）。

## 3. MUST 规则

下文 `max*` 等短名一律指 §6 的 `observability.*` 参数。

### 3.1 访问与隔离（全部 9 个概念）
- **A-1 认证**：未认证 → 401 `unauthenticated`，只回错误信封，且不产生任何写入。
- **A-2 成员**：非成员访问目标工作区 → 404 `not_found`，响应与"工作区不存在"逐字节相同。
- **A-3 跨租户**：按 id 取他租户对象 → 404 `not_found`，与随机 id 响应逐字节相同；查询只返回本工作区数据。
- **A-4 权限**：写接口需成员；`alerts.rule.create` 另需 `adminRoles` 内角色（默认 owner/admin），不足 → 403 `forbidden`。
- **A-5 账号状态**：禁用/未验证账号的会话表现与未认证完全一致（401、同一响应体）。
- **A-6 客户端 IP**：见 §5。
- **A-7 跨源写入**：写入类概念（三个写入概念 + `alerts.rule.create`）在带 `Origin` 且不匹配允许 origin 时 → 403 `cross_origin_blocked` 且不写入；不带 `Origin`（服务端调用）不得被拒。

### 3.2 脱敏与写入通用（三个写入概念）
- **R-1 值形态**：§4 值形态名单内的值一律替换为 mask（错误事件的 `message`/`stack` 同此处理）。
- **R-2 字段名**：§4 字段名名单内的字段（不区分大小写）整体替换为 mask；嵌套同判。
- **R-3 范围**：`message`、`fields`/`tags` 字符串值、嵌套对象与数组元素、`headers` 键值、`cookies` 串、URL（含查询串）、`stack`。
- **R-4 时机**：脱敏在写入前；明文不得出现在任何写/读响应与存储记录（库只读可验，HOST §4）。
- **R-5 保真**：mask 恒为 `[REDACTED]`，字段仍在、类型不变，其它字段逐字节保持。
- **R-6 不回显**：写接口响应只含机器信息（`accepted`/`ids`/`rejected`/`id`/`groupId`）；错误 `message`/`details` 不得含提交原值。
- **R-7 防伪造**：`message`/`stack`/`fields` 的 CR/LF 与控制字符须转义或删除，不得形成第二条事件行。
- **F-1 字段上限**：字段数 > `maxFieldsPerEvent` → 拒绝 `too_many_fields`；字符串超长 → `field_too_long`（`message` 受 `maxMessageLength`、`stack` 受 `maxStackFrames`）。
- **X-1 体积**：请求体 > `maxBodyBytes` → 413 `payload_too_large`；`events`/`points` > `maxBatchSize` → 400 `batch_too_large`，整批不处理。
- **X-2 不产生 5xx**：畸形/恶意输入不得让宿主返回 5xx；此后 `GET /api/health` 仍 200；期间若回过 5xx，该错误须能在 `errors.query` 查到。

### 3.3 日志（`logs.ingest`/`logs.query`）
- **L-1 必填与枚举**：须有非空 `message` 与 `level ∈ {debug,info,warn,error,fatal}`；非法 `level` → 拒绝 `invalid_level`，不落库。
- **L-2 时间戳**：不传则服务端生成（ISO-8601 UTC）；传了须在 `clockSkewSeconds` 窗口内，否则 `timestamp_out_of_window`；不可解析 → `invalid_timestamp`。
- **L-3 分页排序与过滤**：`limit` 默认 50、上限 `maxPageSize`，超限 → 400 `limit_exceeded`；按 `timestamp` 倒序、同刻按 `id` 倒序；`nextCursor` 不透明、翻页传 `cursor`，结果不重不漏；`level`/`from`/`to`/`q`（`message` 子串）可组合过滤，只含匹配项。
- **L-4 幂等**：同 `eventId` 在 `eventDedupeWindowSeconds` 内重复提交只落库一条、两次响应同一 `id`；并发重复同样只一条。
- **L-5 请求 id**：客户端 `X-Request-Id` 不得被采用，事件 `requestId` 须服务端生成。

### 3.4 错误（`errors.capture`/`errors.query`/`errors.get`）
- **E-1 捕获与分组**：合法上报 → 202 `{id, groupId}`；`groupId` 由 `type` + 归一化 `stack` 帧 + `route` 决定（与 `message` 无关）；同一错误重复上报进同一组、`count` 累加。
- **E-2 采样**：验收时错误采样率须为 1.0（宿主声明 `errorSampleRate` 则按声明值）并由 config 暴露；被丢弃部分不得让上报报错。
- **E-3 查询**：`errors.query` 的 `limit` 上限与错误码同 L-3；`errors.get` 取不到（不存在、跨租户）→ 404 `not_found`，与"工作区不存在"逐字节相同。
- **E-4 保留期**：超过 `errorRetentionSeconds`（日志 `logRetentionSeconds`）的事件查不到且存储已无；时钟推进生效（HOST §3）。

### 3.5 指标（`metrics.record`/`metrics.query`）
- **M-1 字段校验**：`name` 匹配 `^[A-Za-z][A-Za-z0-9_.:-]{0,127}$`（否则 `invalid_metric_name`）；`type ∈ {counter,gauge,histogram}`（否则 `invalid_metric_type`）；`labels` 键须为标识符（字母/下划线开头、只含字母数字下划线、≤64 字符）、键数 ≤ `maxLabelKeys`、值长 ≤ `maxLabelValueLength`（否则 `invalid_label`）。
- **M-2 基数**：同一 metric 的 series 数 ≤ `maxSeriesPerMetric`；越限新序列 → 拒绝 `metric_cardinality_limit`；不得静默丢弃或超限续写。
- **M-3 聚合与区间**：`count`/`sum`/`avg`/`min`/`max` 与 `quantiles` 须与写入原始点一致；`to-from` > `maxQueryRangeSeconds` → 400 `range_too_large`。
- **M-4 结果规模**：命中 series 数 > `maxResultSeries` → 400 `result_limit_exceeded`。
- **M-5 取值域**：`counter`/`histogram` 值 ≥ 0，`gauge` 任意有限数，否则 `invalid_value`；非有限值同样 `invalid_value`。

### 3.6 告警（`alerts.rule.create`）
- **T-1 创建**：合法规则 → 201 返回 §1 的 rule；`comparator ∈ {gt,gte,lt,lte}`、`threshold` 有限、`metric` 须存在（否则 `invalid_request`）；同 metric+comparator+threshold+target 重复 → 409 `duplicate_rule`。
- **T-2 收件目标**：`targetEmail` 须解析到工作区成员，否则 400 `invalid_alert_target`。
- **T-3 触发与投递**：metric 点满足规则（比较符+阈值，在 `windowSeconds` 窗口内）时，产生**恰好一条**告警并向 outbox 投递一封邮件：`template` 恒为 `observability.alert.fired`、`to` 为成员邮箱，`data.link` 以 `APP_BASE_URL` 开头且无凭据，`token` 缺省。
- **T-4 冷却与存储**：同一规则在 `alertCooldownSeconds` 内重复越线，不再产生告警事件与第二封邮件；规则与告警记录不得存明文邮箱，只存 `targetMemberId` 与 `recipientEmailHash`。

### 3.7 配置（`config`）
- **C-1 内容**：返回 §6 全部生效参数 + `redaction.mask`/`fieldNames`/`valuePatterns` + `sampling.errorSampleRate` + `serverTime`；缺项即违反。
- **C-2 无密钥**：响应不得含口令、令牌、连接串或环境变量密钥值，模式只给名字。

### 3.8 不变量（全部概念）
- **I-1 归属不变**：一条 event/metric 恰好属于一个工作区，写入后不可改。
- **I-2 结果唯一**：同一事件 id 在任何一次查询结果中至多出现一次。
- **I-3 码稳定唯一**：同一情形的 `error.code` 恒定；不同情形不共用码。

## 4. 默认脱敏集与必须哈希的数据

**默认脱敏集**（宿主可追加，不得少于）：

| 类 | 名单 |
|---|---|
| 值形态（R-1） | JWT（`eyJ` 开头、≥2 段点分）、`sk-`+≥16 字符、`AKIA`+16 位大写字母数字、私钥块（`-----BEGIN … PRIVATE KEY-----`）、`Bearer `+任意 token、`password=`/`pwd=`/`passwd=`/`token=`/`secret=`/`api_key=`/`apiKey=`/`access_token=`/`refresh_token=` 赋值形式 |
| 字段名（R-2） | `password`、`passwd`、`pwd`、`secret`、`token`、`access_token`、`refresh_token`、`api_key`、`apikey`、`authorization`、`proxy-authorization`、`cookie`、`set-cookie`、`session`、`client_secret`、`private_key`、`credit_card`、`card_number`、`cvv`（不区分大小写） |

**必须哈希存储**（用带密钥的 HMAC；裸哈希对低熵输入可被枚举还原）：

- 客户端 IP → `clientIpHash` = HMAC-SHA256(密钥, ip) 截断 32 位小写十六进制，同 IP 同值；不得存明文 IP。
- 告警收件人 → `targetMemberId` + `recipientEmailHash`（同算法同长度）；不得存明文邮箱（outbox 邮件按 HOST 约定带收件地址）。
- 口令/令牌/session → 不入库，按 R-2 掩码。

## 5. 客户端 IP 解析
- `trustedProxyCidrs` 为空，或直连对端不属于受信网段 → 客户端 IP = 直连对端地址，**完全忽略** `X-Forwarded-For` 与 `X-Real-IP`。
- 列表非空且直连对端属于受信网段 → 取 `X-Forwarded-For` 中**从右起第一个不属于受信网段**的条目；头缺失 → 直连对端地址。
- 只存 `clientIpHash`（§4）：有效 IP 相同 → hash 相同；有效 IP 不同 → hash 不同。

## 6. 参数（宿主在 `module-map.json` 的 `params` 声明，未声明则用默认值）

参数名省略前缀 `observability.`（`maxBatchSize` 即 `observability.maxBatchSize`），格式"下限–上限（默认）"。

`maxBatchSize` 1–1000（100）、`maxBodyBytes` 1024–1048576（262144）、`maxMessageLength` 64–8192（2048）、`maxStackFrames` 1–200（50）、`maxFieldsPerEvent` 1–200（50）、`maxLabelKeys` 1–32（8）、`maxLabelValueLength` 8–256（64）、`maxSeriesPerMetric` 8–1024（64）、`maxPageSize` 10–1000（100）、`maxQueryRangeSeconds` 60–2592000（604800）、`maxResultSeries` 10–1000（200）、`logRetentionSeconds` 60–31536000（604800）、`errorRetentionSeconds` 60–31536000（2592000）、`eventDedupeWindowSeconds` 60–604800（86400）、`clockSkewSeconds` 0–3600（300）、`alertCooldownSeconds` 0–86400（300）、`errorSampleRate` 0–1（1）、`trustedProxyCidrs` 列表（`[]`）、`adminRoles` 列表（`["owner","admin"]`）、`allowedOrigins` 列表（默认：APP_BASE_URL 的 origin）。

## 7. 建议，验收不测
以下不是 MUST，黑盒下无法稳定判定：写入路径 fail-open；写入延迟与吞吐；trace/span 采样、session 回放、source map 上传；检索后端选型；PII 分类脱敏；看板与状态页；多通道告警；跨区域双写；数据库 schema 与索引方案。

## 8. 规则 → 验收用例追溯

| 规则 | 用例 | 规则 | 用例 | 规则 | 用例 |
|---|---|---|---|---|---|
| A-1 | OBS-01 | L-1, I-3 | OBS-11 | M-3, M-5 | OBS-25 |
| A-2 | OBS-02 | L-2 | OBS-12 | M-4 | OBS-24 |
| A-3, I-1 | OBS-03 | L-3, I-2 | OBS-13 | T-1, T-2, T-3 | OBS-26 |
| A-4 | OBS-04 | L-4 | OBS-14, OBS-15 | T-4 | OBS-27 |
| A-5 | OBS-05 | L-5 | OBS-16 | C-1, C-2 | OBS-20 |
| A-6 | OBS-29 | A-7 | OBS-30 | F-1 | OBS-19, OBS-22 |
| R-1 | OBS-06, OBS-18 | E-2 | OBS-20 | X-1, X-2 | OBS-28 |
| R-2 | OBS-06 | E-3 | OBS-19 | M-1 | OBS-22 |
| R-3 | OBS-07 | E-4 | OBS-21 | M-2 | OBS-23 |
| R-4, R-5 | OBS-08 | | | | |
| R-6 | OBS-09 | | | | |
| R-7 | OBS-10 | E-1 | OBS-17 | | |
