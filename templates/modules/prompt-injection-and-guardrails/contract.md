# prompt-injection-and-guardrails · 黑盒契约

本文件只写外部可观察行为；启动、路径映射、参数、测试钩子、依赖顺序见 HOST.md。

## 1. 范围

负责三处：**进入模型的输入**（用户文本 + 文档/检索片段）、**模型输出**、**能变成动作的工具调用**，外加高风险内容的一次性审批。
不负责：模型调用、检索、身份与工作区权限、速率限制、审计留存、效果评测（归属见 MODULE.md 第 5 节）。

## 2. 概念（module-map 键）

| 概念 | 方法 | 语义 | 必需 |
|---|---|---|---|
| guardrails.inspect | POST | 检查进入模型的请求，返回决策/命中项/净化内容 | 是 |
| guardrails.output | POST | 检查模型输出，返回决策与净化输出 | 是 |
| guardrails.tool | POST | 工具调用的授权、限额与污染判定 | 是 |
| guardrails.challenge | POST | 兑换一次性审批令牌（配 decision=flag） | 是 |
| guardrails.policy | GET | 读取生效策略、限额、工具登记表 | 是 |
| guardrails.redact | POST | 只做 PII 掩码 | 否（PII 规则用 output 观察） |

必需概念缺失 = 宿主未声明（HOST §2）：相关规则记未覆盖，不判失败也不判通过。

## 3. 公共约定

3.1 认证：除 guardrails.policy 外都需有效会话（auth 签发）。凭据缺失/无效 → 401。
3.2 工作区：所有端点需要 `workspaceId`（policy 用 `?workspaceId=`）；调用方须是该工作区成员，否则 403。
3.3 所有 200 响应体含 `requestId`；同一请求内一致，不同请求不同。
3.4 错误体固定 `{"error":{"code","message","requestId"}}`。
3.5 `decision` 枚举：inspect/output 用 `allow` | `allow_redacted` | `flag` | `block`；guardrails.tool 用 `allow` | `deny`（见 R-27）。
3.6 `findings[].code` 枚举：`injection_direct` `injection_indirect` `role_confusion` `exfiltration_request` `encoding_evasion` `tool_argument_injection` `unsafe_tool_request` `system_prompt_leak` `credential_leak` `injection_echo` `pii`。
3.7 `findings[].severity` ∈ {low,medium,high}；`action` ∈ {strip,drop_document,mask,block,require_approval}；`location` ∈ {text,document,output,tool}。
3.8 实体类型枚举：`email` `phone` `credit_card` `national_id` `ip_address` `api_key`。
3.9 `guardrails.tool` 的 `reason` 枚举：`tool_not_allowed` `turn_blocked` `tainted_write_blocked` `tool_arguments_too_large` `tool_argument_injection` `tool_call_limit_exceeded`。
3.10 长度按 Unicode 码点。
3.11 宿主在 `module-map.json` 的 `params.guardrails.*` 声明实际值；未声明时按第 5 节契约界测。
3.12 验收除会话凭据外不需模块专用头；宿主要 `Origin`/CSRF 时，验收发 `Origin: <APP_BASE_URL>` 并复用登录取得的凭据。
3.13 最小可识别集合（MUST，验收按此判定；大小写不敏感，允许零宽字符）：
- 注入：`ignore|disregard|forget` + `all|any|previous|prior|above|earlier` + `instructions|rules|prompt`；`you are now (in )?(developer|god) mode`；`忽略(掉)?(以上|之前)的?(所有)?(指令|规则|提示)`。
- 提取：`print|reveal|show|repeat|output` + `(your |the )?(full |complete )?(system )?prompt|instructions`；`打印|输出|复述` + `(你的)?(系统)?(提示词|指令)`。
- 危险动作：`delete all records` `drop table` `rm -rf` `转账` `打款`。
- 凭据：`sk-[A-Za-z0-9]{20,}`、`-----BEGIN * PRIVATE KEY-----`、`(postgres|mysql|mongodb)://\S+:\S+@`。
- PII：email、`\+?\d[\d \-]{8,}\d` 电话、16 位卡号（可含空格或短横）、18 位身份证号。

