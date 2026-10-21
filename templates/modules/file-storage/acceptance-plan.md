# file-storage 验收计划（黑盒用例）

本文只是**计划**；可执行脚本在此之后产出。每条用例只通过 HTTP、outbox、只读数据库观察（HOST.md §4）。

**通用前置**（每例各自新建，不共享状态）：① 用 `auth` 公开接口注册全新账号（唯一邮箱）；② 用 `workspaces-and-permissions` 公开接口建工作区 `WS` 并取得 `workspaceId`；③ 状态变更类请求统一带 `Origin: <APP_BASE_URL>`（`APP_BASE_URL` 来自 HOST.md §1），负例用 `Origin: https://evil.example`；④ 所有数值读宿主 `params`（contract §3），不写死；⑤ 时效用例用 `POST /api/__test__/clock {advanceSeconds}`；⑥ 只读查询限于 `file_storage_files`、`file_storage_tickets`（contract §9）；⑦ 路径按 `module-map.json` 解析（HOST.md §2），概念缺失记"宿主未声明"，不计失败。

**缩写**：`P` = 宿主 `params`；`上传` = `file-storage.upload.create`；`完成` = `file-storage.upload.complete`；`列表` = `file-storage.files.list`；`详情` = `file-storage.files.get`；`删除` = `file-storage.files.delete`；`取票` = `file-storage.download.create`。

