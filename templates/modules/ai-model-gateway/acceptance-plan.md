# ai-model-gateway 验收计划（黑盒）

可执行测试稍后另写；本文件只定义**测什么、期望什么**。每条用例必须能只用 `HOST.md` 的钩子跑起来。

## 0. 夹具与约定

- **账号**：每条用例新建独立账号（唯一邮箱）→ 用 `auth` 的注册/登录接口取得凭据 → 按 `auth` 契约方式携带（Cookie 或 `Authorization: Bearer <token>`）。
- **工作区**：用 `workspaces-and-permissions` 的公开接口创建工作区，取其 id，后续请求带 `X-Workspace-Id: <id>`；需要"另一租户"时再建一个账号 + 一个工作区。需要管理员的用例用 `workspaces-and-permissions` 的成员接口把该用户设为管理员（角色名以该模块契约为准）。
- **前置头**：宿主若校验带凭据写请求的 `Origin`，所有 POST/PUT 必须带 `Origin: <APP_BASE_URL>` 及宿主声明的其它 CSRF 头。
- **假模型**：每例开始前 `DELETE /api/__test__/fake-model` 复位；需要时用 `PUT /api/__test__/fake-model` 注入延迟/失败/固定 usage。**上游调用计数** = 假模型钩子读回的请求条数（钩子不提供读回时，该断言记为宿主未声明）。
- **时钟**：TTL 相关用 `POST /api/__test__/clock {advanceSeconds}`。
- **限流**：可能互相干扰的用例先 `DELETE /api/__test__/rate-limits`。
- **数值门限**：`P.X` = `module-map.json` 的 `params["ai-model-gateway.X"]`，未声明时取 `contract.md` §5 的默认值；用例中不写死数值。
- **路径**：全部取自 `module-map.json` 的概念映射；未映射的概念记为"宿主未声明"，不算通过也不算失败。

## 1. 用例表

