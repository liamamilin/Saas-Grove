# usage-metering-and-budgets 独立审查 r1

阻断 0 | 应修 14 | 建议 14 | 追溯缺口 8 | 可用性 3/5 | 结论: 修后可用

审查范围：MODULE.md、contract.md、acceptance-plan.md、decisions.md，对照 HOST.md 与 modules.json。作者为免费模型（minimax-m3.1-flash-free），未经构建验证。通过标准（阻断 0 且应修 ≤3）未达到，应修 14。

篇幅：MODULE 11993B（限 15KB）、contract 13969B（限 17KB）、plan 9961B（限 13KB）、decisions 3942B（限 7KB），均未超限。

整体判断：整数微元、记账与闸门分离、迟到事件、锁存通知这些领域主干是对的。主要问题有三类。第一，几个关键语义（over_budget、hard_stop、放行额度、密钥轮换、价格范围）没有定义，实现者只能猜。第二，若干用例按 HOST 钩子无法执行或自相依赖。第三，并发重放这类资深审查者必攻的点没有覆盖。

---

## 一、应修

### S1 [安全] 计量密钥的权限范围与租户绑定未定义
- 位置：contract §2 认证；UM-02；UM-05。
- 问题：认证允许"会话或租户级计量密钥"，但没写密钥能调哪些概念。如果持密钥者能调 `budget.upsert`、`pricing.upsert`、`key.issue`、`allowance_issue`，一把泄漏的机器密钥就能改预算、改价、自我续期、签发超支放行。同时，"租户由 `X-Tenant-Id` 指定"与"密钥属于某租户"冲突：密钥带上别的租户 id 时怎么处理，没有规则也没有用例。
- 修法：新增 MUST：密钥只允许 `usage.record/batch`、`budget.reserve/commit/release`、`budget.get`、`usage.summary`。调用 `budget.upsert`、`pricing.upsert`、`key.*`、`allowance_*` 一律 403 `forbidden`。密钥绑定签发租户，请求指向别的租户 → 404 `not_found`。补用例：用密钥调 `key.issue`，以及用 A 的密钥访问 B 的租户。

### S2 [安全] 价格表的范围（全局还是租户级）未定义
- 位置：UM-20；contract §1 `pricing.upsert`；AC-28。
- 问题：`pricing.upsert` 要求租户 `admin`。如果价格表是全局的，一个租户的管理员就能改所有租户的价格，属跨租户写。如果是租户级的，客户可以把自己的单价设成 0 来绕过计费。契约也没说 `pricing.upsert` 的币种与预算币种不一致时怎么办。
- 修法：在契约和 decisions.md 里明确价格表属于哪一级，并给出对应的权限规则。建议价格表由平台级角色维护，租户只读。若保持租户级，要写明这是"自计量"场景，并说明与 `payments-billing` 的对账边界。补规则：价格币种与预算币种不同 → 400（reason=currency_mismatch）。补用例：member 调 `pricing.upsert` → 403。

### S3 [一致] 契约不能表达"每 N 个单位"，UM-19 的 half-up 不可测
- 位置：MODULE §3.2；UM-19；contract §1 `pricing.upsert`（字段只有 `unit_price_micro`）。
- 问题：MODULE 说"每 N 个单位用整数除数加 half-up"，但 API 里没有除数字段，不存在任何会触发除法的请求。UM-19 里"需除法的金额按 half-up"因此无法在黑盒下判定。逐笔取整还是累计后取整也没定，会产生系统性偏差。
- 修法：二选一。要么给 `pricing.upsert` 增加 `per_units`（正整数），并写死公式 `cost = round_half_up(quantity × unit_price_micro / per_units)`，逐笔取整后冻结，同时补一条 `quantity=1,per_units=3` 的用例。要么删掉除法，单价只表示每 1 个单位。

### S4 [一致] UM-05"轮换"没有 API 层面的含义，"超时后旧密钥 401"定义不了
- 位置：UM-05；AC-26；MODULE §3.7；D7。
- 问题：只有 `key.issue` 和 `key.revoke`，没有轮换概念。宿主无法知道哪把是"旧密钥"。如果实现成"签发新密钥后，其他密钥在 overlap 秒后过期"，会误伤合法的多密钥并存（多个集成各持一把）。如果实现成"不过期"，又违反 UM-05 的"超时后 401"。AC-26 也从不推进时钟，过渡期结束这半条规则从未被测。
- 修法：给 `key.issue` 增加可选 `rotates_key_id`。只有带它时，被替换的密钥才在 `key.rotation_overlap_seconds` 后失效。不带时多把密钥独立并存。AC-26 补两步：带 `rotates_key_id` 签发，推进时钟超过 overlap 后旧密钥 401；以及不带该字段签发的第二把密钥不影响第一把。

