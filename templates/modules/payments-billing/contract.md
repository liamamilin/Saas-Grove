# payments-billing 黑盒契约

只写从外部看得见、可被脚本判定的行为；理由与事故见 `MODULE.md`，启动与钩子见 `HOST.md`。

## 0. 约定

- **概念名**：`payments-billing.<能力>`（各节标题后），宿主在 `module-map.json` 映射真实路径；未映射记"宿主未声明"。
- **命名**：JSON 字段 `snake_case`（`error.code`/`error.message` 除外）。
- **数值参数**：契约给界限，宿主在 `params` 声明实际值，未声明按下限判定；"过期/超限"用例按读到的值推进时钟。

**0.1 params（下限…上限；键名以 `payments-billing.` 开头）**

`idempotency_ttl_seconds` 86400…604800｜`checkout_session_ttl_seconds` 900…86400｜`webhook_signature_tolerance_seconds` 300…3600｜`webhook_previous_secret_grace_seconds` 3600…2592000｜`max_webhook_bytes` 1024…1048576｜`dunning_token_ttl_seconds` 86400…2592000｜`dunning_grace_hours` 24…168｜`dunning_max_attempts` 1…8｜`dunning_token_max_attempts` 3…10｜`max_page_limit` 1…100｜

**0.2 状态码 → `error.code`（一情形一码；测试钩子另用 `previous_secret_unavailable`）**

400 invalid_request/invalid_token/token_used/invalid_signature/signature_expired；401 unauthenticated；403 billing_admin_required/origin_not_allowed；404 not_found/workspace_not_found/plan_not_found；405 method_not_allowed；409 idempotency_conflict/subscription_exists/subscription_not_resumable/invoice_not_retryable；410 session_expired/token_expired；413 payload_too_large；429 too_many_attempts（带 Retry-After）；500 internal_error

## 1. 通用规则

- **G-01** 非 2xx 体固定 `{error:{code,message}}`；`message` 不得含密钥、令牌、第三方报文、堆栈。
- **G-02** 缺或无效登录态 → 401 `unauthenticated`。
- **G-03** 跨租户的发票/订阅/结账会话 → 404 `not_found`，不得区分"不存在"与"属他人"；未知路径 404，已知路径错误方法 405 `method_not_allowed`。
- **G-04** 非计费管理员 → 403 `billing_admin_required`（角色名由 `workspaces-and-permissions` 定）。
- **G-05** 幂等头 `Idempotency-Key`（≤255 字符，超长 400 `invalid_request`）：同键同载荷首次 201、重放 200 且 id 相同不新建；异载荷 409 `idempotency_conflict`；保留 `idempotency_ttl_seconds` 后可重建。
- **G-06** 金额以 `_minor` 结尾、为整数（最小单位），币种三位大写 ISO 4217，无浮点金额；列表分页（`limit` 超 `max_page_limit` → 400 `invalid_request`，游标不重不漏）；时间为 RFC3339 UTC 字符串（信封内 Unix 秒）。
- **G-07** `plan`/`subscription`/`invoice`/权益判定的字段集是下文允许集的子集，不得多出字段。

## 2. 计划目录（`payments-billing.plan.list`，GET，公开免登录）

- **PL-01** 200 `{plans:[...]}`；计划字段集 ⊆ `{key,name,amount_minor,currency,interval,trial_days,features}`；`key` 全局唯一；`interval ∈ {month,year}`；`trial_days` 非负整数（0=无试用）；`features` 是权益 key 数组（可空，字段须在）。
- **PL-02** 目录只含在售计划；目录里没有的 `plan_key` 建会话 → 404 `plan_not_found`。

## 3. 结账（`payments-billing.checkout.session.create` POST；`payments-billing.checkout.session.get` GET）

请求体 `{plan_key,workspace_id}`（`success_url`/`cancel_url` 可选）。

