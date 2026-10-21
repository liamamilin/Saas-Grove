# async-jobs 契约（黑盒可验收）

只描述"从外部能观察到什么"。实现方式、框架、库、存储结构不在范围内。

## 0. 验收怎么用这份契约

- **概念名**：`async-jobs.xxx` 是概念名；宿主在 `module-map.json` 映射真实路径；未映射记"宿主未声明"，不算通过也不算失败。
- **凭证**：所有任务接口带 `Authorization: Bearer <token>`（由 `auth` 公开接口取得）；宿主若用 Cookie 会话同样接受。
- **工作区**：默认请求头 `X-Workspace-Id: <workspaceId>`（workspace 由 `workspaces-and-permissions` 公开接口创建）；宿主可在 `params.workspaceSelector` 声明 `header`（默认）/`body`/`path`。
- **写请求**：可带 `Idempotency-Key: <随机串>`；必须带 `Origin: <APP_BASE_URL 的 origin>`（宿主若实现 §8 S-2 的来源校验，负例用 `Origin: https://evil.example`）。时钟、outbox、夹具等测试钩子见 HOST.md §3。
- **数据库只读检查**（仅这 4 项）：只读查询 `DATABASE_URL`，扫描 `public` schema 全部文本列检索已知字符串——**P1** 任务 id 出现在持久化存储；**P2** 幂等键明文不在任何单元格/响应体；**P3** 令牌明文不在任何单元格；**P4** 保留期过后个人数据标记串不在任何单元格。
- **数值**：契约给界限与默认值（§5），宿主在 `params` 声明实际值；未声明按默认值测；超界限 → 该项 FAIL。

## 1. 概念与路由

| 概念 | 方法 | 用途 | 成功码 |
|---|---|---|---|
| `async-jobs.submit` | POST | 提交任务 | 202 |
| `async-jobs.get` | GET | 读任务（状态/进度/步骤） | 200 |
| `async-jobs.list` | GET | 列本工作区任务 | 200 |
| `async-jobs.cancel` | POST | 请求取消 | 200 |
| `async-jobs.retry` | POST | 手动重跑已失败任务 | 202 |
| `async-jobs.result` | GET | 读结果（会话或令牌授权） | 200 |
| `async-jobs.token` | POST | 签发一次性结果访问令牌 | 201 |

`async-jobs.result` 的令牌授权形式为 `?jobId=<id>&token=<token>`。字段名 camelCase。`submit` 请求体 `{"type":"...","payload":{},"priority":"normal","timeoutSeconds":120,"metadata":{}}`；成功响应包 `{"job":{...}}`；`token` 为 `{"token":"<明文,仅一次>","expiresAt":"...","link":"..."}`；`list` 为 `{"jobs":[...],"nextCursor":null}`。
job 字段：`id`（不透明）、`workspaceId`、`type`、`status`、`progress`、`attempt`、`maxAttempts`、`cancelRequested`、`priority`、`createdAt`、`updatedAt`、`startedAt`、`finishedAt`、`steps`、`error`、`result`、`metadata`。
step 字段：`index`、`name`、`status`(`pending|running|succeeded|failed|cancelled|skipped`)、`attempts`、`startedAt`、`finishedAt`、`effectKey`、`error`。

## 2. 状态机

状态取值六种：`queued`、`running`、`cancelling`、`succeeded`、`failed`、`cancelled`。合法迁移：`queued → running|cancelled|failed`；`running → succeeded|failed|cancelling|queued`（末者为租约回收重排）；`cancelling → cancelled|failed|succeeded`；`succeeded`/`failed`/`cancelled` 为终态，不可再变。

## 3. 状态码与错误体

错误体统一 `{"error":{"code":"<stable_code>","message":"<可本地化文本>","requestId":"<id>"}}`；同一 code 的响应体键集合必须完全一致。