3.14 默认处置矩阵（宿主可在 params 覆盖，须反映在 policy）：

| 命中 code | 位置 | 处置 | decision（其余内容保留时） |
|---|---|---|---|
| injection_direct / role_confusion | 用户文本 | 整句删除 | allow_redacted |
| exfiltration_request | 用户文本 | 整句删除 | flag |
| unsafe_tool_request | 任意 | 整条拒绝 | block |
| injection_indirect / system_prompt_leak | 文档 | 整份丢弃 | allow_redacted |
| system_prompt_leak / credential_leak / injection_echo | 输出 | 整条拒绝 | block |
| pii | 输出 | 掩码 | allow_redacted |
| pii | 用户文本 | 只报不改写（maskPiiInInput=true 时掩码） | allow |

一次请求的所有句子都被删除 → block。

3.15 请求字段：inspect 需 `workspaceId`、`text`，可选 `documents`（元素 {id?, text}，`id` 原样保留）、`turnId`；output 需 `workspaceId`、`text`；redact 需 `workspaceId`、`text`；tool 需 `workspaceId`、`turnId`、`toolName`、`arguments`（对象）；challenge 需 `workspaceId`、`token`；policy 用查询参数 `workspaceId`。未列出的字段一律忽略（R-18）；类型不符 → 400 `invalid_request`。

## 4. MUST 规则

### A. 身份与隔离
- **R-01** 凭据缺失/无效/过期 → 401 `unauthorized`（错误体按 3.4）。
- **R-02** 账号状态不可枚举：凭据无效或账号不存在/未验证/已禁用时，状态码、`error.code`、`message` 同形。
- **R-03** 非成员访问该 workspace，或 workspaceId 不存在 → 403 `forbidden`，两者响应完全一致。
- **R-04** 工作区隔离：A 的策略与审批令牌对 B 不可见；B 读 A 的 policy → 403。

### B. 输入检查 guardrails.inspect
- **R-05** 200 固定返回：`requestId` `decision` `findings[]` `entities[]` `sanitized{text,documents[{id,text}]}` `approval?` `policyVersion`。
- **R-06** `decision` ∈ 3.5。
- **R-07** `allow` ⇒ `sanitized.text` 与输入逐字相同，`sanitized.documents` 与输入文档逐字相同、顺序相同。
- **R-08** `allow_redacted` ⇒ `sanitized` 与输入不同，且残留文本非空（去空白后仍有字符）。
- **R-09** `block` ⇒ `sanitized.text==""` 且 `sanitized.documents==[]`。
- **R-10** 净化结果不得含被处置的原片段：strip 的句子、mask 的原值、被丢的文档都不出现。
- **R-11** 处置粒度=整句（按句末标点与换行切分）：只删敌意句，其余原样保留、顺序不变。
- **R-12** 文档命中注入类/提示泄漏类 → 整份从 `sanitized.documents` 移除，其余文档与顺序不变；输入带 `id` 时原样保留。
- **R-13** 归一化后再判定：零宽、全角/兼容字符、base64/hex 包裹的敌意文本必须被识别（`decision != allow`），命中时 `code=encoding_evasion`；只对 ≤ 4096 字符的片段试探解码，解码命中 3.13 才判定。
- **R-14** 必须识别 3.13 最小集合（大小写、零宽、全角变体同样命中）。
- **R-15** `flag` ⇒ `approval{id,token,expiresAt}` 必填；`token` 为 base64url 且长度 ≥ 22；`expiresAt` ≤ now + `approvalTtlSeconds`。
- **R-16** 超限 → 413 `payload_too_large`：总字符 > `maxTotalChars`、文档数 > `maxDocuments`、单文档 > `maxDocumentChars`；未超限不得被拒。
- **R-17** 同一账号/工作区/输入重复调用 → `decision` 与 findings（按 (code,location) 排序）相同。
- **R-18** 客户端的系统提示类字段（`system`/`systemPrompt`/`instructions`/`prompt`）被忽略：不出现在任何响应字段，也不改变 `decision`。
- **R-19** `findings[].code` ⊆ 3.6；severity/action/location ⊆ 3.7；location 指明来源，文档须带 `documentId`。

