# usage-metering-and-budgets — 独立审查（r1）

阻断 0 | 应修 7 | 建议 15 | 追溯缺口 14 | 可用性 3/5 | 结论: 修后可用

> 审查对象：`module/{MODULE.md,contract.md,acceptance-plan.md,decisions.md}`；对照 `HOST.md`、`modules.json`。只读，未改源文件；本文件为唯一输出。

## 0. 审查方法与总体

- 逐条核对 contract.md §3 的 UM-01..UM-39，自行建立 规则→用例 表；再反向核对 acceptance-plan.md 的 AC-01..AC-30 是否可追溯。
- 篇幅：MODULE 11993B(<15KB)、contract 13969B(<17KB)、plan 9961B(<13KB)、decisions 3942B(<7KB)，均未超限。
- 模块名引用：MODULE §5 / contract 前提中出现的模块名均在 modules.json 中存在；未发现品牌/厂商名。
- 四条原则、MVP/成熟/完整分层与契约规则大体对齐，金额整数微元、append-only、事件时间归属等核心方向正确。

## 1. 阻断（0）

无。未发现"没有任何合规实现能全部通过"的互斥用例，也未发现直接危险到无法上线的 MUST（如信任最左 XFF、重算存量哈希、非恒定耗时比较、浮点金额）。契约已明确金额用整数微元、哈希只存摘要、轮换不得重算旧摘要。

## 2. 应修（7）

### A1 [可执行] AC-04 的 `amount_out_of_range` 用例在低价资源下不可执行
- 文件+引用：`acceptance-plan.md` AC-04；`contract.md` UM-10；`HOST.md` §2b params
- 为什么：AC-04 要求"提交使 cost_micro 超 params.max_cost_micro_per_event 的 quantity"，但 quantity 同时受 `usage.max_quantity_per_event`（≤1e9）限制。若单价 p 很小（如 1 微元/单位），要让 cost 超 1e12 微元需要 quantity>1e12，必然先触发 `quantity_out_of_range`；用例无法构造。验收虽说"价格表为空时先 upsert 单价>0 的测试类型"，但未规定 p 的下限，宿主/验收无法稳定触发该分支。
- 具体修法：在 AC-04 增加前置条件——使用 `unit_price_micro` 足够大的测试资源（使 `max_quantity_per_event × p > max_cost_micro_per_event`），或把 amount 分支拆成独立用例并声明价格条件；params 未声明时按最宽值 1e9/1e12 计算。

### A2 [可执行] AC-20 "上一窗口 occurred_at" 在月中不可达
- 文件+引用：`acceptance-plan.md` AC-20；`contract.md` UM-16/UM-31；`HOST.md` §3 时钟
- 为什么：`occurred_at` 过去容忍窗 ≤168h，但若验收启动时处于月中，上一自然月起始距今 >7 天，无法提交落在上一窗口的 occurred_at。AC-20 未写时钟前置，直接不可执行。
- 具体修法：AC-20 明确前置步骤：先用 `POST /api/__test__/clock {advanceSeconds}` 推进到新月第 1 天 00:xx，再提交 `occurred_at`=上月末（≤168h 内）；并把"第二条超容忍窗 → 400"的基准时间写清。

### A3 [一致] "每 N 个单位"的除数与 half-up 取整无字段、无用例
- 文件+引用：`MODULE.md` §3.2；`contract.md` UM-19；`contract.md` §1 pricing.upsert 字段
- 为什么：MODULE 要求"单价是每 1 个单位的微元数，'每 N 个单位'时用整数除数 + 四舍五入（half-up）"，但 `pricing.upsert` 只有 `unit`（自由字符串）/`unit_price_micro`/`currency`，没有除数/换算因子字段；`unit` 无法被机器可靠解析为 N。UM-19 又把 half-up 写成 MUST，但 AC 无任何除法用例，追溯不到。
- 具体修法：二选一——(1) 明确 `unit_price_micro` 即"每 1 个 `unit` 的价格"，quantity 以 `unit` 计，移除未定义的除法；或 (2) 新增 `unit_divisor`（整数≥1）字段并加 AC 用例断言 half-up。当前状态会导致不同宿主对 N 的理解不一致。

