# email-transactional 验收计划（黑盒）

本文件只列**计划**：可执行测试在宿主实现后由验收脚本落地。规则见 `contract.md`，每个用例至少对应一条规则（追溯表在 contract.md 第 6 节）。

## 0. 前置与约定

- **启动与钩子**：见 HOST.md。验收只用 HTTP、`GET /api/__test__/outbox`、`POST /api/__test__/clock`、`DELETE /api/__test__/rate-limits`、以及数据库**只读**查询（仅用于 contract 的 G1、G3、J2 三项）。
- **路径**：全部来自 `module-map.json` 的概念映射（`email.send`、`email.status`、`email.unsubscribe`、`email.unsubscribe.confirm`、`email.preferences`、`email.feedback`、`email.test.provider`）。未声明的概念 → 记"宿主未声明"，不计失败也不计通过。
- **数值**：所有阈值（尝试次数、限流上限、TTL、保留天数、可信代理）都从 `params` 读取；`params` 缺失时用 contract 第 3 节的默认值/界限。**不得写死数值。**
- **账号与隔离**：每用例用唯一邮箱的新账号，经 `auth.signup` / `auth.login` 取会话 Cookie（未声明 `auth.*` 映射时，需要登录的用例记"宿主未声明"）。跨账号用例建账号 A、B。
- **收件地址**：每用例用唯一地址 `r-<用例号>@example.test`，避免互相污染；每例开始前 `DELETE /api/__test__/rate-limits`。
- **provider 假实现**：默认 `ok`；需要失败或退信时用 `email.test.provider` 设定（`mode`/`times`/`to`）。
- **令牌与链接**：只能从 `outbox` 钩子取——令牌在 `token` 字段，链接在 `data.link`，一键退订地址在 `data.listUnsubscribePost`。
- **时钟**：一律 `POST /api/__test__/clock {advanceSeconds}` 推进，不 sleep、不等真实时间。
- **negative 列**：yes = 预期被拒绝/报错/状态被拒；no = 预期成功（含"预期无副作用"）。

## 1. 用例表

