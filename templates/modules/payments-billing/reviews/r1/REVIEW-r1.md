阻断 2 | 应修 14 | 建议 16 | 追溯缺口 14 | 可用性 3/5 | 结论: 修后可用

# payments-billing 独立审查 r1

审查对象：`MODULE.md`（12301 B）、`contract.md`（14352 B）、`acceptance-plan.md`（10304 B）、`decisions.md`（4112 B）。对照 `templates/HOST.md`、`templates/modules.json`。作者为免费模型，未经验证。审查者只读，未读 `.env`。

总体：骨架扎实。验签、事件去重、乱序、金额整数、跨租户 404、令牌单次使用都抓对了，MODULE 的事故清单也有价值。问题集中在四处：
- 时间驱动的状态转换没有触发手段。
- 一个全表扫描用例自相矛盾。
- 若干"状态机规则"互相打架。
- 付了钱却丢事件的路径（早到事件、过期会话、迟到事件）没有覆盖。

## 1. 逐项结论

1. **安全/领域**：见 B、S2、S3、S5、S6、S7、A1、A15。没有发现"重算存量哈希令牌"这类做不到的建议。X07 和 §12 第一条是对的，但与本模块无关（见 A6）。
2. **可观察**：除 DN-06 的"真实发起扣款"（A3）和 TH-04（见追溯缺口）外，MUST 基本可经 HTTP、outbox、只读库判定。时间类规则可观察，但缺触发手段（B2）。
3. **一致**：INV-03 与 SB-06/DN-01/PB-10 互斥（S1）；事件示例币种小写与 G-06 冲突（S9）；INV-02 与 WH-09 冲突（S10）；D-03 与 DN-03 冲突（S11）；DS-02/PB-30 无合规实现能通过（B1）。
4. **追溯**：见第 3 节。
5. **可执行**：B2、S4、S8、S13、S14、A4、A10。
6. **越界与引用**：模块名全部存在于 `modules.json`，无越界模块。§12 第三条（XFF）属 `rate-limiting`，X15 与 §12 第二条在本模块没有对应入口（A6）。
7. **文字**：未见乱码。篇幅均未超限：MODULE 12.3K/15K，contract 14.4K/17K，plan 10.3K/13K，decisions 4.1K/7K。见 A16。
8. **缺口**：见 S2、S3、S6、S7、S12、A2、A7–A9、A11、A13。

## 2. 问题清单

### 阻断（2）

**B1 [一致] DS-02 / PB-30：全表扫描与 outbox 明文互斥。**
- 位置：`contract.md` DS-01/DS-02；`acceptance-plan.md` PB-30。
- 为什么：令牌明文取自 outbox，而 outbox 本身就是库里的表。DS-01 和 HOST §3 都允许明文存在于名字含 `outbox` 的表。PB-30 却要求"所有表的文本列"命中行数 = 0，因此任何合规实现都必然命中 outbox 那一行。
- 修法：
  - DS-02 和 PB-30 改为"排除名字含 `outbox` 的表后命中 = 0"。
  - 明确扫描范围含 json/jsonb/bytea 的文本化列（令牌常被塞进 payload 列）。
  - DS-01 的"幂等键、结账会话令牌"也要有扫描用例（见追溯缺口）。

**B2 [可执行] 时间驱动转换没有触发手段。**
- 位置：PB-20、PB-22、PB-27、PB-28；`HOST.md` §3 时钟行；MODULE P16。
- 为什么：这四条用例都靠"推进时钟"就期望订阅变 `unpaid`/`canceled`、`pending_plan_key` 生效、发出 `subscription_canceled` 邮件。但 HOST 的时钟钩子只说"所有时效跟着走"，没有"跑一遍到期任务"的钩子。`async-jobs` 也不在 HOST §5 的依赖顺序里。
- 后果：只有"读取时按当前时钟惰性求值"的实现会通过。用真实定时器每分钟扫一遍的合规实现会误判失败。邮件这类副作用也无法惰性产生。
- 修法（二选一，写入 contract 并在 HOST 登记）：
  - (a) 契约规定：所有读接口（subscription.get、entitlement.check、invoice.list、outbox）返回前必须先按当前时钟结算到期转换，副作用同步落库。
  - (b) 新增钩子 `POST /api/__test__/payments-billing/run-due`（或让 `clock` 推进后同步跑完到期任务）。
  - 同时规定"在 `current_period_end` 之后、未收到续期 `invoice.paid` 时的状态"，现在只有 EN-01 里一个孤立的 `subscription_expired` reason，没有规则（见 A14）。

