阻断 3 | 应修 13 | 建议 11 | 追溯缺口 15 | 可用性 3/5 | 结论: 修后可用

# audit-and-data-export 独立审查 r1

审查对象：MODULE.md、contract.md、acceptance-plan.md、decisions.md，对照 HOST.md、modules.json；另参考 auth、workspaces-and-permissions 两份契约做跨模块一致性核对（只读）。
篇幅：MODULE 12283B（≤15KB）、contract 14274B（≤17KB）、plan 10233B（≤13KB）、decisions 4081B（≤7KB），均未超限。
通过标准：阻断 0 且 应修 ≤3。本轮阻断 3、应修 13，不通过。
总评：结构完整，规则编号、追溯表和"建议，验收不测"分区的纪律都不错。问题集中在三处：几条用例与规则/决策互斥或无法执行；IP 规则与 auth 模块冲突且可伪造；审计"只追加"与假名化、保留清理没有说清。

统计口径：「追溯缺口」是第 4 节表里"规则没有用例，或用例没覆盖规则关键子句"的条数；应修第 7 条是它的汇总，不重复计数。

---

## 一、阻断（3）

### B1 [一致] AC-28 / R-DEL-09 / R-DEL-08 / D-04 互斥，且请求体未定义
- 位置：acceptance-plan AC-28；contract R-DEL-08、R-DEL-09、R-DEL-01；decisions D-04、D-12。
- 为什么：
  - D-04 的默认是"只有整个工作区与本人两种主体，不提供按成员邮箱删除他人数据的接口"。AC-28 却要求 owner 对 E28a..d 四个邮箱用 `subjectEmail` 提交删除请求。按默认实现的宿主没有这个入参，AC-28 无法执行。
  - R-DEL-08 规定"同工作区最多 1 个未完成请求，再次提交 → 409"。R-DEL-09 规定"恒 202"。AC-28 的 given 没有说明四个请求是否在同一工作区。同一工作区则第二个起必然 409，与"恒 202"互斥。
  - 若 409 只对存在的账号返回，它本身就是枚举信号，而 R-DEL-09 没有覆盖。
  - contract 全文没有定义 `deletion.request` 的请求体字段（主体类型、`subjectEmail`、`subjectType` 取值）。
- 修法：先在 D-04 定死主体模型，再改 R-DEL-01 / R-DEL-08 / AC-28。
  1. 契约写明请求体 `{"subjectType":"self|member|workspace","subjectEmail"?}`。
  2. R-DEL-09 改成"若宿主提供按邮箱提交的形式，则……"，宿主未声明记"宿主未声明"。
  3. R-DEL-08 的 409 与 R-DEL-09 的"恒 202"各自限定适用范围。建议 R-DEL-08 的范围按"主体"而不是"工作区"，并要求对不存在、未验证账号走同一分支。
  4. AC-28 每个例子用独立工作区，或明确写成"主体不同则互不占用"。

### B2 [安全][一致] 客户端 IP 规则可被客户端伪造，且与 auth 模块互斥（R-AUD-08 / AC-07）
- 位置：contract R-AUD-08（`trustedProxyCidrs=[]` 默认）；AC-07；MODULE 判断 6、§四第 5 条。对照 auth 契约 G11。
- 为什么：
  - 规则只描述"从右往左跳过受信地址"，没有先判断直连对端是不是受信代理。默认名单为空时，AC-07 期望 `ip=198.51.100.7`。直连对端（测试客户端）并不受信，等于信任任意客户端自带的 XFF，攻击者发一个 `X-Forwarded-For: 1.2.3.4` 就能伪造审计 IP。业界做法（Express trust proxy、nginx realip）是：对端不在受信名单内，就忽略该头，直接用对端地址。
  - auth G11 明确写"受信代理名单由 params 声明，未声明则忽略该头"。workspaces WSP-048 是"未声明取最右一项"。同一个宿主按 auth 实现就过不了 AC-07，按 AC-07 实现就违反 auth，三个模块互相冲突。
  - 测试客户端地址是 127.0.0.1 还是别的，宿主之间不同，AC-07 只在"宿主声明了受信网段"时才可复现。
