# 契约：audit-and-data-export

本文只写**从外部可观察**的行为。宿主与验收的通用约定（启动、路径映射、测试钩子、依赖顺序、只读数据库边界）见 `HOST.md`。

- `R-xxx-nn` 是 MUST（可观察、可判定）；末尾附追溯表。
- 数值给**上下界**，宿主在 `module-map.json` 的 `params` 声明实际值，未声明取本文默认；验收读 `params`，不写死数字。路径是建议名，宿主映射概念到真实路径，验收只读映射，缺映射记"宿主未声明"。
- 统一错误体 `{"error":{"code":"UPPER_SNAKE","message":"文本","details":[{"field":"x"}]}}`（`details` 可选）；除下载外响应 `Content-Type: application/json`。

## 1. 概念与权限

路径公共前缀 `/api/workspaces/{workspaceId}`（`export.download` 除外）。

```
audit.list GET audit/events audit.read
audit.record POST audit/events 服务内部
audit.integrity GET audit/integrity audit.read
export.request POST data-exports audit.export
export.list GET data-exports audit.export
export.status GET data-exports/{id} audit.export
export.cancel POST data-exports/{id}/cancel audit.export
export.download GET /api/data-exports/download?token={token} 无（令牌自证）
deletion.request POST data-deletion-requests audit.delete.request
deletion.status GET data-deletion-requests/{id} audit.delete.request
deletion.confirm POST data-deletion-requests/confirm 持有令牌者
deletion.cancel POST data-deletion-requests/{id}/cancel audit.delete.request
deletion.run_due POST data-deletion-requests/run-due audit.delete.execute
retention.get GET data-retention audit.read
retention.run_due POST data-retention/run-due audit.delete.execute
legal_hold.list GET data-legal-holds audit.legal_hold
legal_hold.set POST data-legal-holds audit.legal_hold
```

权限位由 workspaces-and-permissions 判定；默认仅 owner/admin 拥有全部五个。

`params`（宿主声明实际值，未声明取默认；括号内为契约允许范围）：

```
auditPageDefaultLimit=50 (1..200)
auditPageMaxLimit=200 (<=200)
exportLinkTtlSeconds=3600 (60..86400)
exportJobTimeoutSeconds=30 (5..300)
exportMinIntervalSeconds=60 (0..86400)
exportMaxBytes=52428800 (1024..1073741824)
exportFormats=["json"] (可含 csv)
exportCategories=["identity","workspace"]
deletionGraceSeconds=604800 (60..7776000)
deletionConfirmTtlSeconds=86400 (300..604800)
retentionCategories=["audit","export_artifact","deletion_request"]
trustedProxyCidrs=[]
retentionSecondsByCategory={"audit":34560000,"export_artifact":604800,"deletion_request":2592000}
  audit>=15552000<=220752000；export_artifact 3600..2592000；deletion_request >=2592000<=220752000
```

## 2. 通用规则

- **R-COM-01** 4xx/5xx 体为 `{"error":{"code","message"}}`；`code` 是大写下划线常量，同一语义恒定。
- **R-COM-02** 需登录的概念：无会话/失效 → `401`+`UNAUTHENTICATED`；已登录但缺权限位 → `403`+`FORBIDDEN`；非成员访问按 R-COM-03 走 `404`，不得用 `403` 暴露工作区是否存在。
- **R-COM-03** 非成员，或资源 id 属于其他工作区 → `404`+`NOT_FOUND`；`403` 只用于"成员但权限位不足"。
- **R-COM-04** 未知路径 → `404`+`NOT_FOUND`；已声明路径的非法方法 → `405`+`METHOD_NOT_ALLOWED`。
- **R-COM-05** 时间字段为 ISO-8601 UTC（`2026-01-02T03:04:05Z`）；时效用宿主统一时钟，`POST /api/__test__/clock {advanceSeconds}` 推进后行为随之改变。

## 3. 审计日志

条目字段见 R-AUD-03；`sequence` 整数、`occurredAt` ISO-8601 UTC、`outcome` ∈ `success|failure|denied`、`actorType` ∈ `user|service|system`、`metadata` JSON 对象、`digest`/`prevDigest` 十六进制或 base64 串。