### S5 [一致] `over_budget` 没有定义，AC-16 与 UM-09/UM-29 可能互相矛盾
- 位置：UM-09、UM-27、UM-29；AC-16、AC-17。
- 问题：全篇没有写 `over_budget` 的判据。UM-27 把它描述成"实际数量大于预留"，UM-29 把它描述成预算层面的超支。AC-16 是 limit=300p、预留 100p、commit 300p，此时 committed=300p 恰好等于 limit，并不大于 limit。按"committed>limit"，期望应为 false，但用例写的是 true。实现者按哪个定义都有可能被错判。
- 修法：用一句话定义 `over_budget = (committed_micro > limit_micro)`，且 `limit=null` 时恒为 false。把 UM-27 的"置 over_budget"改成"commit 不因超出预留而拒绝"。AC-16 改成 limit=200p、commit 300p，才能稳定得到 true。

### S6 [一致] `hard_stop_enabled` 的语义与默认值、耗尽通知的触发条件都缺失
- 位置：UM-21、UM-24、UM-32；AC-11、AC-12、AC-22、AC-23。
- 问题：UM-24 的闸门写成无条件的"committed+reserved+本次>limit → 402"，完全没提 `hard_stop_enabled`。关闭硬停时 reserve 是否放行、默认值是什么，都没写。耗尽通知何时触发（committed≥limit 还是 >limit，是否依赖 hard_stop）也没写。AC-22 要求"额度耗尽出现 1 条 budget_exhausted"，却没设置 `hard_stop_enabled`。AC-23 的前提"硬停已触发（committed≥limit）"用了另一个未定义的判据。
- 修法：写明默认 `hard_stop_enabled=true`。`false` 时 reserve 不返回 402，只置 `over_budget` 并发 warning。耗尽通知条件 = `committed_micro >= limit_micro` 且 `hard_stop_enabled`，每窗口一次，与 UM-34 同样用整数比较。AC-12、AC-22、AC-23 的 given 里显式写 `hard_stop_enabled=true`。补一条关闭硬停的用例。

### S7 [一致/可执行] 放行令牌：额度如何叠加、谁收到令牌、谁能兑换、金额校验和竞态
- 位置：UM-24、UM-35、UM-36；AC-23、AC-24。
- 问题：
  1. UM-36 说兑换后 `remaining` 增加，但 UM-24 的闸门公式只写了 `limit_micro`。按字面实现的宿主，兑换后 reserve 仍然 402，而这正是放行的用途。若 `remaining` 被钳到 0，"增加 ≥1000"也观察不到。
  2. UM-35 没有写 `allowance_grant` 邮件发给谁。AC-23 要"从 outbox 取 token"，但 outbox 是按 `to` 查的，用例无从下手。
  3. 兑换权限（admin、member 还是密钥）没写。
  4. `amount_micro` 的合法范围没写，0、负数、小数、超上限都不在用例里。`ttl_seconds` 越界（60..86400）同样没有用例。
  5. AC-23 的"≥1000"与 UM-36 的"增加该额度"不一致。
- 修法：写明有效上限 = `limit_micro` + 本窗口已兑换额度之和，`budget.get` 的 `remaining_micro` 与 UM-24 都按有效上限计算。`remaining` 可以为负，或另给 `allowance_micro` 字段。写明收件人为 `alert_email`，缺省为签发人邮箱。写明兑换需 `admin`。补金额与 TTL 越界的 400 用例。AC-23 改为"恰好增加 1000"，并追加一步"兑换后 `budget.reserve` 成功"。