### 应修（14）

**S1 [一致] INV-03 字面自相矛盾。**
- 位置：`contract.md` INV-03。
- 为什么：它写"除 past_due/unpaid→active 与任意→canceled 外，其余迁移必须拒绝"。但 `pending→active`（PB-10）、`active→past_due`（DN-01）、`trialing→unpaid`（SB-06）、`past_due→unpaid`（DN-03）、`pending→trialing` 都是规定要发生的迁移。
- 修法：列出完整的允许迁移表，再写"表外一律拒绝"，并让 PB-13 追加一个表外迁移的用例，例如 `canceled` 后收到 `invoice.paid` 不得复活。

**S2 [安全] WH-04：`version` 可省略视为最新，同发票的 `payment_failed` 可压过 `paid`。**
- 位置：`contract.md` WH-04、IV-04、WH-09。
- 为什么：
  - 现实里许多支付方事件没有 version。省略即最新，等于绕过乱序防线：已 `paid` 的发票再收到无版本的 `payment_failed`，订阅就被判 `past_due`。
  - "已处理版本"的作用域（按发票、订阅还是事件类型）没写，版本相等怎么办也没写。
- 修法：
  - 加一条硬规则：发票一旦 `paid`，同发票的 `payment_failed`（无论 version）一律 `applied:false`。
  - 规定 version 的作用域是"对象 id + 类型族"，相等视为已过期。
  - 适配层对无 version 的报文要用 `created` 兜底，写进 P19。
  - 增补 PB-13b：`paid` 后投递无 version 的 `payment_failed`。

**S3 [缺口] WH-05 + 乱序：早到事件被 200 丢弃，付了钱永远不生效。**
- 位置：`contract.md` WH-05、WH-09；PB-14。
- 为什么：`invoice.paid` 先于 `invoice.created`/`checkout.session.completed` 到达，是真实支付方最常见的乱序之一。按 WH-05 它会拿到 200 `applied:false`，支付方认为已送达不再重试，客户付了钱却没有订阅。MODULE 只防"迟到回退"，没防"早到丢失"。
- 修法：二选一，并加用例。
  - (a) 对"类型已知、引用对象尚未出现"的事件暂存，对象出现后按序重放。
  - (b) 对这类事件返回可重试的非 2xx，例如 409/425，仅限已验签事件。
  - 同时把 WH-05 限定为"未知 type，或签名有效但永远不会出现的对象"。PB-14 的"invoice_id 不存在"要区分这两种情形。

**S4 [可执行] DN-05 / PB-24：未定义什么叫"失败尝试"。**
- 位置：`contract.md` DN-04/DN-05/§9；`acceptance-plan.md` PB-24。
- 为什么：
  - 假支付方只在"扣款"时按 `pm_fail` 前缀失败，"更新支付方式"本身永远只是记录。因此"提交错误 `payment_method_ref`"没有定义，测试无法造出前 K 次 400，失败时返回的 `error.code` 也没有。
  - DN-05 写"达到 K 次 → 429"，PB-24 写"第 K+1 次 429"，边界不一致。
  - PB-24 靠 `DELETE /rate-limits` 清计数，但 MODULE §5 说令牌尝试上限是本模块自带的，不是限流器，该钩子不一定清它。
  - PB-25 里 `pm_fail_1` 的 update 是否返回 `updated:true`、令牌是否消耗，也没有写。
- 修法：
  - 规定 `payment_method_ref` 须匹配 `^pm_[A-Za-z0-9_]+$`，否则 400 `invalid_request` 并计一次失败。
  - 规定第 K+1 次才 429。
  - 规定 429 之后令牌是否仍可用，以及 `Retry-After` 的上界。
  - 给出"清零令牌尝试计数"的钩子，或让计数随时钟窗口过期，用时钟推进代替清零。
  - 规定 `pm_fail_*`：update 返回 `updated:true` 并消耗令牌，扣款失败后走新的 `payment_failed` 与新令牌。