- **R-AUD-01** 必须记录：本模块自身 export.requested、export.completed、export.failed、export.downloaded、export.cancelled、export.expired、deletion.requested、deletion.confirmed、deletion.cancelled、deletion.executed、deletion.blocked、retention.swept、legal_hold.applied、legal_hold.released；auth/workspaces 事件（宿主提供 `audit.record` 映射时必须写入，否则记"宿主未声明"）auth.login、auth.login_failed、auth.logout、auth.password_changed、auth.account_disabled、workspace.created、workspace.renamed、workspace.deleted、member.added、member.role_changed、member.removed。
- **R-AUD-02** 只追加：无修改/删除条目的接口；审计路径 `PUT`/`PATCH`/`DELETE` → `405`+`METHOD_NOT_ALLOWED`，条目集合与内容不变。
- **R-AUD-03** 每条目含 `id`、`sequence`、`occurredAt`、`action`、`outcome`、`actorType`、`actorId`、`actorLabel`、`workspaceId`、`targetType`、`targetId`、`ip`、`userAgent`、`metadata`、`digest`、`prevDigest`。
- **R-AUD-04** 同工作区 `sequence` 严格递增无重复；`limit` 上限 `params.auditPageMaxLimit`（≤200），超限或 ≤0 → `400`+`INVALID_REQUEST`（`details[].field="limit"`）；游标翻页无重复无遗漏。
- **R-AUD-05** 可组合过滤 `action`、`actorId`、`targetId`、`outcome`、`since`、`until`；结果只含调用者工作区条目。
- **R-AUD-06** 每条目含 `digest`（≥32 字符十六进制/base64）与 `prevDigest`（首条为空或等于前一条 digest）；内容不同则 digest 不同；`audit.integrity` 返回 `{"valid":true,"entries":N}`；digest 不等于任何明文值。
- **R-AUD-07** 条目与 `metadata` 不得含密码、令牌、Cookie、`Authorization`、卡号、原始请求体；失败登录条目不得含尝试的密码，也不得含两类令牌明文。
- **R-AUD-08** 有 `X-Forwarded-For` 时取**最右侧的非受信跳**：从右向左跳过落在 `params.trustedProxyCidrs` 内的地址，取第一个不在其中的地址；不得取最左侧；无该头用直连地址。
- **R-AUD-09** 失败与拒绝同样记录，`outcome` ∈ `success|failure|denied`；失败原因用固定枚举（如 `bad_credentials`），不得自由文本或拼入敏感值。
- **R-AUD-10** 审计类别保留期 ≥ 180 天（`params.retentionSecondsByCategory.audit`，默认 400 天），且须能从 `retention.get` 读到。

## 4. 导出