- **CH-01** 201 `{session_id,url,status:"open",expires_at,plan_key,amount_minor,currency}`；`session_id` ≥128 位随机；`url` 指向支付方收银台；已有活跃订阅 → 409 `subscription_exists`。
- **CH-02** 金额只取自服务端目录：请求体的 `amount_minor`/`currency` 被忽略。
- **CH-03** 请求带 `Origin` 且其 host ≠ `APP_BASE_URL` 的 host → 403 `origin_not_allowed`，不建会话。脚本用显式请求头提供（PB-07）。
- **CH-04** 有效期 `checkout_session_ttl_seconds`；过期后 `GET session.get` → 410 `session_expired`；过期会话的完成事件不建对象。
- **CH-05** 会话一次性：并发两次完成事件只出现 1 张发票、1 次订阅激活、1 封邮件。

## 4. 订阅（`payments-billing.subscription.get` GET；`.cancel`、`.resume`、`.change_plan` POST）

- **SB-01** GET 200 `{subscription:{...}}`；无订阅 → 404 `not_found`。字段集 ⊆ `{id,status,plan_key,workspace_id,current_period_start,current_period_end,cancel_at_period_end,pending_plan_key}`。
- **SB-02** `status ∈ {pending,trialing,active,past_due,unpaid,canceled}`。
- **SB-03** `cancel` → 200 `cancel_at_period_end=true`，周期内 `status` 与权益不变；`resume` → 200 `cancel_at_period_end=false`，仅待取消时可调，`canceled` 时 409 `subscription_not_resumable`。
- **SB-04** `change_plan{plan_key}` → 200：`pending_plan_key`=新计划、生效时刻 = `current_period_end`；生效前 `plan_key` 不变，生效后切换且权益随之变；跨币种 400 `invalid_request`。
- **SB-05** 续期由新的 `invoice.paid` 驱动：`current_period_end` 顺延到事件 `period_end`，不得缩短。
- **SB-06** 试用结束且无成功付款 → `unpaid`、权益失效；随后 `invoice.paid` → `active`。

## 5. 发票（`payments-billing.invoice.list` GET；`payments-billing.invoice.get` GET）

- **IV-01** list 200 `{items:[...],next_cursor}`，只含本租户发票，按创建时间倒序；`limit` 超 `max_page_limit` → 400 `invalid_request`；发票号唯一、递增、不复用。
- **IV-02** get 200 `{invoice:{...}}`；不存在或属他租户 → 404 `not_found`。
- **IV-03** `total_minor == Σ line_items[].amount_minor`，均为整数；行项字段集 ⊆ `{description,quantity,amount_minor}`；`status ∈ {draft,open,paid,void}`，`paid` 时 `paid_at` 非空。
- **IV-04** 已付发票不可变（行项、金额、周期不得改），重复 `invoice.paid` 也不改变它。
- **IV-05** 同一订阅同一周期最多一张发票（`open` 与 `paid` 合计）。
- **IV-06** 发票字段集 ⊆ `{id,number,status,total_minor,currency,period_start,period_end,due_at,paid_at,voided_at,line_items,workspace_id}`；不得含第三方链接、内部 id、长期凭证。

## 6. 权益（`payments-billing.entitlement.check` GET，参数 `feature`、`workspace_id`）

- **EN-01** 恒 200 `{entitled,feature,reason,plan_key,valid_until}`；无订阅不返回 403/404；`reason ∈ {granted,no_subscription,not_in_plan,trial_expired,subscription_canceled,past_due,subscription_expired}`。
- **EN-02** `entitled=true` 当且仅当：有该工作区订阅，`status ∈ {trialing,active}` 或 `past_due` 且仍在宽限期内，且 `feature` ∈ 生效计划的 `features`；结果与请求者身份无关。
- **EN-03** 取消后到周期末仍 true；周期末 false（`subscription_canceled`）；试用结束未付 false（`trial_expired`）；宽限期满 false（`past_due`）；不在计划内 false（`not_in_plan`）；无订阅 false（`no_subscription`）。

## 7. 催收（`payments-billing.dunning.update_payment_method` POST；`payments-billing.dunning.retry` POST）

