# async-jobs 验收计划（黑盒）

只写"从外部怎么做、看到什么"。可执行脚本在后续阶段编写。

## 通用准备（每条用例都按此执行）

1. **账号/工作区**：用 `auth` 公开接口注册全新账号（唯一邮箱 `aj-<case>-<rand>@example.test`）取凭证；用 `workspaces-and-permissions` 公开接口建工作区，记下 `workspaceId`；**用例不共享账号**。
2. **写请求头**：所有 POST 带 `Content-Type: application/json`、`Origin: <APP_BASE_URL 的 origin>`、`X-Workspace-Id: <workspaceId>`（若 `params.workspaceSelector` 声明 `body`/`path` 则改用该位置）；幂等用例额外带 `Idempotency-Key: <随机串>`。
3. **参数**：数字一律从 `module-map.json` 的 `params` 读；未声明用 `contract.md` §5 默认值；声明值越界 → 该项 FAIL。**脚本不得硬编码阈值**。
4. **时钟**：等待用 `POST /api/__test__/clock {advanceSeconds}` 推进，轮询 `async-jobs.get` 至终态（最多 60 次，每次间隔 0.5s）。大幅推进后若 401 → 重新登录再继续。
5. **outbox / 数据库**：`GET /api/__test__/outbox?to=<email>` 取邮件；P1~P4 用只读查询扫描 `public` schema 文本列检索已知字符串。下文 `demo.*` 即 `async-jobs.demo.*`，`submit`/`get`/`list`/`cancel`/`retry`/`result`/`token` 即 `contract.md` §1 的 `async-jobs.*` 概念。
6. **判定**：形状错、错误码不在 `contract.md` §3、出现未列状态码 → FAIL；宿主未声明的概念/参数单列"宿主未声明"，不算通过也不算失败。

## 用例表

