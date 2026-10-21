# ai-retrieval 验收计划（黑盒）

用例只观察 HTTP、Cookie、`outbox`、只读数据库查询；不读源码、不改数据库。路径一律取自 `module-map.json` 的概念映射（`contract.md` 第 1 节），宿主未声明的概念记「宿主未声明」，不判失败也不判通过。每条用例在 `contract.md` 第 10 节有对应规则。

## 执行约定

1. **夹具**：每条用例用全新账号（唯一邮箱）经 `auth` 的公开注册概念建账号，经 `workspaces-and-permissions` 的公开建工作区概念建**唯一**工作区，成员为 owner；不绕过接口。跨租户用例另建第二个账号与其工作区。
2. **参数**：所有数值阈值从 `module-map.json` 的 `params` 读取；未声明时按 `contract.md` 第 2 节界限的宽松端。文件大小留 1 KB 余量：可接受文件 = 声明上限 − 1 KB，超限文件 = 声明上限 + 1 KB。
3. **请求头**：需要幂等的用例由脚本自己写 `Idempotency-Key`（如 `idem-ac11-<uuid>`），不依赖服务端生成；用完不复用。
4. **时钟**：令牌过期用例用 `POST /api/__test__/clock {advanceSeconds}` 推进；其余时效随宿主时钟。
5. **假模型**：`MODEL_PROVIDER=fake` 时模型调用走 `PUT /api/__test__/fake-model`；假模型记录从 `ai-retrieval.fakeModelLog` 读取，未声明该概念时读 `GET /api/__test__/fake-model` 的 `records`/`requests`。
6. **通知邮件**：用 `GET /api/__test__/outbox?to=<email>` 读取，`template` 按 `<模块>.<名>` 命名，链接在 `data.link`。
7. **只读数据库**：用 `DATABASE_URL` 以只读连接扫描全部文本列，检查明文是否仍在（仅用于 `contract.md` R-34、R-39 声明的项）。
8. **negative 列**：是 = 该用例断言拒绝路径、错误码，或断言「不应发生的事」（无命中、无引用、无生成调用、越权不可见）；否 = 正向行为。
9. **条件用例**：宿主未声明对应能力时，该用例整体记「宿主未声明」，不判失败。

## 用例表