- 修法：
  1. R-AUD-08 改成：对端地址不在 `trustedProxyCidrs` → 忽略 XFF，取对端地址。对端受信 → 从右向左跳过受信跳，取第一个非受信地址。
  2. AC-07 拆成两种场景。A：`trustedProxyCidrs` 为空，伪造 XFF 后 `ip` 必须等于对端地址，不得等于任何 XFF 值。B：宿主声明了包含测试客户端的网段，才测"最右非受信跳"，三个值用不同地址（如 `203.0.113.9, 198.51.100.7, <受信>`），断言取中间那个。
  3. 与 auth、workspaces 对齐成同一条公共规则，放进 HOST.md。

### B3 [可执行] 删除执行后，AC-25/26/29（及 AC-24）的操作者与主体是同一个人，会话已被作废，用例无法执行
- 位置：AC-25、AC-26、AC-29、AC-24；contract R-DEL-06、D-04（默认"本人"）。
- 为什么：
  - AC-25 的 U25 既是被删主体，又是后续 `deletion.status`、`audit.list`、W25 成员列表的调用者，同时还是 `run_due` 的权限持有者。执行完成后 U25 的会话立刻 401，后续步骤全部拿不到数据。
  - AC-25 里"W25 成员列表不含 U25"和"U25 另一工作区成员列表仍在"没有写清由谁来读。
  - AC-29 里解除 hold 后再执行成功，之后还要 `retention.run_due`，同样是被删主体在用会话。
  - 若 U25 是 W25 的唯一 owner，则执行后 W25 没有 owner。workspaces WSP-032/034 禁止这种状态，契约却没有定义冲突怎么处理（拒绝？转移？还是标 `blocked`？）。
- 修法：用例 given 明确"第二管理员 A2（同工作区，持有 `audit.delete.execute`、`audit.read`）"，所有执行后的读取都用 A2 的会话。契约补一条：被删主体是唯一 owner 时的行为（建议 `blocked` 并给固定原因码，或拒绝创建请求），并补用例。

---

## 二、应修（13）

### Y1 [一致] 错误码和权限位与其他模块不对齐
- 位置：contract R-COM-01/02/03、§1 权限位。
- 为什么：
  - 本模块用大写 `UNAUTHENTICATED`/`FORBIDDEN`/`NOT_FOUND`/`METHOD_NOT_ALLOWED`，auth 和 workspaces 全部是小写（`unauthenticated`、`forbidden`、`workspace_not_found`、`method_not_allowed`）。非成员访问时 workspaces 返回 `workspace_not_found`，本模块要求 `NOT_FOUND`。宿主同时满足两边是不可能的，除非按模块分别处理。
  - 契约称五个 `audit.*` 权限位"由 workspaces-and-permissions 判定"，但 workspaces 的 13 项权限目录里没有这五项，WSP-044 也没有它们。"默认仅 owner/admin 拥有"无处落地。
- 修法：错误码风格跟随 auth/workspaces（或在 HOST.md 统一一份错误码表，各模块引用）。契约声明"宿主需向 workspaces 注册这五个权限位，并让 owner/admin 默认持有"，并给 AC-02 补出获取普通成员的方法。

### Y2 [一致][安全] "只追加"与假名化、保留清理、摘要链三者没有协调
- 位置：R-AUD-02、R-AUD-06、R-DEL-06、R-RET-02、不变量①、MODULE §四第 2、10 条。
- 为什么：
  - R-AUD-02 写"无修改/删除条目的接口"，没有保留清理的例外，而 `retention.run_due` 就是删除审计条目的接口（MODULE 里有例外，contract 没有）。
  - R-DEL-06 要求把已写入条目里的个人标识换成假名，这就是修改条目。若摘要覆盖标识字段，改完后 `audit.integrity` 必然 `valid=false`。契约没说摘要是否覆盖标识字段，也没说假名化之后 integrity 应不应通过。
  - 清理最旧条目后，剩余第一条的 `prevDigest` 非空且指向已不存在的条目，R-AUD-06 的"首条为空或等于前一条 digest"无法成立，integrity 也无法定义。
  - AC-25 没有检查假名化之后 `audit.integrity`；AC-30 没有检查清理之后的 integrity。
- 修法：
  1. 契约写明做法：摘要只覆盖不含个人标识的字段，标识放在可替换的"主体引用"，或用"主体 → 假名"映射表实现 crypto-shredding，条目本身不改。
  2. R-AUD-06 补一句："清理后以保留窗口内最老一条的 `prevDigest` 为锚（或写入清理检查点）"。
  3. R-AUD-02 补"保留清理除外，且按 R-RET-03 留痕"。
  4. AC-25、AC-30 各补一次 `audit.integrity` 断言。