| id | given | action | expected | 负例 |
|---|---|---|---|---|
| AC-01 | 全新账号+工作区 | submit `{"type":"async-jobs.demo.sleep","payload":{"seconds":1}}` | 202；`job.status=queued`、`progress=0`、`attempt=0`、`maxAttempts=params.maxAttempts`、`error=null`、`result=null`、`steps=[]`、`workspaceId`=自己；`id` 不透明（长度≥22、非纯数字） | 否 |
| AC-02 | 同上 | submit `type="not.registered.type"` | 400 `unknown_job_type`；`list` 数量不变 | 是 |
| AC-03 | 同上 | 三次 submit：`priority="urgent"`；`payload="not-an-object"`；`timeoutSeconds=-1` | 均 400，code 依次 `invalid_priority`/`invalid_payload`/`invalid_request`；无任务创建 | 是 |
| AC-04 | 同上 | submit payload = `params.maxPayloadBytes`+1KB | 413 `payload_too_large`；未创建 | 是 |
| AC-05 | 同上 | submit body 额外带 `{"status":"succeeded","progress":100,"attempt":9,"workspaceId":"<他人 ws>","result":{"x":1}}` | 202；`get` 显示 `status=queued`、`progress=0`、`attempt=0`、`result=null`、`workspaceId`=调用方 | 是 |
| AC-06 | 同上 | 固定 `Idempotency-Key=K1` submit 同一请求体两次 | 两次均 202 且 `job.id` 相同；`list` 只 1 条 | 否 |
| AC-07 | K1 已绑定请求体 A | 用 K1 submit 不同请求体 B | 409 `idempotency_key_conflict`；`list` 仍 1 条 | 是 |
| AC-08 | 同上 | 并发 5 次 submit，同 `Idempotency-Key=K2`、同请求体 | 全部 202；`job.id` 相同；`list` 只有 1 条 | 是 |
| AC-09 | `Idempotency-Key="SECRET-KEY-<rand>"` | submit 后读 `get`/`list` 响应体，再做只读检查 P2 | 三处均无该明文 | 是 |
| AC-10 | 请求不带凭证（不复用他例 token） | 依次调 submit/get/list/cancel/retry/result/token（用随机 job id） | 全部 401 `unauthorized`；七个错误体键集合完全一致 | 是 |
| AC-11 | 账号 A（工作区 A）与账号 B（工作区 B）；A 有任务 | B 对 A 的任务 id 调 get/list/cancel/retry/result；另用随机 id 调 get；再 `list?limit=1000` | 全部 404 `job_not_found`；B 的 404 与随机 id 的 404 逐字节同形；B 的 `list` 不含 A 的任务；`list` 条数 ≤ `params.listPageSize`。宿主若支持受限成员，其 cancel → 403 `forbidden` | 是 |
| AC-12 | 宿主 `auth` 暴露未验证/停用状态且可公开触发 | 账号取令牌 → 用 auth 接口置为未验证/停用 → 用旧令牌调 `result?jobId=T&token=K`；并用其凭证 `submit` | `result` → 401 `invalid_token`（与"令牌不存在"同形）；`submit` → 401 `unauthorized`（与"凭证无效"同形）。无此状态记"宿主未声明" | 是 |
| AC-13 | 账号+工作区；`params.maxConcurrentPerWorkspace=1`（否则填满槽位） | submit `demo.sleep`(`seconds=3600`) 后**立即** cancel，再推进时钟 3600s | cancel → 200，`status=cancelled`、`startedAt=null`、无步骤进入 `running`/`succeeded`；推进后仍 `cancelled`；`outbox` 无新消息。若并发上限>1 致已开始，只断言终态 `cancelled` 且无步骤 `succeeded` | 是 |
| AC-14 | 账号+工作区 | submit `demo.sleep`(`seconds=3600`)；轮询到 `running` 后 cancel；并发再发一次 cancel | 两次 cancel 均 200；状态先 `cancelling` 后 `cancelled`；`finishedAt` 只有一个值；`cancelRequested=true` | 否 |
| AC-15 | 有一个 `succeeded` 任务与一个 `failed` 任务（`demo.steps`，`failTimes` 足够大） | cancel `succeeded` 任务；cancel `failed` 任务；retry `queued` 任务；再 cancel 已 `cancelled` 任务 | 前三者为 409 `invalid_state`；最后一个 200 且仍 `cancelled` | 是 |
| AC-16 | `params.maxAttempts≥2` | submit `demo.steps`：`{"steps":3,"failStep":2,"failTimes":1}` | 最终 `succeeded`；`attempt=2`；`result.executions` 中 step1/step3 各 1 次（未重跑）、step2 出现 2 次；`steps[]` 有序、无两个 `running`；`effectKey` 跨 attempt 不变 | 否 |
| AC-17 | `params.maxAttempts=M`、`retryBackoffSeconds=B` | submit `demo.steps`：`{"steps":2,"failStep":1,"failTimes":99}`（该步永远失败）；先推进 `max(B-1,0)`s 轮询，再推进 `B×2^M+60`s 轮询 | 首次轮询 `attempt<M`（退避未到；M=1 则跳过此断言）；之后终态 `failed`、`error.code=retries_exhausted`、`attempt=M` | 是 |
| AC-18 | 目标收件邮箱 `dup-<rand>@example.test` | submit `demo.email`：`{"to":<该邮箱>,"template":"async-jobs.demo_email","data":{"k":"v"},"failAfterSend":true}`，等所有 attempt 结束 | 该邮箱下 `template=async-jobs.demo_email` 的消息**恰好 1 条**；`data.link` 存在且含任务 id；模板名以 `async-jobs.` 开头 | 是 |
| AC-19 | 账号+工作区 | submit `demo.sleep`(`seconds=3600`)；推进 `jobTimeoutSeconds+60`s 后轮询 | 终态 `failed`、`error.code=timeout`、`finishedAt≠null`；此后 `running` 数 ≤ `maxConcurrentPerWorkspace`（槽位释放） | 是 |
| AC-20 | 账号+工作区 | submit `demo.hang`；轮询到 `running`；推进 `staleAfterSeconds+60`s 后轮询 | `attempt≥2`（已重排）；不再永久停留 `running`；`running` 数不超上限 | 是 |
| AC-21 | `params.maxAttempts=M` | submit `demo.steps`：`{"steps":3,"failStep":2,"failTimes":M}` → 轮询到 `failed` → `retry` 该任务 | 重跑前 `failed`、`attempt=M`、步骤1 `attempts=1`；retry → 202 且 `queued`；之后 `succeeded`、`attempt>M`；步骤1 `attempts` 仍为 1（未重跑） | 否 |
| AC-22 | 账号+工作区 | submit `demo.large`：`{"bytes":params.resultMaxBytes+4096}`；未完成与完成后各读一次 `result` | 未完成：200 且 `result=null`；完成：200 且 `result.truncated=true`、`result.truncatedAt` 存在、长度 ≤ `params.resultMaxBytes`；无 5xx | 否 |
| AC-23 | 有一个 `succeeded` 任务 | `POST async-jobs.token`：`{"jobId":"<id>"}`；再做只读检查 P3 | 201；含 `token` 明文、`expiresAt`、`link`；明文不在任何单元格；再调一次得不同令牌 | 否 |
| AC-24 | 账号 A 的任务 T1 与令牌 K1；另一任务 T2 | 用 `result?jobId=T2&token=K1`；用 `result?jobId=T1&token=<随机>` | 均 401 `invalid_token`；两响应体逐字节同形 | 是 |
| AC-25 | `succeeded` 任务 T；令牌 K | 串行用 `result?jobId=T&token=K` 两次；再用新令牌 K2 并发发两次 `result?jobId=T&token=K2` | K 第二次 → 409 `token_used`；K2 的两个并发请求**恰好一个** 200，另一个 409 `token_used` | 是 |
| AC-26 | `succeeded` 任务 T；令牌 K | 推进 `tokenTtlSeconds+60`s 后用 `result?jobId=T&token=K` | 410 `token_expired`；错误体键集合与其他错误相同 | 是 |
| AC-27 | submit 带 `metadata={"pii_marker":"MARK-<rand>"}`，payload 内放同一标记串 | 推进 `retentionDays×86400+86400`s 后 `get`；再做只读检查 P4 | `get` → 404 `job_not_found`（与随机 id 同形）；标记串不在任何单元格；`list` 不再含它 | 是 |
| AC-28 | 全新账号+工作区；`params.queueLimitPerWorkspace=Q`、`maxConcurrentPerWorkspace=C` | 并发提交 Q+1 个 `demo.sleep`(`seconds=3600`)；采样任务状态 | 第 Q+1 个 → 429 `queue_full` + `Retry-After` 且未创建；任意时刻 `running` 数 ≤ C，其余 `queued` | 是 |
| AC-29 | 任一任务 T（取 `succeeded` 的） | 只读检查 P1：检索 T 的 `job.id` | id 出现在持久化存储；查到的状态与 `get` 一致 | 否 |
| AC-30 | 本轮已完成的任务（覆盖 queued/running/succeeded/failed/cancelled） | 逐个重读 `get`，核对不变量 I-1..I-7 | 无不变量被违反；`succeeded` ⇒ `progress=100` ∧ `error=null` ∧ `result≠null`；`failed` ⇒ `error≠null` ∧ `result=null`；`attempt≤maxAttempts`；`progress` 单调不减 | 否 |

## 覆盖说明

- **隔离**：AC-11（跨工作区读写）、AC-24（令牌跨任务）、AC-10（未认证）、AC-12（账号状态）。
- **重放/单次令牌**：AC-06/07/08（幂等键重放与并发）、AC-25（一次性令牌重放与并发）。
- **限额**：AC-04、AC-11（分页）、AC-17、AC-19、AC-26、AC-27、AC-28。
- **竞态**：AC-08（同键并发）、AC-14（并发取消）、AC-25（并发用令牌）、AC-16（重试期间步骤归属）。
- **安全评审会试的攻击**：AC-05（伪造服务端字段/越权写入）、AC-11 与 AC-24（越权读取与枚举）、AC-10、AC-12、AC-23（令牌明文落库）、AC-27（过期数据未清除）、AC-04（超大载荷）、AC-28（资源打满）、AC-18（重复副作用）。
