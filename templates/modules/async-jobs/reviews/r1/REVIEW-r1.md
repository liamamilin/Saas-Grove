阻断 0 | 应修 15 | 建议 12 | 追溯缺口 7 | 可用性 3/5 | 结论: 修后可用

# async-jobs 独立审查 r1

对象：MODULE.md、contract.md、acceptance-plan.md、decisions.md（对照 HOST.md、modules.json）。只读审查，未读 .env。
篇幅（字节）：MODULE 11996 / 15K，contract 13936 / 17K，plan 9999 / 13K，decisions 3978 / 7K，均未超限。
引用的模块名全部在 modules.json 内；未发现品牌或厂商名。未发现错字或乱码。
通过标准：阻断 0 且应修 ≤3。本轮应修 15 条，未达标。

整体判断：领域骨架是对的（至少一次加 effectKey、协作式取消、租约回收、令牌哈希存储与单次使用、跨租户一律 404）。主要问题集中在三处：
1. 契约内部有几处自相矛盾的文字（byte 同形与 requestId、queued 进度为 0 与单调、终态不可变与手动重跑）。
2. 若干用例在 HOST.md 的钩子下写法不可执行或有竞态（取消、时钟跳变、保留期、结果截断）。
3. 令牌的熵和授权方式缺失，这是匿名可达端点，该写成 MUST。

---

## 一、应修（15）

### Y1 [一致] 错误体含 requestId，与"逐字节同形"互斥
- 位置：contract §3（错误体含 `requestId`）与 R-AUTH-2、R-TOKEN-2；plan AC-11、AC-24。
- 原因：`requestId` 按请求唯一才有追踪意义。规则却要求 404 与"不存在"的响应体"逐字节同形"，字面执行时任何实现都过不了。
- 修法：改成"除 `requestId` 外，状态码、`code`、`message`、键集合完全一致"。验收比较时先剔除 `requestId`。

### Y2 [一致] "queued 时 progress=0"与"单调不减"冲突
- 位置：contract R-PROG-1、I-5；§2 的 `running→queued`（租约回收）；R-RETRY-2（failed→queued）。
- 原因：任务在 33% 失败或被回收，重排后回到 `queued`。此时要么 progress=0（违反单调），要么 progress=33（违反"queued=0"）。
- 修法：改成"首次入队的 queued 为 0；重排或重跑后保留已有值"。I-5 照此写。AC-30 增加"重排后 progress 不下降"。

### Y3 [一致] 终态不可变与手动重跑；自动重试期间的状态没定义
- 位置：contract §2、I-1、R-STATE-1（"终态不可变"）与 R-RETRY-2（failed→queued）；R-RETRY-1。
- 原因：
  - `failed` 被列为终态且"不可再变"，但 retry 又把它改回 `queued`。
  - 自动重试在退避等待期间处于什么状态没有写：`queued` 还是仍为 `running`？§2 只允许 `running→queued` 用于租约回收。
  - AC-17 的"退避未到 attempt<M"依赖这个答案。
- 修法：
  - §2 明确 `failed→queued` 仅限手动重跑，终态不可变改成"除手动重跑外"。
  - 写明自动重试退避期间 `status=queued`。迁移表补上 `running→queued`（重试）。
  - I-1、I-3 同步。

### Y4 [一致] 令牌授权与"所有任务接口都带 Authorization"矛盾
- 位置：contract §0、R-AUTH-1、§1（`?jobId=&token=`）；plan AC-10、AC-23 到 AC-26；decisions #10（令牌邮件投递）。
- 原因：
  - 令牌的用途是把结果链接发给收件人，收件人没有会话。
  - §0 与 R-AUTH-1 却要求所有接口带凭证。
  - 用例没有写令牌读取时是否带 `Authorization` 和 `X-Workspace-Id`。
  - AC-26 推进时钟后，会话可能先过期，变成 401 `unauthorized` 而不是 410。
- 修法：
  - 明确"`result` 在带有效 `token` 参数时不要求会话和工作区头"。
  - 无令牌且无会话 → 401 `unauthorized`；令牌无效 → 401 `invalid_token`。
  - AC-24 到 AC-26 注明不带 Authorization。

