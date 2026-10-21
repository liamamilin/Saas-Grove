# contract.md — llm-observability-and-evals 黑盒契约

## 0. 范围与前置

- 本契约描述"声称实现了 `llm-observability-and-evals` 的宿主"必须对外表现的行为；判定只用 HTTP 响应、Cookie、页面、outbox 与**数据库只读查询**（HOST.md §4）。
- 依赖 `auth` 与 `workspaces-and-permissions` 已通过。概念名即 `module-map.json` 的键，未映射记"宿主未声明"。数值由宿主在 `params` 声明（R-58），未声明时按本契约界限判定。本模块不发邮件。

## 1. 概念（宿主映射键）

概念名省略前缀 `llm-observability-and-evals.`（宿主映射时补全）。

概念与方法：`span.ingest`(POST 上报)、`span.list`(GET)、`span.get`(GET)、`trace.get`(GET)、`policy.get`(GET)、`policy.update`(PUT 改策略)、`eval.dataset.create`(POST 建集)、`eval.dataset.get`(GET)、`eval.dataset.update`(PUT 改判据)、`eval.dataset.delete`(DELETE 删集)、`eval.run.start`(POST 启动)、`eval.run.get`(GET)、`eval.run.list`(GET)、`eval.baseline.set`(PUT 设基线)、`eval.baseline.get`(GET)、`span.replay.prepare`(POST 申请令牌)、`span.replay.execute`(POST 消费并重放)、`cost.summary`(GET 汇总)。

## 2. 认证、租户与错误模型

### 2.1 状态码：一个情境一个码

| 情境 | 码 | `error.code` |
|---|---|---|
| 无会话/会话失效 | 401 | `unauthenticated` |
| 是成员但缺权限 | 403 | `forbidden` |
| 工作区未知/非成员；资源不存在/属于他租户 | 404 | `not_found` |
| JSON 非法、缺必填、参数类型错 | 400 | `bad_request` |
| 值非法（枚举、负数、非 UTC、格式错、超量） | 422 | `unprocessable` |
| 请求体超体积上限 | 413 | `payload_too_large` |
| 超速率限制 | 429 | `rate_limited` |
| 重放令牌已消费 | 409 | `replay_token_used` |
| 重放令牌过期 | 410 | `replay_token_expired` |
| 原记录无可用正文 | 409 | `replay_unavailable` |
| 宿主内部错误 | 500 | `internal_error` |

成功码：ingest 201 / 重复 200；dataset.create 201、update 200、delete 204；run.start 202；replay.prepare 201、execute 201；GET 200。

### 2.2 错误体

- 形状固定 `{"error":{"code":"<枚举>","message":"<文本>"}}`，`Content-Type: application/json`；`message` MUST NOT 含堆栈、SQL、内部路径或他人资源 id。
- "资源不存在"（未知 id 与他租户 id）时状态码、`error.code`、`error.message` MUST 完全一致，且 MUST NOT 回显请求里的 id。

## 3. MUST 规则

### A. 认证、租户、错误

- **R-01** 所有端点 MUST 要求有效会话；缺失或失效 → 401 `unauthenticated`。
- **R-02** 工作区未知或调用者非成员 → 404 `not_found`。
- **R-03** 是成员但缺权限 → 403 `forbidden`；三种权限（读 span / 改策略 / 管理评测集）的名称以 `workspaces-and-permissions` 契约为准。
- **R-04** 错误响应 MUST 用 2.2 的形状与枚举，不泄露内部结构；`error.code` MUST 取自：`unauthenticated` `forbidden` `not_found` `bad_request` `unprocessable` `payload_too_large` `rate_limited` `replay_token_used` `replay_token_expired` `replay_unavailable` `internal_error`。
- **R-05** 未知 id 与他租户 id 的响应 MUST 完全同形且不回显 id。

### B. 摄入（span.ingest）