### C. 输出检查 guardrails.output
- **R-20** 200 固定返回：`requestId` `decision` `findings[]` `entities[]` `sanitizedText` `policyVersion`。
- **R-21** 输出含系统提示 canary（params 声明）⇒ `decision=block` 且 `sanitizedText==""`；任何响应体都不得含 canary 或系统提示正文。
- **R-22** 输出含 3.13 凭据形态 ⇒ `decision=block` 且 `sanitizedText==""`。
- **R-23** 输出复述敌意指令句 ⇒ `decision=block`。
- **R-24** 输出含 PII ⇒ `decision=allow_redacted`；`sanitizedText` 不含原值；`entities[].type` ⊆ 3.8，各 type 的 count ≥ 1，Σcount ≥ 输入中不同原值个数。

### D. PII
- **R-25** guardrails.redact 200 返回 `requestId` `redactedText` `entities[]`；未命中时 `redactedText` 与输入逐字相同；掩码规则同 R-24。
- **R-26** inspect 默认不改写输入 PII（只报 `pii`）；若 `params.guardrails.maskPiiInInput=true`，`sanitized.text` 必须已掩码且原值不出现。

### E. 工具 guardrails.tool
- **R-27** 200 返回 `requestId` `decision` ∈ {allow,deny} `reason`；拒绝是正常结果（200），不是错误。
- **R-28** 工具不在 policy 登记表内 ⇒ `deny` + `reason=tool_not_allowed`。
- **R-29** 同一 (workspaceId,turnId) 内第 `maxToolCallsPerTurn`+1 次调用 ⇒ `deny` + `reason=tool_call_limit_exceeded`；只对 `allow` 计数，`deny` 不消耗额度；并发时原子计数（恰好 N 次 allow）。
- **R-30** 工具参数字符总数 > `maxToolArgumentChars` ⇒ `deny` + `reason=tool_arguments_too_large`。
- **R-31** 工具参数的字符串值命中 3.13 的敌意模式 ⇒ `deny` + `reason=tool_argument_injection`。
- **R-32** 污染轮次（该 turn 的 inspect 携带过文档）调用 write 类工具 ⇒ `deny` + `reason=tainted_write_blocked`；read 类与未携带文档的轮次不受此限。
- **R-33** 该 turn 的 inspect 决策为 `block` ⇒ 该 turn 的任何工具调用 `deny` + `reason=turn_blocked`。
- **R-34** `turnId` 必填，缺失 → 400 `invalid_request`；turn 状态按 (workspaceId,turnId) 隔离。
- 判定优先级：`tool_not_allowed` > `turn_blocked` > `tainted_write_blocked` > `tool_arguments_too_large` > `tool_argument_injection` > `tool_call_limit_exceeded`，取第一个命中者。

### F. 审批 guardrails.challenge
- **R-35** 首次兑换有效令牌 → 200 `{requestId,decision:"allow",approvalId}`，令牌立即作废。
- **R-36** 再次兑换同一令牌 → 409 `approval_already_used`；过期令牌 → 410 `approval_expired`；未知或格式非法的令牌 → 401 `invalid_approval`；三种 `message` 都不得透露令牌是否存在或归属。
- **R-37** 并发兑换同一令牌 ⇒ 恰好一次 200，其余 409 `approval_already_used`。
- **R-38** 跨工作区兑换（B 的身份、workspaceId=B）→ 403 `forbidden`，且该次尝试不得消耗令牌（A 之后仍可兑换成功）。

### G. 存储与一致性
- **R-39** 不得明文持久化提示原文或 PII；只读扫描数据库（排除表名含 `outbox` 的表）不得命中本次请求的探测串。
- **R-40** 审批令牌只存摘要；数据库中不得出现令牌明文。
- **R-41** guardrails.policy 返回生效策略与限额且与 `params` 一致；响应不得含提示正文或示例 payload。
- **R-42** 同一情形在各端点返回相同状态码与 `error.code`（见第 6 节）；所有响应含 `requestId`。
- **R-43** 若宿主实现审批通知邮件：outbox `template` 须为 `prompt-injection-and-guardrails.approval_request`，令牌放 `token`，链接放 `data.link`。

