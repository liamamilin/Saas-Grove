# A-ab01 待办（独立审查发现、测试未覆盖、暂缓处理的问题）

按"阶段确认规则"：没有高/中危的安全问题就放行，健壮性问题攒在这里，最后集中修一轮（会记一次人工介入）。

## 来自 S1 第 2 轮审查

1. 登录限流不是原子操作：并发的失败请求可以同时通过"失败次数 ≥ 10"的检查，突破上限（`server/auth/service.ts:88-110`）。建议对计数做原子递增，或在事务里加行锁后再判断。
2. 登录失败记录只增不减，陌生邮箱的失败记录永远没人清理（`server/auth/service.ts:73-75`）。建议按时间窗口定期清理。
3. 注册不是原子操作：账号建好了但会话创建失败时，用户既登不进来，重试注册又会收到 409（`app/api/auth/signup/route.ts:15-17`）。建议放进同一个事务，或者失败时补偿删除账号。
4. 请求体没有大小上限，超大的 JSON 可能耗尽内存（`server/lib/http.ts:93`）。建议读取前先检查 `Content-Length`，例如超过 1 MB 就拒绝。
5. 邀请时"是否已是成员"的检查在事务外面；邮件在事务提交后才发送，发送失败了邀请却还在（`server/workspaces/service.ts:219-246`）。建议把检查移进事务；发送失败时记录告警，或撤销这次邀请。

## 来自 S2 第 1 轮审查（已在代码中核实第 1、3 条）

7. **[优先]** 取消的结果会被"成功"覆盖：`finishSucceeded`（`server/jobs/engine.ts:656-670`）无条件把状态写成 `succeeded`，失败分支有"已取消就不覆盖"的保护（:641），成功分支却没有。如果在 synthesize 调用刚返回时取消，任务会变回成功，报告也会被保存。建议给 UPDATE 加上 `AND status <> 'canceled'`，并在写报告之前再检查一次状态。
8. **[优先]** `citationsOf(reportId)` 只按 reportId 查询，没带 `workspace_id`（`server/jobs/engine.ts:864`），违反 architecture §3 的"必须"。目前两个调用方都先经过按工作区校验的 `getReportRow`，所以不会泄露，但这是个潜在隐患。建议加上 `workspaceId` 参数和条件。
9. analyze 阶段的进度不随子问题推进：`completed` 是用循环外的快照算的（`engine.ts:562/583`），进度一直停在第一个子问题的位置。
10. `document_chunks` 没有 `(document_id, idx)` 唯一约束。重启恢复和新建资料的后台处理同时进行时，可能插入重复的块（`schema.ts:126-138`、`service.ts:122-147`）。
11. `recoverStale` 里的文档恢复 SQL 实际上什么也没改，却会把所有处于 processing 状态的资料重新处理一遍，包括正在正常处理的（`engine.ts:286-294`）。
12. 真实模型输出 `[1,2]` 这种多编号引用时，系统不会为它生成引用记录，但前端会照样显示这个标记（`engine.ts:757` 和 `markdown.tsx:17` 的解析规则不一致）。假模型只输出单个编号，所以验收测不到。

## 来自 S3 第 1 轮审查（已在代码中核实第 1、2、4 条）

13. **[优先]** 生产环境缺配置时会悄悄用假模型：`MODEL_PROVIDER` 没设置时默认是 `fake`（`server/model/provider.ts:9`）；而"真实模式缺单价就拒绝启动"的检查（`scripts/check-config.mjs`）只在验收用的启动脚本里执行，`npm start` 不会经过它。两者叠加，正式部署时漏配一个变量，就会悄悄产出假报告、按假费用计费。建议：非测试模式下必须显式设置 `MODEL_PROVIDER`，否则拒绝启动；配置检查放到所有启动路径上（例如 instrumentation 或 `npm start` 的前置步骤）。
14. **[优先]** 真实模式下，预留费用可能低于实际费用：预估时把输出固定按 2000 个 token 计（`provider.ts:38`），实际输出更长时会超出预留，破坏"单个任务不超预算"这条不变式。没配单价时预估值是 0（`provider.ts:36`）。建议调用模型时传入 `max_tokens`，并用同一个值来计算预留。
15. 后台任务内部的几处查询（`stagesOf`、`jobStatus`、`citationsOf`，见 `engine.ts:98/411/1019`）只按 ID 查询，没带 `workspace_id`。目前调用方都在后台任务内部，或已先做过工作区校验，所以不会泄露。与第 8 条合并处理。
16. 金额读回时转成了 JS `number`（`schema.ts:241,255`、`budget.ts:73,81`），超过 2^53 微美元会丢精度。以现实的预算量级影响很小。
17. 非测试模式下邮件根本不发送（`sender.ts:43-50`）。对应 H2 的默认值；要接真实邮件服务需要人来决定（开账号、配 key）。
（S3 审查第 3 条"analyze 阶段进度不推进"与第 9 条相同。）

