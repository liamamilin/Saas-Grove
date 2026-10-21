# webhooks-outbound 契约（黑盒）

## 0. 怎么读

- 启动、操作宿主、路径映射、测试钩子一律见 `HOST.md`，本文不重复。
- 本文里的**概念名**形如 `webhooks-outbound.<name>`；宿主在根目录 `module-map.json` 里把它们映射到自己的真实 method+path（HOST.md §2）。下面的路径只是建议名，验收只认映射。
- 数值（次数、超时、TTL）由宿主在 `params` 声明实际值，契约只给**界限**；没声明就按 §2 的"未声明时"列判定（HOST.md §2b）。
- 每条 MUST 至少一个用例，§8 是规则→用例追溯表。
- 只写从外部（HTTP、Cookie、outbox、只读数据库查询）能看到的 MUST；看不到的进 §7。

## 1. 概念与建议路径

| 概念 | 建议 method + path | 作用 |
|---|---|---|
| `webhooks-outbound.endpoint.create` | POST `/api/webhooks/endpoints` | 注册端点，返回 id 与一次性明文密钥 |
| `webhooks-outbound.endpoint.list` | GET `/api/webhooks/endpoints` | 列出当前工作区的端点 |
| `webhooks-outbound.endpoint.get` | GET `/api/webhooks/endpoints/{endpointId}` | 端点详情 |
| `webhooks-outbound.endpoint.update` | PATCH `/api/webhooks/endpoints/{endpointId}` | 改订阅类型/启停/URL |
| `webhooks-outbound.endpoint.delete` | DELETE `/api/webhooks/endpoints/{endpointId}` | 删除端点 |
| `webhooks-outbound.endpoint.rotate_secret` | POST `/api/webhooks/endpoints/{endpointId}/rotate-secret` | 轮换签名密钥，返回新明文一次 |
| `webhooks-outbound.event.emit` | POST `/api/webhooks/events` | 发布一次领域事件（按订阅投递） |
| `webhooks-outbound.delivery.list` | GET `/api/webhooks/deliveries` | 投递日志列表（可按端点/状态/类型过滤） |
| `webhooks-outbound.delivery.get` | GET `/api/webhooks/deliveries/{deliveryId}` | 单次投递详情（含各次尝试） |
| `webhooks-outbound.delivery.replay` | POST `/api/webhooks/deliveries/{deliveryId}/replay` | 重放一次投递，返回新投递 id |
| `webhooks-outbound.signature.verify` | POST `/api/webhooks/verify-signature` | 签名自检：给一组头 + body，回是否通过 |

## 2. 参数（宿主在 `params` 声明）与界限

| params | 含义 | 契约界限 | 未声明时 |
|---|---|---|---|
| `maxAttempts` | 单次投递的最大尝试次数 | 3 ~ 10 | 断言尝试次数落在 [3,10] 且用尽后不再增加 |
| `retryBaseSeconds` | 首次重试间隔 | 5 ~ 600 | 不用固定值，按 `nextAttemptAt` 定位时间点 |
| `deliveryTimeoutSeconds` | 单次尝试超时 | 1 ~ 10 | 10（接收方挂起 11 秒） |
| `signatureToleranceSeconds` | 签名时间戳容差 | 60 ~ 900 | 300 |
| `dualKeyWindowSeconds` | 旧密钥双活窗口 | 0 ~ 86400 | 3600 |
| `retentionDays` | 投递记录保留天数 | 1 ~ 90 | 30 |
| `maxPayloadBytes` | 事件体大小上限 | 65536 ~ 1048576 | 262144 |
| `idempotencyWindowSeconds` | 幂等键窗口 | 3600 ~ 86400 | 86400 |
| `trustedProxyCidrs` | 受信代理网段数组 | — | 未声明时来源 IP 取 `X-Forwarded-For` 最右一跳 |
| `eventTypes` | 可订阅的事件类型清单 | — | 未声明时任意非空字符串可订阅 |
| `secretStorage` | 只读 DB 检查用：表名 + 密钥列名 | — | 未声明时全文只读搜索明文 |
| `receiverBaseUrl` | 接收器基址（与脚本不同网络命名空间时由宿主转发） | — | 未声明时脚本直连 `127.0.0.1` |