- **R-EXP-01** `export.request` → `202`，体 `{"jobId","status":"queued","workspaceId","requestedAt"}`；同工作区两次请求间隔 ≥ `params.exportMinIntervalSeconds` 且同时最多 1 个未完成任务，再次请求 → `409`+`EXPORT_ALREADY_RUNNING`。
- **R-EXP-02** 请求头 `Idempotency-Key`（客户端提供）**先于**闸门判定；同工作区+同 key 24 小时内重复 → 同一 `jobId` 与同一状态体，不产生第二个任务、不发第二封邮件。
- **R-EXP-03** `status` ∈ `queued|running|ready|failed|cancelled|expired`；`ready` 时给出 `readyAt`、`expiresAt`（= `readyAt` + `params.exportLinkTtlSeconds`）、`delivery:"email"`；**响应体不得含令牌明文或含令牌的链接**；非终态任务须在 `params.exportJobTimeoutSeconds` 内收敛为 `ready`/`failed`。
- **R-EXP-04** 下载令牌随机、熵 ≥128 bit；明文只允许出现在 outbox 邮件 `template="audit-and-data-export.export_ready"` 的 `token` 字段与同封邮件的 `data.link`；除表名含 `outbox` 的表外不得有明文（只存摘要，见 §6）。
- **R-EXP-05** 首次下载 `200`；同一令牌第二次 → `410`+`LINK_USED`。
- **R-EXP-06** 超过 `expiresAt` → `410`+`LINK_EXPIRED`；任务状态变 `expired`。
- **R-EXP-07** 产物每条记录都属于请求方工作区，`manifest.workspaceId`=请求方工作区；同一人属于两个工作区时不得含另一工作区的成员关系、记录或标识。
- **R-EXP-08** JSON 产物：`{"manifest":{"schemaVersion","generatedAt","workspaceId","categories","recordCounts","payloadSha256"},"payload":{...}}`；`payload` 按类别分节，每节 `{"category","records":[...]}`；`recordCounts` = 各节 `records` 长度。
- **R-EXP-09** `manifest.payloadSha256` = `payload` 的 canonicalJson（键递归按字典序、无多余空白、UTF-8）字节的 SHA-256 十六进制小写。
- **R-EXP-10** 产物不得含明文密码、密码哈希、会话令牌、API 密钥明文、导出令牌明文。
- **R-EXP-11** 下载响应头：`Content-Type`（声明格式对应类型）、`Content-Disposition: attachment`（文件名不含个人标识）、`Content-Length`=实际字节数、`Cache-Control: no-store`、`Referrer-Policy: no-referrer`、`X-Export-Job-Id`=任务 id。
- **R-EXP-12** `export.cancel` 取消 `queued|running|ready` → `cancelled`，该任务已发令牌立即失效（下载 `410`+`LINK_REVOKED`）；对终态任务取消 → `409`+`EXPORT_NOT_CANCELLABLE`。
- **R-EXP-13** 产物字节数 ≤ `params.exportMaxBytes`；超限 → 任务 `failed` 且 `error.code="EXPORT_TOO_LARGE"`，不留半成品。
- **R-EXP-14** export.requested/completed/failed/downloaded/cancelled/expired 必须写入审计。
- **R-EXP-15** 仅当 `params.exportFormats` 含 `csv` 时适用：单元格值以 `=`、`+`、`-`、`@`、制表符或回车开头时，导出值须以 `'` 前缀转义。

## 5. 删除请求

- **R-DEL-01** `deletion.request` → `202`，体 `{"requestId","status":"pending_confirmation","requestedAt"}`；须向目标账号邮箱发 outbox 邮件 `template="audit-and-data-export.deletion_confirm"`，令牌在 `token`、链接在 `data.link`。
- **R-DEL-02** `deletion.confirm` 携令牌 → `200`，体 `{"requestId","status":"scheduled","confirmedAt","executeAfter"}`，`executeAfter` = `confirmedAt` + `params.deletionGraceSeconds`（60s..90 天）。令牌单次使用：重复 → `410`+`LINK_USED`；未知 → `404`+`LINK_INVALID`；超 `params.deletionConfirmTtlSeconds` → `410`+`LINK_EXPIRED`。
- **R-DEL-03** `deletion.cancel` 在 `scheduled` 且未到 `executeAfter` → `200`、状态 `cancelled`；已过 `executeAfter`/已执行/已取消 → `409`+`DELETION_NOT_CANCELLABLE`；非本人 → `403`+`FORBIDDEN`。
- **R-DEL-04** `deletion.run_due`（`audit.delete.execute`）执行已过 `executeAfter` 的请求 → `completed`；重复执行 → 状态仍 `completed` 且 `action="deletion.executed"` 的审计条目**不新增第二条**。
- **R-DEL-05** `deletion.status` 须给出 `scopes:[{"scope","status":"completed|skipped|failed"}]`；宿主未实现的范围记 `skipped`，不影响整体成功；有任一 `failed` → 整体 `failed`（可重试），否则 → `completed`。
- **R-DEL-06** 执行后：目标用户原会话立即失效（原 Cookie 再请求 → `401`）；不再出现在成员列表；其他工作区的成员关系不受影响；审计条目保留（数量不减），其个人标识（邮箱等）不再出现，改为不可逆假名。
- **R-DEL-07** `legal_hold` 覆盖该请求或该工作区时执行被阻止 → `blocked`（不是 `failed`），审计记 `deletion.blocked`；解除后可再执行并成功。
- **R-DEL-08** 同工作区同时最多 1 个未完成删除请求（`pending_confirmation|scheduled`）；再次提交 → `409`+`DELETION_ALREADY_PENDING`。
- **R-DEL-09** 枚举安全：对"存在正常/未验证/已禁用/完全不存在"的账号提交删除请求，状态码（恒 `202`）、响应体字段集合与结构必须一致；响应不得出现 "not found" 等措辞。
- **R-DEL-10** deletion.requested/confirmed/cancelled/executed/blocked 必须写入审计，条目 `metadata` 含 `requestId` 与 `subjectType`。