### Y5 [安全] 令牌熵没有 MUST，匿名端点可被猜
- 位置：contract R-TOKEN-1；plan AC-23。
- 原因：令牌无需会话即可访问结果。规则不要求随机强度，AC-23 也不检查长度，6 位数字令牌也能通过。
- 修法：
  - R-TOKEN-1 增加"≥128 bit 不可预测随机，只存哈希"。
  - AC-23 断言令牌长度（base64url ≥22 或 hex ≥32）且两次签发无共同前缀规律。
  - 令牌暴力枚举的限速交给 `rate-limiting`，在 MODULE 接口表里写明。

### Y6 [可观察] R-TOKEN-5 是 MUST，但黑盒不可观察
- 位置：contract R-TOKEN-5；追溯表（R-TOKEN-5 → AC-23）。
- 原因：哈希算法升级、双键并存在 HOST.md 的黑盒与钩子下无法判定。AC-23 并没有测它，追溯表是假的。
- 修法：降为 §8 的"建议，验收不测"；追溯表删掉该行。

### Y7 [安全] MODULE.md 写"内存只放租约"
- 位置：MODULE.md"每项的正确行为 → 持久化与隔离"（"内存只放租约"）。
- 原因：
  - 租约只在内存里，进程崩溃后别的执行者无从知道哪些任务失联，无法回收。
  - 这与同文件的"租约过期自动回收"、decisions #5（数据库轮询 + 租约）自相矛盾，也是照做就会出错的建议。
- 修法：改成"租约（执行者标识、到期时间）必须落库，由条件更新抢占；内存只放本进程的心跳定时器"。

### Y8 [一致] 提交默认超时 120 秒，与 `jobTimeoutSeconds` 默认 300 秒、AC-19 冲突
- 位置：contract §1（`timeoutSeconds:120`）、§5（`jobTimeoutSeconds` 默认 300）、R-TIME-1；plan AC-19、AC-03。
- 原因：
  - 没有说明 body 的 `timeoutSeconds` 与宿主 params 的关系：谁覆盖谁，上限是多少，缺省取 120 还是 300。
  - AC-19 不带 `timeoutSeconds` 却按 `jobTimeoutSeconds+60` 推进，若实现按 120 判超时，用例的推导就不成立。
- 修法：
  - 规定"`timeoutSeconds` 可选，缺省取 params 的 `jobTimeoutSeconds`，且 `1..jobTimeoutSeconds`，超界 → 400 `invalid_request`"。
  - §1 示例改成不带该字段，或统一取值。
  - 补一个越界用例。

### Y9 [可执行] 取消用例 AC-13、AC-14 无法稳定执行
- 位置：plan AC-13、AC-14；contract R-CANCEL-1、§2（`cancelling→succeeded`）。
- 原因：
  - AC-13：并发为 1 且队列空时，任务一提交就被领走，"立即 cancel"拿到的是 `cancelling` 而不是 `cancelled`、`startedAt=null`。要稳定停在 `queued`，必须先占满槽位。括号"（否则填满槽位）"的逻辑是反的。
  - AC-14：`demo.sleep` 是单步且 3600 秒。协作式取消只在步骤边界生效，不推进时钟就永远停在 `cancelling`。
  - 推进 3600 秒后，§2 允许 `cancelling→succeeded`，合规实现可以走到 `succeeded`，而用例期望 `cancelled`。
  - 契约没有规定 `demo.sleep` 是否在时间片内检查取消信号。
- 修法：
  - 在 §6 规定 `demo.sleep` 在每个时间片（≤1 秒时间源）检查取消信号，并在取消后停止；对"取消优先于完成"给出优先级。
  - AC-13 先提交 C 个长任务占满并发，再提交目标任务后 cancel。
  - AC-14 推进时钟后断言终态 `cancelled`。

