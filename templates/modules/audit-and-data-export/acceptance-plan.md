# 验收计划：audit-and-data-export

本文是**用例计划**，不是可执行脚本。脚本按 `contract.md` 的概念名到 `module-map.json` 取路径、按 `params` 取阈值；宿主约定见 `HOST.md`。

## 0. 执行前提

- 每条用例用**全新邮箱的全新账号 + 全新工作区**，不共享状态；账号与工作区经 auth / workspaces-and-permissions 公开接口创建。
- 令牌与邮件：读 `GET /api/__test__/outbox?to=<邮箱>` 的 `messages[]`，只认 `template` 为 `audit-and-data-export.export_ready` / `audit-and-data-export.deletion_confirm`；令牌在 `token`，链接在 `data.link`。
- 时钟：`POST /api/__test__/clock {advanceSeconds}`；推进后若会话失效，先用 auth 重新登录（时长取 `params` 值 + 60s）。
- 只读数据库：仅用 `DATABASE_URL` 做**只读**查询（查令牌是否摘要存储、明文外泄）。
- 头：`Idempotency-Key` 脚本自生成，`X-Forwarded-For` 显式写入；不要求 `Origin`。
- 数值全部读 `params`（链接 TTL、任务超时、最小间隔、体积上限、格式与类别、宽限期、确认 TTL、各类别保留期、可信代理网段、分页上限），未声明则用 `contract.md` §1 默认值。
- 概念或 `params` 缺失记"宿主未声明"（不判失败也不判通过）；已声明而行为不符才判失败。

## 1. 用例表

