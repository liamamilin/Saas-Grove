# llm-observability-and-evals — 认知模板

> 面向编码代理：本文说明"成熟版长什么样"，不含实现代码。可验收规则在 `contract.md`，用例在 `acceptance-plan.md`，人的取舍在 `decisions.md`。

## 一页必读（先读这一页）

**它是什么**：把每次模型调用变成可查询、可归因、可复盘的记录（trace / span）；把"要不要把 prompt 与回复存下来"变成一条受策略管辖的产品决策；用固定假模型的回归评测守住提示词与模型变更的质量；给出"每个功能花了多少钱"的账单视角。

**五条铁律**（违反是事故，不是风格问题）

1. **正文默认不落明文**：默认 `bodyMode=hash`（只留摘要）；切 `full` 也必须强制脱敏 email / api_key / JWT / 卡号 / 手机号 / SSN，内置脱敏项不可删。
2. **敏感数据只有两种合法形态**：不可逆摘要，或脱敏后的字符串。策略降到"不存正文"或"停用"时必须同时清掉历史正文——"关了但还在"就是隐私事故。
3. **一次模型调用 = 一条 span**：`spanId` 是幂等键，网关重试与评测重复上报都不得让成本翻倍。
4. **一次性令牌只能用一次**：重放令牌被重复或并发使用时必须恰好成功一次，且不再产生新的模型调用（否则它就是账单放大器）。
5. **跨租户一律 404**："未知 id"与"别人的 id"响应必须完全同形；错误体不得带堆栈、SQL 或对方 id。

**验收前必须知道**

- 宿主在 `module-map.json` 映射 18 个 `llm-observability-and-evals.*` 概念；未映射记"宿主未声明"，不算通过也不算失败。
- 数值只给界限，实际值由宿主在 `params` 声明，验收读 `params`（**禁止写死阈值**）。
- 允许的只读数据库检查只有三类：正文/令牌是否明文落库、幂等与保留期删除的行数。
- 时效用例要推进时钟（`/api/__test__/clock`），**推进时钟的用例排最后**；每条用例用全新账号与全新工作区。
- 限流用例前先 `DELETE /api/__test__/rate-limits`；假模型载荷键名由宿主文档给出，未声明时依赖"固定回复文本"的断言记"宿主未声明"。

## 1. 这个模块是什么

- **追踪面**：用户报"机器人答错了"，一分钟内要拿到那次请求的完整链路：提示词、模型、检索片段、是否被守卫拦、耗时、花了多少钱。做不到就是盲区。
- **政策面**：记多少、记什么、记多久是**产品决策**。默认全量落库原文是最常见的错误默认值——它把一次数据库泄露变成一次 PII 事故。
- **评测面**：提示词一改、模型一换，"感觉变好了"不算数。要有固定数据集 + 固定判据 + 固定假模型 + 基线对比，把"这次改动是不是回退"变成一条可判定的规则。
- **成本面**：老板问"哪个功能在烧钱"，答案必须来自同一批 span 的聚合，而不是另一套计数器——两套计数器必然对不上账。

边界：**记录模型调用、提供查询与归因、执行回归评测**。不路由模型、不做检索、不做守卫判定、不管预算拦截。

**关键字段**：`spanId`（幂等键）、`traceId`/`parentSpanId`、`feature`（成本归因标签）、`source`（`app`/`eval`/`replay`）、`model`、`status`/`errorCode`、`inputTokens`/`outputTokens`、`costMicros`（整数微美元，1 USD = 1,000,000）+`currency`、`latencyMs`、UTC 时间、`clientIp`、正文相关字段（`contentMode`/`contentStored`/`requestHash`/`responseHash`/`requestBody`/`responseBody`/`truncated`）。

## 2. 成熟版应该有什么

**MVP（能上线）**

1. 一条模型调用 = 一条 span（traceId、feature、model、tokens、耗时、状态、UTC 时间），`spanId` 幂等。
2. 工作区级日志策略：开关 + 正文模式（none / hash / redact / full）+ 保留天数；默认 hash。
3. 按 feature 的成本汇总：calls、tokens、`costMicros`，单价由宿主声明。
4. 回归评测闭环：数据集（输入 + 判据）→ 假模型跑 → 每 case 判定 → 整体通过率。

