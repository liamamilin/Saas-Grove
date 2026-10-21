# file-storage 黑盒契约

R1–R23 是 MUST，每条至少一个验收用例（§10 追溯表）；B1–B4 是宿主须提供的后端行为。路径只是**概念名**，宿主在 `module-map.json` 映射（HOST.md §2）；数值只是**界限**，宿主在 `params` 声明（HOST.md §2b）；测试支撑与时钟见 HOST.md §3。观察边界：HTTP 响应与头、outbox、只读库查询（仅限 §9 的表与列）。

## 1 概念名（宿主必须映射）

| 概念 | 方法 |
|---|---|
| `file-storage.upload.create` | POST |
| `file-storage.upload.complete` | POST |
| `file-storage.files.list` | GET |
| `file-storage.files.get` | GET |
| `file-storage.files.delete` | DELETE |
| `file-storage.download.create` | POST |

路径由宿主自定（可用 `/api/files/...` 这类前缀），概念名才是约定。上传地址、下载地址由上面两个接口的响应给出，验收直接使用，无需额外映射。

## 2 通用约定

- 请求与响应 `Content-Type: application/json`（PUT 上传地址除外）；时间戳 UTC ISO-8601，`createdAt`、`expiresAt` 必返。
- 认证方式由 `auth` 决定（会话 Cookie 或 `Authorization` 头），本模块不新增。
- 租户 = workspace；`upload.create` 与 `files.list` 显式带 `workspaceId`，其余接口靠 `fileId` 定位归属。
- 能力名 `files.upload`/`files.read`/`files.delete` 由 `workspaces-and-permissions` 表达。
- **判定顺序**（同时违反多条时取此顺序的码）：`401 未认证 → 403 Origin → 404 不可见 → 403 缺能力 → 400 参数 → 413 大小 → 415 类型 → 409 配额 → 409 状态机`。
- **状态码表**（一个情形一个码，不得混用）：

| 码 | 场景 | `error.code` |
|---|---|---|
| 200 | 读 / 列表 / 签票 / 完成成功 | — |
| 201 | 签发上传票据 | — |
| 204 | 删除 | — |
| 400 | 参数缺失 / 非法 / 分页超限 | `invalid_request` |
| 401 | 未认证 | `unauthorized` |
| 401 | 上传令牌无效 / 过期 / 已用 | `upload_token_invalid` |
| 401 | 下载票据无效 / 过期 / 已用 | `download_token_invalid` |
| 403 | `Origin` 不在允许列表 | `origin_not_allowed` |
| 403 | 可见但缺能力 | `permission_denied` |
| 404 | 不存在 / 不可见（跨租户、已删、pending 过期） | `file_not_found` |
| 409 | 超出工作区配额 | `storage_quota_exceeded` |
| 409 | 记录非 ready（不可下载 / 完成） | `file_not_ready` |
| 409 | 字节未到就要求完成 | `upload_incomplete` |
| 413 | 声明或实际字节超上限 | `file_size_exceeded` |
| 415 | 声明或嗅探类型不被允许 | `content_type_not_allowed` |
| 500 | 未预期错误 | `internal_error` |

## 3 参数界限（宿主在 `params` 声明实际值）

| 参数 | 含义 | 界限 | 未声明时默认 |
|---|---|---|---|
| `maxFileSizeBytes` | 单文件字节上限 | 1 KiB – 100 MiB | 10485760 |
| `maxWorkspaceBytes` | 单 workspace 占用字节上限 | 1 MiB – 100 GiB | 20971520 |
| `maxUploadUrlTtlSeconds` | 上传地址有效期 | 60 – 3600 | 600 |
| `maxUploadTokenTtlSeconds` | 上传令牌 TTL | 60 – 3600 | 900 |
| `maxDownloadUrlTtlSeconds` | 下载票据 TTL | 5 – 300 | 60 |
| `pendingTtlSeconds` | pending 回收时间 | 300 – 86400 | 3600 |
| `maxListPageSize` | 列表单页上限 | 1 – 200 | 50 |
| `trustedProxyHops` | 前方可信代理跳数 | 0 – 5 | 1 |
| `allowedContentTypes` | 允许存储的 MIME 集合 | — | `image/png, image/jpeg, image/gif, image/webp, application/pdf, text/plain, text/csv, application/zip` |