### Y3 [安全][追溯] `audit.record` 作为"服务内部"却占用公开路径，且 AC-04 没测 POST
- 位置：contract §1（`audit.record POST audit/events 服务内部`）、R-AUD-01、R-AUD-02；AC-04。
- 为什么：
  - `audit.record` 与 `audit.list` 同路径 `audit/events`，若宿主把它映射成可路由的 HTTP 端点，任何登录者都能伪造审计条目，这是审计模块最典型的伪造面。契约只写"服务内部"，没有写"必须不可被外部 HTTP 调用"。
  - R-AUD-01 里"宿主提供 `audit.record` 映射时必须写入 auth/workspaces 事件"的语义含糊：映射存在是否意味着它是 HTTP？黑盒无法判断它是不是"内部"。
  - AC-04 只测 PUT/PATCH/DELETE，不测对 `audit.list` 路径发 POST。
- 修法：
  1. 改 R-AUD-02：对审计路径的 POST 也必须不能创建条目（`405`，或 `404`/`403` 且条目数不变）。AC-04 增加 POST。
  2. 把"宿主是否写入 auth/workspaces 事件"改为：不依赖 `audit.record` 映射，直接用"执行该动作后 `audit.list` 是否出现对应条目"判定，宿主声明了对应动作概念才测。

### Y4 [缺口][安全] 邮件链接的主机来源没有约束（Host 头投毒）
- 位置：R-EXP-04、R-DEL-01（`data.link`）；HOST.md `APP_BASE_URL`。
- 为什么：这是 reset-link poisoning 的经典漏洞。若 `data.link` 用请求的 `Host` / `X-Forwarded-Host` 拼接，攻击者带伪造 Host 发起导出，受害人收到指向攻击者域名的链接，点击即泄露令牌。契约和用例都没有覆盖。
- 修法：增加 MUST"`data.link` 的源必须等于 `APP_BASE_URL`，不得取自请求头"。用例：带 `Host: evil.example` 和 `X-Forwarded-Host: evil.example` 发起导出与删除请求，断言 `data.link` 以 `APP_BASE_URL` 开头。

### Y5 [可执行] 多个接口的请求/响应形状缺失，脚本无法写
- 位置：contract §1、§3、§4、§5；plan 多处。
- 缺口清单：
  - `audit.list` 的响应包络（数组字段名、`nextCursor` 名、游标入参名）。
  - `export.list`、`legal_hold.list/set`（体里的 `on`、范围 workspace 或 对象、对象 id）。AC-29 用了 `on=true`，契约里没有。
  - `deletion.request` 体（见 B1）。
  - `deletion.confirm` 的令牌放哪（体字段名？）。
  - `deletion.run_due`、`retention.run_due` 的响应体（执行了几个、范围是谁）。
  - `retention.run_due` 是否可指定类别。
  - `deletion.cancel` 的 200 体。
- 修法：在 contract 的"概念"表后补一张"请求/响应最小字段表"，把验收要读的字段全部列出。没写的字段，脚本不得依赖。

### Y6 [可执行][一致] 全局时钟与用例顺序；用例间依赖与"不共享状态"自相矛盾
- 位置：plan §0、AC-15、AC-26、AC-11、AC-16/24/25/29/30；HOST.md §3（时钟全局）。
- 为什么：
  - `clock.advance` 是整个应用共享的，只增不减。AC-16、AC-24、AC-25、AC-30 各推进 1 小时到 7 天以上，会让并行或后续用例里的会话、令牌、宽限期提前失效。计划没有要求串行，也没有要求"推进后重新建立 fixture"。
  - §0 说"每条用例全新账号、不共享状态"，但 AC-15 沿用 AC-14 的令牌，AC-26 沿用 AC-25 的请求，直接依赖前序用例。
  - AC-11：`exportMinIntervalSeconds` 允许为 0，导出可能瞬间完成。此时第二次请求合法地得到 202，而 AC-11 要求 409。规则本身（R-EXP-01）措辞"间隔 ≥ N 且同时最多 1 个"也有歧义，是并列条件还是任一条件？