**v2（能查、能归因、能防事故）**

5. 策略分层：全局默认 + 按 feature 覆盖 + 强制脱敏清单（内置不可删、可加不可减）。
6. 采样按 trace 决定（0 全丢、1 全留），采样决定随 span 返回。
7. 保留期 + 降级即清除：过期数据删除；策略降级时历史正文同时清除。
8. 强制脱敏：full 模式下 email / api_key / JWT / 卡号 / 手机号 / SSN / 口令不出现在响应与库里。
9. 成本归因完整：`unattributed` 兜底、按天/模型分组、`Σ span 成本 == 汇总成本`（误差 0）。
10. 评测基线与回归对比：每次运行给出 delta 与 `regressedCaseIds`；基线在**运行开始时锁定**。
11. 评测运行进成本账：评测调用也产生 span、也进归因。
12. 一次性重放：用存下的 prompt 重跑一次，产出新 span（不覆盖原记录）。

**成熟（能治理、能被审计）**

13. 幂等去重：网关重试、批量补报只落一条；评测用确定性 spanId 防双记。
14. 元数据护栏：键数、键长、值长、总字节上限；控制字符拒绝或剥离（防日志注入）。
15. 请求体上限与正文截断：超限 413；正文超限截断并打 `truncated`，不静默丢字段。
16. 速率限制：摄入按账号/工作区维度限流，429 + `Retry-After`。
17. 错误体规范：`{"error":{"code","message"}}`，`code` 取自固定枚举，不回显内部结构。
18. 评测资产版本化与同生共死：可编辑可重跑；历史运行保留当时快照；随保留期清理。
19. 审计、导出与预算联动：变更可被 audit-and-data-export 取用；成本汇总供 usage-metering-and-budgets 告警；摄入延迟、丢弃率、限流命中数进 observability 指标。

## 3. 每项的正确行为

> 全部规则的编号与判定细节见 `contract.md`（R-xx 为 MUST）；这里只写"怎样才算对"。

**摄入与追踪**：缺字段/JSON 非法→400；值非法（负 token、未知枚举、非 UTC、非法 feature 名）→422；超体积→413；超限流→429+`Retry-After`。`spanId` 重复→200+`duplicate:true` 不新增，并发重复恰好一条；一次调用恰好一条 span。缺 `feature`→`unattributed`；`feature` 只允许小写字母数字与 `. _ -`（≤64），含空格/CR-LF 拒绝。

**日志策略与正文**：默认 `enabled=true`/`hash`/`sampleRate=1.0`/`retainDays=30`；四档 none/hash/redact/full = 不留正文/只留摘要/留脱敏后正文/留原文但仍脱敏。内置脱敏项任何档位生效且不可删。`hash`/`none` 下响应与库不得出现明文，摘要稳定。降到 `none` 或停用→立即清历史正文且不可逆。采样按 trace 决定且同 trace 一致。正文超长截断并标 `truncated=true`。超保留期的 span、评测集、运行结果都删。策略工作区级，需写权限否则 403。评测资产内容不随 `bodyMode` 变。

**查询与隔离**：按 feature/model/traceId/source/时间窗/evalRunId 过滤，`createdAt` 倒序 + `spanId` 次序稳定。`limit` 缺省 50、上界 200，超上界收敛并回显，≤0 或非整数→400。未知 id 与跨租户一律 404 且同形；错误体 `{"error":{"code","message}}`。`clientIp` 取 X-Forwarded-For **最右侧非受信跳**。

**成本归因**：每 span 整数 `costMicros`+`currency`，按声明单价 × token 算；同过滤下 `Σ span == 汇总`（误差 0）；`groupBy ∈ feature|model|day`，其他 422；无 feature 归 `unattributed`；评测 span 进汇总。

**回归评测**：每 case 有输入与 ≥1 判据；重复 caseId、超量 422；判据 ∈ equals|contains|not_contains|regex。启动→202+runId，超时内到终态。每 case 恰好一次模型调用并一条 eval span。同配置两次运行结果完全一致，不靠模型自评。全判据通过才算通过，`passRate ∈[0,1]`。设基线后新运行给 comparison（delta/regressedCaseIds/improvedCaseIds），基线在运行开始时锁定且只能引用同一数据集。模型出错→case error/passed=false，运行 succeeded 且 errorCount ≥ 1。删数据集→204，之后 404，历史运行仍可读。

