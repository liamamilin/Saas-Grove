# ai-retrieval 模块契约（黑盒）

前置：`auth`、`workspaces-and-permissions` 已按各自契约通过（`../HOST.md` 第 5 节）。本契约只描述 HTTP 可观察行为与只读数据库观察；启动、路径映射、假模型用法见 `../HOST.md`，不重复。

## 1. 概念映射

宿主在 `module-map.json` 里把下列**概念键**映射到自己的方法与路径，验收只读映射；未声明的概念记「宿主未声明」，不判失败也不通过。路径中 `:documentId`、`:chunkId` 为占位符；规则表「概念」列用简称，`ALL`=全部必需概念。

| 概念键 | 简称 | 方法 | 必需 |
| --- | --- | --- | --- |
| `ai-retrieval.ingest` | ING | POST | 必需 |
| `ai-retrieval.documents` | LIST | GET | 必需 |
| `ai-retrieval.document.get` | DOC | GET | 必需 |
| `ai-retrieval.document.delete` | DEL | DELETE | 必需 |
| `ai-retrieval.chunks` | CHS | GET | 必需 |
| `ai-retrieval.chunk.get` | CHK | GET | 必需 |
| `ai-retrieval.query` | Q | POST | 必需 |
| `ai-retrieval.answer` | ANS | POST | 必需 |
| `ai-retrieval.ingest_token` | TOK | POST | 可选 |
| `ai-retrieval.stats` | — | GET | 可选 |
| `ai-retrieval.fakeModelLog` | LOG | GET | 可选（未声明时读 `GET /api/__test__/fake-model`） |

## 2. 参数（界限由契约给，实际值由宿主在 `params` 声明）

键名前缀统一为 `ai-retrieval.`；宿主未声明时按界限的**宽松端**当实际值测（如 `maxBytes` 按 10 MB）。

| 键 | 契约界限 | 含义 |
| --- | --- | --- |
| `ingest.maxBytes` | 1 KB ~ 10 MB | 字节上限 |
| `ingest.acceptSeconds` | 1 ~ 10 | 返回 201 时限 |
| `ingest.readyTimeoutSeconds` | 5 ~ 60 | 到终态时限 |
| `chunk.maxChars` | 200 ~ 4000 | chunk 字符上限 |
| `query.maxTopK` | 1 ~ 20 | topK 上限 |
| `query.defaultTopK` | 1 ~ 20 | 默认 topK |
| `query.maxQueryChars` | 16 ~ 2000 | 查询长度上限 |
| `query.maxContextChars` | 1000 ~ 20000 | 引用字符上限 |
| `ingestToken.ttlSeconds` | 60 ~ 3600 | 令牌 TTL |
| `ingest.fileField` | 默认 `file` | 文件字段名 |
| `workspaceScope` | 默认 `body` | 显式工作区放 body 还是请求头 |

假模型故障注入字段名未声明（`ingest.failureField`）时只做降级断言。

## 3. 数据模型

**Document**：`{id, workspaceId, title, filename, sizeBytes, contentDigest, state, chunkCount, embeddingModel, embeddingDimension, offsetUnit, error?:{code,message}}`。`state ∈ {pending, processing, ready, failed}`，单向不可回退；`error` 只在 `failed` 出现，`error.code ∈ {parse_failed, empty_content, embedding_failed}`。

**Chunk**：`{id, documentId, index, text, start, end}`。`start`/`end` 为**文档级**偏移，区间语义 `[start, end)`；`offsetUnit ∈ {codepoint, utf16, byte}`，必须在 Document 与 Chunk 响应中声明。

## 4. HTTP 契约

- **ING** POST multipart（字段名 `ingest.fileField`），可带 `title`、`metadata`、头 `Idempotency-Key`、`workspaceId`。首次 201；幂等重放 200（body 同首次、`id` 相同）。返回 Document。
- **LIST** GET → 200 `{"documents":[Document...]}`，只含当前工作区，无他租户计数。
- **DOC** GET → 200 Document；不可见 404。
- **DEL** DELETE → 200 `{"id","deleted":true,"deletedAt"}`；此后 DOC 404。
- **CHS** GET → 200 `{"documentId","offsetUnit","chunks":[Chunk...]}`（`index` 升序）；文档 `failed` 时空数组；不可见 404。
- **CHK** GET → 200 Chunk；不可见 404。
- **Q** POST `{"query","topK"?}` → 200 `{"query","normalizedQuery","contextStatus","hits":[{chunkId,documentId,title,score,start,end,text}],"embeddingModel","embeddingDimension","offsetUnit"}`；`contextStatus ∈ {ok,empty_kb,no_context}`：`empty_kb`=无 `ready` 文档，`no_context`=有文档零命中。命中必须带 `chunkId`、`documentId`、`start`、`end`、`text`（逐字原文）、`score`。
- **ANS** POST `{"query","topK"?}` → 200 `{"status","text","citationIds":[],"citations":[{id,chunkId,documentId,title,start,end,text}],"contextStatus"}`；`status ∈ {ok,no_context,empty_kb,insufficient_context,unsupported}`；`citationIds` 与 `citations[].id` 双向一致。
- **TOK** POST → 201 `{"token","expiresAt"}`，明文只此一次。

