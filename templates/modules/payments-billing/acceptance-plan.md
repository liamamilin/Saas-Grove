# payments-billing 验收计划（黑盒）

执行方式、启动、依赖顺序见 `HOST.md`；被测行为见 `contract.md`（规则编号即契约里的 G/PL/CH/SB/IV/EN/DN/WH/DS/INV 编号）。本文件是**计划**：写清每条用例的前置、动作、期望。

## 0. 前置与工具

- **账号与工作区**：每条用例用全新邮箱注册（`auth`），用 `workspaces-and-permissions` 建全新工作区并成为计费管理员；不共享状态。PB-04 另建账号与 W2。
- **角色**：PB-03 的 B 段需第二个"非计费管理员"成员（`workspaces-and-permissions` 成员接口添加）。
- **计划**：从 `plan.list` 里挑：`amount_minor>0` 且 `interval=month` 的作付费计划，`trial_days>0` 的作试用计划，`features[0]` 作计划内 feature，不在计划内的用随机串 `feature_not_in_plan_<random>`；缺计划时记"宿主未声明"。
- **数值**：阈值从 `params` 读，读不到用 `contract.md` §0.1 的下限（例：会话过期推进 `checkout_session_ttl_seconds+1` 秒，宽限期推进 `dunning_grace_hours*3600+1` 秒），**不写死数**。
- **时钟** `POST /api/__test__/clock {advanceSeconds}`；**限流** `DELETE /api/__test__/rate-limits` 清零（PB-24 前后各一次）；**邮件** `GET /api/__test__/outbox?to=<email>` → `{messages:[{to,template,token?,data?}]}`，令牌取 `token`、链接取 `data.link`；**数据库**只读扫描（`HOST.md` §4）；**并发**并行发 N=5 个同参请求。

### 0.1 构造支付方事件（webhook 用例）

1. 脚本自造 id：`sub_<random>`、`in_<random>`、`evt_<random>`；
2. 调 `POST /api/__test__/payments-billing/provider-event`，体（`secret_version` 默认 current）：

```json
{"type":"invoice.paid","data":{"object":{"id":"in_1","subscription_id":"sub_1","amount_minor":4900,"currency":"usd","period_end":1761536000,"version":1}},"options":{"event_id":"evt_1"}}
```

3. 钩子返回 `{event_id,raw_body,headers}`；把 `raw_body` **原样** POST 到 `payments-billing.webhook.receive` 并带上 `headers`。
4. 负例改 `options`：`timestamp_offset_seconds=-(容差+60)` 造过期，`secret_version:"previous"` 造旧密钥，`version` 取小值造乱序；去掉签名头造无签名。轮换密钥用 `POST /api/__test__/payments-billing/webhook-secret/rotate`。
5. 事件类型见 `contract.md` §8。

## 1. 用例表