### S8 [可观察] UM-14 要求"追加反向调整条目"，但没有任何接口，AC-28 也没测它
- 位置：UM-14；MODULE §2 M18；contract 追溯表（UM-14 → AC-28）；AC-28。
- 问题：契约没有 `usage.adjust` 概念，宿主无法声明路径，更正机制不存在。AC-28 的内容是改价冻结，没有任何"账本不可 UPDATE/DELETE"的断言，UM-14 实际上无用例。"不得提供修改/删除接口"又是不存在性断言，黑盒无法穷举验证。
- 修法：新增概念 `usage.adjust`，请求字段为 `target_event_id`、`reason`，行为为追加一条 `cost_micro = -原金额` 的反向条目，原事件不变。补用例：对 `module-map.json` 里每个同路径做 PUT/PATCH/DELETE → 404 或 405，调整后 `usage.list` 同时出现原事件与反向条目，窗口金额相应下降。若不愿加概念，就把 UM-14 降为"建议，验收不测"，并删除追溯表对 AC-28 的映射。

### S9 [一致] `usage.record` 的可选 `reservation_id` 没有语义
- 位置：contract §1 `usage.record`；MODULE §3.1；MODULE §4 倒数第三行（"同一笔用量被记两次"）。
- 问题：同时存在 `commit`（结算预留并写事件）和带 `reservation_id` 的 `record`，正是 MODULE 自己警告的"开放登记/提交/预留三条路径、同一笔记两次"。带了 `reservation_id` 时，是否释放预留、是否与 commit 重复计入、预留已过期时怎么办，都没有规则，也没有用例。
- 修法：删掉 `usage.record` 的 `reservation_id`，让 commit 成为唯一结算入口。预留过期后事实仍已发生的情形，改为"用 `usage.record` 补记，并且不关联预留"。

### S10 [缺口] 并发重放没覆盖：同键并发、重复 commit、重复兑换
- 位置：UM-11、UM-25、UM-27、UM-36。
- 问题：只有 reserve 有并发用例（AC-13）。三个典型竞态没有规则，也没有用例：
  - 同一 `Idempotency-Key` 并发 N 次，可能写出多条事件。
  - 同一 `reservation_id` 并发 commit，可能重复结算。
  - 同一放行令牌并发兑换，可能多次加额度。这条直接是钱。
- 修法：各补一条 MUST 和对应用例，并发 20 次：
  - 同键并发：恰好 1 条事件，其余返回 200 且 event_id 相同。
  - 同预留并发 commit：恰好 1 个 200，其余 409。
  - 同令牌并发兑换：恰好 1 个 200，其余 404，额度只加一次。

### S11 [可执行] AC-04 的 `amount_out_of_range` 在多数价格下构造不出来
- 位置：AC-04；UM-10；contract §2 数值界限。
- 问题：要让 `cost_micro > 1e12`，必须 `quantity × p > 1e12`，而 `quantity ≤ max_quantity_per_event`（≤1e9）。若 p ≤ 1000，在 quantity 合法范围内永远到不了，先触发的是 `quantity_out_of_range`。契约对 `unit_price_micro` 也没有上限，用例没写要先 upsert 一个高单价类型。
- 修法：AC-04 的 given 写明先 `pricing.upsert` 一个单价 `p_big = floor(max_cost / max_quantity) + 1` 的类型，再用 `quantity = max_quantity` 触发。同时在契约里给 `unit_price_micro` 定上限，例如 ≤ `usage.max_cost_micro_per_event`。再补一句多字段同时非法时的报错优先级。

### S12 [可执行] 时间类用例的前提不成立：上一窗口够不到，长推进会让会话过期，时钟还是全局的
- 位置：AC-19、AC-20、AC-24；HOST §3 时钟；plan 通用约定。
- 问题：
  1. AC-20 要求"occurred_at 落在上一窗口"，同时过去容忍 ≤7 天。当前时间若在月中，上一窗口早已超出容忍，无法构造。必须先把时钟推进到下月初，并让 `occurred_at` 取自刚结束的窗口末尾，用例没写。
  2. AC-19 要推进整整一个月，AC-24 要推进最长 86400 秒。HOST 规定时钟让"会话"也跟着走，admin 的 Cookie 会话很可能在推进期间过期，之后的调用全部 401，用例没提示要重新登录。
  3. 时钟是宿主进程全局的。AC-19 推进一个月，会让并行跑的其他用例的 TTL、窗口、幂等保留期全部错乱。plan 却声明"用例之间不共享状态"。
- 修法：AC-20 写成"推进到下月初后，用刚结束窗口内的时间作 occurred_at"。凡推进时钟的用例，推进后重新登录，或用计量密钥发后续请求。在通用约定里写明"含时钟推进的用例必须串行，且放在最后"，或要求宿主为每个租户提供独立时钟偏移。