## 5. 状态码与错误体

错误体形状恒定：`{"error":{"code":"<kebab_case>","message":"<可读文本>","details":{...}}}`。`code` 稳定可机读、`message` 可变；每个 `code` 恒定对应一个状态码，同一情形永远同一 `code`。

| 状态码 | code | 情形 |
| --- | --- | --- |
| 400 | `invalid_request` | 缺字段、空文件、空查询、参数越界（`details.field` 指明） |
| 401 | `unauthorized` | 未认证或凭证无效 |
| 403 | `forbidden` | 工作区可见但权限不足 |
| 404 | `not_found` | 文档/chunk/工作区不存在**或不可见**（已删除、跨租户） |
| 409 | `duplicate_content` | 同工作区已有同内容文档 |
| 409 | `idempotency_conflict` | 同一幂等键配了不同请求体 |
| 410 | `token_consumed` / `token_expired` | 令牌已用过或已过期 |
| 413 | `payload_too_large` | 超过 `ingest.maxBytes` |
| 415 | `unsupported_media_type` | 不支持的 MIME/扩展名 |
| 503 | `dependency_unavailable` | 嵌入/生成依赖不可用（`details.dependency` 指明） |

不可见资源一律 404：不得用 403 区分「不存在」与「存在但无权」，不得在状态码、错误体、响应头、列表计数中透露标题、文件名、大小或存在性。任何账号状态（已验证、未验证、被禁用）下，同一情形返回同一 `code` 与形状。

## 6. MUST 规则

每条都可用 HTTP 或只读数据库观察。

**认证与租户**

| 规则 | 必须满足 | 概念 |
| --- | --- | --- |
| R-01 | 未认证调用任一概念必须 401，错误体合第 5 节形状 | ALL |
| R-02 | 资源必须归属唯一工作区；ING/Q/ANS 必须支持显式指定目标工作区（body `workspaceId` 或头 `X-Workspace-Id`，见 `workspaceScope`），不可见必须 404 | ING/Q/ANS |
| R-03 | 不可见资源（跨租户、已删除、工作区不可见）一律 404，响应体/头/计数不得泄露其存在 | DOC/CHK |
| R-04 | 工作区可见但权限不足必须 403；若全员可读写则记「宿主未声明」 | ING/Q |
| R-05 | Q/ANS 命中与 LIST 只含当前工作区内容，不得含他租户条目或计数 | Q/ANS/LIST |
| R-06 | 读他租户 document 或 chunk 必须 404 | DOC/CHK |
| R-07 | 去重与幂等作用域为「工作区」：同内容在不同工作区各自成功、互不可见 | ING |

**摄入与状态**

| 规则 | 必须满足 | 概念 |
| --- | --- | --- |
| R-08 | ING 成功必须 201，返回含 `id`、`state`、`contentDigest` 的 Document | ING |
| R-09 | 状态机 `pending → processing → ready \| failed` 单向；仅 `ready` 可被检索 | DOC |
| R-10 | `pending`/`processing` 文档的 chunk 不得出现在任何命中中（发布原子性） | Q |
| R-11 | `failed` 文档必须 `chunkCount=0`、`error.code ∈ {parse_failed, empty_content, embedding_failed}`、不可被检索 | DOC/Q |
| R-12 | 同工作区重复上传同内容必须 409 `duplicate_content` 且不新增文档（可给 `details.existingDocumentId`） | ING |
| R-13 | ING 必须在 `ingest.acceptSeconds` 内返回 201（解析异步）；≤ `ingest.maxBytes − 1 KB` 的文档必须被接受，并在 `ingest.readyTimeoutSeconds` 内 `ready` | ING/DOC |
| R-14 | 超过 `ingest.maxBytes` 的上传必须 413 且不产生文档 | ING/LIST |
| R-15 | 至少支持 `text/plain`、`text/markdown`、`application/pdf`；其余类型必须 415，不得 500 | ING |
| R-16 | 空文件、空 `query`、`topK` 或 `query` 长度越界必须 400，`details.field` 指明字段 | ING/Q |