**S5 [安全] entitlement.check 无租户隔离，G-04 适用范围不清。**
- 位置：`contract.md` EN-01、G-03、G-04；PB-19。
- 为什么：
  - EN-01 写"无订阅不返回 403/404""恒 200"，字面上任何登录用户传任意 `workspace_id` 都能拿到别人的 `entitled`、`plan_key`、`valid_until`，能探测他人订阅。
  - G-04 写"非计费管理员 → 403"，未说明适用于哪些端点。PB-19 却要求普通成员可查，subscription.get、invoice.list、cancel 对非管理员的行为都没有定义。
- 修法：
  - EN-01 改为"非该工作区成员 → 404 `workspace_not_found`；成员（不论角色）恒 200"。
  - G-04 列出端点矩阵：create/cancel/resume/change_plan/retry 需管理员；get/list 与 entitlement 对成员开放，或明确也需管理员。
  - 加用例：局外人查询他人工作区的 entitlement。

**S6 [缺口] 幂等键作用域缺失，且扣款路径无重复保护。**
- 位置：`contract.md` G-05、DN-06、DN-07；`decisions.md` D-06。
- 为什么：
  - G-05 没写幂等键的作用域。D-06 推荐"账号 + 端点"，但 contract 没写，也没用例。若键全局生效，B 用 A 的键会重放出 A 的 `session_id` 和 `url`，既泄露又错放。
  - G-05 的"首次 201"只适用于创建端点，对 retry/cancel/change_plan 无定义。
  - 并发 5 次 `dunning.retry` 或 update+retry，可能对同一发票扣款两次，没有任何规则或用例拦截。DN-06 只有事后的 409。
- 修法：
  - G-05 写明键按（账号、端点）隔离，不同账号同键互不可见。
  - 对 retry/update 规定：同一发票同一时刻至多一笔进行中的扣款，并发只发起一次，传给支付方的扣款幂等键 = 发票 id + 尝试序号。
  - 加用例：跨账号同键、并行 retry 只一次扣款。

**S7 [安全] success_url / cancel_url 无约束（开放重定向）。**
- 位置：`contract.md` §3 请求体；MODULE P02。
- 为什么：这两个 URL 由客户端提供，若不限制 host，攻击者可构造指向钓鱼站的结账链接，支付完成后跳转过去。契约只管了 `Origin`，没管这两个字段，也没有用例。
- 修法：规定只接受与 `APP_BASE_URL` 同源的绝对 URL 或站内相对路径，否则 400 `invalid_request`。加用例：外域、`javascript:`、协议相对 `//evil` 都被拒。

**S8 [可执行] TH-01：钩子签名时间戳的时钟、过期旧密钥的行为未定。**
- 位置：`contract.md` TH-01/TH-03；PB-20、PB-29。
- 为什么：
  - 应用判容差用的是测试时钟。若钩子用真实时间签名，PB-20（推进数天后投递 `invoice.paid`）和 PB-29（推进 `previous_grace+1` 后）会被判 `signature_expired`，用例因此失败。
  - TH-03 说宿主无旧密钥时返回 `previous_secret_unavailable` 并记"宿主未声明"。但"宽限期满后的旧密钥"恰是 PB-29 第二步要用的，宿主一旦清除旧密钥，这一步变成"未声明"，会静默变成空通过。
- 修法：
  - TH-01 规定"时间戳 = 应用测试时钟当前时间 + `timestamp_offset_seconds`"。
  - TH-03 规定钩子必须保留已退役的旧密钥直至测试结束，期满后用它签名仍应得到 400 `invalid_signature`，而不是 `previous_secret_unavailable`。

**S9 [一致] 事件示例币种小写，与 G-06/WH-06 冲突。**
- 位置：`acceptance-plan.md` §0.1 示例（`"currency":"usd"`）；`contract.md` G-06、WH-06。
- 为什么：G-06 要求币种三位大写，示例却是 `usd`。WH-06 比较"报文币种与本地发票币种不一致就不应用"，若区分大小写，PB-10 的 `invoice.paid` 会被判 `applied:false` 而失败；若不区分，契约没写。
- 修法：示例改大写。WH-06 写明比较时大小写不敏感（或适配层统一规范为大写），并加一条小写币种报文可被接受的说明。