## 3. 状态码与错误体

- 错误体形状固定为 `{"error":{"code":"<机器可读码>","message":"<人类可读>"}}`；`code` 必须稳定可断言。
- 5xx 不得回显堆栈、密钥、请求头原文。

| 情况 | 状态码 | `error.code` |
|---|---|---|
| 创建端点成功 | 201 | — |
| 读取/更新/发布/重放/轮换/自检成功 | 200 | — |
| 删除端点成功 | 204 | — |
| 未认证 | 401 | `unauthorized` |
| 已认证但缺 webhook 管理权限 | 403 | `permission_denied` |
| 账号被停用或未验证 | 403 | `account_inactive`（若宿主的 auth 层更早拦截并返回 401，也可接受，但同一状态下对"存在的目标"与"不存在的目标"必须返回完全相同的状态码与 `code`） |
| scheme/凭据/主机不合法 | 400 | `invalid_url` |
| 非回环目标使用 http | 400 | `insecure_scheme` |
| 私网/链路本地/运营商级 NAT 目标 | 400 | `blocked_target` |
| 事件类型不在声明的清单内 | 400 | `invalid_event_type` |
| 缺少租户上下文 | 400 | `workspace_required` |
| 字段缺失或类型不对 | 400 | `invalid_request` |
| 签名自检不通过 | 400 | `signature_mismatch` / `signature_expired` / `unknown_signature_version` |
| 事件体超过 `maxPayloadBytes` | 413 | `payload_too_large` |
| 端点不存在或不属于当前工作区 | 404 | `endpoint_not_found` |
| 投递不存在或不属于当前工作区 | 404 | `delivery_not_found` |
| 内部错误 | 500 | `internal_error` |

## 4. 资源形态

### 4.1 endpoint

```json
{ "id": "ep_...", "url": "https://...", "status": "enabled|disabled",
  "eventTypes": ["invoice.paid"], "description": "...",
  "createdAt": "...", "updatedAt": "...", "lastRequestIp": "203.0.113.9" }
```

- `status` 只有 `enabled` / `disabled`。
- 任何读响应都**不得**出现明文密钥（可给 `secretHint` 末 4 位）。

### 4.2 delivery / attempt

```json
{ "id": "whd_...", "endpointId": "ep_...", "eventType": "invoice.paid", "eventId": "evt_...",
  "status": "pending|retrying|succeeded|failed", "attemptCount": 2, "nextAttemptAt": "...",
  "createdAt": "...", "completedAt": "...",
  "attempts": [ { "attempt": 1, "startedAt": "...", "durationMs": 812, "httpStatus": 500,
    "outcome": "server_error", "responseExcerpt": "upstream error" } ] }
```

- `outcome` 取值：`delivered`、`client_error`、`server_error`、`rate_limited`、`timeout`、`connection_error`、`redirect_rejected`、`tls_error`。
- `status` 只有 `pending`（有未完成尝试或等待首次尝试）、`retrying`（失败并等待下一次）、`succeeded`、`failed`（终态）四个取值；终态时 `nextAttemptAt` 为空。

### 4.3 平台发给客户服务器的请求

- 方法 POST，路径取端点 URL 的 path + query；`Content-Type: application/json`。
- 必带头：`X-Webhook-Id`（投递 id）、`X-Webhook-Timestamp`（Unix 秒）、`X-Webhook-Signature`（形如 `v1=<hex>`，可并列多个版本）。
- body 是 JSON 信封，字段固定：`{"id":"evt_...","type":"invoice.paid","created_at":"2026-01-01T00:00:00Z","data":{}}`。
- **签名规范**：签名串 = `<X-Webhook-Timestamp 的十进制秒>.<实际发出的 body 原始字节>`，算法 HMAC-SHA256，密钥取端点签名密钥的 UTF-8 字节，输出小写 hex，头里写 `v1=<hex>`。被签的是**整个 body（含信封）**，不是里面的 `data`。

## 5. MUST 规则

### 5.1 端点与租户