### Y10 [可执行] 时钟大步跳变使"租约失联"与"超时"互相抢先
- 位置：plan AC-19、AC-20；contract R-TIME-1、R-TIME-2。
- 原因：
  - AC-19 对健康的长任务一次推进 `jobTimeoutSeconds+60` 秒，远超 `staleAfterSeconds`（默认 60）。
  - 心跳还没来得及续约，这个健康任务在判定上也"超过 stale"，可能被当作失联重排（attempt+1），而不是 `failed/timeout`。
  - 契约没规定超时与失联谁优先，也没规定推进如何分片处理。
  - AC-20 的 `staleAfterSeconds+60` 在 `staleAfterSeconds>jobTimeoutSeconds-60` 时会先触发超时，这是合法的 params 组合。
- 修法：
  - 规定"时钟推进后，执行者按不超过 `staleAfterSeconds/3` 的片处理并续约；健康任务不得被判失联"。
  - 规定超时判定先于失联判定。
  - AC-19、AC-20 对 params 做约束或分段推进（每段 ≤ stale/2，每段后轮询）。

### Y11 [可执行] AC-11 的文字自相矛盾，且分页上限是空断言
- 位置：plan AC-11；contract R-LIMIT-1、R-AUTH-4。
- 原因：
  - AC-11 写"对 A 的任务 id 调 get/list/cancel/retry/result … 全部 404"，但 `list` 没有任务 id，也不会是 404。
  - 同条还漏了 `token` 概念。
  - "`list?limit=1000` 条数 ≤ listPageSize"是在 B 的空工作区上测的，永远为空，这是空断言。
  - R-AUTH-4 的 403 只在"宿主若支持受限成员"时才出现，并没有说明怎样用 `workspaces-and-permissions` 的公开接口创建受限成员。
- 修法：
  - 拆成两条：跨工作区点查（get/cancel/retry/result/token → 404 同形）和 `list` 隔离（200 且不含他人任务）。
  - 分页上限单独造 `listPageSize+1` 个任务（完成的也计入）再测。
  - 受限成员用例写清夹具，或把 403 标"宿主未声明"。

### Y12 [可执行] AC-27（保留期）没写保留期从何时起算，也没规定任务状态
- 位置：plan AC-27；contract R-DATA-1。
- 原因：
  - 保留期按 `createdAt`、`finishedAt` 还是 `updatedAt` 算，没有规定。
  - AC-27 没说任务要先走到终态，也没给合法的 payload（`pii_marker` 要塞进哪个类型的 payload？）。
  - 若任务是 `queued`，推进 31 天的过程中才开始执行，`finishedAt` 就是新时间，按 `finishedAt` 起算的实现不会清除，用例会误判。
- 修法：
  - 规定"保留期从 `finishedAt`（终态时间）起算，未到终态的任务不清除"。
  - AC-27 先提交 `demo.sleep` 并带 `metadata` 标记，走到 `succeeded`，再推进。payload 在 `demo.sleep` 的合法字段外加扩展字段需写明。

### Y13 [可执行] AC-22 的结果形状没定义，"未完成时读"有竞态
- 位置：contract R-RESULT-1、§6（`demo.large`）；plan AC-22。
- 原因：
  - `result.truncated` 说明结果是对象，但内容放在哪个字段，"长度 ≤ resultMaxBytes"按什么口径量（序列化后的 JSON 还是内容字段），契约都没写。
  - 按字节截断 JSON 可能产生非法 JSON。
  - "未完成时读一次 result"：时间源在测试里由测试驱动，任务可能在两次读取之间已经完成，这一步不稳定。
- 修法：
  - §6 定 `demo.large` 的结果为 `{"data":"<N 字节字符串>"}`；截断后为 `{"truncated":true,"truncatedAt":<字节>,"data":"<前缀>"}`，整体序列化长度 ≤ `resultMaxBytes`。
  - "未完成读"改成先用长任务占满并发，再读排队中的任务。

### Y14 [可执行] R-AUTH-3 / AC-12 依赖 `auth` 并不存在的公开能力
- 位置：contract R-AUTH-3；plan AC-12；modules.json 中 auth 的 scope。
- 原因：
  - auth 的范围是账号、登录、会话、重置、验证、MFA，没有"停用账号"或"把已验证账号置为未验证"的公开接口。
  - 这条 MUST 实际上几乎总会落到"宿主未声明"，名义上有 MUST，实际没有验收。
  - R-AUTH-3 同时规定了 `invalid_token` 与 `unauthorized` 的映射，也依赖这两种状态。