- **R-06** 载荷 MUST 含 `spanId`、`traceId`、`model`、`inputTokens`、`outputTokens`、`startedAt`；缺任一或 JSON 非法 → 400 `bad_request`。
- **R-07** `spanId` 是幂等键：重复上报 MUST NOT 新增记录 → **200** 且 `duplicate:true`、`spanId` 不变；首次 → **201**；并发重复 MUST 只落一条。
- **R-08** 载荷或查询参数的值非法 → 422 `unprocessable`：token 非整数或 <0；`source`/`status`/`operation` 非枚举值（`source` ∈ app/eval/replay）；时间非 UTC RFC3339；`feature` 不符 `^[a-z0-9][a-z0-9._-]{0,63}$`；`groupBy` 非 `feature|model|day`；`from > to`。
- **R-09** `metadata` MUST ≤ 32 键、键 ≤ 64 字符、值 ≤ 1024 字符、序列化 ≤ 8 KiB；超限 → 422。
- **R-10** 可查询字段（`feature`、`model`、`errorCode`、metadata 键值）MUST NOT 含控制字符（含 CR/LF/NUL）；含则 422。
- **R-11** 请求体 > `maxBodyBytes`（params，上界 1 MiB）→ 413 `payload_too_large`，MUST NOT 落库。
- **R-12** 摄入 MUST 限速：超过 `ingestRateLimitPerMinute`（params，界限 60/分钟）→ 429 `rate_limited` 且带 `Retry-After`；限流键 MUST 含账号或工作区维度，不得全局共享。
- **R-13** 一次模型调用 MUST 恰好对应一条 span；重复上报 MUST 被幂等吞掉，MUST NOT 二次计费。
- **R-14** 缺 `feature` → 归入 `unattributed`（MUST NOT 丢弃）；`feature` 存在但字符集非法 → 422（两种情境）。
- **R-15** span.ingest 响应 MUST 含 `spanId`、`traceId`、`stored`、`sampled`、`contentMode`。

### C. 日志策略与正文存储

- **R-16** 每个工作区 MUST 有唯一策略；默认 `enabled=true`、`bodyMode=hash`、`sampleRate=1.0`、`retainDays=30`（宿主可在 params 声明实际默认）。
- **R-17** `bodyMode` ∈ `none`/`hash`/`redact`/`full`：不存正文/只存摘要/存脱敏后正文/存原文但仍脱敏；其他值 → 422。
- **R-18** 内置脱敏项（email、api_key、JWT、卡号、手机号、SSN、口令、私钥、`Authorization` 头）MUST 在任何 `bodyMode` 下生效，且 MUST NOT 可删除（尝试删除 → 422）。
- **R-19** `hash`/`none` 下响应与数据库 MUST NOT 出现正文明文；`hash` MUST 返回稳定摘要（同一输入两次读取相同，≥ 32 位十六进制）。
- **R-20** 策略降级为 `bodyMode=none` 或 `enabled=false` 时，已有 span 正文 MUST 被清除（只读查询 MUST NOT 再出现正文标记），不得提供"恢复明文"。
- **R-21** `sampleRate=0` → MUST 一条不留；`=1` → MUST 全留；0<r<1 时 MUST 按 trace 决定，同 trace 的 span 决策 MUST 一致。
- **R-22** 存储正文长度 MUST ≤ `maxStoredBodyBytes`（params，默认 32 KiB、上界 256 KiB）；超出 MUST 截断并置 `truncated=true`。
- **R-23** 超过 `retainDays` 的 span、评测集、评测运行结果 MUST 被删除（主库、索引、对象存储都清；只读查询 MUST NOT 出现）。
- **R-24** 策略 MUST 按工作区隔离：A 的变更 MUST NOT 影响 B；policy.update 需策略写权限，否则 403。
- **R-25** 评测集与评测运行结果是评测资产，内容 MUST NOT 随 `bodyMode` 变化；其读取由评测权限控制。
- **R-26** policy.update 为整体替换（PUT）；重复提交同一策略 MUST 得到同一结果（幂等）。

### D. 查询与隔离

- **R-27** span.list MUST 支持按 `feature`、`model`、`traceId`、`source`、`since`、`to`、`evalRunId` 过滤，MUST 按 `createdAt` 倒序 + `spanId` 升序稳定排序。
- **R-28** 分页：`limit` 缺省 50，契约上界 200；请求值 > 上界 MUST 收敛到上界并回显生效 `limit`；`limit ≤ 0` 或非整数 → 400。
- **R-29** 不存在的 span/trace/评测集 → 404 `not_found`；跨租户 → 同样 404 且同形。
- **R-30** trace.get MUST 返回该 trace 的全部 span，按 `startedAt` + `spanId` 升序；未知 `traceId` → 404。
- **R-31** `clientIp` MUST 取 X-Forwarded-For 中**最右侧的非受信代理跳**；全部受信则取最左侧；无该头取直连对端。受信网段由 `params.trustedProxyCidrs` 声明。
- **R-32** 任何读取端点 MUST NOT 返回调用者无权访问的工作区的数据。
- **R-33** span.get 响应 MUST 含 `spanId`、`traceId`、`feature`、`source`、`model`、`status`、`inputTokens`、`outputTokens`、`totalTokens`、`costMicros`、`currency`、`latencyMs`、`createdAt`、`contentMode`、`contentStored`、`clientIp`。