- 修法：
  1. 计划明确"涉及时钟的用例串行执行，放在最后；之后的用例用相对时间"。
  2. 把 AC-15、AC-26 并入 AC-14、AC-25，或在前提里写明有序依赖。
  3. R-EXP-01 拆成两条：并发闸门（未完成时再请求 → 409）、频率闸门（间隔内再请求 → 409，仅当 `exportMinIntervalSeconds>0`）。AC-11 要么先注入慢任务，要么只在 `exportMinIntervalSeconds>0` 时断言。

### Y7 [追溯] 追溯表声称"每条规则恰好映射"，实际多条规则只覆盖了一部分（15 条，见第四节）
- 位置：contract §8、plan 全表。
- 要点：R-AUD-01 的 25 个动作里只有约 5 个被断言，其余没有；R-AUD-05 六个过滤器只测了一个；R-EXP-11 的 `Content-Type` 没测；R-EXP-14 只测两项；R-DEL-10 只测 `executed`；R-RET-01 没比对 `retentionSeconds` 的值；R-RET-02 的审计条目和删除请求两类清理没测；§6 里"删除确认令牌只存摘要"的 MUST 没有任何用例。
- 修法：补用例或收窄规则。凡是黑盒无法诱发的，移入"建议"。表头改成"覆盖关键子句的用例"。

### Y8 [缺口] 权限位和跨租户访问只测了一个接口
- 位置：AC-02、AC-03；R-COM-02、R-COM-03。
- 为什么：
  - AC-02 只测普通成员读 `audit.list`。`export.request`、`deletion.request`、`run_due`（D-05 明确警告"开放给普通成员则任何人可手动触发删除"）、`legal_hold.set` 对缺权限者的 403 都没有测。
  - AC-03 只测 `export.status`。`audit.list`、`deletion.status/cancel`、`export.cancel`、`legal_hold.list` 用别的工作区 id，以及删除确认令牌属于别的工作区，都没有测。这是多租户审计模块被攻击的第一类面。
- 修法：用一张"概念 × 角色（owner / admin / member / 非成员 / 未登录）"矩阵驱动，每个概念至少一个 403/404/401 用例。

### Y9 [可执行] AC-29 的 hold 断言是空转的
- 位置：AC-29；R-DEL-07、R-RET-04。
- 为什么：对象要在 hold 下"仍存在"才有意义。但导出任务只有超过 `export_artifact` 保留期（默认 7 天，范围 1 小时..30 天）才会被清理。AC-29 只把时钟推进到 `executeAfter`（默认 7 天宽限），既没有保证对象已过期，也没有"无 hold 对照组"。宿主保留期设成 30 天时，不挂 hold 对象也还在，用例照样通过，什么也没证明。
- 修法：用例里把时钟推进到 `max(executeAfter, 导出创建时刻+保留期)+60`，并加对照：同样条件下未挂 hold 的另一个工作区的导出任务应被清理。

### Y10 [一致] R-RET-01 "缺失则不得 < 180 天" 与各类别的允许区间冲突
- 位置：R-RET-01；§1 保留期区间；D-10。
- 为什么：`export_artifact` 区间是 1 小时..30 天，`deletion_request` 下限是 30 天，都小于 180 天。"缺失则不得 < 180 天"适用于它们时，与契约默认值冲突，没有合规实现能满足。
- 修法：改成"缺失取本文默认值；`audit` 缺失则不得 < 180 天"。

### Y11 [缺口] 删除的主体范围和作用域没有定义
- 位置：R-DEL-04/06、D-04、MODULE §三第 6 条。
- 为什么：
  - D-04 说主体有"整个工作区"和"本人"，但 R-DEL-06 只描述了用户删除。删除整个工作区后的可观察行为（成员访问 404？数据清理？与 workspaces WSP-023 软删除的关系）没有规则。
  - 用户删除是全局账号删除，还是仅对本工作区？R-DEL-06 既要原会话失效、个人标识假名化，又说"其他工作区成员关系不受影响"，语义是全局。可是请求是由一个工作区的 owner/admin 发起的，该用户只要是这个工作区的成员，别的工作区就会受影响；契约没有说这是否被允许、以及是否需要主体本人确认。
  - `run_due` 是只处理本工作区到期请求，还是全局？全局则租户管理员能触发他人删除。
