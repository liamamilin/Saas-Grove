# webhooks-outbound 验收计划（黑盒）

## 1. 前置与工具

- **依赖**：auth、workspaces-and-permissions 必须先按各自契约通过（HOST.md §5）。每个用例用**全新账号**（唯一邮箱），互不共享状态。
- **夹具**：账号与工作区只经公开接口创建——`auth.signup`、`auth.login`、`workspaces-and-permissions.workspace.create`、`workspaces-and-permissions.workspace.member.add`（概念名由 module-map 提供，验收不猜路径；缺失映射记"宿主未声明"）。
- **本地接收器**：脚本在 `127.0.0.1:<空闲端口>` 起 HTTP 服务，逐次记录收到的原始 body 字节、请求头、到达时间与请求次数，并能按用例配置返回 204/400/429/500/302 或挂起不响应。端点 URL 填 `http://127.0.0.1:<端口>/hook`（契约 R04 在 `TEST_MODE=1` 放行回环）。若宿主与脚本不在同一网络命名空间，改用 `params.receiverBaseUrl`。
- **时钟**：用 HOST.md 的 `POST /api/__test__/clock {advanceSeconds}` 推进所有时效。注意时钟是全局的，推进后不要依赖跨用例的时间顺序。
- **标识符**：端点 id 来自创建响应，投递 id 来自 event.emit 的响应或 delivery.list，事件 id 来自交付 body 或投递记录。
- **参数**：所有数值阈值从 module-map 的 `params` 读（`deliveryTimeoutSeconds`、`signatureToleranceSeconds`、`dualKeyWindowSeconds`、`retentionDays`、`maxAttempts`、`maxPayloadBytes`）；未声明时按 contract.md §2 的"未声明时"列取值。
- **数据库**：只用只读查询核对"密钥明文是否落库"（`DATABASE_URL`）。
- 本模块不发邮件，**不使用** outbox 约定。

## 2. 用例表

