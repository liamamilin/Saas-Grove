# usage-metering-and-budgets — 黑盒契约

宿主与验收方式见 `HOST.md`，本文件不重复。路径只写"概念名"，由宿主在 `module-map.json` 声明；数值只给界限，实际值由宿主在 `params` 声明；时间用 `POST /api/__test__/clock` 推进。

---

## 1. 概念、请求与响应字段

**概念键 = 前缀 `usage-metering-and-budgets.` + 下表后缀**（例：前缀 + `usage.record`）。宿主须为每个概念声明 `{"method","path"}`；可把多个概念映射到同一路径（用请求体字段区分），但每个都要单独声明。未声明的概念记为"宿主未声明"，不算通过也不算失败。

金额字段一律以 `_micro` 结尾且为整数；`?` 表示可选；GET 的字段放查询参数，其余放 JSON 请求体。

| 概念 | 方法 | 请求字段 |
|---|---|---|
| `usage.record` | POST | resource_type, quantity, occurred_at, unit?, metadata?, reservation_id? |
| `usage.batch` | POST | events[]（同上字段） |
| `usage.list` | GET | resource_type?, from?, to?, limit?, page? |
| `usage.summary` | GET | window_key?, resource_type? |
| `budget.get` | GET | — |
| `budget.upsert` | PUT | limit_micro, currency?, warning_thresholds[]?, hard_stop_enabled?, alert_email?, timezone? |
| `budget.reserve` | POST | resource_type, quantity 或 amount_micro, ttl_seconds? |
| `budget.commit` | POST | reservation_id, resource_type, quantity |
| `budget.release` | POST | reservation_id |
| `budget.allowance_issue` | POST | amount_micro, ttl_seconds? |
| `budget.allowance_redeem` | POST | token |
| `budget.notifications` | GET | window_key? |
| `pricing.list` | GET | — |
| `pricing.upsert` | PUT | resource_type, unit, unit_price_micro, currency |
| `key.issue` | POST | label? |
| `key.list` | GET | — |
| `key.revoke` | POST | key_id |

前提：账号由 `auth.*` 创建（唯一邮箱），租户与角色由 `workspaces-and-permissions.*` 创建；验收用权限最高的可写角色当 `admin`，最低的成员当 `member`。

## 2. 通用约定

- **认证**：会话（Cookie）或租户级计量密钥（`Authorization: Bearer <key>`），缺失/无效 → 401。
- **租户范围**：每个请求落在一个租户内；租户由路径参数或 `X-Tenant-Id`/`tenant_id` 指定（宿主声明参数名）。跨租户 → 404。
- **错误体**：`{"error":{"code","message","details?"}}`。
- **固定 code 表**：`invalid_request`(400)、`unauthenticated`(401)、`forbidden`(403)、`not_found`(404)、`budget_exceeded`(402)、`idempotency_conflict`(409)、`reservation_not_active`(409)、`allowance_invalid`(404)。未另行标注的 4xx 一律 `invalid_request`，细分原因放 `details.reason`；一个情况只对应一个 code，同一 code 不得跨两个状态码。
- **金额**：整数微元，1 货币单位 = 1,000,000 微元；字段后缀 `_micro`；币种用 ISO 4217 三字母。
- **数值界限**（宿主在 `params` 声明实际值；未声明时按本表界限测；宿主可另加参数，验收只用本表的键）。窗口时区默认 `UTC`（可用 `params.budget.window_timezone` 声明）：

| params 键（名即义） | 界限 |
|---|---|
| `usage.max_quantity_per_event` | ≤ 1e9 |
| `usage.max_cost_micro_per_event` | ≤ 1e12 |
| `usage.max_batch_size` | ≤ 1000 |
| `usage.idempotency_retention_hours` | ≥ 24 |
| `usage.occurred_at_past_tolerance_hours` | ≤ 168 |
| `usage.occurred_at_future_tolerance_seconds` | ≤ 300 |
| `budget.max_limit_micro` | ≤ 1e15 |
| `budget.reservation_ttl_seconds` | 30..86400 |
| `budget.allowance_token_ttl_seconds` | 60..86400 |
| `budget.max_thresholds` | ≤ 20 |
| `key.rotation_overlap_seconds` | ≤ 86400 |