- 修法：契约写明 `subjectType` 取值及各自可观察效果；写明 `run_due` / `retention.run_due` 只作用于路径中的 `workspaceId`，跨租户 id 一律不处理。

### Y12 [可执行] AC-18 把四件无关的事塞进一个用例，且其中两件无法诱发
- 位置：AC-18；R-EXP-10、R-EXP-13、R-EXP-15。
- 为什么：
  - 超限（`EXPORT_TOO_LARGE`）需要把产物做到比 `exportMaxBytes` 大（下限 1024 字节），黑盒下没有办法造数据，除非宿主恰好把阈值设得很小。条件"已声明且超限"可能永远不满足。
  - CSV 转义需要夹具里有以 `=`、`+`、`-`、`@` 开头的值，计划没说用哪个字段（成员显示名？工作区名？）以及怎么注入。
  - 一个用例里任何一项失败就整条失败，定位困难。
- 修法：拆成 AC-18a（秘密不泄露）、AC-18b（CSV，写明用成员显示名 `=cmd|' /C calc'!A1` 注入）、AC-18c（超限，仅当宿主声明 `exportMaxBytes` ≤ 某阈值并提供 `TEST_MODE` 造大数据的夹具，否则记"宿主未声明"）。

### Y13 [一致][缺口] 登录失败等"认证前"事件归属于哪个工作区
- 位置：R-AUD-01、R-AUD-03、R-AUD-05；AC-05、AC-06。
- 为什么：条目要求 `workspaceId`，`audit.list` 又只返回调用者工作区的条目。登录失败发生时用户还没选工作区，邮箱可能根本不存在。条目该写进哪个工作区？写进"用户的所有工作区"会向所有租户泄露撞库信息；写进一个无主区域，则租户看不到。AC-05 期望在 `audit.list` 中看到 `auth.login_failed`，但契约没规定怎么归属。另外把攻击者提供的邮箱字符串写进租户审计，本身也是日志注入面。
- 修法：契约规定认证前事件的归属规则（例如用户已知时写入其所属工作区，未知邮箱不入租户审计，或 `workspaceId` 为空只对平台级可见），并让 AC-05/06 与之对齐。

---

## 三、建议（11）

- S1 [安全] 单次下载用 GET 消费状态，会被邮件安全扫描器、链接预取先消耗掉（D-02 已知风险但没给缓解）。令牌放 query 会进代理日志和 Referer。建议：邮件链接指向落地页，落地页再 POST 下载；或下载对 `HEAD`/预取不消耗。此条放入"建议，验收不测"。
- S2 [安全] "不可逆假名"没有给出做法。无盐的 SHA-256(email) 可被字典还原。建议使用随机假名或带密钥 HMAC，并补充 IP、`userAgent`、`actorLabel` 同样处理。可测的部分：断言条目中不出现邮箱的 md5/sha256 明文哈希。
- S3 [缺口] 并发竞态没有任何用例：同一令牌并发两次下载只能有一次 200；同一时刻两个 `export.request`（不同幂等键）只能有一个 202；并发写入下 `sequence` 无重复；两个并发 `run_due` 只产生一条 `deletion.executed`。计划里 AC-26 标"竞态"，实际是串行重复调用。
- S4 [一致] 缺规则的边角：未知导出令牌的状态码（MODULE 说 404，contract R-EXP 里没有，删除确认有 `404 LINK_INVALID`）；令牌既用过又过期时的优先级；下载成功后任务状态仍为 `ready`，此时 `export.cancel` 会成功并写 `export.cancelled`，与"终态不可取消"的直觉不符；属于已被清理任务的令牌返回什么。
- S5 [可观察] 以下 MUST 黑盒无法判定，应移入"建议"：`digest` 不等于任何明文值（R-AUD-06）、"不可逆假名"（R-DEL-06）、令牌熵 ≥128 bit（R-EXP-04）。若要保留可测版本，可改为令牌长度下限（如 ≥22 个 base64url 字符）。另外要求摘要列名含 `hash` 或 `digest` 是对宿主 schema 的硬约束，只当"读取摘要列"的启发式，不应作为失败依据。
- S6 [安全] `userAgent`、`actorLabel`、`metadata` 是用户可控内容，没有长度上限，也没有输出编码要求。建议：写入前截断（如 UA ≤256 字节），在 `audit.list` 返回中不改写但保证 `Content-Type: application/json`，并提醒前端输出转义。
- S7 [可观察] `outcome=denied` 没有用例会产生，也没规定哪些动作产生（例如 403 拒绝是否一定记 `denied`）；"失败原因用固定枚举"没有给出字段名（`metadata.reason`？）和枚举表，AC-05/06 只能检查"不是自由文本"，无法判定。
- S8 [安全] `deletion.confirm` 令牌持有者即可确认，没有绑定会话，邮件被转发或被邮件管理员读取就能确认删除。宽限期 + 可取消在一定程度上缓冲，但建议在决策项里列为明示的风险，并要求确认邮件发给被删主体而不是发起者。
- S9 [可执行] R-EXP-09 的 canonicalJson 只说"键递归字典序、无多余空白、UTF-8"，未规定非 ASCII 是否转义、数字格式、`/` 转义。中文姓名下，不同语言的实现（Python `ensure_ascii` 与 JS）会得到不同字节，校验和互不相认。建议直接引用 RFC 8785（JCS）。
- S10 [文字] 小问题合集：契约里用 "auth/workspaces" 简写，应写完整模块名 `workspaces-and-permissions`；§8 "每条规则恰好映射" 实际有的映射到两条，措辞不准；MODULE 状态机把 `blocked` 列为终态，但 R-DEL-07 说解除 hold 后可再执行；R-RET-03"每次清理一条 `retention.swept`"与 `metadata.category` 单值，一次清理多个类别时是一条还是多条没有说；"除下载外响应 `Content-Type: application/json`"未说明下载端点的 410/404 错误体是否为 JSON。
- S11 [缺口] 故障模式：邮件投递失败（outbox 写入失败）时导出任务应进入什么状态；任务执行中进程重启后能否恢复（async-jobs 接口）；导出过程中成员被删除或工作区被软删；时钟跳变。至少把前两条写进契约，并选一条做用例。