### S13 [可执行] AC-02 依赖 AC-01 从未发送的 `Idempotency-Key`
- 位置：AC-01、AC-02。
- 问题：AC-02 写"用相同 `Idempotency-Key` 与载荷再 POST 一次"，但 AC-01 的 action 里根本没带这个头。按字面执行，没有"相同的键"可用。
- 修法：AC-01 的 action 改为带 `Idempotency-Key: k1`，或把 AC-02 改成自包含，先发带键请求再重放。

### S14 [一致] `usage.summary` 的响应结构与 AC-30 的断言对不上
- 位置：UM-23；AC-30；contract §1 `usage.summary`。
- 问题：UM-23 规定 `usage.summary` 返回 `window_key/committed_micro/usage_by_resource_type[]`。AC-30 的判定却是"summary 的 cost_micro = 明细逐条 cost_micro 之和"，但 summary 里没有 `cost_micro` 字段，`usage_by_resource_type[]` 的元素结构也没规定。`budget.get` 里同名字段还写成了没有 `[]` 的形式。
- 修法：规定元素结构为 `{resource_type, quantity, cost_micro}`，`budget.get` 与 `usage.summary` 共用同一结构。AC-30 改为"各元素 `cost_micro` 之和等于顶层 `committed_micro`，也等于明细 `cost_micro` 之和"。

---

## 二、建议

1. [越界] UM-04（停用、未验证、凭据无效三态错误一致）和 AC-08 属于 `auth` / `workspaces-and-permissions` 的契约，本模块重复了一遍。而且停用账号返回 401 还是 403，本模块不该替它们定。修法：删除 UM-04 与 AC-08，改成"依赖 auth 的验收通过"；或降为建议。
2. [安全] UM-34 `committed*100 >= limit*threshold` 在 `limit` 到 1e15 时乘积约 1e17，超过 JS Number 的 2^53（约 9.007e15）。npm 宿主若用 Number，或用 pg 把 bigint 当字符串读，就会丢精度，恰好 50% 判错。`usage.record` 不受单笔之外的约束，累计也能超 2^53。修法：建议里写明用 BigInt 或在 SQL 中用 bigint 比较，并给 `limit_micro` 设一个确保乘 100 不溢出的上限，或加一条"limit=9e15、committed 恰为 50%"的边界用例。
3. [一致] UM-18 的金额格式规则互相拧着：字符串 `"10"` 接受但 `"1e3"` 拒绝，JSON 数字 `1e3` 却解析成 1000，`10.0` 和 `1E3` 没有规定。不同语言 JSON 解析器对 `1e3` 是整数还是浮点处理不同。修法：只接受 JSON 整数字面量，数字写法带小数点或指数一律拒绝。字符串形式的金额统一 400，除非有明确理由保留。
4. [缺口] 窗口滚动边界没覆盖：窗口切换时仍活跃的预留算入哪个窗口（UM-30 只说 reserved 归零，会让跨月的未结算预留悄悄消失）；`commit` 的事件按 `occurred_at` 归窗口还是按 commit 时间；`timezone` 的非法 IANA 名、非 UTC 时区、夏令时那天、窗口中途改时区（会重划边界）。MODULE 大讲夏令时，契约一条规则也没有。修法：各补一条规则，并补一条非 UTC 时区的月边界用例。
5. [缺口] `budget.reserve` 不接受 `Idempotency-Key`，网络重试会重复占用额度，直到 TTL 才释放。请求里的 `ttl_seconds` 超出 30..86400 时是钳制还是 400 也没写，它与 `params` 里的 `reservation_ttl_seconds` 的关系（默认值还是上限）也没写。reserve 同时给 `quantity` 和 `amount_micro` 时的行为未定。修法：补这三条规则。
6. [缺口] UM-08 说所有 ≥400 都用统一错误体，但 AC-04 只测了 400。畸形 JSON、未知路由、方法不允许 405、请求体过大 413、框架层抛出的 401 往往返回 HTML 或裸文本。修法：补一条用例，发送畸形 JSON 和超大请求体。
7. [缺口] `alert_email` 没有格式校验规则或用例。管理员能把通知发往任意外部地址，应至少要求合法邮箱格式。修法：非法格式 → 400（reason=invalid_email），并补用例。
8. [一致] UM-20 允许单价 0，UM-22 却说 `limit=0` 时"任何正数量用量都拒绝"。零价类型的 reserve 金额为 0，按 UM-24 公式 `0>0` 为假，会放行，两条规则矛盾。修法：UM-22 改成"任何正金额用量都拒绝"。
9. [安全] 令牌与密钥的明文熵没有要求。修法：放进建议，要求至少 128 位随机数据，用 CSPRNG 生成，且存储用 SHA-256 一类的快速哈希即可（高熵凭据无需慢哈希）。兑换端点的暴力枚举交 `rate-limiting`，在 MODULE §5 里说明。
10. [缺口] 阈值通知只在"提交"时触发。管理员把 `limit` 调低，使当前用量立刻越过阈值时，是否发通知没有规则。AC-22 反方向（调高上限）只验证了"不触发"。修法：补一条规则，写明改预算也要重新评估阈值，并补用例。
11. [文字] UM-24 写"402 含 limit_micro/committed_micro/reserved_micro"，没说在 `error.details` 里还是顶层。AC-12 同样含糊。修法：固定写为 `error.details.*`。MODULE §3.5 的"提交"一词既指 `budget.commit`，也指"记账成功"，容易误读，建议改成"记账"。
12. [缺口] 校验边界不全：负数 `limit_micro`、`warning_thresholds` 的重复值与顺序（MODULE 说去重排序，契约没有对应规则）、`from > to`、`from/to` 是否半开区间。修法：补规则与用例。
13. [一致] MODULE §3.1 提到 `metadata` 最多 8 个键且不放 PII，以及 `unit` 的含义，契约和用例对此一字未提。修法：要么补一条规则与用例，要么从 MODULE 里删掉。`unit` 与价格表里 `unit` 不一致时的行为同样没定。
14. [可执行] UM-17 / AC-29 的"越界分页 → 400"没有定义什么算越界（页码超过末页、page=0、limit 超上限或为 0）。超过末页返回 400 也不符合常见客户端的遍历习惯。修法：规定 page 从 1 开始、`limit` 默认值与上限，page<1 或 limit 越界 → 400，超过末页 → 200 空列表。AC-29 与 AC-30 的 given 里补一个确实有数据的租户 B，否则租户隔离并没有被真正验证。