---

## 3. 规则（MUST）

### A. 认证、租户范围、跨源

- **UM-01** 无凭据或凭据无效（含已吊销密钥）→ 401 `unauthenticated`（不得 403）。
- **UM-02** 调用者属于该租户但角色不足（member 改预算）→ 403 `forbidden`。预算写操作需 `admin`；变更立即生效，影响本窗口剩余额度。
- **UM-03** 租户不存在或调用者不属于该租户 → 404 `not_found`；两种情况 status/code/message 一致（不得用 403/404 区分存在性）。
- **UM-04** 账号处于"已停用""未验证""凭据无效"三态时，失败响应的 status/code/message 结构一致，message 不含状态词（停用/未验证/不存在/disabled/unverified）。
- **UM-05** `key.revoke` 后密钥立即 401。轮换签发新密钥后，新旧密钥在 `key.rotation_overlap_seconds` 内都有效；不得用新密钥重算或替换旧密钥摘要；超时后旧密钥 401。
- **UM-06** 所有读写按租户隔离：`usage.list`、`usage.summary`、`budget.get`、`budget.notifications` 的行只属请求租户，不得含他租户数据。
- **UM-07** 写请求带 `Origin` 且与 `APP_BASE_URL` 的 origin 不一致 → 403 `forbidden`；无 Origin 不拒。验收脚本用 `Origin: {APP_BASE_URL}` 正常提交、`Origin: https://evil.example` 做负例。

### B. 错误形状

- **UM-08** 所有 ≥400 响应体必须是 `{"error":{"code","message"}}`，code 取自第 2 节固定表；不得返回裸数组、HTML、文本或空体；message 不得含堆栈、SQL/表名、路径、内部细节、他租户数据、明文密钥。

### C. 用量事件

- **UM-09** `usage.record` 成功 → 201；body 含 `event_id`、`cost_micro`(整数)、`window_key`、`committed_micro`、`remaining_micro`、`over_budget`(布尔)。
- **UM-10** 输入校验：`quantity` 须为正整数，0/负数/非整数 → 400（reason=quantity_out_of_range），超 `usage.max_quantity_per_event` → 400 同 reason；单笔 `cost_micro` 超 `usage.max_cost_micro_per_event` → 400（reason=amount_out_of_range）；`resource_type` 不在价格表 → 400（reason=unknown_resource_type），不得按 0 价记账；以上任一情形事件都不入库。
- **UM-11** `usage.record`、`usage.batch`、`budget.commit` 都接受头 `Idempotency-Key`。同租户、同键、语义载荷相同（tenant/resource_type/quantity/unit/occurred_at 归一到秒、metadata 规范化后一致）→ 200（不是 201），返回同一 `event_id`，条数与金额不增加。
- **UM-12** 同键但语义载荷不同 → 409 `idempotency_conflict`，不写新事件。
- **UM-13** 幂等作用域是 (租户, 键)；键在 `usage.idempotency_retention_hours` 内仍有效（重放不得被当成新事件）；不同租户同键互不影响。
- **UM-14** 用量账本 append-only：不得提供修改/删除用量事件的接口；更正只通过追加反向调整条目。
- **UM-15** `usage.batch` 一次 ≤ `usage.max_batch_size` 条，超出 → 400；任一条非法 → 整批 400，一条都不入库；成功 → {accepted, event_ids[]}。
- **UM-16** 事件归属窗口由 `occurred_at` 决定（非入库时间），窗口键为计费时区下的 `YYYY-MM`；`occurred_at` 超出容忍窗（过去 `usage.occurred_at_past_tolerance_hours` 小时、未来 `usage.occurred_at_future_tolerance_seconds` 秒）→ 400（reason=occurred_at_out_of_range）。
- **UM-17** `usage.list` 支持按 `resource_type`、起止时间过滤并分页，返回 items[]（event_id,resource_type,quantity,unit,cost_micro,occurred_at,window_key）与 total，过滤一致且只含本租户数据；越界分页 → 400。

