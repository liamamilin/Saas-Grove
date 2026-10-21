# usage-metering-and-budgets — 验收计划（黑盒用例）

只列用例，不含代码。判定依据见 `contract.md`，启动与宿主操作见 `HOST.md`。

**通用约定**

- 概念名省略前缀 `usage-metering-and-budgets.`；路径在 `module-map.json` 里解析，未声明的概念记"宿主未声明"（不算通过也不算失败）。
- 每条用例用 `auth.*` 注册**唯一邮箱**的新账号，用 `workspaces-and-permissions.*` 建租户并放入 admin 与 member 角色；用例之间不共享账号、租户或状态。
- 上限、TTL、并行时长从 `module-map.json` 的 `params` 读取；未声明时按 `contract.md` 第 2 节界限取最宽值。**不硬编码阈值。**
- 设 `p` = `pricing.list` 中某资源类型的 `unit_price_micro`（>0）；价格表为空时先用 `pricing.upsert` 写入单价 > 0 的测试类型。下文用 n·p 表达金额，保证阈值精确命中。
- 时间用 `POST /api/__test__/clock {advanceSeconds}` 推进；跨月的长推进按每次 ≤3600 秒分步累加。
- 通知与令牌明文从 `GET /api/__test__/outbox?to=<email>` 读取（`messages[].template`/`.token`/`.data.link`）。
- "负例"列 = 该用例含"必须被拒绝/不得产生副作用"的判定；是 = yes。