### E. 成本归因

- **R-34** 每条 span MUST 有整数 `costMicros` 与 `currency`；`costMicros` = 声明的模型单价（`params.modelPrices`）× 本 span 的 token 数，向上取整；token 为 0 → 0。
- **R-35** 同一过滤条件下 `Σ span.costMicros` MUST 等于 cost.summary 的 `totals.costMicros`（误差 0）。
- **R-36** cost.summary 的 `groupBy` ∈ `feature`/`model`/`day`，其他 → 422；时间窗 `from > to` → 422；缺省窗口 = 保留期内。
- **R-37** 无 feature 的调用 MUST 计入 `unattributed` 分组，MUST NOT 被丢弃。
- **R-38** `source=eval` 的 span MUST 同样计入 cost.summary。

### F. 回归评测

- **R-39** dataset.create：每个 case MUST 有非空 `input` 与 ≥1 条 `criteria`；`caseId` 重复 → 422；case 数 > `maxDatasetCases`（params，上界 1000）→ 422；缺 `name` → 400。
- **R-40** `criteria[].kind` ∈ `equals`/`contains`/`not_contains`/`regex`；其他 → 422；`regex` 模式 MUST ≤ 512 字符，超出 → 422。
- **R-41** run.start MUST 返回 **202** 与 `runId`、`status` ∈ `queued`/`running`；运行 MUST 在 `evalRunTimeoutSeconds`（params，默认 60、上界 600）内到达终态 `succeeded`/`failed`，不得永远停在非终态。
- **R-42** 每个 case MUST 恰好触发一次模型调用（经 `ai-model-gateway`），并产生恰好一条 `source=eval` 的 span。
- **R-43** 运行结果的 `output` MUST 等于模型当次返回的原文（不加工、不截断）；同一数据集 + 同一模型配置的两次运行，`output` 与 `passed` MUST 完全一致。
- **R-44** case 通过 = 全部 `criteria` 通过；`equals` 去首尾空白后整串相等；`contains` 区分大小写子串包含；`not_contains` 取反；`regex` 全串匹配。`summary.total` MUST 等于 case 数；`passRate = passed/total` ∈ [0,1]。
- **R-45** baseline.set MUST 只接受同一数据集的运行，否则 422；他租户的 `runId` → 404。
- **R-46** run.get MUST 返回 `comparison`：`baselineRunId`、`baselinePassRate`、`passRate`、`delta`、`regressedCaseIds`、`improvedCaseIds`；无基线时为 null。`regressedCaseIds` = 基线通过而本次失败的 caseId 集合。
- **R-47** 运行 MUST 记录**开始时**生效的基线；运行结束后再设基线 MUST NOT 改写该次运行的 `comparison`。
- **R-48** 模型调用失败 → 该 case `status=error`、`passed=false`、`errorCode` 非空、`summary.errorCount ≥ 1`；运行本身 `status=succeeded`；仅整体超时才 `failed` 且 `errorCode=run_timeout`。
- **R-49** 评测集、运行、基线的读写 MUST 按工作区隔离；跨租户 → 404。
- **R-50** dataset.delete → **204**，之后 GET → 404，但历史运行结果 MUST 仍可读；dataset.update MUST NOT 改写历史运行结果（历史运行保留其开始时的数据集与判据快照）。

### G. 重放与一次性令牌