- **R01** 创建端点成功返回 201，响应含 `id`、`url`、`status`、`eventTypes`、`createdAt`，并含**仅此一次**的明文 `secret`；同一工作区可创建多个端点，互不影响。
- **R02** 目标 URL 的 scheme 非 http/https、含 `user:pass@` 凭据、或缺主机 → 400 `invalid_url`。
- **R03** 目标为 `http://` 且主机不是回环地址 → 400 `insecure_scheme`。
- **R04** 目标主机是私网段（10/8、172.16/12、192.168/16）、链路本地（169.254/16）或运营商级 NAT 的字面量地址 → 400 `blocked_target`；在 `TEST_MODE=1` 下回环目标（127/8、::1）必须被接受，但上述其余私网地址仍必须被拒绝。
- **R05** 读取/修改/删除其他工作区的端点或投递 → 404（`endpoint_not_found` / `delivery_not_found`）；列表与日志不得出现他人资源；对"存在但无权限"与"不存在"必须返回相同的状态码与 `code`。
- **R06** 更新订阅类型或把端点置为 `disabled` → 200 且读回一致；处于 `disabled` 的端点不接收任何新投递；声明了 `params.eventTypes` 时，订阅清单外类型 → 400 `invalid_event_type`。
- **R07** 删除端点 → 204；之后读该端点 → 404；其历史投递记录保留；之后发布事件不再向它投递。
- **R08** 明文密钥只在创建与轮换的响应里出现一次；任何读接口、列表、日志都不得出现明文；持久化存储中不得出现明文密钥（可用只读数据库查询核对）。
- **R09** 轮换后新密钥立即可用于签名与验签；旧密钥在 `dualKeyWindowSeconds` 内仍能验签通过，窗口过后一律拒绝；旧密钥必须靠"两份并存"实现，不得靠"保留摘要再重算"（摘要不可逆，重算必失败）。
- **R10** 缺少 webhook 管理权限的成员做写操作（创建/更新/删除/轮换/重放）→ 403 `permission_denied`；读操作按宿主的读权限模型，放宽不报错。

### 5.2 签名

- **R11** 每次交付必带 `X-Webhook-Id`、`X-Webhook-Timestamp`、`X-Webhook-Signature`；签名串、算法、编码严格按 §4.3；客户端可用这三个头 + 收到的原始 body 独立算出相同 hex。
- **R12** body 字节、签名值、时间戳三者任一被改动 → 校验失败（400 `signature_mismatch`）。
- **R13** 时间戳与服务器时间之差超过 `signatureToleranceSeconds` → 校验失败（400 `signature_expired`）；差值在容差内 → 通过。
- **R14** 用不匹配的密钥 → 400 `signature_mismatch`；签名头里没有已知版本 → 400 `unknown_signature_version`；都不得泄露密钥信息。

### 5.3 事件与投递

- **R15** 发布事件成功返回 200，响应里给出**匹配到的端点数**与本次的事件 id、投递 id；每个"订阅了该类型且启用"的端点各产生恰好一条投递；未订阅或已停用的端点不产生投递；调用方没有租户上下文 → 400 `workspace_required`（不得静默成功）；事件体超过 `maxPayloadBytes` → 413 `payload_too_large`。
- **R16** 同一工作区、相同 `Idempotency-Key` 的发布在 `idempotencyWindowSeconds` 内只产生一次投递，重复请求返回首次的事件 id 与投递 id；并发同键也只产生一次投递。
- **R17** 同一次投递的多次尝试，`X-Webhook-Id` 保持不变。
- **R18** 同一事件的各次尝试、以及它的重放，body 字节完全相同（事件 id 相同）。
- **R19** 某次尝试失败后，投递状态为 `retrying` 且 `nextAttemptAt` 在未来；时钟未到 `nextAttemptAt` 之前不得再产生新尝试，时钟到达后必须产生新尝试；相邻两次重试的间隔单调不减。

### 5.4 结果分类