**分块、嵌入与中文**

| 规则 | 必须满足 | 概念 |
| --- | --- | --- |
| R-17 | 每个 chunk 的 `text` 非空、UTF-8 往返无损、不含 U+FFFD；切分不得落在多字节字符中间 | CHS/CHK |
| R-18 | `ready` 文档 `chunkCount ≥ 1`；按 `index` 排序后首 chunk `start` 必须为 0，相邻 chunk 区间相接（后一 `start` ≤ 前一 `end`），无空洞 | CHS |
| R-19 | 相邻 chunk 重叠区域文本必须逐字一致；单 chunk 字符数不超过 `chunk.maxChars` | CHS |
| R-20 | `offsetUnit` 必须在 Document 与 Chunk 响应中声明且一致；偏移为文档级 | DOC/CHS |
| R-21 | Q/ANS 必须回显实际 `embeddingModel` 与 `embeddingDimension`，且与命中 chunk 所属文档一致（不得跨模型混检） | Q/ANS/DOC |
| R-22 | 非 ASCII 查询必须**完整**传入嵌入模型：假模型记录中有请求的输入含该查询串完整文本（不截断、无 U+FFFD、非空） | Q/ANS/LOG |
| R-23 | 查询首尾与连续空白必须归一化：仅空白不同的两个查询返回**完全相同**的命中序列 | Q |

**检索、引用与不捏造**

| 规则 | 必须满足 | 概念 |
| --- | --- | --- |
| R-24 | 命中数不超过 `min(topK, query.maxTopK)`；未传 `topK` 按 `query.defaultTopK` | Q/ANS |
| R-25 | 同一查询 + 同一知识库状态下，两次调用的命中序列（`chunkId`、`score`）完全一致；同分按 `chunkId` 升序 | Q |
| R-26 | 命中 `text` 必须逐字来自对应 chunk 原文，按 `offsetUnit` 计的 `text` 长度 == `end − start`；不得摘要、改写、截断 | Q/CHK |
| R-27 | 命中 `text` 必须落在 CHK 返回的 chunk 文本区间内，且 `[start, end)` 落在该 chunk 的 `[chunk.start, chunk.end)` 内 | Q/CHK/CHS |
| R-28 | 单次返回的引用总字符数不超过 `query.maxContextChars` | Q/ANS |
| R-29 | 零命中必须 200 + `hits=[]` + `contextStatus=no_context`；无 `ready` 文档必须 `contextStatus=empty_kb`；都不得 5xx | Q |
| R-30 | `text` 非空 ⟺ `citationIds` 非空；`citationIds` 与 `citations[].id` 双向一致（无悬空、无孤儿） | ANS |
| R-31 | ANS 每个 `citation` 必须来自本次命中集合、对应 chunk 真实存在且 `text` 逐字一致；不得引用未 `ready` 或他租户 chunk | ANS/CHK |
| R-32 | 无上下文时（`empty_kb` 或零命中）ANS 必须 `status ∈ {no_context, empty_kb, insufficient_context}`、`citations=[]`，且**不得发起生成模型调用**（假模型记录不得有补全形态请求：含 `messages` 数组或 `prompt` 字符串；嵌入调用允许） | ANS/LOG |

**删除与数据**

| 规则 | 必须满足 | 概念 |
| --- | --- | --- |
| R-33 | DEL 必须 200 且 `deleted=true`；随后 DOC 必须 404，Q 不得再命中该文档的 chunk | DEL/Q |
| R-34 | 删除后数据库不得再出现该文档原文与 chunk 文本（只读查询检索原文唯一标记 → 0 命中），只留非个人标识元数据 | DEL/只读 DB |
| R-35 | 对已删除文档再次 DEL 必须 404 | DEL |
| R-36 | 删除只影响目标文档；同工作区同内容其他文档、他工作区同内容文档不受影响 | DEL/LIST |
| R-37 | `contentDigest` 必须是 64 位小写十六进制（原文 SHA-256），不得以明文正文充当摘要 | DOC |

**幂等、并发、重放、稳定性**