| 情况 | 状态码 | code |
|---|---|---|
| 提交被接受（含幂等重放） | 202 | — |
| 读/列/取消/读结果成功 | 200 | — |
| 令牌签发成功 | 201 | — |
| 请求体/字段非法；类型未注册 | 400 | `invalid_request`/`invalid_priority`/`invalid_payload`/`unknown_job_type` |
| 缺少或无效凭证 | 401 | `unauthorized` |
| 令牌不存在/不匹配/已吊销 | 401 | `invalid_token` |
| 工作区内权限不足 | 403 | `forbidden` |
| 任务不存在或不属于本工作区 | 404 | `job_not_found` |
| 状态不允许；幂等键同键异体；令牌已使用 | 409 | `invalid_state`/`idempotency_key_conflict`/`token_used` |
| 一次性令牌已过期 | 410 | `token_expired` |
| 载荷超过上限 | 413 | `payload_too_large` |
| 队列/并发上限打满 | 429 | `queue_full`（须带 `Retry-After`） |
| 未预期错误 | 500 | `internal_error`（不含堆栈、SQL、内部路径） |

任务级错误码（`job.error.code`，与 HTTP 状态码无关）：`timeout`（超时）、`retries_exhausted`（重试耗尽）、步骤自定义 code。

## 4. MUST 规则（每条都有用例，见 §9）

**认证与隔离**

- **R-AUTH-1** 所有任务接口校验凭证；缺失/无效 → 401 `unauthorized`，错误体与其他认证失败同形。
- **R-AUTH-2** 访问非本工作区任务 → 404 `job_not_found`，与"不存在"响应体逐字节同形（不得用 403/404 区分存在）。
- **R-AUTH-3** 账号 disabled/unverified 时：令牌失效 → 401 `invalid_token`，写操作 → 401 `unauthorized`；形状分别与"令牌不存在""凭证无效"相同，任何账号状态都不得泄露账号存在或停用。
- **R-AUTH-4** 同工作区可见性服从 `workspaces-and-permissions`：权限不足 → 403 `forbidden`；任务/步骤/结果/令牌绑定单一工作区，`list` 只返回本工作区任务。

**提交与幂等**

- **R-SUB-1** 提交 → 202 与完整 job；`id` 不透明不可枚举（≥128 bit 随机，不由时间戳或自增推导）。
- **R-SUB-2** 只执行已注册类型；未注册 → 400 `unknown_job_type` 且不创建任务；类型名不得被当作代码/模板路径执行。
- **R-SUB-3** 校验失败 → 400：字段非法 → `invalid_request`；`priority` 非 `{low,normal,high}` → `invalid_priority`；`payload` 不符类型要求 → `invalid_payload`。
- **R-SUB-4** `payload` 超 `maxPayloadBytes` → 413 `payload_too_large`，不创建任务。
- **R-SUB-5** 请求体中的服务端权威字段（`status`/`progress`/`attempt`/`steps`/`result`/`error`/`workspaceId` 等）必须被忽略：提交后 `status=queued`、`progress=0`、`attempt=0`，归属调用方工作区。
- **R-SUB-6** `Idempotency-Key`：(a) 同键同体 → 返回同一 job（202，`job.id` 相同）；(b) 同键异体 → 409 `idempotency_key_conflict`；(c) 并发同键 → 只建 1 个任务，所有 202 的 `job.id` 相同；(d) 键只存摘要、不回显明文（P2）。

**状态、进度、步骤**

- **R-STATE-1** 状态取值与迁移须符合 §2；非法迁移（取消终态、重跑非 `failed`）→ 409 `invalid_state`；终态写入后不得再变，重复取消已 `cancelled` → 200 且状态与 `finishedAt` 不变；不得出现 `succeeded` 与 `error` 同时非空。
- **R-PROG-1** `progress` 为 0..100 整数且单调不减；`queued`=0，只有 `succeeded`=100；失败/取消保留最后已知值。
- **R-STEP-1** 步骤按序执行，`steps[].attempts` 记尝试次数；重试时**已成功步骤不得再执行**（次数保持 1）；`effectKey` 跨 attempt 稳定 → 该步外部副作用至多一次。

**取消与重试**