### A4 [缺口] 迟到事件与阈值/耗尽通知的交互未定义
- 文件+引用：`contract.md` UM-31、UM-32、UM-33；`acceptance-plan.md` AC-20、AC-21/22
- 为什么：UM-31 允许迟到事件计入历史窗口并增加其 committed，UM-32/33 又规定阈值与耗尽通知"每窗口每阈值一次"。但迟到事件是否触发历史窗口的通知、是否受该窗口的锁存约束，契约与用例均未说明；AC-20 也不查 outbox。资深审查者会直接攻击此边界（重放/迟到事件刷通知或逃通知）。
- 具体修法：在 UM-31 或 UM-32 明写"迟到事件计入 committed 但不触发阈值/耗尽通知（或触发但遵守同窗口锁存）"二选一，并在 AC-20 增加 outbox 断言。

### A5 [一致] `over_budget` 的边界（≥ vs >）未明写，与 reserve 拒绝条件混用
- 文件+引用：`contract.md` UM-23、UM-24、UM-27、UM-32；`acceptance-plan.md` AC-16、AC-22
- 为什么：AC-16 要求 committed=limit（300p）时 `over_budget=true`；而 UM-24 reserve 拒绝条件是 `committed+reserved+本次 > limit`（严格大于），UM-32 耗尽通知在"用尽"时触发。契约从未明写 `over_budget` 的布尔判定是 `committed >= limit` 还是 `committed > limit`，实现者取 `>` 会导致 AC-16 失败、取 `>=` 则与"超支"字面含义冲突。
- 具体修法：UM-23 增加一句：`over_budget = (limit_micro != null && committed_micro >= limit_micro)`；无限额时恒 false。并在 UM-24 旁注"reserve 在 committed+reserved+本次 == limit 时仍成功，但结果 over_budget=true"。

### A6 [一致] 币种"租户级固定"与"同窗口不得切换"措辞冲突
- 文件+引用：`contract.md` UM-21；`decisions.md` D14；`acceptance-plan.md` AC-09
- 为什么："租户级固定"（D14）暗示永远不可切，但 UM-21 只禁"同窗口切换"，跨窗口是否可切未定义；AC-09 只测同窗口。宿主可能允许跨月切币种，导致历史窗口币种含义改变，与 D14 "历史账单无法解释"的事故描述矛盾。
- 具体修法：明确二选一——"币种一旦设定不可更改（任何窗口）"或"仅同窗口不可切，跨窗口可切但历史窗口保留原币种"——并同步 AC-09 增加跨窗口断言。

### A7 [可观察] 阈值通知的收件人与字段未在 AC 断言
- 文件+引用：`contract.md` UM-33；`acceptance-plan.md` AC-21、AC-22
- 为什么：UM-33 明确收件人为 `alert_email`（缺省设预算的成员邮箱）、`budget.notifications` items 含 `template/window_key/threshold/link/created_at`、同阈值同窗口不得 2 条。但 AC-21/22 只断言模板名与 link 前缀，未断言 `messages[].to`、items 字段与去重，导致该 MUST 实际不可验收，违反 HOST §3b "每条 MUST 必须有至少一个验收用例"。
- 具体修法：AC-21 增加断言：outbox 消息 `to == alert_email`；`budget.notifications` 的 items 每条含 template/window_key/threshold/link/created_at；同阈值同窗口 items 数 ≤1。

## 3. 建议（15）

### B1 [追溯] UM-05 轮换"超时后旧密钥 401"未测
- 文件+引用：`contract.md` UM-05；`acceptance-plan.md` AC-26
- 为什么：AC-26 只测 revoke 立即 401 与 overlap 内可用，未推进时钟超过 `params.key.rotation_overlap_seconds` 验证旧密钥到期失效；UM-05 的后半段无用例。
- 具体修法：AC-26 增加步骤：推进时钟 overlap+1 秒后用 key1 → 401 `unauthenticated`。

### B2 [追溯] UM-06 `budget.notifications` 跨租户隔离未测
- 文件+引用：`contract.md` UM-06；`acceptance-plan.md` AC-29、AC-30
- 为什么：AC-29/30 覆盖 list/summary，budget.get 跨租户由 AC-06 覆盖，但 notifications 无跨租户用例。
- 具体修法：AC-29 或新增 AC 断言：租户 B 的通知不出现在租户 A 的 `budget.notifications`。

### B3 [可执行] UM-07 Origin 校验仅在 `usage.record` 上测
- 文件+引用：`contract.md` UM-07；`acceptance-plan.md` AC-27
- 为什么：UM-07 适用于所有涉钱写接口，但 AC-27 仅测 usage.record；budget.upsert/reserve/commit/release/allowance_*/pricing.upsert/key.* 的 Origin 负例未覆盖。
- 具体修法：AC-27 扩展为对至少一个预算写接口与 key.issue 的 Origin 负例，或新增 AC 覆盖。