内联白名单与危险类型为固定常量：白名单 `image/png, image/jpeg, image/gif, image/webp`；危险 `text/html, image/svg+xml, application/xhtml+xml, text/javascript, application/javascript, text/xml, application/xml`。

## 4 接口契约

### 4.1 `file-storage.upload.create`（POST）

请求体 `{"workspaceId":"ws_1","filename":"report.pdf","contentType":"application/pdf","sizeBytes":12345}`（`sizeBytes` 正整数）。

成功 **201**：

```json
{"fileId":"f_1","objectKey":"ws_1/9f2c/report.pdf","uploadUrl":"https://storage.example/put?sig=...","method":"PUT","headers":{"Content-Type":"application/pdf"},"uploadToken":"<一次性令牌>","expiresAt":"..."}
```

- 必须含上述全部字段；`method` 为 `PUT`；`headers` 给出客户端 PUT 要带的全部头；`expiresAt` 见 R7。成功即建 `pending` 记录并预占配额（R16）。
- 失败：400（`sizeBytes` 缺失或 ≤ 0、`contentType` 格式非法、`filename` 空）、401、403（Origin / 缺 `files.upload`）、404（workspace 不可见）、413、415、409（配额）。

### 4.2 `file-storage.upload.complete`（POST）

请求体 `{"fileId":"f_1","uploadToken":"<一次性令牌>"}`。

成功 **200**：`{"fileId":"f_1","status":"ready","filename":"report.pdf","contentType":"application/pdf","sizeBytes":12345,"createdAt":"..."}`

- `sizeBytes` = 存储中**实际**字节数；`contentType` = 完成校验确定的类型（优先嗅探，无法嗅探用声明类型）；见 R9。
- 失败：400（缺 `fileId` / `uploadToken`）、401（令牌无效 / 过期 / 已用）、404（`fileId` 不存在或不可见）、409（`upload_incomplete` 字节未到；记录已 `rejected` → `file_not_ready`）、413、415。

### 4.3 `file-storage.files.list`（GET）

查询：`workspaceId`（必填）、`limit`、`cursor`。

成功 **200**：`{"items":[{"fileId":"f_1","status":"ready","filename":"report.pdf","contentType":"application/pdf","sizeBytes":12345,"createdAt":"..."}],"nextCursor":"c_1"}`

- `items` 是该 workspace 的**全部非 deleted** 记录（含 `pending`、`rejected`），每条带 `status`；`limit` 默认 `params.maxListPageSize`（R18）。
- `nextCursor` 为不透明串，无下一页时为 `null`。
- 失败：400、401、403（缺 `files.read`）、404（workspace 不可见）。

### 4.4 `file-storage.files.get`（GET）

查询 `fileId`（必填）。成功 **200**：单条记录对象（同 `items` 元素结构）。
失败：400（缺 `fileId`）、401、403（缺 `files.read`）、404（不存在 / 不可见 / 已删 / pending 过期）。

### 4.5 `file-storage.files.delete`（DELETE）

查询 `fileId`（必填）。成功 **204**（无响应体）。失败：400、401、403（缺 `files.delete`）、404。
删除后：不可再 `get`、不出现在 `list`、已签发票据失效（R15）。

### 4.6 `file-storage.download.create`（POST）

请求体 `{"fileId":"f_1"}`。

成功 **200**：`{"url":"https://app.example/files/content?t=<一次性令牌>","expiresAt":"...","filename":"report.pdf","contentType":"application/pdf","sizeBytes":12345}`

- `expiresAt` 见 R11。
- 失败：400（缺 `fileId`）、401、403（缺 `files.read`）、404（不存在 / 不可见）、409（非 `ready` → `file_not_ready`）。

### 4.7 下载取字节（用 4.6 返回的 `url`，无需映射）

- 成功 **200**：响应体是文件字节；`Content-Length` = 记录的 `sizeBytes`；头规则见 R12。
- 失败：**401** `download_token_invalid`（令牌不存在 / 过期 / 已用 / 文件已删或非 `ready`）。
- 该地址**不要求登录态**（它就是一次性能力凭据），故须短命。

### 4.8 往上传地址 PUT（用 4.1 返回的 `uploadUrl`，无需映射）

- 有效地址 → **2xx**（200 或 201），后端保存字节与 `headers` 声明的 `Content-Type`；签名或 key 被改动、换了方法、地址已过期 → **403**（见 B1–B3）。