- 修法：
  - 降级为"建议，验收不测"，或在 `auth` 模块契约里先定义停用的公开夹具钩子，再引用。
  - 现在的状态是追溯表上已有用例，实际并不能跑。

### Y15 [可执行] 重试类用例没写推进多少，退避公式未定义，demo.email 的 link 无来源
- 位置：plan AC-16、AC-17、AC-18、AC-21；contract R-RETRY-1、R-OUTBOX-1、§6（`demo.email`）。
- 原因：
  - AC-16、AC-18、AC-21 都需要越过退避才能完成重试，用例没写推进量。只靠"轮询 30 秒"，在 `retryBackoffSeconds` 较大时必然超时。
  - AC-17 按 `B×2^M+60` 推进，隐含"指数、倍数 ≤2"。契约只写"首次 ≤60s，其后 ≤300s"，增长系数没规定。合法实现（5、50、300）总和 355s 会被误判。
  - `retryBackoffSeconds` 是首次延迟还是基数也没说。
  - AC-18 期望 `data.link` 含任务 id，但 `demo.email` 的入参 `data` 里没有 link，`demo.email` 的行为描述也没写由谁加 link。
- 修法：
  - R-RETRY-1 明确"第 k 次延迟 = min(300, B×2^(k-1))，带抖动不超过该值"。
  - 每个重试用例写"推进 `B×2^(M-1)` 后轮询，重复直到终态或达到上限"。
  - §6 的 `demo.email` 规定"模块给 `data.link` 附加指向该任务结果页的链接，含 job id"。

---

## 二、建议（12）

1. [越界] `X-Forwarded-For` / 来源 IP 解析不属于本模块。
   - MODULE.md 把它写进"最容易翻车的 5 处"、成熟度第 21 项、"容易做错"第 6 条，contract §8 S-1 又重复一遍。
   - 但契约里任务模型没有任何 IP 字段，也没有用 IP 的接口。建议移到 `web-security` / `rate-limiting`，本模块只保留一句引用。建议是对的（最右侧起跳过受信代理），问题只是放错了地方。

2. [安全] 单次令牌走 GET 且在 query 里。
   - 邮件安全扫描器和链接预览器会预取 GET，把一次性令牌消耗掉，用户第一次点击反而 409。
   - 令牌在 URL 中还会出现在访问日志和 Referer。
   - 建议加"建议，验收不测"：令牌页用 POST 或点击确认后兑换；`Referrer-Policy: no-referrer`；日志屏蔽 `token` 参数。
   - 另需定义令牌签发的前置条件：非 `succeeded`、已清除的任务怎么处理；"已使用"与"已过期"同时成立时返回哪个。

3. [一致] MODULE.md 与契约的小出入。
   - 不变量 1 写 `queued → running → succeeded/failed/cancelled`，漏了 `cancelling`。
   - decisions #8 写"并发 1~4"，§5 是 1..64。

4. [可观察] R-SUB-1 的"≥128 bit 随机、不由时间戳推导"黑盒不可判。
   - AC-01 只查长度 ≥22 且非纯数字，UUIDv4（122 bit）和 UUIDv7（含时间戳）都能通过。
   - 要么降为建议，要么加"N 个任务 id 两两无公共前缀规律"。

5. [一致] P3"令牌明文不在任何单元格"与 HOST.md"令牌明文只允许出现在名字含 outbox 的表"不一致。
   - 若令牌经 outbox 邮件投递，P3 会误报。P3 应排除名字含 `outbox` 的表。

6. [缺口] 租约回收是否消耗 attempt。
   - `demo.hang` 这类毒任务会被无限重排。AC-20 只断言 `attempt≥2`。
   - 建议规定回收计入 `attempt`、耗尽落 `failed` + `retries_exhausted`，并补一个用例。

