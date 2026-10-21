# ai-model-gateway 契约（黑盒）

只写"从运行中的系统外部能观察到"的行为。宿主把概念映射到自己的路由（`module-map.json`），验收只读映射（见 `HOST.md`）。框架、库、数据库实现不在契约内。

## 0. 前置与上下文

- **认证**：除 `ai-model-gateway.health` 外都要 `auth` 的会话凭据；验收用 `auth` 注册/登录取得，按其契约方式携带（Cookie 或 `Authorization: Bearer <token>`）。
- **工作区**：调用类与记录类概念需工作区；请求头带 `X-Workspace-Id: <workspaces-and-permissions 创建的工作区 id>`。缺该头 → 400 `missing_context`；非成员 → 404 `not_found`。
- **管理员**：需管理员的用例用 `workspaces-and-permissions` 成员接口把用户设为管理员（角色名以该契约为准）。
- **Origin / CSRF**：网关不校验 `Origin`（属 `web-security`）；宿主若校验带凭据写请求的 `Origin`，验收必须带 `Origin: <APP_BASE_URL>` 及宿主声明的其它 CSRF 头。
- **时钟**：TTL 用例用 `POST /api/__test__/clock {advanceSeconds}` 推进。
- **假模型**：`MODEL_PROVIDER=fake` 时全部模型调用走 `PUT/DELETE /api/__test__/fake-model`；钩子须支持固定延迟、一次性失败（前 N 次失败后成功）、持续失败、固定 usage、读回网关请求体；只写不读时"读回"断言记宿主未声明。

## 1. 概念（宿主必须映射）

| 概念 | 方法 | 建议路径 |
|---|---|---|
| `ai-model-gateway.health` | GET | `/api/ai/health` |
| `ai-model-gateway.models` | GET | `/api/ai/models` |
| `ai-model-gateway.complete` | POST | `/api/ai/complete` |
| `ai-model-gateway.stream` | POST | `/api/ai/stream` |
| `ai-model-gateway.config` | GET | `/api/ai/config` |
| `ai-model-gateway.config.update` | PUT | `/api/ai/config` |
| `ai-model-gateway.calls` | GET | `/api/ai/calls` |

`ai-model-gateway.calls` 只返回本工作区记录，支持 `?limit=`（默认 20，上限 100）。

## 2. 数据形状

**请求**（两概念相同）：`model` 必填（逻辑模型名）；`messages` 必填（数组 ≥1，`role ∈ {system,user,assistant,tool}`，`content` 非空串）；`maxTokens` 正整数（缺省取模型/全局上限较小值）；`temperature` ∈ [0,2]；`topP` ∈ (0,1]；`stop` 字符串数组 ≤4；`truncate` 布尔（默认 false）；`metadata` ≤16 键（只回显）；`idempotencyKey` ≤128 字节（或 `Idempotency-Key` 头，二者同时给出须一致）。

**成功响应**（complete，200）：`id`、`requestId`、`model`（实际使用）、`requestedModel`、`provider`、`content`、`finishReason`(`stop|length|tool_calls|content_filter|error`)、`usage{inputTokens,outputTokens,totalTokens,source}`、`attempts`、`fallback`、`requestedMaxTokens`、`effectiveMaxTokens`、`truncated`。

**流式事件**（stream，200）：帧 `event: <name>\ndata: <JSON>\n\n`；顺序 `start`→`delta`（≥0）→`usage`→`done`，出错时 `start`→`delta`→`error`。`start`=`{id,requestId,model,provider,providerModel}`；`delta`=`{text}`；`usage`=`{usage:{inputTokens,outputTokens,totalTokens,source}}`；`done`=`{id,finishReason}`；`error`=`{code,message,retryable}`。

**调用记录**（calls 的元素）：`id`、`requestId`、`workspaceId`、`requestedModel`、`usedModel`、`provider`、`status`(`succeeded|failed|cancelled|rejected`)、`errorCode`、`attempts`(整数)、`usage`、`latencyMs`、`clientIp`、`createdAt`，另可含每次尝试的错误码明细。