### B4 [追溯] UM-11 幂等载荷规范化（occurred_at 到秒、metadata）未测
- 文件+引用：`contract.md` UM-11；`acceptance-plan.md` AC-02、AC-03
- 为什么：UM-11 要求 occurred_at 归一到秒、metadata 规范化后一致；AC-02 仅测字节完全相同的重放，未测毫秒差异或 metadata 键序差异应视为同义。
- 具体修法：AC-02 增加子断言：occurred_at 毫秒不同但秒相同 → 200 同 event_id；metadata 键序不同 → 200。

### B5 [追溯] UM-13 幂等 (租户, 键) 作用域未测跨租户
- 文件+引用：`contract.md` UM-13；`acceptance-plan.md` AC-02、AC-03
- 为什么：UM-13 明确不同租户同键互不影响，但 AC-02/03 仅同租户；无跨租户碰撞用例。
- 具体修法：新增 AC：租户 A 与 B 各用相同 Idempotency-Key 提交，两者均 201 且 event_id 不同、互不冲突。

### B6 [追溯] UM-14 append-only 未实际验证
- 文件+引用：`contract.md` UM-14；`acceptance-plan.md` AC-28
- 为什么：AC-28 验证改价不回溯，但未验证"不存在修改/删除用量事件的接口"；UM-14 的核心断言未被测试。
- 具体修法：AC-28 增加：对 `module-map.json` 中未声明的 update/delete 概念不测，但对已声明的更新类路径（若存在）断言 404/405；或在契约把 UM-14 移入"建议，验收不测"并弱化措辞。

### B7 [追溯] UM-15 成功批次的响应形状未测
- 文件+引用：`contract.md` UM-15；`acceptance-plan.md` AC-18
- 为什么：AC-18 只测失败（部分非法、超限），UM-15 要求成功返回 `{accepted, event_ids[]}`，无正例验证。
- 具体修法：AC-18 增加正例：3 条全合法 → 200/201，body 含 accepted=3 与 3 个 event_id，且 `usage.list` 条数 +3。

### B8 [追溯] UM-16 未来容忍窗未测
- 文件+引用：`contract.md` UM-16；`acceptance-plan.md` AC-04、AC-20
- 为什么：AC-20 只测过去超限，未来 `usage.occurred_at_future_tolerance_seconds`（≤300s）超限未测。
- 具体修法：AC-04 或 AC-20 增加：`occurred_at = now + tolerance + 1s` → 400 `occurred_at_out_of_range`。

### B9 [追溯] UM-18 JSON 数字 `1e3` 接受未测
- 文件+引用：`contract.md` UM-18；`acceptance-plan.md` AC-09
- 为什么：UM-18 明确 JSON 数字 `1e3` 解析为 1000 应接受，字符串 `"1e3"` 拒绝；AC-09 只测字符串 `"1e3"`，未测数字 `1e3`。
- 具体修法：AC-09 增加：`limit_micro=1e3`（JSON 数字）→ 200 且 `budget.get` 显示 1000。

### B10 [追溯] UM-20 `pricing.upsert` 管理权限与 0 价未测
- 文件+引用：`contract.md` UM-20；`acceptance-plan.md` AC-28
- 为什么：UM-20 要求 admin 写、0 价合法；AC-28 用 admin 改价但未测 member 403，也未测 0 价不回溯。
- 具体修法：AC-28 增加 member 调用 → 403 对照；并增加 0 价 upsert → 200 且新事件 cost_micro=0。

### B11 [追溯] UM-21 阈值去重与排序未测
- 文件+引用：`contract.md` UM-21；`acceptance-plan.md` AC-10
- 为什么：UM-21 要求 warning_thresholds 去重排序，AC-10 只测越界/超数，未测 `[80,50,50]` → `[50,80]`。
- 具体修法：AC-10 增加：提交含重复与乱序的阈值 → 200 且 `budget.get` 返回去重升序。

### B12 [追溯] UM-28 `release` 不存在 id 未测
- 文件+引用：`contract.md` UM-28；`acceptance-plan.md` AC-15
- 为什么：AC-15 测已提交 release → 409，未测不存在 → 404 `not_found`。
- 具体修法：AC-15 增加步骤：release 不存在 id → 404 `not_found`。