- **R20** 尝试次数达到 `maxAttempts` 后，投递状态为 `failed`、`nextAttemptAt` 为空；此后无论时钟推进多久都不再产生新尝试。
- **R21** 某次尝试收到 2xx → 该次尝试 `outcome=delivered`，投递状态为 `succeeded`；此后推进时钟不再产生新尝试。
- **R22** 某次尝试收到 4xx（408、429 除外）→ 该次尝试 `outcome=client_error`，投递立即为 `failed`，不重试。
- **R23** 某次尝试收到 429 → 该次尝试 `outcome=rate_limited`，并按重试策略在之后产生新的尝试。
- **R24** 某次尝试收到 3xx → 不跟随跳转；该次尝试记 `httpStatus` 为该 3xx 且 `outcome=redirect_rejected`；客户服务器只收到这一个请求。
- **R25** 某次尝试耗时超过 `deliveryTimeoutSeconds` → 该次尝试 `outcome=timeout`，并按重试策略处理。

### 5.5 重放、日志与并发

- **R26** 重放返回新的投递 id 与新的尝试链；body 字节与事件 id 与原投递相同；签名时间戳为当下（原投递的 `created_at` 不变）；原投递的状态与 `attemptCount` 不变；任何终态的投递都可重放。
- **R27** 重放不属于当前工作区的投递，或投递 id 不存在 → 404 `delivery_not_found`。
- **R28** 投递记录在 `retentionDays` 之后被删除（之后读该投递 → 404）；目标响应体最多保存 1024 字节片段，不得保存完整响应。
- **R29** 并发发布与并发重放不得造成重复投递或丢失投递；同一投递的并发重放各自产生独立的新投递，彼此不合并，原投递不被改动。
- **R30** 记录来源 IP 时（端点详情里的 `lastRequestIp`），取 `X-Forwarded-For` 中**从右往左第一个非受信代理**那一跳，绝不取最左；未声明 `trustedProxyCidrs` 时取最右一跳。
- **R31** 调用方账号被停用或未验证时，本模块接口必须返回**完全相同**的状态码与 `error.code`（无论目标资源是否存在），且不得返回 2xx。

## 6. 存储与数据最小化

| 数据 | 存储要求 | 黑盒怎么查 |
|---|---|---|
| 端点签名密钥 | 必须可逆（要用来算 HMAC）→ 必须**加密存储**，不得明文落库；也不得只存摘要（本模块是"存哈希"规则的唯一例外，理由是签名需要原文） | 只读数据库查 `secretStorage` 声明的表/列；未声明时全文搜索明文 |
| 事件正文 | 只存投递必需的最小内容，不写日志文件 | A17：两次收到的 body 字节一致 |
| 客户响应体 | 只存 ≤1024 字节片段，不存完整响应 | 读投递详情看片段长度（A26） |

## 7. 建议，验收不测

- 非 `TEST_MODE`（生产）下必须拒绝回环与全部私网目标：验收跑在 `TEST_MODE=1`，无法从外部观察该分支，宿主需自证。
- 每次尝试重新解析目标主机并按解析结果连接（防 DNS rebinding），解析结果落在私网段时按 `blocked_target` 拒绝。
- 遵循客户的 `Retry-After`（比本地退避大时取较大值）。
- 退避用"指数 + 抖动"，抖动让间隔不严格倍增，验收只断言单调不减。
- 密钥与请求头不进日志文件；错误日志不含完整 URL 的 query（客户常把令牌放 query 里）。

## 8. 规则 → 用例追溯表

| 规则 | 用例 |
|---|---|
| R01 | A01, A03, A09 |
| R02 | A02 |
| R03 | A02 |
| R04 | A02, A03 |
| R05 | A04, A25 |
| R06 | A06 |
| R07 | A07 |
| R08 | A08 |
| R09 | A09 |
| R10 | A05 |
| R11 | A10 |
| R12 | A11 |
| R13 | A12 |
| R14 | A13 |
| R15 | A06, A14, A15 |
| R16 | A16 |
| R17 | A17 |
| R18 | A17, A24 |
| R19 | A17 |
| R20 | A18 |
| R21 | A19 |
| R22 | A20 |
| R23 | A21 |
| R24 | A22 |
| R25 | A23 |
| R26 | A24, A27 |
| R27 | A25 |
| R28 | A26 |
| R29 | A16, A27 |
| R30 | A28 |
| R31 | A29 |