| 规则 | 必须满足 | 概念 |
| --- | --- | --- |
| R-38 | 同一 `Idempotency-Key` + 同一请求体 → 返回首次 `documentId`、状态 200、文档数不增加；键作用域为「工作区+概念」 | ING |
| R-39 | 同一 `Idempotency-Key` + 不同请求体 → 409 `idempotency_conflict`；幂等键不得明文入库（只读查询检索明文键 → 0 命中） | ING/只读 DB |
| R-40 | 同工作区并发同内容上传、或同幂等键并发上传 → 最终只存在一个文档，另一个请求 409（`duplicate_content` 或 `idempotency_conflict`） | ING |
| R-41 | 若提供 TOK：单次使用（重放 410 `token_consumed`）、过期 410 `token_expired`、跨工作区使用 404；不提供续期或「重算摘要」路径 | TOK |
| R-42 | 嵌入/生成依赖故障时必须 503，且 **fail closed**：不得返回部分命中或半截答案 | Q/ANS |
| R-43 | 每个错误 `code` 恒定对应唯一状态码；错误体形状恒为第 5 节形状 | ALL |

**条件 MUST（宿主提供该能力时才生效）**

| 规则 | 必须满足 | 概念 |
| --- | --- | --- |
| R-44 | 若宿主发摄入失败通知邮件：outbox `template` 必须为 `ai-retrieval.ingest_failed`，链接放 `data.link`，令牌明文只许出现在名字含 `outbox` 的表 | 宿主 outbox |

## 7. 存储与哈希

- 文档内容摘要以哈希存储：`contentDigest` 为原文字节 SHA-256（64 位小写十六进制）；数据库不得有「明文正文充当摘要」的列。
- 幂等键以哈希形式存储，数据库不得出现客户端传入的幂等键明文。
- 一次性令牌只存哈希，明文只在创建响应出现一次；不提供续期、重算摘要或复活已用令牌的路径。
- 为引用复核，原文与 chunk 文本必须可被有读权限者取回；二者属个人数据，删除时清除（R-34）。向量、chunk id、模型 id 不必哈希。

## 8. 不变式

- INV-1 `state=ready` ⟺ 该文档 chunk 可被检索；INV-2 命中的 `documentId` 属当前工作区且其文档 `ready`。
- INV-3 `text.length == end − start`（按 `offsetUnit`）且等于所属 chunk 对应区间内容。
- INV-4 删除后 DOC 404、Q 不命中、只读 DB 无该文档正文。
- INV-5 同一查询在同一知识库状态下返回同一命中序列；INV-6 同工作区同内容、同幂等键各最多一个文档。

## 9. 建议，验收不测（不进入 MUST）

- 嵌入/重排模型选型调参、近义召回质量、分数绝对值（只需稳定可复现）。
- 中文简繁、拼音、全半角折叠等额外归一化（契约只要求空白归一化）。
- 哈希算法选型与密钥轮换；解析器选型与版面还原质量。
- 上游 `rate-limiting` 的 429、`usage-metering-and-budgets` 的额度拒绝应原样透传（不改写为 500）；阈值属别的模块，验收不测。
- 若本模块按客户端 IP 限流，IP 口径由宿主统一给出：取 `X-Forwarded-For` 中**最右侧的非受信跳**，不得取最左侧。
- 连接池隔离与索引预热。

## 10. 规则 → 用例追溯表

| 规则 用例 | 规则 用例 |
| --- | --- |
| R-01 AC-01 | R-23 AC-29 |
| R-02 AC-17 | R-24 AC-10 |
| R-03 AC-15、AC-17 | R-25 AC-09 |
| R-04 AC-17（条件） | R-26 AC-05 |
| R-05 AC-16 | R-27 AC-05、AC-06 |
| R-06 AC-15 | R-28 AC-10 |
| R-07 AC-14、AC-27 | R-29 AC-02、AC-03 |
| R-08 AC-04 | R-30 AC-07 |
| R-09 AC-04、AC-18 | R-31 AC-08 |
| R-10 AC-18 | R-32 AC-03 |
| R-11 AC-19 | R-33 AC-23 |
| R-12 AC-13 | R-34 AC-24 |
| R-13 AC-04 | R-35 AC-25 |
| R-14 AC-20 | R-36 AC-14、AC-26 |
| R-15 AC-04、AC-21 | R-37 AC-04、AC-13 |
| R-16 AC-21、AC-22 | R-38 AC-11 |
| R-17 AC-29 | R-39 AC-12 |
| R-18 AC-29 | R-40 AC-27 |
| R-19 AC-29 | R-41 AC-28（条件） |
| R-20 AC-06、AC-29 | R-42 AC-30（条件） |
| R-21 AC-04、AC-05 | R-43 AC-01、AC-12、AC-13、AC-21 |
| R-22 AC-29 | R-44 AC-19（条件） |