## 5 MUST 规则清单

每条给出外部可观察的判据；不可观察的建议见 §7。

| 编号 | 规则 | 可观察判据 |
|---|---|---|
| R1 | 上传票据签发：认证 + 可见性 + 能力 + 参数 + 限额全过才签发 | 201；响应含 `fileId/objectKey/uploadUrl/method/headers/uploadToken/expiresAt`；`expiresAt-now ≤ maxUploadUrlTtlSeconds` |
| R2 | 认证与租户前置：未认证 401；workspace 不可见 404；可见但缺能力 403 | 同一接口只改身份即得三种码 |
| R3 | 声明大小上限：超 `maxFileSizeBytes` → 413；`≤ 上限 - 1 KiB` 必须被接受 | 413 `file_size_exceeded`；边界正例 201 |
| R4 | 类型策略：不在允许集 → 415；缺字段或格式非法 → 400 | 415 `content_type_not_allowed` / 400 `invalid_request` |
| R5 | 文件名规范化：去 `/`、`\`、`..`、控制字符、CRLF；截断 255 | 响应与记录里的文件名不含上述字符，长度 ≤ 255 |
| R6 | 对象 key 服务端生成、不可猜、按 workspace 分区、客户端不可指定 | 同名两次上传 key 不同；key 以 workspace 作用域开头 |
| R7 | 上传地址有时限且不可篡改 | `expiresAt` 在界内；篡改 key / 签名 / 方法的 PUT → 403 |
| R8 | 上传令牌：高熵随机、一次性、有 TTL、只存哈希 | 二次使用 → 401 `upload_token_invalid`；库中只有哈希 |
| R9 | 完成校验：对象存在（否则 409）、实际字节 ≤ 上限（否则 413）、**以嗅探类型判定**是否被允许（否则 415，不看声明类型） | 三种失败码可复现；成功时 `sizeBytes` = 实际字节数 |
| R10 | 完成幂等与并发：同一令牌重复或并发用，恰好一次成功，失败方 401，记录数与状态不变 | 并发两次完成：一 200、一 401；`get` 仍一条 `ready` |
| R11 | 下载票据：一次性、有 TTL（≤ `maxDownloadUrlTtlSeconds`）、只存哈希；文件删除后立即失效 | 同址第二次 → 401；过期后 → 401；删除后 → 401 |
| R12 | 下载不可内联执行：必带 `nosniff`；非内联白名单类型必须 `attachment`；危险类型降级 `application/octet-stream`；文件名安全引用（无 CRLF / 引号） | 响应头逐项可查 |
| R13 | 跨租户隔离：他人 workspace 的 `fileId` 在 get / delete / download.create 一律 404；`list` 不含他人记录 | 三接口同一 404；两 workspace `list` 不交叠 |
| R14 | 能力检查：`upload.create`→`files.upload`；`files.list`/`files.get`/`download.create`→`files.read`；`files.delete`→`files.delete` | 缺能力 → 403 `permission_denied` |
| R15 | 删除语义：204；软删除（记录不可见）；已签发的下载票据立即失效 | 删除后 get → 404、list 不含、旧下载地址 → 401 |
| R16 | 工作区配额：占用 = pending 声明字节 + ready 实际字节（deleted / rejected 不占）；超限 → 409 | 灌到 `maxWorkspaceBytes - 1 KiB` 后再要 1 KiB+1 → 409 `storage_quota_exceeded` |
| R17 | pending 过期回收：超 `pendingTtlSeconds` 未完成按不存在处理 | 推进时钟后 `get` → 404 |
| R18 | 列表分页与稳定排序：`limit` 超上限 → 400；返回 `items` + `nextCursor`；`createdAt` 倒序 + `fileId` 升序 | 翻页无重复无漏项 |
| R19 | 错误形状与不泄漏：错误响应一律 `{"error":{"code":"...","message":"..."}}`；`code` 稳定；`message` 不含堆栈、SQL、后端原文、内部路径 | `code` 命中 §2；体中无栈帧 / 驱动名 / 密钥 |
| R20 | Origin 校验：状态变更接口（`upload.create` / `upload.complete` / `download.create` / `files.delete`）带 `Origin` 且不在允许列表 → 403 `origin_not_allowed`；不带 `Origin` 放行。验收脚本给状态变更请求带 `Origin: <APP_BASE_URL>`（HOST.md §1），负例带 `Origin: https://evil.example` | 恶意 Origin → 403；自身 origin → 正常 |
| R21 | 客户端 IP：剥掉 `X-Forwarded-For` 最右 `params.trustedProxyHops` 项后取最右一项；**绝不取最左**；无可用项用连接对端地址 | `created_by_ip` = 期望值 |
| R22 | 敏感数据只存哈希：`uploadToken`、`downloadToken` 库中只存 SHA-256 十六进制；明文不出现在响应（除签发那次）、列表项、表列 | 库中搜不到明文；`token_hash` = SHA-256 十六进制 |
| R23 | 失败通知：字节已落地但完成校验失败（413 / 415）时产出 outbox 消息，template = `file-storage.upload_failed`，链接放 `data.link`，`token` 不放秘密 | outbox 有该 template；`data.link` 是应用内绝对地址 |