### D. 金额与价格

- **UM-18** 金额字段必须能解析为整数：`10.5`、`"10.5"`、`"1e3"`、`"abc"` → 400（reason=non_integer_money）；`10` 与 `"10"` 都按 10 微元接受（JSON 数字 `1e3` 解析为 1000）。
- **UM-19** 事件冻结 `price_version` 与 `cost_micro`；改价后历史金额不变，窗口已用按冻结值求和；需除法的金额按 half-up 取整到微元，权威值是冻结值与窗口累计值，不得由显示值反推。
- **UM-20** `pricing.upsert` 需 admin；改价只对之后的事件生效；单价 0 合法（该资源免费），已记账金额不受影响。`pricing.list` 的 items[] 给出 unit/unit_price_micro/currency/price_version。

### E. 预算、闸门、窗口

- **UM-21** `budget.upsert`：币种在租户级固定并随预算返回，同窗口不得切换（切换 → 400 `invalid_request`）；`limit_micro` 非整数 → 400（reason=non_integer_money），超 `budget.max_limit_micro` → 400；`warning_thresholds` 元素须为 [1,99] 整数，越界或非整数 → 400（reason=threshold_out_of_range），条数超 `budget.max_thresholds` → 400。
- **UM-22** `limit_micro=null` = 不限额（闸门永远放行）；`limit_micro=0` = 任何正数量用量都拒绝；两者不得混淆。
- **UM-23** `budget.get` 返回 `limit_micro`、`currency`、`hard_stop_enabled`、`warning_thresholds`、`alert_email`、`window_key`、`window_start/end`、`committed_micro`、`reserved_micro`、`remaining_micro`、`over_budget`、`usage_by_resource_type`、`now`；`usage.summary` 返回 window_key/committed_micro/usage_by_resource_type[]。
- **UM-24** `budget.reserve` 成功 → 201（含 reservation_id/expires_at/remaining_micro）；`committed + reserved + 本次 > limit_micro` → 402 `budget_exceeded`（含 limit_micro/committed_micro/reserved_micro），不产生预留。
- **UM-25** 并发原子性：任意并发下 `committed + reserved` 不得超过 `limit_micro`；剩余额度 `R`、每笔 `A` 且 `R ≥ A` 时，并发恰好 `floor(R/A)` 笔 201，其余 402。
- **UM-26** 预留带 TTL（`budget.reservation_ttl_seconds`）：超时未结算自动释放，remaining_micro 恢复，同额再 reserve 成功；时钟用 `POST /api/__test__/clock`。
- **UM-27** `budget.commit` → 200（event_id/committed_micro/remaining_micro/over_budget），写入用量事件、按实际数量结算、释放差额；实际数量大于预留时按实际记账并置 over_budget=true（事实已发生，不得拒绝）；`reservation_id` 不存在（含他租户）→ 404 `not_found`；已提交/已释放/已过期 → 409 `reservation_not_active`。
- **UM-28** `budget.release` → 200 并释放全部占用；不存在 → 404；已提交/已释放/已过期 → 409 `reservation_not_active`。
- **UM-29** `usage.record` 是事实登记：任何预算状态都 201 并入库；超支只体现为 `over_budget=true`，不得丢弃已发生用量。
- **UM-30** 窗口为计费时区下的自然月 `[window_start, window_end)`；跨过 `window_end` 后 `window_key` 变化、committed/reserved 归零，但历史窗口用量仍能用 `usage.summary` 查到。
- **UM-31** `occurred_at` 落在已结束窗口的迟到事件计入该窗口并使其 `committed_micro` 增加；不得因窗口关闭拒绝入库。

### F. 阈值与通知