7. [缺口] `list` 的查询参数 `limit`、`cursor`、`nextCursor` 语义没有定义，也没有分页用例。
   - 也没有状态过滤，没有稳定排序规则，翻页期间新增任务会重复或漏项。

8. [缺口] 输入边界没覆盖。
   - `metadata` 大小，`type` 长度，`timeoutSeconds` 上限，畸形 JSON 或错误 Content-Type，深度嵌套。
   - R-SUB-2 说"类型名不得被当作代码路径"，但 AC-02 只用了普通未注册名，没有 `../../x` 这类路径穿越字符串。

9. [缺口] 竞态与边界。
   - 并发两次 retry（应一个 202、一个 409）。
   - cancel 与完成同时到达的结果。
   - `queue_full` 时 retry 或幂等重放怎么处理。
   - 跨工作区使用相同 `Idempotency-Key` 不得互相影响。
   - 幂等键保留期（decisions #3 写 7 天）没有 MUST 也没有 param，不可验。

10. [缺口] 账号停用后的行为不完整。
    - R-AUTH-3 只规定了令牌和写操作。读接口（get、list）和已入队的任务怎么处理没写。
    - 令牌签发的权限（谁可以签）也没写。

11. [文字] 措辞与追溯小问题。
    - AC-13 的"（否则填满槽位）"语义反了。
    - R-STEP-1 里"手动重跑计入"读不通。
    - 追溯表"R-AUTH-2 → AC-24"不准：AC-24 实际测的是 R-TOKEN-2。
    - 篇幅均未超限。

12. [缺口] 租户级放大与故障模式。
    - 工作区可以无限创建，按工作区的排队上限会被绕过，建议加"每账号总量上限"，或明确交给 `rate-limiting` / `usage-metering-and-budgets`。
    - 故障模式没写：数据库写失败时 submit 的行为（不得回 202）、outbox 失败时的处理。

---

## 三、规则→用例追溯核对（自建）

契约末尾追溯表覆盖了全部 R-*，每条 MUST 名义上都有用例，但下列条款实际没被覆盖，或映射不实：

| # | 规则条款 | 问题 |
|---|---|---|
| T1 | R-TOKEN-5 | AC-23 并未测哈希升级（见 Y6） |
| T2 | R-PERSIST-1"重启后 get 仍返回" | HOST.md 没有重启钩子，AC-29 只验 P1 |
| T3 | R-CANCEL-1"取消后不启动新步骤、不产生新副作用、不回滚" | AC-14 用单步 sleep，多步任务中途取消没有用例（`demo.steps` 没有可暂停手段） |
| T4 | R-AUTH-4 的 403 | 只在"宿主若支持受限成员"时有（Y11） |
| T5 | R-LIMIT-1 的 `list` 截断 | AC-11 在空工作区上测，是空断言（Y11） |
| T6 | R-RETRY-1 的退避上界 | AC-17 只验"推进后到终态"，没有验证首次 ≤60s、其后 ≤300s（Y15） |
| T7 | §7 不变量 I-1 到 I-7 | AC-30 引用，但追溯表没有列 I-*；I-2、I-3、I-4、I-7 无对应 MUST 规则 |

没有"追溯不到规则的用例"：AC-01 到 AC-30 都能对应到某条规则或 §7。AC-29（P1）、AC-30（不变量）属于间接对应。

## 四、做得好的地方（不计入问题）

- 范围控制得当：明确不是定时器、DAG 引擎、"恰好一次"系统；"至少一次 + effectKey"的定位是业界共识。
- 跨工作区一律 404 且与"不存在"同形、令牌绑定单任务、令牌只存哈希、令牌并发恰好一个成功，均为正确做法，且有对应用例。
- 令牌哈希升级不能靠"重算明文"的判断正确。
- `X-Forwarded-For` 的建议方向正确（最右侧起跳过受信代理）。只是位置不对，见建议 1。
- 参考任务类型（§6）让验收可执行；价值明确，但其行为描述需要按 Y9、Y13、Y15 补全。
- 数值一律从 params 读，不硬编码阈值，与 HOST.md §2b 一致。