- **DN-01** `invoice.payment_failed` → 订阅 `past_due`，向账号邮箱发 `template=payments-billing.payment_failed`（令牌在 `token`、链接在 `data.link`，其 host = `APP_BASE_URL` 的 host 且含同一令牌）；重复投递不重复发信（WH-03）。
- **DN-02** 自动重试上限 `dunning_max_attempts`；同一发票该模板邮件 ≤ 上限 + 1；宽限期后不再新增。
- **DN-03** 宽限期 `dunning_grace_hours` 小时自失败起算：期内 `past_due` 且权益保留；期满 `unpaid`、权益撤销，发 `payments-billing.subscription_canceled`。
- **DN-04** 令牌 ≥128 位随机，只从请求体读取（在 URL 查询串里 → 400 `invalid_token`），TTL `dunning_token_ttl_seconds`，绑定一个工作区。体 `{token,payment_method_ref}`：成功 200 `{updated:true}`；再用 400 `token_used`；未用且过期 410 `token_expired`；无效 400 `invalid_token`。
- **DN-05** 同一令牌失败尝试达 `dunning_token_max_attempts` → 429 `too_many_attempts`，带 `Retry-After`；令牌仅在更新成功时消耗，失败尝试计入该次数。
- **DN-06** 手动重试 `{invoice_id}` → 200 `{attempted:true}` 并真实发起扣款；发票已 `paid` → 409 `invoice_not_retryable`；属他租户或不存在 → 404；非管理员 → 403。
- **DN-07** 更新支付方式成功后立刻发起一次扣款（假支付方见 §9）：成功 → 发票 `paid`、订阅 `active`、发 `payments-billing.invoice_paid`；失败 → 发票 `open`、订阅 `past_due`。

## 8. 支付方 Webhook（`payments-billing.webhook.receive` POST）

规范事件信封（真实支付方报文由适配层翻译成它）：`{id,type,created,data:{object:{id,subscription_id,amount_minor,currency,period_start,period_end,version}}}`；示例见 acceptance-plan。

- **WH-01** 验签头 `x-provider-timestamp`（Unix 秒）、`x-provider-signature`（小写 hex）= HMAC-SHA256(secret, `"{timestamp}.{raw_body}"`)；缺失或不匹配 → 400 `invalid_signature`。
- **WH-02** 容差 `webhook_signature_tolerance_seconds`；`|now - timestamp|` 超容差 → 400 `signature_expired`；容差内的旧事件仍处理。
- **WH-03** 按事件 `id` 去重：重复或并发投递同一事件 → 200 `{received:true,applied:false,duplicate:true}`，只生效一次。
- **WH-04** `version` 小于已处理版本 → 200 `{received:true,applied:false}`，状态不回退；`version` 可省略（视为最新）。
- **WH-05** 未知 `type`/`subscription_id`/`invoice_id` → 200 `{received:true,applied:false}`，不创建对象，不返回 4xx/5xx。
- **WH-06** `invoice.created`/`invoice.paid` 的 `amount_minor`/`currency` 与本地发票不一致 → 不应用，本地金额不变。
- **WH-07** 当前密钥与上一把密钥都要接受；旧密钥并存期 `webhook_previous_secret_grace_seconds`，期满后旧密钥 → 400 `invalid_signature`；轮换不得让未投递报文失效。
- **WH-08** 请求体超 `max_webhook_bytes` → 413 `payload_too_large`。
- **WH-09** 支持的事件类型（其余按 WH-05）：`checkout.session.completed` 绑定 `subscription_id`→工作区与计划，有试用建 `trialing` 否则 `pending`，不建第二条订阅；`invoice.created` 建 `open` 发票（金额与周期取自报文）；`invoice.paid` 发票 `paid`、订阅 `active`、周期顺延到 `period_end`、发 `payments-billing.invoice_paid`；`invoice.payment_failed` 见 DN-01；`subscription.updated` 同步周期不回退；`subscription.deleted` 订阅 `canceled`。

## 9. 假支付方接口（宿主提供，验收不直接调用）

假支付方必须支持：**建结账会话**（返回会话 id 与 URL）、**更新支付方式**（记录 `payment_method_ref`）、**发起扣款**（`invoice_id`、`amount_minor`、`currency`、`payment_method_ref`；`pm_fail` 开头 → 失败，否则成功；成功后回调 `invoice.paid`，失败后回调 `invoice.payment_failed`，签名同 WH-01）。

## 10. 数据与存储

- **DS-01** 落库必须哈希：催收令牌、结账会话令牌、幂等键只以不可逆摘要存储（输入 ≥128 位随机）；明文只允许出现在发信内容与 outbox 表。
- **DS-02** 验收在只读数据库上扫描所有表所有文本列，查找 outbox 里的**明文催收令牌**，命中必须为 0（只读查询，`HOST.md` §4）。