| id | given | action | expected | 负例 |
|---|---|---|---|---|
| A01 | 宿主以非 fake 的 provider 且缺少凭据启动 | 观察进程与端口 | 退出码非 0；端口无监听；stderr 含 `gateway_config_invalid` | 是 |
| A02 | `MODEL_PROVIDER=fake` 且 `TEST_MODE` 未设置 | 启动宿主 | 非 0 退出；端口无监听 | 是 |
| A03 | 已启动（fake）；管理员把 provider 端点写成不可解析的地址（若宿主以 422 拒绝该值，本例记宿主未声明） | GET health；POST complete | health 503；complete 503 且 `error.code=gateway_not_ready`（非 500）且快速返回；用例末尾把端点写回原值 | 是 |
| A04 | 已启动且配置含凭据 | GET config；只读查库搜凭据明文 | 响应只含掩码/指纹；响应与库中均无凭据明文 | 是 |
| A05 | 普通成员与管理员各一；先用 GET config 取回当前配置（PUT 与 GET 读写同形） | 普通成员 PUT config；管理员 PUT schema 非法的值；管理员再 PUT 一个合法改动 | 前者 403 `forbidden`；非法值 422 `invalid_request` 且旧配置仍生效；合法改动 200 且有审计事件；用例末尾写回原配置 | 是 |
| A06 | 账号在 W1；另有仅对 W2 可见的模型 | complete 请求未知模型名；再请求 W2 专属模型名 | 两者同为 404 `model_not_found`（不得一个 404 一个 403） | 是 |
| A07 | 账号在 W1 | GET models | 只含 W1 可见模型；每项含 `name`/`maxInputTokens`/`maxOutputTokens`/`supportsStreaming`；不含 W2 专属模型 | 否 |
| A08 | 已启动；先记录 calls 与 usage 条数 | complete 体为非 JSON；再 complete `maxTokens=0` | 前者 400 `invalid_json`；后者 422 `invalid_request`；两次都不新增调用记录与 usage 记账 | 是 |
| A09 | `P.maxRequestBytes` 已知 | complete 体大小 > `P.maxRequestBytes` | 413 `request_too_large`；上游调用计数、calls 条数、usage 条数均不变 | 是 |
| A10 | 从 models 读出模型 `maxOutputTokens=M` | complete 传 `maxTokens=1000000`；读假模型收到的请求 | 响应 `effectiveMaxTokens=M`（且 ≤ `P.maxOutputTokens`）、`requestedMaxTokens=1000000`；上游收到的 maxTokens=M | 否 |
| A11 | 模型 `maxInputTokens=N`；构造长度足够大的输入（使其估算 token > N），且字节数 < `P.maxRequestBytes`；若两者无法同时满足则本例记宿主未声明 | complete 传该输入；再传同样输入 + `truncate:true` | 首次 422 `context_length_exceeded` 且上游计数不变；二次 200 且 `truncated=true`、`effectiveMaxTokens` 按截断后重算 | 是 |
| A12 | 账号被禁用或未验证（用 `auth` 的公开接口制造该状态）；另有一份错误凭据 | 两次 POST complete | 两次同为 401 `unauthenticated`，错误体与头结构一致，不暴露账号状态与凭据错误细节 | 是 |
| A13 | 假模型固定 usage | POST stream 并逐帧解析 | 200 且 `Content-Type: text/event-stream`；事件为 `start`→`delta`→`usage`→`done`；恰好一个终止事件；delta 拼接等于最终内容 | 否 |
| A14 | 假模型注入失败 | POST stream | 出现 `error` 终止事件（含 code/message/retryable）；无 `done`；连接结束 | 是 |
| A15 | 假模型固定 usage（input=I, output=O） | POST stream 与 POST complete（同输入） | 两者 usage 相同：`totalTokens=I+O`、`source=reported` | 否 |
| A16 | 两个工作区各一账号 | 并发开两个 stream，各自读增量 | 各自的 delta 只属于本流，`id`/`requestId` 不串；两流字节不交错 | 是 |
| A17 | 假模型有延迟 | POST stream，收到首个 delta 后断开 | calls 中出现 `status=cancelled`；usage 记账条数不变 | 是 |
| A18 | 完成一次调用（请求带 `X-Forwarded-For: 1.1.1.1, 2.2.2.2`） | GET calls 两次 | 记录含 `contract.md` §2 的全部字段；两次读取一致；`clientIp` 为最右侧非受信跳（受信网段按 `P.trustedProxyCidrs`） | 否 |
| A19 | 假模型"前 1 次失败后成功"（钩子不支持一次性失败则记宿主未声明）；`P.maxAttempts≥2`（=1 则记宿主未声明） | POST complete | 200；`attempts=2`；usage 记账 1 条；耗时 ≥ `P.retryBaseDelayMs` | 否 |
| A20 | 假模型持续 401；再持续 429 | 两次 POST complete | 401：attempts=1 且 502 `provider_auth_failed`；429：重试耗尽后 429 `provider_rate_limited`（上游有 `Retry-After` 则透传） | 是 |
| A21 | 主模型持续失败，备用模型可见且成功 | POST complete 请求主模型；管理员改别名后再请求 | 200、`fallback=true`、`model`=备用、`requestedModel`=主；usage 记账 1 条；改别名只影响之后的新调用 | 否 |
| A22 | 假模型持续失败；`P.circuitFailureThreshold=N`；`P.circuitOpenMs` 已知 | 反复请求直到出现 503 `provider_unavailable`（最多 N×`P.maxAttempts`+2 次）；随即再请求一次 | 再次为 503 `provider_unavailable`，两次之间上游调用计数不增加、耗时 < `P.attemptTimeoutMs`；推进时钟 `P.circuitOpenMs` 后可再试 | 是 |
| A23 | 固定幂等键 K 与请求体 A | 用 K 发两次；推进 `P.idempotencyWindowSeconds`+60s 后再发 | 前两次同 `id`、同 usage、上游计数 1、第二次带 `Idempotent-Replay: true`；第三次上游计数变 2 | 是 |
| A24 | 固定幂等键 K | 用 K 发请求体 A，再用 K 发请求体 B | 第二次 409 `idempotency_conflict`；上游调用计数仍为 1 | 是 |
| A25 | 工作区 W1 与 W2，同一幂等键 K | W1 请求后，W2 用同键同体请求 | W2 响应不得含 W1 的 `content`/`id`；按新调用处理或 409 都可，但不得泄露 W1 内容 | 是 |
| A26 | `K=P.maxConcurrentPerWorkspace`（未声明取默认 8）；假模型有足够延迟 | 并发发 K+1 个 complete | K 个 200，多出的 1 个 429 `rate_limited` 且带 `Retry-After`；上游计数 K；usage 记账 K 条 | 是 |
| A27 | W1 已有调用记录 | W2 的账号 GET calls | 404 `not_found`；响应体不得含 W1 的 `id`/`requestId`/内容 | 是 |
| A28 | 假模型注入的错误文本含标记 `sk-live-SECRET-XYZ` | 触发该错误并读响应体 | 响应体不含该标记；体结构为 `{"error":{code,message,retryable,requestId}}`；响应头 `X-Request-Id` 存在且与 calls 记录一致 | 是 |
| A29 | 宿主声明 `usage-metering-and-budgets` 且该模块把预算置为耗尽 | POST complete | 402 `budget_exceeded`；上游调用计数不变；无 usage 记账 | 是 |
| A30 | 两个并发请求，同一模型但 `maxTokens` 不同（可见模型 ≥2 时改用不同模型）；`P.maxConcurrentPerWorkspace≥2`（否则本例记宿主未声明） | 并发 POST complete 两次 | 两条响应的 usage/`effectiveMaxTokens`/`attempts` 各自正确、互不串扰；usage 记账 2 条 | 是 |

## 2. 条件依赖与说明

- **A29** 依赖宿主实现 `usage-metering-and-budgets`；未声明该模块时记为宿主未声明，不判失败。
- **A03 / A05 / A21** 需要管理员身份，依赖 `workspaces-and-permissions` 暴露角色设置接口。
- **A03 / A05 改的是全局配置**，必须在用例内写回原值复原，否则后续用例全被"网关未就绪"污染。
- **A04** 的"只读查库"按 `HOST.md` §4 只读 DB 查询执行；查不到明文凭据即通过。
- **A10 / A19 / A20 / A21 / A22 / A23 / A26** 需要从假模型钩子读回上游请求或调用计数；钩子只写不读时，依赖该读回的断言记为宿主未声明，其余断言照常判定。
- A22 与 A23 之前先 `DELETE /api/__test__/fake-model` 复位，避免上一例的失败注入残留。
- A23 的"第三次上游计数变 2"依赖幂等窗口到期后不再命中旧结果。
- 负例为"是"的用例必须断言**状态码、错误体与副作用**三者，不是只看非 200。