**错误体**（所有非 2xx）：`{"error":{"code":"model_not_found","message":"...","retryable":false,"requestId":"req_x"}}`；`message` 不得含凭据、上游原文、堆栈、SQL 片段。

## 3. 行为规则（MUST，每条可从外部观察）

- **R1 启动门禁**｜配置缺失/非法 → 进程非 0 退出、stderr `gateway_config_invalid: <原因>`、端口不监听；`TEST_MODE=1`+假 provider 免凭据。判据：退出码/stderr/端口。
- **R2 生产禁假**｜`MODEL_PROVIDER=fake` 且 `TEST_MODE≠1` → 拒绝启动。判据：退出码。
- **R3 运行期降级**｜运行期不可用（端点不可解析、必需项被清空等）→ health/complete/stream 均 503 `gateway_not_ready`，不得 500、不得挂起等上游超时。判据：状态码+code+快速返回。
- **R4 凭据不外泄**｜配置读接口只回掩码+指纹；凭据不得出现在响应/错误/记录/日志；持久化不得明文入库。判据：响应与只读 DB 查询无明文。
- **R5 配置写权限**｜改配置需管理员：非管理员 403 `forbidden`；schema 非法（类型错/越界/缺字段）422 `invalid_request` 且旧值仍生效；schema 合法但语义不可用（端点不可解析）可写入，网关转为未就绪；成功变更写审计；GET/PUT 读写同形。判据：状态码+旧值+审计+形态。
- **R6 枚举安全**｜未知模型与不可见模型同为 404 `model_not_found`，不用 403 暴露存在性。判据：两请求 code 相同。
- **R7 模型目录**｜models 只回可见模型，含 `name`/`maxInputTokens`/`maxOutputTokens`/`supportsStreaming`。判据：响应集合。
- **R8 不静默换模型**｜回退响应含 `fallback:true`+实际 `model`+`requestedModel`；改别名只影响新调用。判据：字段+改名前后对比。
- **R9 请求校验与零副作用**｜体非 JSON → 400 `invalid_json`；字段越界（见 §2）→ 422 `invalid_request`；被 400/413/422 拒绝的请求零上游调用、零记录、零记账。判据：状态码+code+记录与 usage 不变。
- **R10 请求体上限**｜字节数 > `maxRequestBytes` → 413 `request_too_large`，不调上游。判据：状态码+上游计数。
- **R11 max tokens 裁剪**｜下发上游 maxTokens = min(请求值, 模型上限, 全局上限)；响应给 `requestedMaxTokens`/`effectiveMaxTokens`。判据：响应+假模型收到的请求。
- **R12 上下文预算**｜估算输入+`effectiveMaxTokens` > 模型 `maxInputTokens` → 422 `context_length_exceeded`，不调上游；仅 `truncate:true` 才截断并回 `truncated:true`。判据：状态码+计数。
- **R14 流式形态**｜stream 返 200 + `Content-Type: text/event-stream; charset=utf-8`（等价类型须在 module-map 声明），帧 `event:`+`data:` JSON。判据：响应头+帧解析。
- **R15 事件顺序与终止**｜恰好一个终止事件（`done`/`error`）；`done` 前必有 `usage`；出错须发 `error` 并结束连接，不得静默断开。判据：事件序列。
- **R16 流/非流一致**｜同输入下流式 `usage` 与 complete 的 token 数、`source` 一致。判据：两次比对。
- **R17 并发流隔离**｜并发流字节不得交错；事件 id 属于本连接。判据：按连接核对 id。
- **R18 客户端中断**｜提前断开 → 停止产出、记 `status:"cancelled"`、不记账。判据：记录状态+usage 不变。
- **R19 usage 取值**｜上游报了 usage 用上报值（`reported`），没报才估算（`estimated`），估算不得标 reported。判据：source 与假模型 usage 一致。
- **R20 usage 口径**｜`totalTokens = inputTokens + outputTokens`；缓存/推理 token 只作额外字段，不重复计入。判据：恒等式。
- **R21 一调一记账**｜到达上游的逻辑调用最多 1 条 usage 记账：成功记上报值，上游全败记 0 并带 status，中间尝试只进明细；取消与被拒不记账。判据：usage 条数。
- **R22 调用记录**｜每次通过校验并进入生成阶段的调用（含失败/取消/被护栏拒绝）留一条不可改记录，字段见 §2；被 400/413/422 校验拒绝的不留记录。判据：字段齐备+两次读取一致。
- **R23 重试类别与次数**｜仅瞬时类（连接错/超时/上游 429/5xx）可重试；我方 4xx 与上游 400/401/403 不重试；尝试数（含首次）≤ `maxAttempts`。判据：上游计数+attempts。
- **R24 退避与超时**｜退避指数+抖动；单次 ≤ `attemptTimeoutMs`；整次 ≤ `requestTimeoutMs`（超时 503 `provider_unavailable`）。判据：耗时+尝试数。
- **R25 回退链**｜重试耗尽后按配置回退，深度 ≤ `fallbackDepth`；目标重裁 maxTokens；响应标 `fallback:true` 与实际模型；无回退 → 503 `provider_unavailable`。判据：响应+`usedModel`。
- **R26 回退不越权**｜回退目标须对调用方可见，否则按无可用回退处理。判据：`usedModel` ∈ 可见集。
- **R27 熔断**｜连续失败达 `circuitFailureThreshold` → 打开；期间 503 `provider_unavailable` 且不调上游；超时后一次半开探测，成功即关闭。判据：上游计数+状态码。
- **R28 统一错误体**｜非 2xx 体固定 `{"error":{code,message,retryable,requestId}}`，message 不含凭据/上游原文/堆栈；响应带 `X-Request-Id` 且与记录一致。判据：体结构+头。
- **R29 状态码唯一**｜§4 一一确定，同 code 不跨两个状态码；未认证 401、无权 403、跨租户读 404；账号被禁用或未验证时与凭据无效同为 401 `unauthenticated`，不泄露账号状态。判据：逐项比对错误表。
- **R30 幂等**｜同工作区+同键+同体 → 返回首次结果（同 `id`、同 `usage`、不重复调用/记账）并带 `Idempotent-Replay: true`；同键不同体 → 409 `idempotency_conflict`；作用域限工作区，跨租户同键不得命中本工作区结果；键只存 SHA-256 摘要，窗口 `idempotencyWindowSeconds`。判据：id/usage+上游计数+跨租户内容。
- **R31 并发护栏**｜同工作区在途上游调用 ≤ `maxConcurrentPerWorkspace`；超出 → 429 `rate_limited`+`Retry-After`，不排队、不记账、不调上游。判据：状态码+上游计数。
- **R32 429 两来源**｜护栏用 `rate_limited`，上游 429 耗尽用 `provider_rate_limited`（code 不同），透传上游 `Retry-After`；不自建第二套 rpm 限流，`rate-limiting` 拒绝原样透传。判据：code+头。
- **R33 预算**｜宿主声明 `usage-metering-and-budgets` 时调用前查预算；耗尽 → 402 `budget_exceeded`，不调上游、不记账。判据：状态码+上游计数。
- **R34 记录可见性**｜calls 只回本工作区记录；跨工作区读 → 404 `not_found`。判据：跨租户码+内容。
- **R35 并发状态隔离**｜并发调用不共享可变状态：attempts/usage/usedModel/status 互不串扰。判据：并发响应比对。
- **R36 clientIp**｜记录里的 clientIp 取 `X-Forwarded-For` 最右侧的第一个非受信代理跳，不得取最左端。判据：记录 IP；受信网段按 `trustedProxyCidrs` 声明。