B1 后端：接受 `PUT` 到 `uploadUrl`（带 `headers` 的 `Content-Type`），保存字节与类型，返回 2xx；客户端不得借此读取或列出对象，也不得写入别的 key。
B2 后端：被篡改的 key / 签名 / 方法 → 403；过期地址 → 403（时钟跟随 HOST.md §3 测试时钟）。
B3 后端：服务端凭据可读字节、读元信息（大小、类型）、删对象；上传地址有效期不超过 `params.maxUploadUrlTtlSeconds`。
B4 后端：验收不直接调用服务端凭据，无独立用例；C09、C12、C23 的结果依赖它。

## 6 不变量

- I1 每条记录至多一个可用上传令牌，重传前先作废旧令牌。
- I2 令牌用过或过期即不可再用。
- I3 `object_key` 全局唯一（同 workspace 同名文件也不同 key）。
- I4 `ready` 的 `size_bytes` = 实际字节数且 > 0。
- I5 `deleted` 记录不出现在 `list`，`get` 一律 404。
- I6 占用字节 = Σ(pending 声明值) + Σ(ready 实际值)；`rejected`/`deleted` 不计入。
- I7 下载票据只对 `ready` 签发；记录删除后即失效。
- I8 令牌明文不出现在任何表列、响应（除签发那次）、其他输出。
- I9 同一请求只返回一个状态码；`error.code` 与 §2 对应。

## 7 建议，验收不测

- 哈希算法选型与慢哈希；令牌换哈希方案时**双键并存**直到旧令牌自然过期——库里无明文，无法"重算"已存摘要。
- 存储后端 SDK 抽象、连接池、区域冗余、生命周期规则；大文件流式转发的内存与背压；服务端加密、CDN 缓存、对象版本与自动归档。
- 病毒扫描引擎、缩略图、文档解析；内容去重、内容寻址、分片续传；单请求耗时与吞吐（HOST.md §6 不测性能）；审计字段与保留期（属 audit-and-data-export）。

## 9 验收可只读查询的表与列

验收只做只读查询（HOST.md §4），仅限下列字段：

- `file_storage_files`：`workspace_id`、`status`、`filename`、`content_type`、`size_bytes`、`object_key`、`created_at`、`created_by_ip`、`deleted_at`
- `file_storage_tickets`：`file_id`、`purpose`（`upload`/`download`）、`token_hash`、`expires_at`、`used_at`、`created_at`

宿主可增列，不得改列名与含义。验收用途：确认令牌只存哈希（R22）与来源 IP 取值（R21）。

## 10 规则 → 验收用例追溯表

| 规则 | 用例 |
|---|---|
| R1 | C01, C12 |
| R2 | C05, C06, C07 |
| R3 | C02, C10 |
| R4 | C03, C11 |
| R5 | C04 |
| R6 | C01 |
| R7 | C01, C08 |
| R8 | C13, C14, C15 |
| R9 | C09, C10, C11, C12, C30 |
| R10 | C13, C14 |
| R11 | C17, C18, C19 |
| R12 | C20 |
| R13 | C21, C22 |
| R14 | C06 |
| R15 | C23 |
| R16 | C24 |
| R17 | C16 |
| R18 | C22, C29 |
| R19 | C25 |
| R20 | C26 |
| R21 | C27 |
| R22 | C27 |
| R23 | C28 |
| B1 | C01, C08 |
| B2 | C08 |
| B3 | C08 |
| B4 | 宿主内部能力，由 C09、C12、C23 覆盖 |
