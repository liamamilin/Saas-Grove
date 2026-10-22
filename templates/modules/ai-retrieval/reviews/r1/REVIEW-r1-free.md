阻断 0 | 应修 10 | 建议 6 | 追溯缺口 7 | 可用性 3/5 | 结论: 修后可用

# ai-retrieval 模块独立审查（r1）

审查对象：`module/MODULE.md`、`module/contract.md`、`module/acceptance-plan.md`、`module/decisions.md`；对照 `HOST.md`、`modules.json`。仅读，未修改其它文件。

## 0. 文件规模（篇幅 limits）

- `MODULE.md` 10399 B ≤ 15KB；`contract.md` 14988 B ≤ 17KB；`acceptance-plan.md` 10728 B ≤ 13KB；`decisions.md` 4799 B ≤ 7KB。均未超限。

## 1. 越界与引用核对

- `modules.json` 中模块名核对：MODULE.md §5 接口表引用的 `auth`、`workspaces-and-permissions`、`file-storage`、`async-jobs`、`ai-model-gateway`、`prompt-injection-and-guardrails`、`usage-metering-and-budgets`、`rate-limiting`、`audit-and-data-export`、`llm-observability-and-evals`、`feature-flags`、`notifications`、`observability`、`internationalization`、`analytics` 全部存在于 `modules.json`。未发现品牌/厂商名。

## 2. 自建 规则→用例 追溯表（摘要）

规则 44 条（R-01…R-44），用例 30 条（AC-01…AC-30）。契约末尾 §10 追溯表声称的覆盖与实际断言存在偏差，见问题 1。

无用例覆盖的 MUST 分支（追溯缺口）：
- R-29 / R-32 的 `no_context` 分支（有 ready 文档但零命中）：现有 AC-02/AC-03 仅覆盖空工作区 `empty_kb`。
- R-01 对 DEL/CHS/TOK/stats/LOG 等概念的 401。
- R-02 的正向显式工作区选择成功路径。
- R-21 的 `embeddingModel`/`embeddingDimension` 回显与一致性断言。
- R-37 的 SHA-256 等值校验（仅格式）。
- R-39 的幂等键明文入库数据库扫描。
- R-03 的响应头/计数泄露。

## 3. 问题清单

### 应修

1. [追溯] 追溯表虚报覆盖 — `contract.md` §10 表写 `R-21 AC-04、AC-05`、`R-37 AC-04、AC-13`、`R-39 AC-12`，但 `acceptance-plan.md` AC-04/AC-05 的 expected 未断言 `embeddingModel`/`embeddingDimension`；AC-13 未校验 `contentDigest`；AC-12 未做数据库明文键扫描。HOST.md §3b 要求"每条 MUST 必须有至少一个验收用例"，当前表与实际断言不一致。修法：把断言补进对应 AC，或把追溯表改为真实覆盖范围。

2. [追溯] `no_context` 分支无用例 — `contract.md` R-29/R-32 要求"有文档零命中 → `no_context`"，但 `acceptance-plan.md` AC-02/AC-03 均为"新账号 + 唯一空工作区"（`empty_kb`）。没有任何 AC 构造"ready 文档存在但查询无命中"。修法：新增 AC（或扩展 AC-02/AC-03）覆盖 `no_context` 的 Q/ANS 行为与"不调用生成模型"断言。

3. [可执行] ingest token 传输方式未定义 — `contract.md` §1 概念表有 `ai-retrieval.ingest_token`（TOK，POST → `{token,expiresAt}`），§4 HTTP 契约只描述 ING multipart，未说明 token 如何提交（header/body/query）。`acceptance-plan.md` AC-28"用它上传成功一次"无法执行。引 `contract.md` §1、§4 与 `acceptance-plan.md` AC-28。修法：在 ING 契约中明确 token 字段/头名与作用方式。

4. [可观察] R-01 未认证覆盖不全 — `contract.md` R-01 "未认证调用任一概念必须 401"，但 `acceptance-plan.md` AC-01 仅调用 ING、LIST、DOC、CHK、Q、ANS，未覆盖 DEL、CHS、TOK、stats、LOG。修法：AC-01 扩展到全部必需/可选概念，或拆分用例。

5. [安全] 文件名/路径穿越无 MUST — `MODULE.md` §4 列"文件名直接拼存储路径 → 路径穿越、覆盖他人文件"为事故，但 `contract.md` §6 MUST 无文件名校验/规范化要求，R-14 仅按字节。修法：新增 MUST（如文件名长度/字符集、服务端生成存储键、不得含路径分隔符）。

6. [安全] 服务端字节计数未规定 — `MODULE.md` §4 列"只信客户端 Content-Length"为事故，但 `contract.md` R-14 未规定 size 以实际接收字节为准、分块传输/Content-Length 缺失时的处理。修法：R-14 补充"按实际接收字节计数，客户端声明不可信"。