- **R-CANCEL-1** 取消 `queued` → 200、`status=cancelled`、`startedAt` 保持 null，步骤不得进入 `running`/`succeeded`，无外部副作用；取消 `running` → 200，先 `cancelling` 后 `cancelled`，此后不启动新步骤、不产生新副作用；已发生的副作用**不回滚**。
- **R-RETRY-1** 失败自动重试最多 `maxAttempts` 次；耗尽 → `failed`、`error.code=retries_exhausted`、`attempt=maxAttempts`；退避有界（首次 ≤ 60s、其后 ≤ 300s，实际值 `params.retryBackoffSeconds`），重试发生在该延迟之后。
- **R-RETRY-2** 手动重跑仅限 `failed` → 202，状态回 `queued`，已成功步骤保留不重跑，`attempt` 继续增长；否则 409 `invalid_state`。

**时间、租约、持久化、结果**

- **R-TIME-1** 运行超 `jobTimeoutSeconds` → `failed`、`error.code=timeout` 并释放执行槽位；`running` 超 `staleAfterSeconds` 无进展（执行者失联）→ 重排并 `attempt+1`，不得永久 `running`。
- **R-TIME-2** 超时、租约、令牌 TTL、保留期、参考任务等待共用同一时间源，且可被 `POST /api/__test__/clock` 推进。
- **R-PERSIST-1** 任务/步骤/结果/幂等记录持久化在数据库而非进程内存（P1），重启后 `get` 仍返回该任务及状态；重跑、重排队、重启不产生重复副作用；`status` 与 `startedAt`/`finishedAt`/`error`/`result` 自洽。
- **R-RESULT-1** 未完成时 `result` 为 null，`succeeded` 后可经 `result` 概念读到（200）；超 `resultMaxBytes` 必须截断（`result.truncated=true`、`result.truncatedAt`），不得 5xx，超出部分不内联（大产物交 `file-storage`）。

**一次性访问令牌**

- **R-TOKEN-1** `token` → 201，明文只出现一次，库中只存哈希（P3）；含 `expiresAt` 与 `link`。
- **R-TOKEN-2** 令牌绑定**单一**任务：用于其它 job id → 401 `invalid_token`，与"令牌不存在"逐字节同形。
- **R-TOKEN-3** 一次性：第二次 → 409 `token_used`；两个并发请求用同一令牌 → 恰好一个 200，另一个 409。
- **R-TOKEN-4** 超 TTL → 410 `token_expired`。
- **R-TOKEN-5** 哈希升级用双键（旧新并存直到旧令牌全部过期）；**不得**用"拿明文重算摘要"校验（明文不可得）。

**数据与容量**

- **R-DATA-1** 超 `retentionDays`：`get` → 404 `job_not_found`（不区分"已过期"与"不存在"）；payload/metadata/result 的个人数据必须清除（P4）；明文令牌与幂等键不得出现在响应体或数据库单元格（P2/P3）。
- **R-LIMIT-1** 同工作区 `queued`+`running` ≤ `queueLimitPerWorkspace`，超出 → 429 `queue_full` + `Retry-After` 且不创建任务；`running` ≤ `maxConcurrentPerWorkspace`（超出只排队）；`list` 单页 ≤ `listPageSize`（≤100），超限 `limit` 被截断。
- **R-OUTBOX-1** 本模块邮件：模板名 `async-jobs.<name>`，链接放 `data.link`，令牌放 `token`；同一任务多次尝试不产生重复消息（同 `to`+`template` 恰好 1 条）。

## 5. params：界限与默认值

宿主在 `params` 声明实际值；未声明用默认值；超界限 → 该项 FAIL。
`maxConcurrentPerWorkspace` 1..64（默认 1）；`queueLimitPerWorkspace` 1..100（20）；`maxPayloadBytes` 1024..1048576（65536）；`resultMaxBytes` 1024..1048576（65536）；`maxAttempts` 1..10（3）；`jobTimeoutSeconds` 5..3600（300）；`staleAfterSeconds` 5..600（60）；`retryBackoffSeconds` 1..60（5）；`retentionDays` 1..365（30）；`tokenTtlSeconds` 60..86400（900）；`listPageSize` 1..100（20）；`workspaceSelector` `header`/`body`/`path`（`header`）。

## 6. 参考任务类型（契约的一部分，宿主必须实现）

业务类型由宿主自行注册；以下类型让验收可执行，行为固定：