### B13 [追溯] UM-36 放行额度"仅作用于签发窗口"未测
- 文件+引用：`contract.md` UM-36；`acceptance-plan.md` AC-23
- 为什么：AC-23 只在同一窗口 redeem；窗口滚动后令牌如何处理（失效/转窗口）未测，与 A6/A8 同类边界。
- 具体修法：AC-23 增加：推进时钟跨月后再 redeem 同一令牌 → 404 `allowance_invalid` 且 remaining 不变（与 A8 结论一致）。

### B14 [追溯] UM-38/UM-39 明文回读与哈希存储未穷尽验证
- 文件+引用：`contract.md` UM-38、UM-39；`acceptance-plan.md` AC-25
- 为什么：AC-25 查 `key.list` 无明文，但未验证其他读接口（如 budget.get、usage.list、outbox）不回显明文；UM-39 的哈希存储仅在宿主声明只读视图时可测，未声明则"宿主未声明"，追溯不完整。
- 具体修法：AC-25 增加：用明文 key 调用 usage.record 成功后，再读 budget.get/usage.list/outbox，响应中不含该明文；若未声明 db 视图，记"宿主未声明"（与 HOST §2 一致）。

### B15 [安全] 令牌/密钥摘要比对未要求恒定时间
- 文件+引用：`contract.md` §3 G、§4；`MODULE.md` §3.6/§3.7
- 为什么：契约要求"只存哈希"与错误响应统一，但未明写摘要比对使用恒定时间比较；宿主可能用 `==`/`strcmp`，在统一错误体下仍可能通过计时侧信道枚举令牌（HOST 黑盒计时虽难，但契约应闭合）。这属于安全建议，非阻断。
- 具体修法：在 contract §4 "建议，验收不测" 增加："令牌与密钥摘要比对使用恒定时间比较；日志不记录明文。"（验收不测，但写入建议节）。

## 4. 追溯矩阵与缺口

contract §5 追溯表中的 39 条 UM 规则均至少对应 1 条 AC，AC-01..AC-30 也均标注了规则，无"用例追溯不到规则"的情况。但以下 14 条 MUST 的用例未真正验证规则内容（追溯缺口）：

| 规则 | 现有用例 | 缺口 |
|---|---|---|
| UM-05 | AC-26 | 未测 overlap 超时失效（B1） |
| UM-06 | AC-29/30 | notifications 跨租户未测（B2） |
| UM-11 | AC-02 | 载荷规范化未测（B4） |
| UM-13 | AC-02 | 跨租户同键未测（B5） |
| UM-14 | AC-28 | 无修改/删除接口未验证（B6） |
| UM-15 | AC-18 | 成功批次形状未测（B7） |
| UM-16 | AC-20 | 未来容忍窗未测（B8） |
| UM-18 | AC-09 | JSON 数字 1e3 未测（B9） |
| UM-20 | AC-28 | admin 权限与 0 价未测（B10） |
| UM-21 | AC-10 | 阈值去重/排序未测（B11） |
| UM-28 | AC-15 | release 不存在未测（B12） |
| UM-33 | AC-21/22 | 收件人与 items 字段未断言（A7） |
| UM-36 | AC-23 | 窗口作用域未测（B13） |
| UM-38/39 | AC-25 | 明文回读与哈希存储未穷尽（B14） |

另：UM-04 的失败状态码未在契约中明写（AC-08 只要求"结构一致"），UM-19 的 half-up 除数未定义（A3），UM-31 与通知交互未定义（A4），均属契约本身缺口而非单纯用例缺口。

## 5. 可用性评分与结论

- 安全/领域正确性：核心方向正确（整数微元、原子闸门、TTL、统一错误体、令牌只存哈希），但边界定义（over_budget、币种切换、half-up 除数、迟到事件通知）未闭合，扣 1 分。
- 可观察性：大部分 MUST 可在 HOST 黑盒下判定；UM-14/UM-39 为条件性可观察，已部分进入"建议，验收不测"。
- 一致性：字段列表（reserve 响应）、状态码边界存在不一致，扣 1 分。
- 追溯：39 条规则均挂有用例，但 14 条用例未真正验证规则，扣 1 分。
- 可执行性：AC-04、AC-20 存在不可执行路径，扣 1 分。

可用性 3/5。阻断 0、应修 7（>3），按通过标准当前为"修后可用"；完成 A1–A7 修复后可复审。