## 来自 S4 第 1 轮审查（已在代码中核实第 1 条；第 3 条按 H2 不算缺陷）

18. **[优先]** 真实模式下已付费的调用可能没记进账本，破坏"已花费不超过预算"：(a) 模型调用成功后若 `input.signal.aborted`，直接抛 `ModelCanceled` 并释放预留，没写用量行（`engine.ts:546`、`chat/service.ts` 的 `signal.aborted` 分支）；(b) 研究任务里记账写库失败时只释放预留再重抛（`engine.ts:550-573`）；聊天里 `recordUsage` 失败时预留保持不动，这是保守的做法，不要改成释放，但要让重启恢复时能把它补记成一行用量；(c) 启动时 `releaseAllReservations()` 删光所有预留（`budget.ts:170`），正在进行的已付费调用既没有 spent 也没有 reserved。fake 模型下测不到。与第 14 条一起处理：调用成功就必须先记账，记账失败要保留预留（研究任务里也一样，不要释放），恢复时补记，而不是启动时一律删除。
19. 恢复失败后 worker 照常启动，且不再重试恢复：`ensureWorker` 先置 `started = true`，`recoverStale()` 失败后残留的 `running` 任务永远不会被恢复（`engine.ts:369-387`）。
20. 多次请求重置密码会并存多个有效令牌，旧链接在新令牌签发后仍可用，直到有人真正重置才清理（`auth/service.ts:126-172`）。
21. 删除是软删除：删除资料只清掉 chunks 并打 `deleted_at`，`extracted_text` 还留在行里；删除工作区只打 `deleted_at` 并删成员关系，资料、报告、消息、用量全部原样保留（`documents/service.ts:209-241`、`workspaces/service.ts:211-256`）。验收只要求"不可访问"，所以通过了，但 S4 阶段目标写的是"删除的东西真的删掉了"。如果以后要面向别人使用，需要物理清除或带保留期的定时清除，并把"数据库里不再有文本"写进验收。
22. 追问没有引用时自动补的"依据："是硬编码的中文（`chat/service.ts`），回答是英文时会混语言。
23. （同第 8、15 条）S4 新增的查询基本都带了 `workspace_id`；审查指出的剩余几处与第 15 条相同，合并处理。

## 来自集中修复轮之后的复审（S4-r2，2026-10-18；第 24、25 条已在代码中核实）

24. **[高，修复轮引入的回归]** 修第 19 条时加的"恢复失败后每 2 秒重试"会和已经启动的 worker 并发：恢复失败后 `startTicking()` 先启动并把任务 claim 成 `running`，随后重试的 `recoverStale()` 又把所有 `running` 行改回 `queued`，并把进行中的预留按 error 结算，于是同一个任务被二次执行、二次计费，账本重复（`engine.ts:340-440`，`budget.ts` 的 `recoverReservations`）。只在启动时恢复失败（比如数据库瞬断）时才会触发，验收测不到。建议：恢复成功之前不启动 worker，或者恢复和 claim 共用同一把 advisory lock。
25. **[中，第 4 条没修完]** 文件上传先 `request.formData()` + `file.arrayBuffer()` 整个读进内存，之后才检查 10 MB（`app/api/workspaces/[ws]/documents/route.ts:30-45`）。修复轮只给 JSON 请求体加了字节上限（`lib/http.ts`），multipart 没有。注册是开放的，所以任何人都可以注册账号后上传超大文件耗尽内存。建议：先看 `Content-Length`，并在流式读取时计数，超过上限就中止。
26. 删除工作区时，`in_flight` 的预留被直接丢掉，只结算了 `unsettled` 的（`workspaces/service.ts:238-265`），违反"花了钱的调用不能既没有账本又没有预留"。
27. 预算判定不一致：`engine.ts:163` 用 `spent + reserved >= budget`，`budget.ts:156` 用 `>`。

## 来自 S1 第 1 轮审查（暂缓）

6. 按邮箱限流可能被人恶意刷到锁号。对应 agent 提出的 Q3，需要先决定反向代理怎么传递客户端 IP。