| id | given | action | expected | 规则 | 负例 |
|---|---|---|---|---|---|
| C01 | 已认证、WS 成员且有 `files.upload` | 调 `上传`（普通文件名、合法类型、大小 = `P.maxFileSizeBytes` - 1024） | 201；含 `fileId/objectKey/uploadUrl/method/headers/uploadToken/expiresAt`；`expiresAt-now ≤ P.maxUploadUrlTtlSeconds`；`objectKey` 以 workspace 作用域开头 | R1, R6, R7, B1 | 否 |
| C02 | 同 C01 | 调 `上传`，`sizeBytes` = `P.maxFileSizeBytes` + 1；再调一次 `sizeBytes` = `P.maxFileSizeBytes` - 1024 | 第一次 413 `file_size_exceeded`，响应不含 `uploadUrl`（未产生对象）；第二次 201（上限下方留 1 KiB 余量必须被接受） | R3 | 是 |
| C03 | 同 C01 | 调 `上传`，`contentType=text/html`（不在 `P.allowedContentTypes`） | 415，`error.code=content_type_not_allowed` | R4 | 是 |
| C04 | 同 C01 | 调 `上传`，`filename="../../a/b.txt\r\nX-Injected: 1"` | 201；返回与记录中的文件名不含 `/`、`\`、`..`、CRLF、控制字符，长度 ≤ 255 | R5 | 是 |
| C05 | 全新账号但无会话 | 调 `上传` | 401（`unauthorized`）；不泄漏文件是否存在 | R2 | 是 |
| C06 | WS 成员，角色缺 `files.upload`（用 workspaces 接口建的最小权限成员） | 调 `上传` | 403，`error.code=permission_denied` | R2, R14 | 是 |
| C07 | 账号不是 `WS` 成员 | 调 `上传`（带 `WS` 的 `workspaceId`） | 404，`error.code=file_not_found`（不可见 ≠ 缺能力） | R2 | 是 |
| C08 | 本账号刚领到一张票据，拿到 `uploadUrl` 与 `expiresAt` | ① PUT 字节到原 `uploadUrl` → ② PUT 到改了 key 的地址 → ③ PUT 到改了签名的地址 → ④ 推进时钟越过 `expiresAt` 后再 PUT | ① 2xx；②③④ 均 403 | R7, B1, B2, B3 | 是 |
| C09 | 只领了票据、未 PUT 任何字节 | 调 `完成`（带 `uploadToken`） | 409，`error.code=upload_incomplete` | R9, B4 | 是 |
| C10 | 已领票据 | PUT `P.maxFileSizeBytes` + 1 字节 → 调 `完成` | 413，`error.code=file_size_exceeded`；记录不得变为 `ready` | R9, R3 | 是 |
| C11 | 已领票据，声明 `image/png` | PUT `<html><script>alert(1)</script>` 字节 → 调 `完成` | 415，`error.code=content_type_not_allowed`（按嗅探类型判定，不看声明） | R9, R4 | 是 |
| C12 | 已领票据，声明 `text/csv` | PUT 正常 CSV 字节 → 调 `完成` → 调 `详情` | 200，`status=ready`；`sizeBytes` = 实际字节数；`contentType` = 判定出的类型；`详情` 200 同值 | R9, R1, B4 | 否 |
| C13 | 刚成功 `完成` 过 | 用同一个 `uploadToken` 再调 `完成` | 401，`error.code=upload_token_invalid`；`详情` 仍 200 且 `status=ready`；记录仍只有一条 | R8, R10 | 是 |
| C14 | 刚领一张票据（未完成） | 并发两次 `完成`（同一 `uploadToken`） | 恰好一次 200、另一次 401；`详情` 只有一条 `ready` 记录 | R8, R10 | 是 |
| C15 | 刚领一张票据 | 推进时钟 > `P.maxUploadTokenTtlSeconds` → 调 `完成` | 401，`error.code=upload_token_invalid` | R8 | 是 |
| C16 | 刚领一张票据，未完成 | 推进时钟 > `P.pendingTtlSeconds` → 调 `详情` | 404（pending 过期按不存在处理） | R17 | 是 |
| C17 | 有一条 `ready` 记录 | 调 `取票` → GET 返回的 `url` | 200 且含 `url/expiresAt/filename/contentType/sizeBytes`；`expiresAt-now ≤ P.maxDownloadUrlTtlSeconds`；GET `url` → 200，字节与 `Content-Length` = `sizeBytes` 一致 | R11 | 否 |
| C18 | 刚取到下载 `url` 且已 GET 过一次 | 再次 GET 同一个 `url` | 401，`error.code=download_token_invalid` | R11 | 是 |
| C19 | 刚取到下载 `url`（未用过） | 推进时钟 > `P.maxDownloadUrlTtlSeconds` → GET 该 `url` | 401，`error.code=download_token_invalid` | R11 | 是 |
| C20 | 有一条 `text/csv` 的 `ready` 记录 | 取票并 GET `url`，检查响应头 | 必有 `X-Content-Type-Options: nosniff`；`Content-Disposition` 以 `attachment` 开头；`Content-Type` 不在危险类型集内；文件名被安全引用（无 CRLF / 引号注入） | R12 | 是 |
| C21 | 账号 A 在 `WS-A` 有 `ready` 文件；账号 B 在 `WS-B` | B 用 A 的 `fileId` 依次调 `详情`、`取票`、`删除` | 三者均 404，`error.code=file_not_found`（不区分不存在与无权限） | R13 | 是 |
| C22 | `WS-A` 有 2 个文件、`WS-B` 有 1 个 | B 调 `列表`（`workspaceId=WS-B`） | 只含 B 的 `fileId`；不含 A 的任何 `fileId` | R13, R18 | 是 |
| C23 | 有一条 `ready` 记录，且已取过下载 `url`（未用过） | 调 `删除` → 调 `详情` → 调 `列表` → GET 旧 `url` | 204；`详情` 404；`列表` 不含该 `fileId`；旧 `url` → 401 | R15, B4 | 是 |
| C24 | 全新 WS | 反复调 `上传` 占位，直到剩余额度 ≤ 1024（每次声明 ≤ `P.maxFileSizeBytes`）→ 再调 `上传` 声明 1025 | 409，`error.code=storage_quota_exceeded`（灌到只剩 1 KiB 余量时，再要 1 KiB+1 必须被拒） | R16 | 是 |
| C25 | 已认证 | 调 `上传`（缺 `sizeBytes`）→ 再调 `上传`（`filename` 为空串） | 两次均 400，`error.code=invalid_request`，响应体形如 `{"error":{"code","message"}}`；体中无堆栈、SQL、存储后端原文、密钥 | R19 | 是 |
| C26 | 已认证 | 调 `上传`（`Origin: https://evil.example`）→ 再调 `上传`（`Origin: <APP_BASE_URL>`） | 第一次 403，`error.code=origin_not_allowed`；第二次正常（201） | R20 | 是 |
| C27 | 已认证 | 带 `X-Forwarded-For: 203.0.113.9, 198.51.100.7` 调 `上传` → 只读查 `file_storage_files.created_by_ip` 与两张表的 `token_hash` | `created_by_ip` = 剥掉最右 `P.trustedProxyHops` 项后的最右一项（**不是**最左的 203.0.113.9）；`token_hash` = 上一步 `uploadToken` 的 SHA-256 十六进制；两张表全部文本列搜不到该 token 明文 | R21, R22 | 是 |
| C28 | 刚被拒的完成（按 C11 重做） | 读 `GET /api/__test__/outbox?to=<上传者邮箱>` | 存在 `template=file-storage.upload_failed` 的消息；`data.link` 是应用内绝对地址；消息 `token` 不含秘密 | R23 | 是 |
| C29 | 有一条 `ready` 记录 | 调 `列表`，`limit` = `P.maxListPageSize` + 1 → 再 `limit` = 合法值并翻页 | 第一次 400，`error.code=invalid_request`；第二次返回 `items` + `nextCursor`，翻页无重复无漏项，排序为 `createdAt` 倒序、同值按 `fileId` 升序 | R18 | 是 |
| C30 | 有一条 `pending` 记录 | 调 `取票` | 409，`error.code=file_not_ready` | R9 | 是 |

**已知条件依赖**：C06 需要 workspaces-and-permissions 能表达一个缺 `files.upload` 的最小权限角色；若宿主没有这种角色，记"宿主未声明"，不计失败。C24 需要 `P.maxWorkspaceBytes` 可在合理时间内灌满（契约默认 20 MiB，且只声明不真传字节）。C08 的第 ④ 步要求存储后端的地址有效期时钟跟随测试时钟（contract B3）。

**覆盖自检**：正例 C01/C02/C12/C17；负例 C02/C03/C04/C05/C06/C07/C08/C09/C10/C11/C13/C14/C15/C16/C18/C19/C20/C21/C22/C23/C24/C25/C26/C27/C28/C29/C30；隔离 C07/C21/C22；重放 C13/C14/C18/C19；限额 C02/C10/C24；竞态 C14。