- `async-jobs.demo.sleep` `{"seconds":N}` — 单步，等待 N 秒时间源时间后成功，`result={"sleptSeconds":N}`。
- `async-jobs.demo.steps` `{"steps":N,"failStep":k,"failTimes":m}` — N 个顺序步骤；第 k 步在**累计前 m 次尝试**失败（手动重跑计入）；每执行一次往 `result.executions` 追加 `{"step":i,"attempt":a}`。
- `async-jobs.demo.email` `{"to":e,"template":t,"data":{},"failAfterSend":bool}` — 发一封邮件到 outbox；`failAfterSend=true` 时发信后本步失败（验证副作用不重复）。
- `async-jobs.demo.hang` `{}` — 单步启动后永不完成、也不续约租约（模拟执行者崩溃）。
- `async-jobs.demo.large` `{"bytes":N}` — 成功后 `result` 产出 N 字节内容（验证截断）。

## 7. 不变量（每轮轮询后都应成立）

- **I-1** `status` 只取 §2 六种，终态之后不再变化。
- **I-2** `succeeded` ⇒ `progress=100` ∧ `error=null` ∧ `result≠null` ∧ `finishedAt≠null`。
- **I-3** `failed` ⇒ `error≠null` ∧ `finishedAt≠null` ∧ `result=null`。
- **I-4** `cancelled` ⇒ `finishedAt≠null` ∧ `cancelRequested=true`。
- **I-5** `0≤attempt≤maxAttempts` 且只增不减；`0≤progress≤100` 且单调不减。
- **I-6** 同一时刻最多一个步骤 `running`；步骤 `index` 连续有序。
- **I-7** 同 (工作区, 幂等键) 至多一个任务；同一 job 的 `effectKey` 跨 attempt 不变。

## 8. 建议，验收不测（黑盒不可观察）

- **S-1** 需记录客户端 IP（审计、溯源）时，从 **X-Forwarded-For 最右侧起跳过受信代理**取第一个不受信任的跳；绝不取最左侧（最左侧由客户端伪造）。
- **S-2** 写请求的来源校验（Origin/CSRF）复用 `web-security` 的允许来源集合，不自建第二套来源规则。
- **S-3** 调度公平性：同优先级 FIFO，不同优先级之间不得饿死低优先级任务。
- **S-4** 队列持久性建议"先落库再入队"，避免"已回 202 但没进队列"的丢任务窗口。
- **S-5** 日志记录 `job.id`+`attempt`+`step`，不记录 payload 原文（常含 PII 与第三方凭据）。
- **S-6** 大对象存 `file-storage` 时只留引用与校验和，便于重放校验。
- **S-7** 死信列表与人工处置流程属运营面，不在本契约。

## 9. 规则 → 验收用例追溯表

| 规则 | 用例 |
|---|---|
| R-AUTH-1 | AC-10 |
| R-AUTH-2 | AC-11, AC-24 |
| R-AUTH-3 | AC-12 |
| R-AUTH-4 | AC-11 |
| R-SUB-1 | AC-01 |
| R-SUB-2 | AC-02 |
| R-SUB-3 | AC-03 |
| R-SUB-4 | AC-04 |
| R-SUB-5 | AC-05 |
| R-SUB-6 | AC-06, AC-07, AC-08, AC-09 |
| R-STATE-1 | AC-01, AC-13, AC-14, AC-15, AC-30 |
| R-PROG-1 | AC-01, AC-30 |
| R-STEP-1 | AC-16, AC-30 |
| R-CANCEL-1 | AC-13, AC-14, AC-18 |
| R-RETRY-1 | AC-16, AC-17 |
| R-RETRY-2 | AC-21 |
| R-TIME-1 | AC-19, AC-20 |
| R-TIME-2 | AC-17, AC-19, AC-20 |
| R-PERSIST-1 | AC-18, AC-20, AC-29 |
| R-RESULT-1 | AC-22 |
| R-TOKEN-1 | AC-23 |
| R-TOKEN-2 | AC-24 |
| R-TOKEN-3 | AC-25 |
| R-TOKEN-4 | AC-26 |
| R-TOKEN-5 | AC-23 |
| R-DATA-1 | AC-09, AC-23, AC-27 |
| R-LIMIT-1 | AC-11, AC-28 |
| R-OUTBOX-1 | AC-18 |