---

## 四、规则 → 用例追溯表（自建核对）

标记：OK 表示用例覆盖了规则的关键子句；部分 表示用例存在，但有关键子句没有断言；无 表示没有用例。

| 规则 | 用例 | 判定 | 缺的子句 |
|---|---|---|---|
| R-COM-01 | AC-01 | OK | |
| R-COM-02 | AC-01,02 | 部分 | 只测 audit.list（见 Y8） |
| R-COM-03 | AC-03 | 部分 | 只测 export.status |
| R-COM-04 | AC-04 | 部分 | 只测审计路径的 405 |
| R-COM-05 | AC-05 | OK | |
| R-AUD-01 | AC-05 | 部分 | 25 个动作里只断言 export.requested、auth.login、auth.login_failed；AC-20/25/29/30 另外覆盖 downloaded、executed、blocked、swept；其余动作无断言（含 legal_hold.*、export.cancelled/expired/failed/completed、deletion.requested/confirmed/cancelled、auth.logout 等） |
| R-AUD-02 | AC-04 | 部分 | 无 POST（Y3） |
| R-AUD-03 | AC-05 | OK | |
| R-AUD-04 | AC-08 | OK | 游标参数名未定义（Y5） |
| R-AUD-05 | AC-08 | 部分 | 只测 `action` 过滤；actorId/targetId/outcome/since/until/组合无断言 |
| R-AUD-06 | AC-09 | OK | 假名化、清理之后的 integrity 无断言（Y2） |
| R-AUD-07 | AC-06,13 | OK | |
| R-AUD-08 | AC-07 | 有缺陷 | 见 B2 |
| R-AUD-09 | AC-05 | 部分 | `denied` 从未产生（S7） |
| R-AUD-10 | AC-30 | OK | |
| R-EXP-01 | AC-10,11 | 部分 | 频率闸门（间隔）无独立断言（Y6） |
| R-EXP-02 | AC-12 | OK | 24 小时窗口、跨工作区同 key 无断言（可作建议） |
| R-EXP-03 | AC-10 | OK | |
| R-EXP-04 | AC-13 | OK | 熵不可测（S5） |
| R-EXP-05 | AC-15 | OK | 依赖前序用例（Y6） |
| R-EXP-06 | AC-16 | OK | |
| R-EXP-07 | AC-17 | OK | |
| R-EXP-08 | AC-14 | OK | |
| R-EXP-09 | AC-14 | OK | canonicalJson 歧义（S9） |
| R-EXP-10 | AC-18 | OK | |
| R-EXP-11 | AC-14 | 部分 | `Content-Type` 无断言 |
| R-EXP-12 | AC-19 | OK | |
| R-EXP-13 | AC-18 | 部分 | 无法诱发（Y12） |
| R-EXP-14 | AC-20 | 部分 | 只断言 requested、downloaded；completed/failed/cancelled/expired 无断言 |
| R-EXP-15 | AC-18 | 部分 | 无夹具（Y12） |
| R-DEL-01 | AC-21 | OK | 请求体未定义（Y5） |
| R-DEL-02 | AC-22,23 | 部分 | `LINK_EXPIRED`（确认令牌超时）无断言 |
| R-DEL-03 | AC-24 | 部分 | "非本人 → 403"无断言，且"本人"未定义；"已取消再取消"无断言 |
| R-DEL-04 | AC-25,26 | 有缺陷 | 见 B3 |
| R-DEL-05 | AC-25 | 部分 | 仅断言取值在枚举内；`failed` 不可诱发 |
| R-DEL-06 | AC-25 | 有缺陷 | 见 B3、Y2 |
| R-DEL-07 | AC-29 | 部分 | Y9 |
| R-DEL-08 | AC-27 | OK | 与 AC-28 冲突（B1） |
| R-DEL-09 | AC-28 | 有缺陷 | 见 B1 |
| R-DEL-10 | AC-25 | 部分 | 只看 `executed`；requested/confirmed/cancelled/blocked 的 `metadata` 无断言 |
| R-RET-01 | AC-30 | 部分 | 未比对 `retentionSeconds` 与 params；`legalHold` 字段值无断言 |
| R-RET-02 | AC-30 | 部分 | 只测导出任务；审计条目、删除请求两类无断言 |
| R-RET-03 | AC-30 | OK | |
| R-RET-04 | AC-29 | 部分 | Y9 |
| §6 删除确认令牌只存摘要 | 无 | 无 | 只有 AC-13 覆盖导出令牌；删除令牌的摘要存储、outbox 外无明文没有用例 |