## 4. 错误码 → 状态码（一一确定）

`invalid_json`→400；`missing_context`→400；`unauthenticated`→401；`forbidden`→403；`not_found`→404；`model_not_found`→404；`idempotency_conflict`→409；`request_too_large`→413；`invalid_request`→422；`context_length_exceeded`→422；`budget_exceeded`→402；`rate_limited`→429；`provider_rate_limited`→429；`provider_auth_failed`→502（上游 401/403）；`provider_rejected`→502（上游 4xx 除 408/429）；`provider_invalid_response`→502（上游响应不可解析）；`provider_unavailable`→503（超时/重试耗尽/熔断打开）；`gateway_not_ready`→503（运行期不可用）；`internal_error`→500。

## 5. 数值边界（宿主在 `params` 声明；未声明按"默认"）

| params 键（省略前缀 `ai-model-gateway.`） | 含义 / 允许范围 | 默认 |
|---|---|---|
| `maxRequestBytes` | 请求体字节上限 / 262144–4194304 | 1048576 |
| `maxOutputTokens` | 全局输出 token 上限 / 512–32768 | 4096 |
| `maxAttempts` | 最大尝试数 / 1–5 | 3 |
| `retryBaseDelayMs` | 退避基数 / 50–2000 | 200 |
| `attemptTimeoutMs` | 单次尝试超时 / 1000–120000 | 30000 |
| `requestTimeoutMs` | 整体超时预算 / 5000–300000 | 60000 |
| `fallbackDepth` | 回退链深度 / 0–3 | 1 |
| `circuitFailureThreshold` | 熔断失败阈值 / 2–10 | 3 |
| `circuitOpenMs` | 熔断打开时长 / 10000–300000 | 30000 |
| `maxConcurrentPerWorkspace` | 单工作区在途上限 / 1–64 | 8 |
| `idempotencyWindowSeconds` | 幂等窗口 / 3600–604800 | 86400 |
| `trustedProxyCidrs` | 受信代理网段 / 列表 | 空 |