| id | given | action | expected | negative |
|---|---|---|---|---|
| AC-01 | E01 未登录 | GET `audit.list` | `401`；体 `{"error":{"code","message"}}`，`code="UNAUTHENTICATED"`；无条目内容 | 否 |
| AC-02 | W02 的非管理员成员 M02 已登录（成员经 workspaces 公开接口加入，需邮箱确认则按该模块契约用 outbox 邮件确认） | GET `audit.list` | `403` + `code="FORBIDDEN"`；无任何审计条目 | 是 |
| AC-03 | A03 属于 W03a，不属于 W03b | GET W03b 的 `export.status`；GET W03a 的 `export.status` 但带 W03b 的 jobId | 均 `404` + `code="NOT_FOUND"`；体不含 W03b 的任何标识 | 是 |
| AC-04 | W04 owner 已登录且审计有条目 | 对 `audit.list`/`audit.integrity` 发 `PUT`/`PATCH`/`DELETE`；GET 未声明路径 | 声明路径 `405` + `METHOD_NOT_ALLOWED`；未声明路径 `404` + `NOT_FOUND`；条目数量与内容不变 | 是 |
| AC-05 | E05 未登录 | 登录成功 → 错误密码登录 → 请求一次导出 → GET `audit.list` | 至少 1 条 `export.requested`（无条件）；宿主声明 `audit.record` 时还须有 `auth.login`/`auth.login_failed`；含 R-AUD-03 全字段；`sequence` 严格递增；`occurredAt` 为 ISO-8601 UTC；失败条目 `outcome="failure"` | 否 |
| AC-06 | E06 已注册，密码 `P06-Secret-9` | 错误密码登录一次 → GET `audit.list` | 失败条目及 `metadata` 不含 `P06-Secret-9`（含 base64/hex 编码）；原因为固定枚举 | 是 |
| AC-07 | E07 已登录 | 带 `X-Forwarded-For: 203.0.113.9, 198.51.100.7` 请求一次导出 → GET `audit.list` | 该条目 `ip`=`198.51.100.7`（最右侧），不等于 `203.0.113.9`（最左侧） | 是 |
| AC-08 | E08 与 W08，条目 ≥3 | GET `audit.list`；`?limit=201`；`?limit=0`；带 cursor 翻页；`?action=export.requested` | 越界 limit 均 `400`+`INVALID_REQUEST` 且 `details[].field="limit"`；默认条数 ≤ `params.auditPageMaxLimit`；cursor 拼接后 `sequence` 无重复无遗漏；`action` 过滤只返回该 action；条目 `workspaceId==W08` | 否 |
| AC-09 | E09 已登录，多条不同内容条目 | GET `audit.list` 比较 `digest`；GET `audit.integrity` | 每条有 `digest`（≥32 字符十六进制/base64）与 `prevDigest`（首条空或等于前一条）；内容不同 digest 不同；`valid=true` 且 `entries`=可见条目数；`digest` 不等于任何明文 | 否 |
| AC-10 | E10 与 W10 | POST `export.request` → 轮询 GET `export.status`（≤ `params.exportJobTimeoutSeconds`） | 首次 `202` + `{"jobId","status":"queued","workspaceId"}`；随后只能 `ready`（含 `readyAt`/`expiresAt`/`delivery="email"`）或 `failed`；体不含令牌明文或含令牌链接；`expiresAt-readyAt` ≈ `params.exportLinkTtlSeconds` | 否 |
| AC-11 | E11 与 W11 | 连续两次 POST `export.request`（不同或无幂等键） | 第二次 `409` + `EXPORT_ALREADY_RUNNING`；`export.list` 长度仍为 1 | 是 |
| AC-12 | E12 与 W12 | 两次 POST `export.request` 带相同 `Idempotency-Key` | 两次都 `202` 且 `jobId` 相同；`export.list` 长度 1；outbox 只有 1 封 `export_ready` | 否 |
| AC-13 | E13 与 W13，导出已 `ready` | GET outbox；只读 SQL 全库搜令牌明文（排除表名含 `outbox` 的表） | 邮件 `template="audit-and-data-export.export_ready"`，`token` 非空、`data.link` 含令牌；outbox 表外明文 0 命中；有列名含 `hash`/`digest` 的摘要列，长度 ≥32 且 ≠ 明文 | 是 |
| AC-14 | E14 与 W14，导出 `ready`，令牌 T14 | GET `export.download?token=T14` | `200`；头含 `Content-Disposition: attachment`（文件名不含邮箱）、`Content-Length`=实际字节数、`Cache-Control: no-store`、`Referrer-Policy: no-referrer`、`X-Export-Job-Id`=jobId；体含 `manifest`（`schemaVersion/generatedAt/workspaceId/categories/recordCounts/payloadSha256`）与 `payload`；`recordCounts`=各节 `records` 长度；`payloadSha256`=sha256(canonicalJson(`payload`))；`manifest.workspaceId==W14`；`identity` 记录数=W14 成员数 | 否 |
| AC-15 | 沿用 AC-14 已用过的 T14 | 再次 GET `export.download?token=T14` | `410` + `LINK_USED`；体不含业务数据 | 是 |
| AC-16 | E16 与 W16，导出 `ready`，令牌 T16 | 推进时钟 `params.exportLinkTtlSeconds+60`（会话失效则重登）→ 下载 → GET `export.status` | 下载 `410` + `LINK_EXPIRED`；任务 `status="expired"`；两处都不含业务数据 | 是 |
| AC-17 | U17 同时属于 W17a、W17b，两区数据与成员不同 | 在 W17a 请求导出并下载 | 产物不含 W17b 的标识（邮箱、记录 id、名称）；`manifest.workspaceId==W17a`；`identity` 记录数=W17a 成员数 | 是 |
| AC-18 | E18 与 W18，秘密：密码 `P18-Secret-9`、令牌 T18、会话 Cookie | 下载产物 → 逐字节搜索 | 产物不含 `P18-Secret-9`、T18、Cookie 值、任何密码哈希串；`exportFormats` 含 `csv` 时以 `=`/`+`/`-`/`@`/制表符/回车开头的值被 `'` 转义；`exportMaxBytes` 已声明且超限时任务 `failed`、`error.code="EXPORT_TOO_LARGE"` 且无可下载产物 | 是 |
| AC-19 | E19 与 W19，导出 `ready`，先取令牌 T19 | POST `export.cancel` → 下载 → 再次取消 | 取消 `200` 且 `status="cancelled"`；下载 `410` + `LINK_REVOKED`；再次取消 `409` + `EXPORT_NOT_CANCELLABLE` | 是 |
| AC-20 | E20 与 W20，已请求并下载过导出 | GET `audit.list?action=export.requested`；`?action=export.downloaded` | 各 1 条且 `targetId`=jobId；`metadata` 不含令牌明文；`outcome="success"` | 否 |
| AC-21 | E21 与 W21 | POST `deletion.request`（本人） | `202` + `{"requestId","status":"pending_confirmation"}`；outbox 有 `template="audit-and-data-export.deletion_confirm"`，`token` 非空、`data.link` 含令牌 | 否 |
| AC-22 | E22 与 W22，已建请求并从 outbox 取令牌 T22 | confirm(T22) → confirm(T22) → confirm(随机串) | 首次 `200`（`scheduled`）；第二次 `410` + `LINK_USED`；随机串 `404` + `LINK_INVALID`；体不含请求外信息 | 是 |
| AC-23 | E23 与 W23，已确认请求 | GET `deletion.status` | `status="scheduled"`；`executeAfter-confirmedAt`=`params.deletionGraceSeconds`（±1s）；`executeAfter` 在未来 | 否 |
| AC-24 | E24 与 W24 | A：确认后未到 `executeAfter` 时取消；B：推进时钟到 `executeAfter` 之后再取消 | A → `200` + `cancelled`；B → `409` + `DELETION_NOT_CANCELLABLE`；被取消的请求数据未删（成员列表仍含 E24） | 是 |
| AC-25 | U25 属于 W25 且有活跃会话；其请求已确认且已到期 | 推进时钟到 `executeAfter` 后（会话失效则重登）→ `deletion.run_due` → `deletion.status` → `audit.list` → 用 U25 原会话请求 → W25 成员列表 → U25 另一工作区成员列表 | `status="completed"` 且 `scopes` 每项 `completed|skipped|failed`（未实现为 `skipped`）；U25 原会话 `401`；W25 成员列表不含 U25；审计条目数不减、不含 U25 邮箱（应为假名）；有 `deletion.executed` 且 `metadata` 含 `requestId`/`subjectType`；U25 在另一工作区的成员关系仍在 | 是 |
| AC-26 | 沿用 AC-25 已 `completed` 的请求 | 再 `deletion.run_due`；统计 `deletion.executed` 条目 | 状态仍 `completed`；该条目仍只有 1 条 | 是 |
| AC-27 | E27 与 W27，已有 1 个未完成删除请求 | 再次 POST `deletion.request` | `409` + `DELETION_ALREADY_PENDING`；原请求状态未变 | 是 |
| AC-28 | owner 提交；E28a 正常、E28b 未验证、E28c 已禁用、E28d 不存在（禁用接口没有则跳过 E28c） | 分别 POST `deletion.request`（指定 `subjectEmail`） | 各例状态码同为 `202`、字段集合与结构完全一致；无 "not found" 类措辞，无区分存在性的字段 | 是 |
| AC-29 | E29 与 W29，请求已确认且到期 | `legal_hold.set`(on=true) → `deletion.run_due` → `deletion.status` → `legal_hold.set`(on=false) → 再 `deletion.run_due` → `deletion.status` → `retention.run_due` | 首次执行后 `status="blocked"`（非 `failed`），审计有 `deletion.blocked`；解除后 `completed`；被 hold 覆盖的对象在 `retention.run_due` 后仍存在（`export.status` ≠ `404`） | 是 |
| AC-30 | E30 与 W30，有一个 `ready` 的导出任务 | `retention.get` → 推进时钟 `params.retentionSecondsByCategory.export_artifact+60` → `retention.run_due` → `export.status` → `audit.list?action=retention.swept` | `retention.get` 含每个 `params.retentionCategories` 类别，各带 `retentionSeconds/legalHold/lastSweepAt/purgedCount`；`audit` 类 ≥15552000；清理后 `export.status` `404`+`NOT_FOUND`；有 `retention.swept` 且 `metadata` 含 `category` 与数量 | 否 |

## 2. 负向覆盖

隔离 AC-03/17/25；重放 AC-12/15/22；限流 AC-11/27；竞态 AC-26；枚举 AC-28；泄漏 AC-06/13/18；IP 伪造 AC-07；不可改 AC-04；生命周期 AC-16/19/24/29/30。