**重放与一次性令牌**：准备→201 + 一次性令牌（TTL ≤300s，绑定一个 spanId 与工作区）；执行→原子消费，201 + 新 spanId + 恰好一次新调用；已用→409 replay_token_used，过期→410 replay_token_expired，无正文→409 replay_unavailable；跨租户→404；重放计入成本；令牌不明文落库。

## 4. 容易做错的地方（会出什么事故）

| 做错 | 事故 |
|---|---|
| 无条件把原文落库 | 一次注入或备份泄露 = 全租户 PII 泄露，通报与解约 |
| 把 `Authorization`、api key 塞进 span metadata | 泄露可用凭证，攻击者接管上游账号 |
| 关正文只改配置不清历史；内置脱敏可关 | 以为已删实际还在，删除请求无法闭环 |
| feature/metadata 不校验字符集、允许 CR/LF | 日志注入：伪造日志行、污染 SIEM |
| 成本用浮点美元累加；只在成功时记 span；重试各报一次 | 对账差钱；看不到失败率；真实成本翻倍 |
| 采样按 span 决定 | 同 trace 只剩一半，排障被"缺失 span"误导 |
| 重放令牌可重复/并发使用 | 刷模型、账单暴涨（成本放大攻击），难追责 |
| 重放不校验租户、覆盖原记录 | 跨租户泄露他人提示词；原始证据被改写 |
| 评测判据用"LLM 自评"且温度 > 0 | 同一版本两次结论不同，门禁误报漏报 |
| 基线取"最近一次通过"而非锁定；基线可引用别的数据集 | 回归被自我覆盖；对比数字无意义 |
| 只看整体通过率；评测不记 span；编辑数据集改写历史结果 | 不知哪个 case 退化；成本不进归因；结论不可复现 |
| 保留期只删主库、漏删索引与对象存储 | 删除请求表面成功、底层仍在，导出时旧数据复活 |
| 只从左到右取 X-Forwarded-For | 伪造来源 IP 绕过风控限流、污染审计 |
| 摄入端点不限流不限体积 | 被当免费日志写入服务，存储打满、功能不可用 |

## 5. 与其他模块的接口

| 模块 | 接口含义 |
|---|---|
| auth | 提供已认证身份；未认证 401 |
| workspaces-and-permissions | 工作区上下文、成员身份与权限判定；数据按工作区隔离，越权 403 |
| ai-model-gateway | 唯一模型调用出口：网关上报调用事件；评测经网关调模型 |
| ai-retrieval | 检索片段 id/数量作为 span 归因字段（不复制正文） |
| prompt-injection-and-guardrails | 拦截判定（verdict、规则 id）附加到 span；判定不在本模块做 |
| usage-metering-and-budgets | 统一 token/费用口径与预算判定；本模块只归因 |
| async-jobs | 评测运行、批量清理等长任务的投递与状态回传 |
| audit-and-data-export | 策略/评测资产变更的审计事件；导出与删除请求落地 |
| notifications | 评测失败、预算超限的通知事件来源（不发邮件） |
| observability | span 事件进入指标/日志/告警管线 |
| analytics | 成本与用量看板消费成本汇总 |
| rate-limiting | 摄入与查询端点限流（限流键含账号/工作区维度） |
| web-security | 受信代理网段与来源 IP 解析（X-Forwarded-For 信任边界） |
| llm-observability-and-evals | 本模块 |

## 6. 不做什么

不路由模型、不降级重试（ai-model-gateway）；不做注入检测与内容拦截（prompt-injection-and-guardrails）；不做检索与文档存储（ai-retrieval、file-storage）；不做预算硬拦截与出账（usage-metering-and-budgets、payments-billing）；不做登录与组织架构（auth、workspaces-and-permissions）；不做通用 APM 与告警编排（observability）；不做看板前端（analytics）；不发邮件通知（notifications）；不做人工标注平台、模型微调、实时流式 trace 推送；不替代 audit-and-data-export 的导出删除流程；不评价回答的语义好坏，只做确定性判据与成本/可靠性指标。