---

## 三、规则 → 用例追溯（自建核对）

契约末尾的追溯表与 plan 里的"规则"列逐项核对，两边互相一致，没有"孤儿用例"和完全无用例的 MUST。问题出在映射的内容并没有真正覆盖规则的全部断言：

| 规则 | 缺口 |
|---|---|
| UM-05 | 过渡期结束后旧密钥 401 从未测（AC-26 不推进时钟）；轮换概念见 S4 |
| UM-06 | `budget.get`、`budget.notifications` 的租户隔离无用例；AC-29/30 的 given 里 B 没有数据 |
| UM-11 | `usage.batch` 的幂等无用例；只有 record（AC-02）和 commit（AC-15） |
| UM-13 | 保留期 ≥24h 与"不同租户同键互不影响"都没有用例 |
| UM-14 | AC-28 里没有任何账本不可改写的断言（S8） |
| UM-20 | 只测了改价，没测"admin 才能 upsert"、单价 0 合法 |
| UM-27 / UM-28 | "已过期预留 → 409"、"他租户预留 → 404"、release 不存在 → 404 均无用例；AC-14 只验证了过期释放，没验证过期后 commit |
| UM-36 | "放行额度只作用于签发时所在窗口"无用例 |

另外：UM-15 只有负例没有成功路径（`{accepted, event_ids[]}`）；UM-39 属可选只读视图，未声明就是"宿主未声明"，这点本身是合理的。

---

## 四、核对过、无问题的项

- 模块名引用：MODULE §5、§6 用到的 17 个模块名都在 modules.json 里，没有越界引用。
- 品牌/厂商名：没有出现。
- 数值：未来容忍 300 秒、过去 168 小时、预留 TTL 30..86400、幂等保留 ≥24 小时，MODULE、contract、decisions 三处一致。
- 错误码：固定表里每个 code 对应唯一状态码，没有一码两状态。`idempotency_conflict` 与 `reservation_not_active` 同为 409 但 code 不同，不构成冲突。
- 错字与乱码：未发现。
- 没有发现"没有任何合规实现能全部通过"的互斥用例，所以阻断为 0。但 S5、S6、S7 属于边缘：不同的合理解读会让不同的宿主在不同用例上失败，应在重写时一并消除。