## 5. 数值界（宿主在 params 声明实际值）

| params 键 | 含义 | 契约界 |
|---|---|---|
| guardrails.maxTotalChars | inspect 总字符 | ≤ 200000 |
| guardrails.maxDocuments | 文档数 | ≤ 50 |
| guardrails.maxDocumentChars | 单文档字符 | ≤ 100000 |
| guardrails.maxToolCallsPerTurn | 每 (workspace,turn) 工具调用上限 | 1..20 |
| guardrails.maxToolArgumentChars | 工具参数字符 | ≤ 20000 |
| guardrails.approvalTtlSeconds | 审批令牌有效期 | 60..900 |
| guardrails.systemPromptCanary | 系统提示里的唯一标记串 | 必填字符串 |
| guardrails.tools | 工具登记表 [{name,mode}]，mode ∈ {read,write} | 各一个 |
| guardrails.maskPiiInInput | 输入侧是否掩码 PII | 布尔，默认 false |
| guardrails.approvalNotificationTo | 审批通知收件人邮箱 | 可选 |

宿主实际值必须落在契约界内；`guardrails.policy` 返回值必须与 params 一致（R-41）。未声明时：上限按本表数值测，工具次数在 1..20 内探测；canary、tools、approvalNotificationTo 未声明则相关用例记未声明。

## 6. 状态码与错误码

| 情形 | 状态 | error.code |
|---|---|---|
| 检查成功 | 200 | — |
| 缺字段或类型错 | 400 | invalid_request |
| 未认证或会话无效 | 401 | unauthorized |
| 令牌未知或格式非法 | 401 | invalid_approval |
| 非成员或跨工作区 | 403 | forbidden |
| 令牌已使用 | 409 | approval_already_used |
| 令牌过期 | 410 | approval_expired |
| 超长/超量 | 413 | payload_too_large |
| 内部错误 | 500 | internal_error |

500 不得含堆栈、SQL、内部路径；401/403 不得含账号状态、工作区存在性、提示、规则正则。

## 7. 不变量（黑盒可观察）

- I-1 `block` ⇒ 净化结果为空；`allow` ⇒ 与输入逐字相同；净化结果永不含被处置的原片段。
- I-2 任何响应体都不含 canary；落库只有摘要、掩码与分类计数。
- I-3 审批令牌最多成功兑换一次，并发下恰好一次。
- I-4 输入变长时 `decision` 不得变宽松；A 的策略与令牌对 B 不可见。

## 8. 建议，验收不测

- 规则层之外加一层语义判定（LLM 分类）：更准但不确定、可被注入、贵；必须串在规则层之后且可解释。
- 规则库与模型的版本化、热更新与灰度（feature-flags）；攻击样本回归集与红队演练（llm-observability-and-evals）。
- 每段上下文带来源标签、跨轮记忆投毒防护、N-gram 与语义相似度阈值的调参（黑盒不可测耗时与相近度）。

## 9. 规则 → 验收用例追溯

R-01→C-01；R-02→C-01；R-03→C-02；R-04→C-03；R-05→C-04；R-06→C-04,C-05,C-06；R-07→C-04；
R-08→C-05；R-09→C-06；R-10→C-05,C-07；R-11→C-05；R-12→C-07；R-13→C-08；R-14→C-05,C-08；
R-15→C-09；R-16→C-14；R-17→C-04,C-15；R-18→C-16；R-19→C-04,C-05,C-07；R-20→C-17；
R-21→C-17；R-22→C-17；R-23→C-17；R-24→C-18；R-25→C-18；R-26→C-19；R-27→C-20,C-23；
R-28→C-20；R-29→C-21,C-22；R-30→C-23；R-31→C-23；R-32→C-24；R-33→C-25；R-34→C-26；
R-35→C-10；R-36→C-11,C-12；R-37→C-13；R-38→C-03；R-39→C-27；R-40→C-27；R-41→C-28；
R-42→C-01,C-26；R-43→C-29（条件）。
每条 MUST 至少一个用例，每个用例至少一条规则；C-29 条件执行（宿主未实现审批邮件则记未声明）。