**S10 [一致] INV-02 与 WH-09 `invoice.created` 的金额来源冲突。**
- 位置：`contract.md` INV-02、WH-09、WH-06、CH-02。
- 为什么：
  - WH-09 写 `invoice.created` 的"金额与周期取自报文"，INV-02 写"首张发票 `total_minor` = 计划 `amount_minor`"。报文金额与目录不符时两条无法同时成立。
  - 带试用的首张发票，现实中通常为 0。
  - WH-06 只在"本地已有发票"时校验金额，首张发票无本地基准，等于服务端价格铁律（CH-02）在这里被绕开。
- 修法：规定首张发票按目录价校验，报文金额不符则 `applied:false`；试用首张发票金额 = 0，INV-02 限定为"非试用"。同时规定后续周期的发票金额来源（目录价，或套餐变更后的新价）。

**S11 [一致] 催收节奏、宽限与终态不自洽。**
- 位置：`decisions.md` D-03；`contract.md` DN-02/DN-03/SB-02；MODULE 状态机。
- 为什么：
  - D-03 推荐按 0/1/3/7 天重试，而宽限 72 小时，第 3 天（72h）和第 7 天的重试发生在宽限期满、订阅已 `unpaid` 之后，但 DN-02 又说"宽限期后不再新增"。
  - DN-03 在订阅变 `unpaid` 时发 `subscription_canceled` 邮件，而状态并不是 `canceled`。MODULE 写"unpaid → canceled"，但 `unpaid → canceled` 由什么触发、何时发生，全文没有规则。
- 修法：重试日程必须落在宽限期内（或宽限期 ≥ 最后一次重试 + 缓冲）。明确 `unpaid → canceled` 的触发条件，或删掉这一步。邮件模板名与状态对齐，例如在 `unpaid` 时发 `payment_failed_final`，或把 `unpaid` 视为终态并如实命名。

**S12 [缺口] INV-01 与"unpaid → active 恢复"冲突。**
- 位置：`contract.md` INV-01、CH-01、INV-03。
- 为什么：INV-01 的计数集合不含 `unpaid`，CH-01 只在"已有活跃订阅"时 409，所以 `unpaid` 的工作区可以新建结账并拥有第二个订阅。随后旧订阅的迟到 `invoice.paid` 触发"unpaid → active 恢复"，就出现两个 `active`，违反 INV-01，也会双重计费。
- 修法：规定 `unpaid` 也占用工作区的订阅位（要么阻止新建结账，要么新订阅激活时必须终结旧的），并加用例。

**S13 [可执行] 入口的鉴权方式与租户定位参数未定义。**
- 位置：`contract.md` §4–§7、G-02。
- 为什么：
  - subscription.get、invoice.list、invoice.get 没说怎样定位工作区（`workspace_id` 查询参数？当前会话的默认工作区？）。账号属于多个工作区时无法执行 PB-10、PB-17。
  - G-02 写"缺或无效登录态 → 401"，字面也套到了公开的 plan.list 和无登录态的 webhook.receive。`dunning.update_payment_method` 到底靠令牌还是靠登录态也没写。PB-23 的流程完全没有登录步骤，但 DN-06/G-04 要求管理员。
- 修法：
  - 给每个概念标注鉴权类型：公开 / 登录 / 登录+管理员 / 令牌 / 验签。
  - 给出租户参数位置。
  - G-02 排除 plan.list、webhook.receive、令牌入口。

**S14 [可执行] PB-17 的前置不够，发票号语义不清。**
- 位置：`acceptance-plan.md` PB-17；`contract.md` IV-01；`decisions.md` D-09。
- 为什么：
  - PB-17 的 given 只有"管理+W 已付"，即一张发票，却要验"倒序""number 不同且递增""limit=1 分页"。
  - IV-01 说发票号"唯一、递增"，D-09 说"租户内单调递增"，唯一的作用域不一致。号码是字符串还是整数、"递增"怎么比较，也没有规定。
- 修法：
  - PB-17 的前置补成"已两个周期各一张发票"（再投递一次下一周期的 `invoice.created`/`invoice.paid`）。
  - 规定 `number` 的格式和可比较规则，例如"`INV-` + 零填充整数"或纯整数，并统一作用域为租户内。
  - 加分页游标用例，遍历所有页做不重不漏对账。

### 建议（16）

- **A1 [安全] 验签比较要恒定耗时。**
  - 位置：`contract.md` WH-01、§12。
  - 现状：全文没提及，常见实现用 `===` 比较 hex 串。
  - 修法：在"建议，验收不测"里加"用常量时间比较 HMAC，不用 `==`；比较前先校验长度与 hex 格式"。