| id | given | action | expected | neg |
|---|---|---|---|---|
| AC-01 | 已登录账号 A | `POST email.send`，体缺 `to` | 400 `invalid_request`，体为 `{"error":{"code","message"}}`；outbox 中该地址无新消息 | yes |
| AC-02 | 已登录账号 A | `POST email.send`，`to="not-an-email"` | 422 `invalid_recipient`；无新记录 | yes |
| AC-03 | 已登录账号 A | `POST email.send`，`template` 依次为 `"contact"`、`"email-transactional.nope"` | 分别 400 `invalid_template_name`、422 `unknown_template` | yes |
| AC-04 | 已登录账号 A | `POST email.send`，模板 `email-transactional.contact`，`data` 缺 `message` | 422 `missing_variables`；outbox 无新消息 | yes |
| AC-05 | 已登录账号 A | `POST email.send`，模板同上，`data` 多一个键 | 422 `unknown_variables`；outbox 无新消息 | yes |
| AC-06 | 已登录账号 A | `POST email.send`，模板 `email-transactional.contact`，`data={name,email,message}` | 202，体含 `id`、`status="queued"`、`template`、`to`、`category`、`createdAt`；outbox 新增 1 条，`template="email-transactional.contact"`，强制类别无 `token` | no |
| AC-07 | provider=ok，AC-06 的邮件已入队 | 轮询 `GET email.status?id=...`（≤50 次）或推进时钟 ≤60s | `status=sent`、`attempts≥1`、`sentAt` 非空、`lastError` 缺失；outbox 仍 1 条 | no |
| AC-08 | 账号 A、B | 不带会话 `POST email.send`；带 B 会话 `GET email.status?id=A的id`；`GET email.status?id=随机id` | 依次 401 `unauthorized`、404 `not_found`、404 `not_found`，且后两者响应体完全一致 | yes |
| AC-09 | 一封 `product_update` 已发出 | `GET email.status?id=...`，并与 outbox 中的令牌比对 | 响应 JSON 不含令牌明文，不含正文/变量内容 | no |
| AC-10 | provider=`transient_error`,`times=2` | 向地址 P 发一封邮件并推进时钟 | 最终 `status=sent`、`attempts=3` | no |
| AC-11 | provider=`transient_error`（不限次数） | 向地址 P 发一封邮件，按 `email_retry_backoff_seconds` 逐次推进时钟至耗尽 | `status=failed`；`attempts=email_max_attempts`（契约界限 2–10）；`lastError.code=transient_provider_error`；`sentAt` 为空 | yes |
| AC-12 | provider=`permanent_error` | 向地址 P 发一封邮件并推进时钟 | `status=failed`、`attempts=1`、`lastError.code=permanent_provider_error` | yes |
| AC-13 | 已登录账号 A | 同一 `Idempotency-Key`：同载荷发两次（再并发发两次），然后换 `to` 发一次 | 前两次同一 `id`、并发两次也同一 `id`，outbox 该地址仍 1 条；最后一次 409 `idempotency_conflict` | yes |
| AC-14 | provider=`hard_bounce`,`to=X` | 向 X 发一封，等 `status=bounced`；再向 X 发 `product_update` 与 `contact` | 原邮件 `status=bounced`；`product_update` → 422 `recipient_suppressed` 且 outbox 无新消息；`contact` → 202 | yes |
| AC-15 | provider=`complaint`,`to=Y` | 向 Y 发 `product_update` 与 `contact` | 两次都 422 `recipient_suppressed` | yes |
| AC-16 | provider=`soft_bounce`,`to=Z` | 向 Z 发 `product_update` | 202（未抑制）；该邮件 `status` 不是 `bounced` | no |
| AC-17 | 地址 W 已被 `hard_bounce` | 推进时钟：未声明 `email_suppression_ttl_seconds` 时推进 > 保留期+24h；声明时推进超过该 TTL | 向 W 发送：未声明 TTL → 仍 422 `recipient_suppressed`；声明 TTL → 恢复 202 | yes |
| AC-18 | 一封 `product_update` 已发到地址 P | 查 `outbox?to=P`，再做只读查库 | `token` 非空且 ≥32 字符；`data.link` 是含该令牌的绝对 URL；`data.listUnsubscribePost` 存在；`data` 中除链接外无令牌明文；库中（表名含 `outbox` 者除外）无明文令牌，有其 SHA-256 小写十六进制 | no |
| AC-19 | 一封未使用的 `product_update` 在地址 P | `GET` 其 `data.link` | 200；随后向 P 发 `product_update` 仍 202（订阅未变），该令牌仍可用 | no |
| AC-20 | 同 AC-19 | `POST data.listUnsubscribePost`；并发再 POST 同一 URL 两次；再 POST 一个随机令牌 | 首次生效（向 P 发 `product_update` → 422 `not_subscribed`）；并发两次与随机令牌都 400 `invalid_token` 且响应体一致（恰好一次消费）；再推进时钟 ≥25h，只读查库：该令牌的 SHA-256 摘要在任何表都查不到 | yes |
| AC-21 | P 已退订 `product` | 向 P 发 `product_update` 与 `contact` | 分别 422 `not_subscribed`、202（退订只影响被指定的类别） | yes |
| AC-22 | 已登录账号 A | `POST email.preferences`（带 `Origin=$APP_BASE_URL`），`{category: 强制类别, subscribed:false}` | 409 `category_protected`；随后 `GET email.preferences` 该类别 `subscribed` 仍为 true | yes |
| AC-23 | 一封未使用的 `product_update` | 推进时钟超过 `email_unsubscribe_token_ttl_seconds`+24h，再 POST 其一键退订地址，并只读查库 | 400 `invalid_token`；该令牌的 SHA-256 摘要在任何表都查不到（过期记录已清除） | yes |
| AC-24 | 已登录账号 A | `GET email.preferences`；再 `POST`（带 `Origin=$APP_BASE_URL`）`{category: product, subscribed:false}` | GET → 200，`categories` 含强制类别且 `subscribed=true`；POST → 200，随后 GET 显示 `product.subscribed=false` | no |
| AC-25 | 已登录账号 A | 用强制类模板向同一地址连发，直到超过 `email_rate_limit_per_recipient` | 第 (上限+1) 次 429 `rate_limited` 且带 `Retry-After≥1`（上限 ≤10，即 11 次内必现 429）；`DELETE /api/__test__/rate-limits` 或推进时钟过窗口后再发 → 202 | yes |
| AC-26 | 无需登录 | 对 `email.unsubscribe` 连续用随机令牌尝试 | 失败尝试达 `email_token_rate_limit_per_ip` 后返回 429 `rate_limited`（上限 ≤10，即 11 次内必现） | yes |
| AC-27 | `params.email_trusted_proxies` 含对端 | 先用 `X-Forwarded-For: 203.0.113.10, 203.0.113.20` 连续用随机令牌把令牌限流打满；再用 `203.0.113.10, 203.0.113.21` 用随机令牌请求一次 | 后者不是 429 而是 400 `invalid_token`（桶按最右非可信跳 203.0.113.20 划分，不能按最左的 203.0.113.10）。若可信代理不含对端：两次都应 429（该头被忽略） | yes |
| AC-28 | 已登录账号 A | `POST email.preferences` 不带 `Origin`；再带 `Origin=$APP_BASE_URL` | 依次 403 `origin_forbidden`、200 | yes |
| AC-29 | 无 | `POST email.feedback` 不带签名；再带 `type="unknown"` 的**合法签名**体 | 依次 401 `invalid_signature`、400 `invalid_request`（第二段需 `params.email_feedback_secret`，未声明则记"宿主未声明"） | yes |
| AC-30 | 一封邮件发到外部地址 W（W 未被抑制、未退订） | 推进时钟超过 `email_retention_days`+24h | `GET email.status?id=...` → 404 `not_found`；只读查库（排除表名含 `outbox`）不再出现地址 W | yes |

## 2. 参数驱动的分支

| 用例 | 读取的参数 | 分支 |
|---|---|---|
| AC-11 | `email_max_attempts`、`email_retry_backoff_seconds` | 按参数推进时钟；`attempts` 等于声明值 |
| AC-17 | `email_suppression_ttl_seconds`、`email_retention_days` | 声明了抑制 TTL → 按 TTL 推进并期望恢复；未声明 → 按保留期推进并期望仍被抑制 |
| AC-18 | — | 令牌长度 ≥32 与 SHA-256 摘要为固定判据 |
| AC-23 | `email_unsubscribe_token_ttl_seconds` | 按声明值推进时钟 |
| AC-25 | `email_rate_limit_per_recipient`、`email_rate_limit_window_seconds` | 上限与窗口均取声明值 |
| AC-26 | `email_token_rate_limit_per_ip` | 上限取声明值 |
| AC-27 | `email_trusted_proxies` | 声明值是否覆盖对端决定走"采信头部"还是"忽略头部"分支 |
| AC-30 | `email_retention_days` | 保留期取声明值 |

## 3. 尚未纳入用例的项

- 反馈接口的**有效签名**用例（AC-29 第二段）需要 `params.email_feedback_secret`；未声明则该段记"宿主未声明"，不判失败。
- 强制的原语（正文渲染、投递时延、日志内容）不可黑盒观察，按 contract 第 5 节处理，不设用例。