- **UM-32** 跨越阈值的那一次提交触发通知；每个阈值每窗口最多一次（锁存）：回落后再冲高，同窗口不再触发。阈值通知与硬停耗尽用两个不同模板，耗尽通知每窗口最多一次。
- **UM-33** 通知写入 outbox：模板名固定 `usage-metering-and-budgets.budget_warning`（阈值）与 `usage-metering-and-budgets.budget_exhausted`（硬停），链接放 `data.link`（`APP_BASE_URL` 下绝对地址），收件人 `alert_email`（未设时为设预算的成员邮箱）；`budget.notifications` 的 items[] 含 template/window_key/threshold/link/created_at，同阈值同窗口不得 2 条。
- **UM-34** 阈值判定基于整数金额（`committed_micro * 100 >= limit_micro * threshold`），不得因浮点误差漏触发。

### G. 放行令牌与计量密钥

- **UM-35** `budget.allowance_issue` → 201，响应体不含令牌明文（只含 issued/amount_micro/expires_at）；明文只在 outbox 记录 `usage-metering-and-budgets.allowance_grant` 的 `token`，链接在 `data.link`。
- **UM-36** `budget.allowance_redeem` → 200，当前窗口 `remaining_micro` 增加该额度；同一令牌再次兑换 → 404 `allowance_invalid` 且额度不再增加。放行额度只作用于签发时所在窗口。
- **UM-37** 令牌"不存在/已过期/已使用/属他租户"四种情况 → 完全相同的 404 `allowance_invalid` 与相同 message，不得用不同 code/status/message 区分。
- **UM-38** 令牌与密钥的明文只在签发那次出现，之后任何接口都读不回；`key.issue` 返回 key（明文，仅此一次）/key_id/created_at，`key.list` 的 items[] 只含 key_id/prefix/last4/created_at/revoked_at/last_used_at。
- **UM-39** 令牌与密钥在存储中只保存摘要（哈希），不存明文；宿主可在 `module-map.json` 声明只读视图（如 `usage-metering-and-budgets.db.tokens`）暴露凭据 id、摘要列与时间戳，验收只用它确认无明文。

---

## 4. 建议，验收不测

- 预留与结算走同一事务，用行级锁或原子条件更新；金额用 64 位整数列 + CHECK 约束，另留 `decimal` 影子列人工核对；幂等键清理前先确认账本可对账。
- 限流由 `rate-limiting` 负责；日志不打明文令牌；双密钥并行时长应 ≥ 客户端重试窗口；夏令时按 IANA 时区换算。

---

## 5. 规则 → 验收用例追溯

下表对应 `acceptance-plan.md` 用例编号（每条 MUST 至少一个用例，每个用例至少一条规则）。

| 规则 | 用例 |
|---|---|
| UM-01 | AC-07 |
| UM-02 | AC-05 |
| UM-03 | AC-06 |
| UM-04 | AC-08 |
| UM-05 | AC-26 |
| UM-06 | AC-29、AC-30 |
| UM-07 | AC-27 |
| UM-08 | AC-04 |
| UM-09 | AC-01 |
| UM-10 | AC-04 |
| UM-11 | AC-02 |
| UM-12 | AC-03 |
| UM-13 | AC-02 |
| UM-14 | AC-28 |
| UM-15 | AC-18 |
| UM-16 | AC-20 |
| UM-17 | AC-29 |
| UM-18 | AC-09 |
| UM-19 | AC-01、AC-28 |
| UM-20 | AC-28 |
| UM-21 | AC-09、AC-10 |
| UM-22 | AC-11 |
| UM-23 | AC-11 |
| UM-24 | AC-12 |
| UM-25 | AC-13 |
| UM-26 | AC-14 |
| UM-27 | AC-15、AC-16 |
| UM-28 | AC-15 |
| UM-29 | AC-17 |
| UM-30 | AC-19 |
| UM-31 | AC-20 |
| UM-32 | AC-21、AC-22 |
| UM-33 | AC-21、AC-22 |
| UM-34 | AC-21 |
| UM-35 | AC-23 |
| UM-36 | AC-23 |
| UM-37 | AC-24 |
| UM-38 | AC-25 |
| UM-39 | AC-25 |