## 6. 保留与摘要存储

- **R-RET-01** `retention.get` → `200`，`{"policies":[{"category","retentionSeconds","legalHold","lastSweepAt","purgedCount"}]}`；`params.retentionCategories` 每个类别都出现；`retentionSeconds` 取 `params.retentionSecondsByCategory` 同名键（缺失则不得 < 180 天）。
- **R-RET-02** `retention.run_due` 须删除超过保留期的对象，删除后外部不可再取：导出任务记录 → `export.status` `404`+`NOT_FOUND`；删除请求记录 → `deletion.status` `404`+`NOT_FOUND`；审计条目 → 不出现在 `audit.list`。
- **R-RET-03** 每次清理产生一条 `retention.swept` 审计条目，`metadata` 含 `category` 与删除数量。
- **R-RET-04** 被 `legal_hold` 覆盖的对象不得被清理，也不得被执行删除。

只读数据库查询是允许的观察手段（见 HOST.md），故存储形态可判定：**导出下载令牌**与**删除确认令牌**只存摘要（列名含 `hash` 或 `digest`，≥32 字符十六进制/base64），明文不得出现在表名含 `outbox` 的表以外的任何表/列；密码/哈希/会话令牌/API 密钥由 auth 持有，不得复制其明文到审计或导出。（`Idempotency-Key` 存摘要、审计链用带密钥 HMAC 属建议，验收不测。）

**不变量**：① 审计只增不改、只减于清理；② 产物/令牌/请求绑定唯一 `workspaceId`，跨工作区 `404`；③ 令牌明文只在 outbox；④ 导出令牌一次性；⑤ 删除在 `executeAfter` 前可取消、之后不可且执行幂等；⑥ 删除后被删个人标识检索不到；⑦ 同一时钟。

## 7. 建议，验收不测

审计链用带密钥的 HMAC 并把链头摘要锚定到外部只追加位置；事件类型注册表与 schema 向前兼容解析；产物压缩、分片、断点续传；删除编排的逐模块擦除清单与人工介入队列。

## 8. 规则 → 用例追溯表

用例编号见 `acceptance-plan.md`，每条规则恰好映射到下列用例。

R-COM-01→AC-01；R-COM-02→AC-01,AC-02；R-COM-03→AC-03；R-COM-04→AC-04；R-COM-05→AC-05；
R-AUD-01→AC-05；R-AUD-02→AC-04；R-AUD-03→AC-05；R-AUD-04→AC-08；R-AUD-05→AC-08；R-AUD-06→AC-09；R-AUD-07→AC-06,AC-13；R-AUD-08→AC-07；R-AUD-09→AC-05；R-AUD-10→AC-30；
R-EXP-01→AC-10,AC-11；R-EXP-02→AC-12；R-EXP-03→AC-10；R-EXP-04→AC-13；R-EXP-05→AC-15；R-EXP-06→AC-16；R-EXP-07→AC-17；R-EXP-08→AC-14；R-EXP-09→AC-14；R-EXP-10→AC-18；R-EXP-11→AC-14；R-EXP-12→AC-19；R-EXP-13→AC-18；R-EXP-14→AC-20；R-EXP-15→AC-18；
R-DEL-01→AC-21；R-DEL-02→AC-22,AC-23；R-DEL-03→AC-24；R-DEL-04→AC-25,AC-26；R-DEL-05→AC-25；R-DEL-06→AC-25；R-DEL-07→AC-29；R-DEL-08→AC-27；R-DEL-09→AC-28；R-DEL-10→AC-25；
R-RET-01→AC-30；R-RET-02→AC-30；R-RET-03→AC-30；R-RET-04→AC-29