| id | given | action | expected | negative | 规则 |
|---|---|---|---|---|---|
| A01 | 全新账号 A + 工作区 W | POST endpoint.create，`url=https://example.com/hook`，`eventTypes=["invoice.paid"]` | 201；响应含 `id`/`url`/`status=enabled`/`eventTypes` 与一次性明文 `secret`；再建一个端点互不影响 | 否 | R01 |
| A02 | 同上 | 依次 POST 4 个目标：`file:///etc/passwd`、`https://user:pw@example.com/hook`、`http://93.184.216.34/hook`、`http://10.0.0.1/hook` | 分别 400 `invalid_url`、400 `invalid_url`、400 `insecure_scheme`、400 `blocked_target`；不产生任何投递 | 是 | R02,R03,R04 |
| A03 | 接收器已在 `127.0.0.1:P` 运行 | POST endpoint.create，`url=http://127.0.0.1:P/hook`，`eventTypes=["invoice.paid"]` | 201；再 emit 一条 `invoice.paid`，接收器确实收到该请求 | 是 | R04,R01 |
| A04 | 账号 A 有端点 E1；账号 B 有工作区 W2 | 先不带会话请求一次（401）；再由 B 依次 GET/PATCH/DELETE E1；最后读 B 的端点列表与投递列表 | 无会话 → 401 `unauthorized`；三次都是 404 `endpoint_not_found`；B 的两个列表都不含 A 的任何资源 | 是 | R05 |
| A05 | 宿主声明了"受限成员"概念 | 用无 webhook 管理权限的成员 PATCH 端点；同成员 GET 端点列表 | PATCH → 403 `permission_denied`；GET → 200（读权限更宽不算错） | 是 | R10 |
| A06 | 端点 E 订阅 `invoice.paid` 后被置为 `disabled` | POST event.emit，`type=invoice.paid`；若宿主声明了 `params.eventTypes`，再订阅一个清单外的类型 | emit → 200 且匹配端点数为 0，E 的投递数不增加；订阅清单外类型 → 400 `invalid_event_type` | 是 | R06,R15 |
| A07 | 端点 E 存在且已有历史投递 | DELETE E；再 GET E；再 emit 一条事件 | DELETE → 204；GET E → 404；历史投递仍在；E 不再收到新投递 | 是 | R07 |
| A08 | 端点 E 已创建，明文密钥为 S | GET E、GET 端点列表；再对数据库做只读查询搜 S | 两个读响应都不含 S；数据库里搜不到 S | 是 | R08 |
| A09 | 端点 E 的密钥为 S | POST rotate_secret 得 S2；用 S2 验签；用 S 验签；把时钟推进超过双活窗口 T（`params.dualKeyWindowSeconds`，未声明取 3600）后再用 S 验签 | S2 验签通过；窗口内 S 仍通过；窗口后 S 被拒；轮换响应只此一次给出 S2 | 是 | R09,R01 |
| A10 | 接收器已收到一次交付 | 脚本用 S 与收到的**原始 body 字节**自行算 HMAC-SHA256(`timestamp + "." + body`)，与 `X-Webhook-Signature` 的 hex 比对 | hex 完全一致；`X-Webhook-Id`/`X-Webhook-Timestamp`/`X-Webhook-Signature` 三个头齐全；body 是信封（含 `id`/`type`/`created_at`/`data`） | 否 | R11 |
| A11 | 已拿到一次交付的头与 body | 分别改 body 一个字节、改签名 hex、改时间戳，各调一次 signature.verify | 三次都是 400 `signature_mismatch` | 是 | R12 |
| A12 | 已知一次交付的时间戳 T 与容差（`params.signatureToleranceSeconds`，未声明取 300） | 用 `T-(容差+60)` 构造签名调 verify；再用 T 构造一次 | 过期那次是 400 `signature_expired`；用 T 的那次通过（200） | 是 | R13 |
| A13 | 已拿到一次交付 | 用别的密钥验签；再把签名头改成 `v9=<hex>` 调 verify | 错密钥那次 400 `signature_mismatch`；`v9` 那次 400 `unknown_signature_version`；响应里不含任何密钥内容 | 是 | R14 |
| A14 | 已登录但没有工作区上下文的账号 | POST event.emit | 400 `workspace_required`（不得返回 200） | 是 | R15 |
| A15 | 端点 E1 订阅 `invoice.paid`，E2 订阅 `other.type`；接收器延迟 2 秒才响应 | POST event.emit，`type=invoice.paid`；再 POST 一条超过 `params.maxPayloadBytes`（未声明则 256KB）的事件 | 正常那条 200、匹配端点数=1、E1 恰好收到 1 条、E2 收不到、emit 响应早于接收器响应；超大那条 413 `payload_too_large`，且 E1 没有新投递 | 否 | R15 |
| A16 | 端点 E 订阅 `invoice.paid` | 并发发两个带**相同** `Idempotency-Key` 的 emit | E 恰好 1 条投递；两次响应给出同一事件 id 与同一投递 id | 是 | R16,R29 |
| A17 | 接收器恒返回 500 | emit 一条；读投递；时钟推进到 `nextAttemptAt-1`；再推进到 `nextAttemptAt` | 第 1 次尝试 `httpStatus=500`、`outcome=server_error`、`status=retrying`、`nextAttemptAt` 在未来；未到点尝试次数不增；到点后尝试次数 +1；两次尝试的 `X-Webhook-Id` 与 body 字节完全相同 | 是 | R17,R18,R19 |
| A18 | 接收器恒返回 500 | 反复推进时钟直到尝试次数不再增加 | 尝试次数 == `params.maxAttempts`（未声明则落在 [3,10]）；`status=failed`；`nextAttemptAt` 为空；继续推进时钟无新尝试 | 是 | R20 |
| A19 | 接收器返回 204 | emit 一条；读投递；再推进时钟很久 | `status=succeeded`、`attemptCount=1`；推进时钟后仍无新尝试 | 否 | R21 |
| A20 | 接收器返回 400 | emit 一条；推进时钟很久 | `attemptCount=1`（不重试）、`status=failed` | 是 | R22 |
| A21 | 接收器返回 429 | emit 一条；推进时钟到 `nextAttemptAt` 之后 | 尝试次数增加；该次尝试 `outcome=rate_limited` | 是 | R23 |
| A22 | 接收器返回 302，`Location: http://169.254.169.254/x` | emit 一条 | 接收器只收到 1 个请求（未跟随跳转）；该次尝试 `httpStatus=302`、`outcome=redirect_rejected`；平台未向 `169.254.169.254` 发起连接 | 是 | R24 |
| A23 | 接收器挂起不响应（挂起时长 > `params.deliveryTimeoutSeconds`，未声明则 > 10 秒） | emit 一条 | 该次尝试 `outcome=timeout`；投递进入重试流程 | 是 | R25 |
| A24 | 有一条已 `failed` 的投递 D（含 body 字节） | POST delivery.replay D | 返回**新的**投递 id；接收器收到的 body 字节与 D 的 body 完全相同；新的签名时间戳是当下；D 的 `attemptCount` 与 `status` 不变 | 是 | R26,R18 |
| A25 | 账号 A 有投递 D | 账号 B 重放 D；再用不存在的 id 重放 | 两次都 404 `delivery_not_found`；B 的投递日志里不出现 D | 是 | R27,R05 |
| A26 | 有投递 D，其目标曾返回 5000 字节响应体 | 读 D 的 `attempts[].responseExcerpt`；再把时钟推进超过 `params.retentionDays`（未声明取 30 天） | 片段长度 ≤1024 字节且不是完整响应；到期后 GET D → 404 | 是 | R28 |
| A27 | 有投递 D | 并发发起两次 delivery.replay D | 产生 2 条独立的新投递（id 不同）、body 相同；D 自身未变；没有丢失或合并 | 是 | R29,R26 |
| A28 | 端点 E 存在 | 带 `X-Forwarded-For: 203.0.113.7, 198.51.100.9` 更新 E，再读 E 的 `lastRequestIp` | `lastRequestIp` 不是 203.0.113.7（最左值）；若 `params.trustedProxyCidrs` 已声明，则等于最右侧的非受信跳 | 是 | R30 |
| A29 | 账号处于停用（或未验证）状态；该账号有端点 E | 在此状态下分别请求 E（存在）与一个不存在的 id | 两次返回的状态码与 `error.code` **完全相同**，且都不是 2xx；不因目标是否存在而不同 | 是 | R31 |

> A05、A29 依赖宿主声明"受限成员"与"账号状态"的概念；未声明则记"宿主未声明"，不判失败也不判通过。

## 3. 攻击面覆盖

- **越权与枚举**：A04（跨工作区读改删）、A05（无权限成员）、A25（跨工作区重放）、A29（账号停用/未验证下状态一致）。
- **出站 SSRF 与跳转**：A02（协议/凭据/http/私网目标）、A03（回环放行的边界）、A22（不跟随 3xx，不打内网）。
- **签名伪造**：A10（独立复算）、A11（篡改 body/签名/时间戳）、A12（过期）、A13（错密钥、未知版本）。
- **密钥泄露**：A08（读接口与数据库都无明文）、A09（轮换后旧密钥按窗口失效）。
- **重放、幂等与竞态**：A16（同键并发只投一次）、A17（重试时 id 与 body 不变）、A24（重放不改原投递）、A27（并发重放各自独立）。
- **失败与放大**：A17~A23（退避、上限、2xx 停、4xx 不重试、429 重试、3xx 不跟随、超时）。
- **数据留存与资源**：A26（响应截断、到期清理）、A15（不阻塞业务请求）。