| id | given | action | expected | negative |
|---|---|---|---|---|
| PB-01 | 未登录 | GET `plan.list`；对同一路径发 POST；对随机路径发 GET | 200 且 `plans[]`；计划字段 ⊆ `{key,name,amount_minor,currency,interval,trial_days,features}`；`amount_minor` 整数、`currency` 三位大写、`interval ∈ {month,year}`；POST → 405；随机路径 → 404 | yes |
| PB-02 | 管理+W | POST `checkout.session.create`，`plan_key="no_such_plan_<random>"` | 404 `plan_not_found`；无会话/发票/订阅 | yes |
| PB-03 | A) 无登录态；B) W 的非管理员成员 | 分别 POST `checkout.session.create` | A) 401 `unauthenticated`；B) 403 `billing_admin_required`；体为 `{error:{code,message}}`，`message` 不含密钥/令牌/堆栈 | yes |
| PB-04 | 甲的 W1、乙的 W2 | 乙用 W1 的 `workspace_id` 建结账；乙读甲的 `invoice_id` 与订阅 | 三次都 404（`workspace_not_found`/`not_found`），不区分"不存在"与"属他人" | yes |
| PB-05 | 管理+W | POST `checkout.session.create`，体多带 `amount_minor:0`、`currency:"xxx"` | 201，返回金额/币种仍等于目录值 | yes |
| PB-06 | 管理+W | POST `checkout.session.create`，显式带头 `Origin: https://evil.example`（正例 `Origin: <APP_BASE_URL>`） | 403 `origin_not_allowed`；随后 GET `checkout.session.get` 为 404/410，无残留 | yes |
| PB-07 | 管理+W | 并行 5 次 POST `checkout.session.create`，同一 `Idempotency-Key`、同体 | 恰好 1 次 201、其余 200；5 个 `session_id` 相同；发票/订阅各 0 条 | yes |
| PB-08 | 管理+W | 同键改 `plan_key` 再请求；推进时钟 `idempotency_ttl_seconds+1` 后用同键请求 | 改载荷 → 409 `idempotency_conflict`；TTL 后 → 201 且 `session_id` 不同 | yes |
| PB-09 | 管理+W 已建会话 | 推进时钟 `checkout_session_ttl_seconds+1` 后 GET `checkout.session.get`；再投递该会话的完成事件 | GET → 410 `session_expired`；完成事件不建订阅/发票/权益 | yes |
| PB-10 | 管理+W、付费计划 | 建结账 → `checkout.session.completed`（`id`=会话 id）→ `invoice.created` → `invoice.paid`（同 `invoice_id`） | 订阅 200 且 `status=active`、`plan_key`=所选计划、`current_period_end`=事件 `period_end`；发票 1 张、`paid`、`total_minor`=计划金额、`paid_at` 非空；权益 true；再建结账 → 409 `subscription_exists` | no |
| PB-11 | 同 PB-10 | 并行投递 2 次完成事件（同一会话、不同 `event_id`） | 只 1 条订阅、1 张发票、1 封邮件；后一次 `applied=false` | yes |
| PB-12 | 已付费 | 同一已签名报文投递 2 次；再并行投递 5 次 | 全 200 且 `applied=false`（重复时 `duplicate=true`）；发票仍 1 张；无新邮件 | yes |
| PB-13 | 已付费 | 先 `invoice.paid`（`version=5`），再 `invoice.payment_failed`（同发票、`version=2`） | 后者 200 且 `applied=false`；发票仍 `paid`、订阅仍 `active`，无欠费邮件 | yes |
| PB-14 | 任意工作区 | 投递未知 `type`；投递 `invoice_id` 不存在的 `invoice.paid` | 都 200 且 `applied=false`；不建发票、不改订阅、不发邮件，无 4xx/5xx | yes |
| PB-15 | 任意工作区 | 投递：不带签名头；签名头改乱码；`timestamp_offset_seconds=-(容差+60)` 的报文 | 前两种 400 `invalid_signature`，第三种 400 `signature_expired`；无状态变化 | yes |
| PB-16 | 有 `open` 发票（4900） | 投递 `invoice.paid`，报文金额写 1、`currency` 写 `xxx` | 200 且 `applied=false`；本地 `total_minor` 仍 4900、币种不变 | yes |
| PB-17 | 管理+W 已付 | GET `invoice.list`（`limit`=1 与 `max_page_limit+1`）；GET `invoice.get`；GET 他租户 `invoice_id` | 列表 200、只含本租户发票、按创建时间倒序；`limit` 超限 → 400 `invalid_request`；详情 `total_minor == Σ line_items[].amount_minor`、整数、字段 ⊆ 允许集、无第三方链接；两张发票 `number` 不同且递增；他租户 → 404 | yes |
| PB-18 | 已付费 | 再投递一次 `invoice.paid`；再投递同周期、不同 `event_id` 的 `invoice.created` | 发票 `total_minor`、行项、`status`、`period` 不变；发票仍 1 张 | yes |
| PB-19 | 管理+W；W 的另一成员；无订阅的 W2 | 查 `entitlement.check`：计划内 feature；随机 feature；W2 的同 feature；两成员各查一次 | 恒 200；计划内 → true、`granted`；随机 → false、`not_in_plan`；W2 → false、`no_subscription` | no |
| PB-20 | 管理+W、试用计划 | 建结账 → 完成事件 → 推进时钟到试用结束后 | 订阅 `unpaid`、权益 false、`trial_expired`；再投递 `invoice.paid` → `active`、权益 true | no |
| PB-21 | 管理+W 已付费 | 投递 `invoice.payment_failed` | 订阅 `past_due`；outbox 出现 1 封 `payments-billing.payment_failed`（`token` 非空、`data.link` 含同一令牌、host=`APP_BASE_URL` 的 host）；宽限期内权益仍 true | no |
| PB-22 | 同 PB-21，跨过重试点 | 推进时钟 `dunning_grace_hours*3600+1` 秒 | 该发票 `payments-billing.payment_failed` 邮件数 ≤ `dunning_max_attempts+1`；订阅 `unpaid`、权益 false；出现 1 封 `payments-billing.subscription_canceled`；此后不再增 | yes |
| PB-23 | 有催收邮件 | 取 `token`：①请求体里成功更新支付方式；②再用同一令牌；③另取一枚令牌推进 `dunning_token_ttl_seconds+1` 后用；④令牌放查询串；⑤随机令牌 | ①200 `{updated:true}`；②400 `token_used`；③410 `token_expired`；④⑤400 `invalid_token` | yes |
| PB-24 | 有催收邮件 | 同一枚令牌连续提交 K 次错误 `payment_method_ref`（K=`dunning_token_max_attempts`）；清计数后再试 | 前 K 次 400；第 K+1 次 429 `too_many_attempts` 带 `Retry-After`；清计数后令牌仍可用（失败不消耗） | yes |
| PB-25 | 两个已催收的工作区 W1、W2 | W1 的令牌配 `payment_method_ref="pm_ok_1"` 调 `dunning.update_payment_method`；W2 的令牌配 `pm_fail_1` 同样调用 | 成功：发票 `paid`、订阅 `active`、outbox 出现 `payments-billing.invoice_paid`；失败：发票仍 `open`、订阅仍 `past_due` | yes |
| PB-26 | 管理+W，有 `open` 发票 | POST `dunning.retry {invoice_id}`；对已 `paid` 的发票再调；用他租户发票 | 首次 200 `{attempted:true}` 且真实发起扣款；已付 → 409 `invoice_not_retryable`；他租户 → 404 | yes |
| PB-27 | 管理+W 已付费 | POST `subscription.cancel`；查权益；推进时钟越过 `current_period_end`；再查权益与订阅；再 POST `subscription.resume` | cancel → 200 且 `cancel_at_period_end=true`、周期内权益仍 true；越过周期末 → 订阅 `canceled`、权益 false；resume → 409 `subscription_not_resumable` | yes |
| PB-28 | 管理+W 已付费、另一同币种计划 | POST `subscription.change_plan {plan_key}`；查订阅；推进时钟越过周期末再查 | 立即：`pending_plan_key`=新计划、`plan_key` 仍旧计划；周期末后 `plan_key`=新计划，旧计划独有 feature 变 false、新计划 feature 变 true | no |
| PB-29 | 任意工作区 | 轮换密钥后用旧密钥（`secret_version:"previous"`）投递；推进 `webhook_previous_secret_grace_seconds+1` 后再用旧密钥；再发超 `max_webhook_bytes` 的报文 | 窗口内旧密钥报文 200 且生效；窗口后 → 400 `invalid_signature`；超大 → 413 | yes |
| PB-30 | 有催收邮件 | 取 outbox 明文令牌，对只读数据库所有表的文本列做全表匹配扫描 | 明文令牌命中行数 = 0（库里只有摘要） | yes |

## 2. 判定

- 通过 = 期望全中且无额外副作用；失败 = 期望未命中或有额外副作用。
- 概念未在 `module-map.json` 声明 → 记"宿主未声明"，不算失败也不算通过；PB-02、PB-20 依赖目录有对应计划，PB-29 依赖轮换钩子。
- 规则 → 用例对照见 `contract.md` §14 追溯表，两边必须一致。