追溯缺口统计（部分或无的规则）：R-COM-02、R-AUD-01、R-AUD-05、R-AUD-09、R-EXP-01、R-EXP-11、R-EXP-13、R-EXP-14、R-EXP-15、R-DEL-02、R-DEL-03、R-DEL-10、R-RET-01、R-RET-02、§6 删除令牌存储，共 15 条。

反向（用例追溯到规则）：30 个用例均能对应到至少一条规则，没有发现孤立用例。但 AC-15、AC-26 依赖前序用例（Y6）；AC-26 被"负向覆盖"标为"竞态"而实际是串行（S3）。

契约末尾追溯表与上表对比：所有规则编号和映射的用例编号一致，没有错号；不准确之处只有措辞"恰好映射"（S10）和第 4 节里列出的覆盖缺口。

---

## 五、各检查项结论

1. 安全/领域正确性：B2、Y3、Y4、Y2、S1、S2、S6、S8。其余做法正确：令牌只存摘要且熵足够、`no-store` 与 `no-referrer`、导出在查询层限定工作区、枚举统一响应、审计脱敏。
2. 可观察性：整体较好，大部分 MUST 能用 HTTP + outbox + 只读 SQL 判定。S5 列出的几条应移入建议区。Y12 的两项不可诱发。
3. 一致性：B1、B2、Y1、Y2、Y10、Y13；S4 与 S10 是小项。数值（TTL 3600、宽限 604800、确认 TTL 86400、保留期 400 天 = 34560000s、180 天 = 15552000s、7 年 = 220752000s）互相自洽，MODULE、decisions 与 contract 的默认值没有冲突。
4. 追溯：见第四节。
5. 可执行性：B3、Y5、Y6、Y9、Y12。令牌从 outbox 可取，数值从 params 可读，XFF 由脚本显式提供，这几项都成立。
6. 越界与引用：引用的模块名全部在 modules.json 内；没有出现品牌或厂商名。唯一问题是 Y1（权限位未登记在 workspaces）与 S10 的简写。MODULE §三成熟档里的"产物分片、压缩、断点续传"等属于增长项，已放在建议区，没有进 MUST。
7. 文字：未发现乱码或明显错字，篇幅均在限内。
8. 缺口：Y4、Y8、Y11、Y13、S3、S11。