- **A2 [缺口] 去重标记要与状态变更同事务。**
  - 位置：WH-03。
  - 现状：先写"已处理"后改状态，若中途崩溃，支付方重试会被当成重复丢掉；反过来则双重应用。黑盒难测，应写入"建议"。
  - 修法：事件 id 登记与状态变更放同一事务，失败回滚后返回 5xx 让支付方重试。
- **A3 [可观察] DN-06 的"真实发起扣款"不可直接观察。**
  - 位置：DN-06；PB-26。
  - 现状：假支付方"验收不直接调用"，PB-26 的期望只验 `{attempted:true}`。
  - 修法：改成可观察结果，例如"随后回调使发票变 `paid` 或产生 `payment_failed`"。
- **A4 [可执行] PB-11 前置和期望含糊。**
  - 位置：PB-11。
  - 现状：given"同 PB-10"，不清楚是否已含 `invoice.paid`。"1 封邮件"指哪一封，完成事件本身不发邮件（WH-09）。"后一次 `applied=false`"在并行时无法分前后。
  - 修法：改成"恰有一次 `applied:true`"，邮件数明确指 `invoice_paid` 或 0。
- **A5 [一致] 邮件链接带令牌与 X06 的说法互相拉扯。**
  - 位置：MODULE X06；DN-01。
  - 现状：X06 反对令牌进 URL 查询串，DN-01 却要求 `data.link` 含同一令牌。
  - 修法：规定令牌放 URL 片段（`#token=`），不进查询串和 Referer，PB-21 据此判 `data.link`。
- **A6 [越界] §12 部分内容属于其他模块或与本模块无关。**
  - 位置：`contract.md` §12 第二、三条；MODULE X07、X15。
  - 现状：X-Forwarded-For 规则属 `rate-limiting`。X15 和"以邮箱/账号为输入的入口"属 `auth`，本模块没有这种入口。"哈希密钥轮换"在使用明文随机令牌的 SHA-256 摘要时不成立。
  - 修法：删除或改为一句交叉引用，别占篇幅。
- **A7 [缺口] Webhook 校验顺序和畸形输入没定。**
  - 位置：WH-01、WH-08。
  - 现状：体积检查、验签、JSON 解析的先后未写。超大的未签名报文该 413 还是 400。签名有效但 JSON 畸形、缺字段时的响应也没写。
  - 修法：规定先体积（413）、再验签、再解析（畸形 → 400 `invalid_request`）。
- **A8 [缺口] 金额边界值。**
  - 位置：G-06、WH-06、IV-03。
  - 现状：没写金额必须非负，也没写上限。报文里的负数或超过 2^53 的整数（JS 实现会丢精度）怎么处理没有规定。
  - 修法：规定 `amount_minor` 为 0…2^53-1 的整数，越界视为 `applied:false`，加一个边界用例。
- **A9 [缺口] 新令牌签发后旧令牌的处置。**
  - 位置：DN-01/DN-04。
  - 现状：同一发票多次 `payment_failed` 会多次签发，多枚令牌同时有效，攻击面和混乱都增加。
  - 修法：新令牌签发时作废同一发票的旧令牌，并加一条用例。
- **A10 [可执行] 假支付方回调应同步。**
  - 位置：§9；PB-25。
  - 现状：回调若异步，PB-25 的"立刻"期望会有竞态。
  - 修法：规定回调在发起扣款的请求返回前完成，或验收用轮询并给超时。
- **A11 [缺口] entitlement.check 入参校验。**
  - 位置：EN-01。
  - 现状：`feature` 缺失、为空、超长、含特殊字符时的行为没写。
  - 修法：缺失或不合法 → 400 `invalid_request`，加一个用例。
- **A12 [一致] decisions 声称"默认值已写进 contract"，部分未写。**
  - 位置：`decisions.md` 开头；D-06、D-07。
  - 现状：D-06 的"账号+端点"作用域、D-07 的"事件 id 保留 ≥7 天"，contract 里都没有对应规则或 params。
  - 修法：补一个 `webhook_event_retention_seconds`（≥604800）参数，并在 WH-03 引用；作用域见 S6。