- **R-51** replay.prepare MUST 返回 **201** 与一次性 `replayToken`、`expiresAt`；TTL ≤ `replayTokenTtlSeconds`（params，默认 300、上界 600）；令牌 MUST 绑定唯一 `spanId` 与工作区。
- **R-52** replay.execute MUST 原子消费令牌：成功 → **201**，返回新 `spanId`、`replayedFromSpanId` 指向原 span，MUST 恰好产生一次新的模型调用与一条新 span；原 span 不得被修改或删除。
- **R-53** 令牌已消费 → 409 `replay_token_used`，MUST NOT 产生新的模型调用或 span。
- **R-54** 令牌过期 → 410 `replay_token_expired`。
- **R-55** 原 span 无可用正文（`bodyMode=none` 或正文已被清除）→ `span.replay.prepare` MUST 返回 409 `replay_unavailable`，MUST NOT 发放令牌或调用模型。
- **R-56** 令牌 MUST 以不可逆摘要存储；只读数据库查询 MUST NOT 出现明文令牌。
- **R-57** 跨租户重放（他租户 `spanId` 或他租户令牌）→ 404；重放产生的 span MUST 计入 cost.summary。

### H. 参数

- **R-58** 宿主 MUST 在 `params` 声明：`pageSizeMax`、`maxBodyBytes`、`maxStoredBodyBytes`、`maxDatasetCases`、`retainDays`、`evalRunTimeoutSeconds`、`replayTokenTtlSeconds`、`ingestRateLimitPerMinute`、`modelPrices`、`trustedProxyCidrs`；未声明时按本契约界限执行。

## 4. 必须哈希存储、必须清除的数据

- 正文：`hash` 只存摘要，`none` 完全不存；`full`/`redact` 下内置敏感项 MUST NOT 出现在响应或数据库。
- 历史正文：降级或停用后 MUST 被清除，不得提供"恢复明文"。
- 重放令牌：只存摘要，数据库 MUST NOT 出现明文令牌。
- 成本金额：MUST 用整数 `costMicros`，不得浮点美元。
- 只读库检查仅限三类：**正文明文、令牌明文、幂等与保留期删除后的行数**。

## 5. 不变式

- I-1 每个已存 span 恰有一个 `spanId`，(工作区, spanId) 唯一；`totalTokens = inputTokens + outputTokens`，均为非负整数。
- I-2 同过滤下 `Σ span.costMicros == cost.summary.totals.costMicros`。
- I-3 `summary.total == 数据集 case 数`；`passed + failed + errorCount == total`；`passRate ∈ [0,1]`，`delta = passRate - baselinePassRate`。
- I-4 一次模型调用最多一条 span；一个令牌最多消费一次；跨租户读到的记录数为 0。

## 6. 建议，验收不测

- 正文静态加密与密钥轮换、字段级加密、数据库分区与冷热分层。
- `regex` 判据的执行时间上限（ReDoS 防护）、表达式缓存。
- 摄入异步化、批量写吞吐、预聚合缓存、评测运行的并发度。

## 7. 规则 → 用例 追溯表

| 规则 | 用例 |
|---|---|
| R-01 | A07 |
| R-02 | A04 |
| R-03 | A06 |
| R-04 | A07 |
| R-05 | A04, A05 |
| R-06 | A01, A08 |
| R-07 | A02, A03 |
| R-08 | A08 |
| R-09 | A08 |
| R-10 | A08 |
| R-11 | A08 |
| R-12 | A30 |
| R-13 | A01, A02 |
| R-14 | A08, A19 |
| R-15 | A01 |
| R-16 | A09 |
| R-17 | A09, A10 |
| R-18 | A10 |
| R-19 | A09 |
| R-20 | A11 |
| R-21 | A12 |
| R-22 | A13 |
| R-23 | A14 |
| R-24 | A06, A15 |
| R-25 | A21 |
| R-26 | A15 |
| R-27 | A01, A16 |
| R-28 | A16 |
| R-29 | A04 |
| R-30 | A01 |
| R-31 | A17 |
| R-32 | A04, A05 |
| R-33 | A01 |
| R-34 | A18 |
| R-35 | A18 |
| R-36 | A19 |
| R-37 | A19 |
| R-38 | A23 |
| R-39 | A20 |
| R-40 | A20 |
| R-41 | A21 |
| R-42 | A21 |
| R-43 | A21 |
| R-44 | A22 |
| R-45 | A23 |
| R-46 | A23 |
| R-47 | A23 |
| R-48 | A24 |
| R-49 | A05 |
| R-50 | A23, A25 |
| R-51 | A26 |
| R-52 | A26, A27 |
| R-53 | A26 |
| R-54 | A28 |
| R-55 | A29 |
| R-56 | A26 |
| R-57 | A29 |
| R-58 | A14, A16, A17, A18, A20, A28, A30 |