| id | given | action | expected | negative |
| --- | --- | --- | --- | --- |
| AC-01 | 未登录（无 Cookie、无 Bearer） | 依次调用 ING、LIST、DOC、CHK、Q、ANS（路径取自 module-map） | 每个都 401；body 形如 `{"error":{"code":"unauthorized","message":...,"details":{...}}}`；不得泄露资源是否存在 | 是 |
| AC-02 | 新账号 + 唯一空工作区（无任何文档） | POST Q `{"query":"我们的退款政策"}` | 200；`hits=[]`；`contextStatus="empty_kb"`；不得 5xx | 否 |
| AC-03 | 同 AC-02 的空工作区 | POST ANS `{"query":"我们的退款政策"}`；随后读假模型记录 | 200；`status ∈ {no_context, empty_kb, insufficient_context}`；`citations=[]` 且 `citationIds=[]`；假模型记录中**无**补全形态请求（请求体含 `messages` 数组或 `prompt` 字符串），只允许嵌入请求 | 是 |
| AC-04 | 新账号 + 唯一工作区 | 上传一份 ≤ 声明上限 − 1 KB 的 Markdown（含唯一标记 `MK-<随机>`）；记下返回的 documentId，轮询 DOC 至终态 | ING 201 且响应含 `id`、`state`、`contentDigest`；返回耗时 ≤ `ingest.acceptSeconds`；≤ `ingest.readyTimeoutSeconds` 内 `state="ready"`、`chunkCount ≥ 1`；`contentDigest` 匹配 `^[0-9a-f]{64}$` | 否 |
| AC-05 | AC-04 的文档已 ready | POST Q 查文档中的独特词；对每个命中调用 CHK 取回 chunk | 命中 `text` 与 CHK 返回 chunk 的对应区间**逐字相同**；`text.length == end − start`（按 `offsetUnit`）；`text` 无省略号、非摘要改写 | 是 |
| AC-06 | 同 AC-05 | 比对命中与 chunk 的偏移与归属 | 命中 `[start,end)` 落在该 chunk 的 `[chunk.start, chunk.end)` 内；命中 `documentId` 与 chunk 的 `documentId` 一致；DOC 与 CHS 声明的 `offsetUnit` 相同 | 是 |
| AC-07 | 文档已 ready | POST ANS 同一问题 | 若 `text` 非空则 `citationIds` 非空，且每个 id 存在于 `citations[].id`；每个 `citations[].id` 都出现在 `citationIds`；无悬空引用、无孤儿引用 | 是 |
| AC-08 | 同 AC-07 | 比对 ANS 的引用与本次 Q 的命中集合；再对每个 `citation.chunkId` 调 CHK | 每个 `citation.chunkId` ∈ 本次命中 chunkId 集合；CHK 取回的 chunk 对应区间文本与 `citation.text` 逐字相同；无未 ready 或他租户 chunk | 是 |
| AC-09 | 文档已 ready | 用同一 query 连续 POST Q 两次 | 两次的 `chunkId` 序列与 `score` 序列完全一致；若存在同分项，其 `chunkId` 升序 | 否 |
| AC-10 | 文档已 ready 且 `chunkCount ≥ 3`（上传长度 ≥ 3 × `chunk.maxChars` 的文档） | POST Q `{"query":...,"topK":3}` | 命中数 ≤ `min(3, query.maxTopK)`；未传 `topK` 时命中数 ≤ `query.defaultTopK`；本次返回的引用总字符数 ≤ `query.maxContextChars` | 是 |
| AC-11 | 新账号 + 唯一工作区 | 用固定 `Idempotency-Key` 上传同一内容两次 | 第一次 201；第二次 200 且 `documentId` 与第一次相同；LIST 中该工作区只有一份该内容 | 是 |
| AC-12 | 同 AC-11 的幂等键 | 改内容后再用同一 `Idempotency-Key` 上传 | 409，`error.code="idempotency_conflict"`；文档数不变；不得 5xx | 是 |
| AC-13 | 文档已 ready | 在**同一工作区**上传内容完全相同的文件（换新的幂等键） | 409，`error.code="duplicate_content"`；LIST 文档数不变；原文档仍可被检索 | 是 |
| AC-14 | 账号 B 的工作区 W2 | 在 W2 上传与 W1 完全相同的内容 | 201 成功；W2 的文档在 W2 查询中可命中；W1 的文档在 W2 查询中不出现，反之亦然；两边 `contentDigest` 相同但 `documentId` 不同 | 是 |
| AC-15 | A 工作区有文档 docA（记下 id、chunkId、title） | 以 B 账号调用 DOC(docA) 与 CHK(chunkA) | 均 404，`error.code="not_found"`，错误体合 `contract.md` 第 5 节形状；响应体不含 docA 的 title、filename、size、contentDigest | 是 |
| AC-16 | 同 AC-15 | 以 B 账号 POST Q 查 docA 的独特词；再 GET LIST | Q 的命中不含 docA 的 documentId/chunkId/text；LIST 不含 docA 条目，也不返回 A 的文档计数 | 是 |
| AC-17 | 账号 A 不属于工作区 W2 | 以 A 账号在 ING 与 Q 中显式指定目标工作区 W2（按声明的 `workspaceScope`：`body` 放 body 字段 `workspaceId`，`header` 放请求头 `X-Workspace-Id`） | 两者 404 `not_found`，不得 403（不得泄露 W2 存在）；若宿主支持受限角色成员，则该成员对自己可见的工作区做受限操作必须 403 `forbidden`（宿主未提供受限角色时该子断言记「宿主未声明」） | 是 |
| AC-18 | 新账号；刚上传文档，DOC 显示仍为 pending/processing | 立即 POST Q 查该文档的独特词 | 200；命中不含该文档的任何 chunk；不得 5xx；不得返回半截文本 | 是 |
| AC-19 | 新账号 | 上传无可提取文本的 PDF（页面只有图片、无文本层） | DOC 最终 `state="failed"`；`error.code ∈ {parse_failed, empty_content}`；`chunkCount=0`；Q 不命中它；不得 5xx；若宿主发失败通知邮件，outbox 中 `template="ai-retrieval.ingest_failed"` 且 `data.link` 非空 | 是 |
| AC-20 | 新账号 | 上传大小 = 声明 `ingest.maxBytes` + 1 KB 的文件 | 413，`error.code="payload_too_large"`；LIST 文档数不变；不得 5xx | 是 |
| AC-21 | 新账号 | 上传 `.bin`（未知 MIME）；再上传 0 字节文件 | 前者 415 `unsupported_media_type`；后者 400 `invalid_request` 且 `details.field` 指明字段；均不得 5xx | 是 |
| AC-22 | 新账号 + 已 ready 文档 | POST Q 依次用 `topK=0`、`topK=999`（> 声明 maxTopK）、`query=" "`（去空白后为空）、超长 `query`（> 声明 maxQueryChars） | 每次都 400 `invalid_request`，`details.field` 指明字段；不得 5xx | 是 |
| AC-23 | 文档已 ready 且可被检索 | DELETE 该文档 | 200 且 `deleted=true`；随后 DOC 404；Q 不再命中该文档的任何 chunk | 是 |
| AC-24 | AC-23 的文档已删除 | 只读数据库扫描全部文本列，检索原文唯一标记与 chunk 文本片段 | 该标记与片段在任何文本列出现次数为 0；只留非个人标识元数据 | 是 |
| AC-25 | AC-23 的文档已删除 | 再次 DELETE 同一 documentId | 404 `not_found`（不得 200、不得 5xx） | 是 |
| AC-26 | W1 与 W2 各有一份内容相同的文档 | 删除 W1 的文档 | W2 的同内容文档仍在 LIST 中且仍可被 W2 查询命中；W1 文档已 404 | 是 |
| AC-27 | 新账号 + 唯一工作区 | 同时发出两个内容相同、幂等键不同的 ING；再同时发出两个相同幂等键的 ING | 前者最终只有一个文档，另一个 409 `duplicate_content`；后者只产生一个文档，另一个 409 `idempotency_conflict`；LIST 不出现重复文档 | 是 |
| AC-28 | 宿主声明了 `ai-retrieval.ingest_token` | 创建令牌 → 用它上传成功一次 → 原样重放 → 用 `clock` 推进超过 `ingestToken.ttlSeconds` 后再用 → 在另一工作区使用该令牌 | 重放 410 `token_consumed`；过期 410 `token_expired`；跨工作区 404；每次都不产生第二个文档 | 是 |
| AC-29 | 新账号；上传中文 Markdown（包含「服务等级协议 99.9%」「退款政策」等，并含多字节字符边界） | 轮询至 ready，取 CHS/CHK；再 POST Q 用中文查询「退款 政策」，读假模型记录；再用仅空白不同的查询「退款  政策」POST Q | chunk `text` 非空、无 U+FFFD、UTF-8 往返无损、含「99.9%」未被截断；首 chunk `start=0`；相邻 chunk 区间相接无空洞、重叠逐字一致；单 chunk 字符数 ≤ `chunk.maxChars`；假模型记录中嵌入请求的输入含完整中文查询串（未截断）；两次查询的命中 chunkId 序列完全相同 | 是 |
| AC-30 | 宿主声明了假模型故障注入方式（`ingest.failureField`） | 用 `PUT /api/__test__/fake-model` 注入嵌入故障，再 POST Q 与 ANS | 两者 503 `dependency_unavailable`（`details.dependency` 指明）；不得返回部分命中或半截答案；不得 500 | 是 |

## 覆盖说明

- 硬负向覆盖：租户隔离（AC-14、AC-15、AC-16、AC-17）、重放与幂等（AC-11、AC-12、AC-25、AC-27、AC-28）、限额（AC-10、AC-20、AC-21、AC-22）、竞态（AC-27、AC-18）、越权与枚举（AC-01、AC-15、AC-17、AC-25）、数据清除（AC-24）、不捏造（AC-03、AC-07、AC-08）。
- 条件用例：AC-17（受限角色）、AC-19（失败通知邮件）、AC-28（一次性令牌）、AC-30（故障注入）。宿主未提供对应能力时记「宿主未声明」。
- 未测项见 `contract.md` 第 9 节（语义召回质量、分数绝对值、额外归一化、限流与额度透传等）。