模型自身能力由 `ai-model-gateway.models` 暴露，验收读它而不写死。

## 6. 存储要求（哈希 / 加密）

- **幂等键**：只存 SHA-256 摘要，不得存明文；命中比对用"键摘要+请求体摘要"，不做"重算旧摘要"式迁移。
- **上游凭据**：不得明文入库；持久化必须加密；只留指纹（SHA-256 前 16 位十六进制）用于检测轮换；读接口只回掩码+指纹。
- **不得明文出现**：凭据、幂等键、上游原文不得出现在响应体、错误体、记录、日志、trace。

## 7. 不变量

1. 一次逻辑调用 → 恰好 1 条调用记录（400/413/422 除外）；到达上游的调用 → 1 条 usage 记账（取消与被拒除外）。
2. `totalTokens = inputTokens + outputTokens`；`effectiveMaxTokens ≤ min(模型上限, 全局上限)`。
3. 记账与记录不可变；`requestId` 在响应头、记录、日志中一致。
4. 记录、幂等结果、可见模型都不跨租户。
5. 被拒请求（400/402/409/413/422/429）与 `gateway_not_ready` 零上游调用、零记账；`provider_unavailable` 表示已尝试上游（`attempts` ≥ 1），其记账 token 为 0。

## 8. 建议，验收不测

- 对话原文默认不落库；要落库须显式开关+保留期+可清理（配 `audit-and-data-export`）。
- 退避抖动算法、熔断半开探测细节。
- 指标 / trace 的采集实现与看板（属 `llm-observability-and-evals`、`observability`）。

## 9. 规则 → 验收用例追溯表

| 规则 | 用例 |
|---|---|
| R1 | A01 |
| R2 | A02 |
| R3 | A03 |
| R4 | A04 |
| R5 | A05 |
| R6 | A06 |
| R7 | A07 |
| R8 | A21 |
| R9 | A08 |
| R10 | A09 |
| R11 | A10 |
| R12 | A11 |
| R14 | A13 |
| R15 | A13, A14 |
| R16 | A15 |
| R17 | A16 |
| R18 | A17 |
| R19, R20 | A15 |
| R21, R24 | A19 |
| R22, R36 | A18 |
| R23 | A19, A20 |
| R25, R26 | A21 |
| R27 | A22 |
| R28 | A28 |
| R29 | A08, A09, A11, A12, A20, A26, A28 |
| R30 | A23, A24, A25 |
| R31 | A26 |
| R32 | A20, A26 |
| R33 | A29 |
| R34 | A27 |
| R35 | A30 |