- **A13 [缺口] CH-04 以收到时间判过期，会丢已付款的会话。**
  - 位置：CH-04；PB-09。
  - 现状：支付方在会话有效期内扣款成功，但 webhook 延迟到会话过期之后才到，按"收到时刻"判过期就会丢掉一笔真实付款。
  - 修法：改为比较事件的 `created` 与会话 `expires_at`；若已付款则仍应处理，或至少记入对账队列，不能静默丢弃。
- **A14 [一致] 错误码与 reason 枚举有悬空项。**
  - 位置：§0.2、EN-01。
  - 现状：§0.2 声称"一情形一码"，但跨租户既有 `not_found` 又有 `workspace_not_found`（PB-04 两个都接受）。`subscription_expired` 出现在 EN-01 枚举中，从未被 EN-02/EN-03 使用。周期结束、无续期事件时状态不明（与 B2 相关）。
  - 修法：规定哪个端点用哪个码。删掉 `subscription_expired`，或给它一条触发规则。
- **A15 [安全] CH-03 的 Origin 比较粒度。**
  - 位置：CH-03。
  - 现状：只比较 host，忽略 scheme 和端口。同 host 不同端口或 `http` 降级的 Origin 会被放过。`Origin: null` 也未定义。
  - 修法：比较完整 origin（scheme+host+port），`null` 视为外来；PB-06 加这两个子例。
- **A16 [文字] 小问题。**
  - MODULE 必读区说"对象只有六类"，其中"催收工单"在 contract 和 plan 里没有任何定义或接口，是悬空对象。要么删，要么补契约。
  - X06 里写了具体厂商名 Nginx，建议改为"反向代理日志"。

## 3. 规则 → 用例对照与追溯核对

我自建了对照表，结果与 `contract.md` §14 的表逐行一致：没有规则缺行，没有无法追溯到规则的孤儿用例（PB-01…PB-30 都落在某条规则上）。**表的格式没有错误，问题是"规则被映射到了用例，但规则里的子句没被该用例覆盖"，以及 TH 规则整体缺席。**

没有被任何用例覆盖的 MUST 子句（计 14 项）：

1. SB-01：无订阅 → 404 `not_found`。PB-10 只验有订阅的路径。
2. SB-03：`resume` 的成功路径（待取消时 200）。PB-27 只验 canceled 后 409。
3. SB-04：跨币种 `change_plan` → 400。PB-28 只验同币种。
4. SB-05：续期 `invoice.paid` 顺延 `current_period_end` 且不得缩短。PB-10 只验首张发票，没有第二个周期。
5. WH-09：`subscription.updated`（同步周期不回退）、`subscription.deleted`（→ canceled）没有用例，`invoice.created` 的"金额与周期取自报文"也只被 PB-10 间接用到。
6. G-05：`Idempotency-Key` 超 255 字符 → 400。
7. DN-06：非管理员 → 403 没有用例（PB-26 只测 409/404）。
8. WH-02："容差内的旧事件仍处理"没有正例。
9. WH-04："version 可省略（视为最新）"没有用例。
10. WH-06：`invoice.created` 金额不一致的情形没有用例（PB-16 只测 `invoice.paid`）。
11. DS-01：幂等键和结账会话令牌只存摘要，PB-30 只扫催收令牌。
12. TH-01…TH-04 未出现在追溯表。其中 TH-04（`TEST_MODE != 1` 时必须 404）验收永远在 `TEST_MODE=1` 下跑，无法验证，应移到"建议，验收不测"，或改成由 HOST 的启动检查负责。
13. EN-01：reason `subscription_expired` 无任何用例（也无规则，见 A14）。
14. G-06："游标不重不漏"没有用例（PB-17 只验 `limit=1` 与超限）。

此外还有若干"映射到用例但只覆盖了一半"的情形：
- G-03 的"结账会话"跨租户读取（`checkout.session.get`）没有用例。
- G-04 只在 `checkout.session.create` 上验证。
- DN-02 的上限只验"不超过"，零次重试也能通过。

## 4. 复核要点（修订后建议重点复查）

- 修 B1、B2 后，重跑一遍 PB-20、PB-22、PB-27、PB-28、PB-29、PB-30 的可执行性推演。
- S1、S10、S11、S12 都涉及状态机，建议一次性给出"状态迁移表 + 触发事件 + 邮件/权益副作用"的完整表，并让追溯表引用它，比逐条补丁更稳。
- 修订后契约预计会增长 1–2 KB，注意不要超过 17 KB。