| id | given | action | expected | 负例 | 规则 |
|---|---|---|---|---|---|
| AC-01 | admin + 租户 W；`pricing.list` 中某资源类型单价 p>0；预算 limit=1000p | POST `usage.record` {resource_type, quantity=10, occurred_at=now} | 201；body 含 event_id、cost_micro=10×p（整数）、window_key=YYYY-MM、committed_micro=10×p、remaining_micro=limit−committed、over_budget=false | no | UM-09、UM-19 |
| AC-02 | AC-01 的账号与租户 | 用相同 `Idempotency-Key` 与载荷再 POST 一次 | 200（不是 201）；event_id 与 AC-01 相同；`budget.get` 的 committed_micro 不变；`usage.list` 条数不变 | yes | UM-11、UM-13 |
| AC-03 | 新账号 | 同一 `Idempotency-Key` 先 quantity=10 再 quantity=11 | 第二次 409 `idempotency_conflict`；committed_micro 未增加；只有一条事件 | yes | UM-12 |
| AC-04 | 新账号 | 依次提交 quantity=0、−1、1.5、"2.5"、params.max_quantity_per_event+1；再提交使 cost_micro 超 params.max_cost_micro_per_event 的 quantity；再提交未知 resource_type | 全部 400，body={"error":{"code":"invalid_request","message":…,"details":{"reason":…}}}；reason 依次为 quantity_out_of_range / amount_out_of_range / unknown_resource_type；message 不含 SELECT、INSERT、at Object、node_modules、.js:、stack；`usage.list` 里没有这些事件 | yes | UM-08、UM-10 |
| AC-05 | 同租户的 admin 与 member 账号 | member 调 `budget.upsert`；再用 admin 调同一请求 | member 403 `forbidden`；admin 200（对照） | yes | UM-02 |
| AC-06 | 账号 A（租户 W1）；另有租户 W2 | A 请求 W2 的 `budget.get` 与 `usage.record`（租户 id 取 W2）；再请求一个不存在的租户 id | 都 404 `not_found`，两次响应逐字节相同；W2 的 committed、事件数不变 | yes | UM-03 |
| AC-07 | 新账号，不带凭据 | 调 `usage.record` | 401 `unauthenticated`（不是 403/404） | yes | UM-01 |
| AC-08 | 正常、已停用、未验证三个账号（停用由 workspaces-and-permissions 设置，未验证来自 auth 侧邮箱状态） | 各自调 `usage.record` | 失败两者的 status/code/message 结构一致；message 不含 停用、未验证、不存在、disabled、unverified；正常账号 201；宿主不提供的状态子项记宿主未声明 | yes | UM-04 |
| AC-09 | admin | `budget.upsert` limit_micro=10.5 / "10.5" / "1e3" / "abc"；再 limit_micro="10"；再在同一窗口内改 currency | 前四个 400 `non_integer_money`；"10" → 200 且 `budget.get` 显示 limit_micro=10；改币种 → 400 | yes | UM-18、UM-21 |
| AC-10 | admin | `budget.upsert` warning_thresholds=[0] / [100] / [50.5] / 条数超 params.budget.max_thresholds；再 limit_micro 超 params.budget.max_limit_micro | 全部 400（`threshold_out_of_range` 或超限）；预算未写成非法值 | yes | UM-21 |
| AC-11 | admin | limit_micro=null 时 `budget.reserve`；再 limit_micro=0 时 reserve 任意正数量 | limit=null → 201；limit=0 → 402 `budget_exceeded` 且不产生预留；`budget.get` 返回 UM-23 列出的全部字段 | yes | UM-22、UM-23 |
| AC-12 | limit=100p，已用 90p | `budget.reserve` amount_micro=20p | 402 `budget_exceeded`；响应含 limit_micro/committed_micro/reserved_micro；`budget.get` 的 reserved_micro、remaining_micro 不变 | yes | UM-24 |
| AC-13 | limit=500，reserve 用 amount_micro=100 | 并行发 20 笔 `budget.reserve`（每笔 amount_micro=100） | 恰好 5 笔 201、15 笔 402；最终 reserved_micro=500，committed+reserved ≤ limit | yes | UM-25 |
| AC-14 | 已 reserve quantity=10（=10p） | 推进时钟 params.budget.reservation_ttl_seconds+1 | `budget.get` 的 reserved_micro=0、remaining_micro 恢复；同额再 reserve → 201 | no | UM-26 |
| AC-15 | 已 reserve quantity=10（=10p） | `budget.commit` quantity=5（=5p，带 `Idempotency-Key`）；同键重放；再无键 commit 同一 reservation；再 commit 不存在的 id；再 release 已提交的 reservation | 首次 200：产生一条用量事件、committed += 实际金额、reserved 释放差额、remaining 正确；同键重放 → 200 且同一 event_id、不新增事件；无键重复 → 409 `reservation_not_active`；不存在 → 404 `not_found`；release 已提交 → 409 | yes | UM-27、UM-28 |
| AC-16 | limit=300p | reserve quantity=100 后 commit quantity=300（=300p） | 200；按 300p 记账；over_budget=true | yes | UM-27 |
| AC-17 | limit=100p | `usage.record` 记 quantity=500（=500p） | 201、事件入库、over_budget=true、committed_micro=500p；随后 reserve amount_micro=1 → 402 | yes | UM-29 |
| AC-18 | admin | `usage.batch` 提交 3 条（其中 1 条 quantity=0）；再提交超过 params.usage.max_batch_size 条 | 两次都 400；`usage.list` 里这批一条没有 | yes | UM-15 |
| AC-19 | admin，已用 quantity=100 | 读 `budget.get` 的 window_end 与 now，推进时钟跨过它 | window_key 变化；committed_micro=0、reserved_micro=0；`usage.summary` 仍能按旧窗口键查到旧金额 | no | UM-30 |
| AC-20 | admin | 提交 occurred_at 落在上一窗口的用量；再提交 occurred_at = now − (params.usage.occurred_at_past_tolerance_hours+1) 小时 | 第一条 201 且 window_key=旧窗口、旧窗口 committed 增加；第二条 400 `occurred_at_out_of_range` | yes | UM-16、UM-31 |
| AC-21 | limit=100p、thresholds=[50]、alert_email=本人邮箱 | 记 quantity=50（committed=50p，恰为 50%）；再记 quantity=10（60p） | 恰好 1 条 outbox 消息：template=usage-metering-and-budgets.budget_warning，data.link 以 APP_BASE_URL 开头；记到 60p 仍只有 1 条；`budget.notifications` 同窗口同阈值也只有 1 条 | no | UM-32、UM-33、UM-34 |
| AC-22 | limit=100p、thresholds=[50] | 记 quantity=60（60p，触发一次）→ limit 提到 1200p（比例跌回 5%）→ 再记 quantity=540（600p，比例回到 50%）→ 再记 quantity=600（用尽 1200p） | 第 2 步不触发；第 3 步比例再达 50% 仍只有 1 条 budget_warning（锁存）；额度耗尽只出现 1 条 template=usage-metering-and-budgets.budget_exhausted，与 warning 模板不同 | yes | UM-32、UM-33 |
| AC-23 | 硬停已触发（committed≥limit）的租户 | admin 调 `budget.allowance_issue` {amount_micro:1000}；从 outbox 取 token；redeem 一次；再 redeem 同一 token | 201 响应体不含 token 明文；outbox 有 1 条 template=usage-metering-and-budgets.allowance_grant，含 token 与 data.link；首次 redeem → 200 且 remaining_micro 增加 ≥1000；再次 redeem → 404 `allowance_invalid` 且不再增加 | yes | UM-35、UM-36 |
| AC-24 | 租户 A：已兑换过一次的令牌、随机串、签发后推进时钟超过 params.budget.allowance_token_ttl_seconds 的过期令牌；另有租户 B 令牌 | 分别 `budget.allowance_redeem` 这四个令牌 | 四次响应 status/code/message 逐字节相同（404 `allowance_invalid`）；message 不含 expired、used、not found、已过期、不存在 等可区分词；四次兑换后 remaining_micro 均未增加 | yes | UM-37 |
| AC-25 | admin | `key.issue` 取明文；`key.list`；用明文调 `usage.record`；再读 `key.list` 与 `budget.get`；若 module-map 声明了 db 只读视图则查其中是否含明文 | 201 只返回一次明文；`key.list` 无明文（只有前缀/末 4 位/时间戳）；用明文的请求 201；之后任何接口都读不回明文；只读视图查不到明文（未声明则记宿主未声明） | yes | UM-38、UM-39 |
| AC-26 | admin | 签发 key1 与 key2（轮换）；用 key1 调用；revoke key1；再用 key1、key2 调用 | key2 签发后 key1 在 params.key.rotation_overlap_seconds 内仍可用 → 201；revoke 后 key1 → 401 `unauthenticated`；key2 → 201 | yes | UM-05 |
| AC-27 | admin | `usage.record` 带 `Origin: https://evil.example`；再带 `Origin: {APP_BASE_URL}`；再不带 Origin | 第一次 403 `forbidden`；后两次 201 | yes | UM-07 |
| AC-28 | admin | 记 10 单位用量（单价 p1）→ `pricing.upsert` 改价为 p2 → 回查该事件与 `budget.get` | 该事件 cost_micro 仍为 10×p1、price_version 未变；committed_micro 仍按 10×p1 累加；之后的新事件按 p2 计 | no | UM-14、UM-19、UM-20 |
| AC-29 | 租户 A 有 3 条用量 | `usage.list`（带过滤与分页）；再请求越界页码 | 返回条数与 total 与过滤一致且只含 A 的数据；越界页码 → 400 | yes | UM-06、UM-17 |
| AC-30 | 租户 A 有若干用量；另有租户 B | 同窗口同类型下 `usage.summary` 与 `usage.list` 逐条求和比对；再确认 summary 不含 B 的数据 | summary 的 cost_micro = 同窗口同类型明细逐条 cost_micro 之和；summary 不含其他租户数据 | yes | UM-06 |