## 11. 不变量

- **INV-01** 同一工作区至多一个活跃订阅（`pending`/`trialing`/`active`/`past_due` 合计 ≤ 1）。
- **INV-02** 首张发票 `total_minor` = 计划 `amount_minor`（整数，无舍入）。
- **INV-03** 状态不得回退：除 `past_due/unpaid→active`（恢复）与任意 `→canceled` 外，其余迁移必须拒绝。

## 12. 建议，验收不测

- 哈希密钥轮换：不得重算已存摘要，须保留旧密钥的校验能力直到旧令牌过期（双密钥并存）。
- 以邮箱/账号为输入的入口（若有）不得暴露账号状态：disabled / 未验证 / 已存在 响应相同。
- **若要做按 IP 的限流**：客户端 IP 必须取"最右侧非受信 `X-Forwarded-For` 跳"，绝不取最左侧（可被伪造）；无可信代理列表时忽略该头、用连接地址。DN-05 的上限不依赖 IP。

## 13. 测试钩子（`HOST.md` §3 的模块扩展，仅 `TEST_MODE=1`，否则 404）

- **TH-01** `POST /api/__test__/payments-billing/provider-event`，体 `{type,data:{object:{...}},options:{event_id,timestamp_offset_seconds:0,secret_version}}` → 200 `{event_id,raw_body,headers:{x-provider-signature,x-provider-timestamp,x-provider-event-id}}`；`raw_body` 是待投递原文，脚本原样 POST 到 `payments-billing.webhook.receive` 并带上 `headers`；`timestamp_offset_seconds` 造过期时间戳，`secret_version` 取 `previous`。
- **TH-02** `POST /api/__test__/payments-billing/webhook-secret/rotate` → 200 `{current_version,previous_version,previous_expires_at}`；旧密钥进入并存期。
- **TH-03** `secret_version="previous"` 用旧密钥签名；宿主无旧密钥时返回 400 `previous_secret_unavailable`，相关用例记"宿主未声明"。
- **TH-04** 以上三个路径在 `TEST_MODE != 1` 时必须 404。

## 14. 规则 → 用例 追溯表

| 规则 | 用例 | 规则 | 用例 | 规则 | 用例 | 规则 | 用例 |
|---|---|---|---|---|---|---|---|
| G-01 | PB-03 | G-02 | PB-03 | G-03 | PB-01, PB-04 | G-04 | PB-03 |
| G-05 | PB-07, PB-08 | G-06 | PB-01, PB-10, PB-17 | G-07 | PB-01, PB-10, PB-17, PB-19 | PL-01 | PB-01 |
| PL-02 | PB-02 | CH-01 | PB-05, PB-07, PB-10 | CH-02 | PB-05 | CH-03 | PB-06 |
| CH-04 | PB-09 | CH-05 | PB-11 | SB-01 | PB-10 | SB-02 | PB-10 |
| SB-03 | PB-27 | SB-04 | PB-28 | SB-05 | PB-10 | SB-06 | PB-20 |
| IV-01 | PB-17 | IV-02 | PB-04, PB-17 | IV-03 | PB-17 | IV-04 | PB-18 |
| IV-05 | PB-18 | IV-06 | PB-17 | EN-01 | PB-19 | EN-02 | PB-19, PB-21, PB-28 |
| EN-03 | PB-19, PB-20, PB-27 | DN-01 | PB-21 | DN-02 | PB-22 | DN-03 | PB-21, PB-22 |
| DN-04 | PB-23 | DN-05 | PB-24 | DN-06 | PB-26 | DN-07 | PB-25 |
| WH-01 | PB-15 | WH-02 | PB-15 | WH-03 | PB-12 | WH-04 | PB-13 |
| WH-05 | PB-14 | WH-06 | PB-16 | WH-07 | PB-29 | WH-08 | PB-29 |
| WH-09 | PB-10, PB-21 | DS-01 | PB-30 | DS-02 | PB-30 | INV-01 | PB-11 |
| INV-02 | PB-10 | INV-03 | PB-13 |  |  |  |  |