7. [一致] R-36 与 R-12 措辞冲突 — `contract.md` R-12 "同工作区重复上传同内容必须 409 `duplicate_content`"，R-36 又说"同工作区同内容其他文档……不受影响"，但同工作区不可能存在两份同内容文档（已被 R-12 拒绝）。引 `contract.md` R-12、R-36。修法：把 R-36 改为"同工作区的其他文档（不同内容）与他工作区同内容文档不受影响"。

8. [可执行] AC-18 竞态用例不可稳定复现 — `acceptance-plan.md` AC-18 要求"刚上传文档，DOC 显示仍为 pending/processing"立即 Q；未说明如何拖慢处理（如假模型延迟，HOST.md §3 支持 `PUT /api/__test__/fake-model` 延迟注入），快速宿主可能直接 ready，用例无法稳定执行。修法：AC-18 明确使用假模型延迟或大文件，并把"未观测到 pending 则记宿主未声明/跳过"写入执行约定。

9. [追溯] contentDigest 未校验 SHA-256 等值 — `contract.md` R-37 要求 "`contentDigest` 必须是原文 SHA-256（64 位小写十六进制）"，但 `acceptance-plan.md` AC-04 仅断言正则 `^[0-9a-f]{64}$`，未与上传字节的 SHA-256 比对。修法：AC-04 增加"contentDigest == SHA-256(上传字节)"断言。

10. [可观察] R-03 响应头/计数泄露未测 — `contract.md` §5 "不得在状态码、错误体、响应头、列表计数中透露……"，但 `acceptance-plan.md` AC-15 仅检查响应体不含 title/filename/size/contentDigest，未检查响应头（如 Content-Disposition/Location）与 LIST 计数。修法：AC-15 增加响应头与 LIST 计数断言。

### 建议

11. [缺口] 账号状态一致性未测 — `contract.md` §5 "任何账号状态（已验证、未验证、被禁用）下，同一情形返回同一 `code` 与形状"，但无 AC 变换账号状态。引 `contract.md` §5。修法：在 AC-01 或新增用例覆盖。

12. [缺口] 模型切换/重建未覆盖 — `decisions.md` D-12 建议"新模型上线即把旧文档标记为待重建……重建完成前不混检"，但 `contract.md` R-21 无 MUST/AC 验证模型变更后不混检。修法：把 D-12 的"不混检"提升为可测 MUST（如模型变更后旧文档不可被检索或标记 pending），并配 AC。

13. [一致] `offsetUnit` 与"字符数"单位歧义 — `contract.md` §3 允许 `offsetUnit ∈ {codepoint, utf16, byte}`，R-17/R-26/R-27 用"字符数/UTF-8 往返"混用字节与字符；在 `byte` 偏移下 `text.length == end − start` 的单位不明确。修法：明确 `text.length` 的计数单位随 `offsetUnit`，并在 AC-05/AC-06 断言单位一致性。

14. [缺口] 审计/计量信号未要求 — `MODULE.md` §2 L1 提及"计量信号（文档数、chunk 数、嵌入 token、检索次数）"与审计，但 `contract.md` §6 无对应 MUST/观测点。修法：若宿主声称计量/审计能力，补充条件 MUST 与 AC。

15. [文字/一致] R-44 措辞不当 — `contract.md` R-44"令牌明文只许出现在名字含 outbox 的表"，但摄入失败通知场景未必涉及令牌，表述与 HOST.md §3 "令牌明文只允许出现在名字含 outbox 的表"混用。修法：改为"本模块发出的令牌/链接明文仅通过 outbox 通道传递，不落库"。

16. [可执行] AC-10 构造条件脆弱 — `acceptance-plan.md` AC-10 要求"上传长度 ≥ 3 × `chunk.maxChars` 的文档"以保证 `chunkCount ≥ 3`，但按结构切分可能仍产生少于 3 个 chunk。修法：改为"轮询至 ready 后断言 `chunkCount ≥ 3`，若不足则跳过"或提供固定文本构造法。

## 4. 安全/领域正确性小结

对照业界常见错误，模板在 `MODULE.md` §4 已覆盖：全局内容哈希去重、先取 topK 再按工作区过滤、按 UTF-8 字节切分、纯英文模型嵌入中文、解析未完写入索引、引用用模型摘要、无上下文兜底生成、不可见资源 403、只删向量不删原文、换模型沿用旧向量、只信 Content-Length、文件名拼路径、全局幂等键、无上限 topK/上下文、同步解析大文件、检索无超时/连接池隔离、只做向量不做关键词、归一化不一致、失败文档直接删除。以上为认知层，未全部下沉为 MUST（见问题 5、6），建议在 contract 中补强文件名与字节计数两条。

## 5. 结论

阻断 0；应修 10 > 3，故不满足"通过"标准，结论"修后可用"。追溯缺口 7 条需在下一轮修订中补齐用例或修正追溯表。

阻断 0 | 应修 10 | 建议 6 | 追溯缺口 7 | 可用性 3/5 | 结论: 修后可用