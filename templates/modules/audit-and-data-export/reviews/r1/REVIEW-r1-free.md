阻断 1 | 应修 5 | 建议 10 | 追溯缺口 9 | 可用性 3/5 | 结论: 修后可用

# 独立审查：audit-and-data-export

## 1. 阻断

### Z1 [一致] decisions.md D-04 与 acceptance-plan.md AC-28 互斥
- 严重度：阻断
- 文件+引用：`decisions.md` D-04「只有"整个工作区"与"本人"两种主体，不提供"按成员邮箱删除他人数据"的接口」；`acceptance-plan.md` AC-28「owner 提交；E28a 正常、E28b 未验证、E28c 已禁用、E28d 不存在…分别 POST `deletion.request`（指定 `subjectEmail`）」；`contract.md` R-DEL-09。
- 为什么：决策默认禁止按邮箱删除他人数据，但验收用例要求 owner 以 `subjectEmail` 发起删除请求并覆盖 4 种账号状态（枚举安全）。没有任何实现能同时满足两者；按 D-04 实现会直接失败 AC-28，按 AC-28 实现则违反 D-04。
- 具体修法：二选一并写回：要么 D-04 改为"允许 owner 按邮箱发起，但必须遵守 R-DEL-09 统一响应"，要么 AC-28 改为本人/整工作区场景并调整枚举安全断言。

## 2. 应修

### A1 [追溯] R-AUD-01 mandated events 仅追溯到 AC-05
- 严重度：应修
- 文件+引用：`contract.md` §8 追溯表 `R-AUD-01→AC-05`；`contract.md` R-AUD-01 完整事件列表；`acceptance-plan.md` AC-05「至少 1 条 `export.requested`」。
- 为什么：R-AUD-01 要求记录 export.completed/failed/downloaded/cancelled/expired、deletion.*、retention.swept、legal_hold.applied/released 等，但 AC-05 仅断言 `export.requested`（及条件 auth 事件）。追溯表声称 AC-05 覆盖 R-AUD-01，与用例实际断言不符。
- 具体修法：追溯表拆分映射（如 R-AUD-01 的 export.* → AC-10/19/16/20，deletion.* → AC-21/22/24/25/29，retention.swept → AC-30），并在对应用例增加 audit.list 断言。

### A2 [追溯] R-DEL-10 审计写入仅验证 executed
- 严重度：应修
- 文件+引用：`contract.md` §8 `R-DEL-10→AC-25`；`contract.md` R-DEL-10；`acceptance-plan.md` AC-21/AC-22/AC-24/AC-29。
- 为什么：R-DEL-10 要求 deletion.requested/confirmed/cancelled/executed/blocked 全部写入审计且 metadata 含 requestId/subjectType，但 AC-21/22/24/29 均未检查 audit.list；只有 AC-25 检查 executed。
- 具体修法：在 AC-21/22/24/29 的 expected 中增加对应 audit 事件与 metadata 断言。

### A3 [追溯] R-RET-02 仅断言 export.status 404
- 严重度：应修
- 文件+引用：`contract.md` §8 `R-RET-02→AC-30`；`contract.md` R-RET-02；`acceptance-plan.md` AC-30。
- 为什么：R-RET-02 要求清理后 export.status→404、deletion.status→404、审计条目不再出现在 audit.list；AC-30 只断言 export.status 404，deletion 与 audit 未覆盖。
- 具体修法：AC-30 增加 deletion.status 404 与 audit.list 不含被清条目的断言，或新增用例。

### A4 [一致] AC-29 预期引用 export.status 但场景无导出任务
- 严重度：应修
- 文件+引用：`acceptance-plan.md` AC-29 expected「被 hold 覆盖的对象在 `retention.run_due` 后仍存在（`export.status` ≠ `404`）」；AC-29 given「E29 与 W29，请求已确认且到期」。
- 为什么：given 只有删除请求，没有导出任务；expected 却断言 export.status，字段与场景不对应，验收脚本无法执行。
- 具体修法：改为 `deletion.status` ≠ `404`，或在 given 中补充一个 ready 导出任务并说明 hold 覆盖对象。

### A5 [追溯] 删除确认令牌摘要存储无验收
- 严重度：应修
- 文件+引用：`contract.md` §6「导出下载令牌与删除确认令牌只存摘要（列名含 `hash` 或 `digest`…）」；`acceptance-plan.md` AC-13（仅导出令牌）、AC-22（删除确认）。
- 为什么：§6 明确两类令牌都只存摘要，但只有 AC-13 做只读 SQL 验证；删除确认令牌（AC-22）无对应数据库断言，存储形态不可判定。
- 具体修法：AC-22 增加只读 SQL：outbox 表外无明文，存在列名含 hash/digest 的摘要列且长度 ≥32 且 ≠ 明文。

## 3. 建议

### S1 [可观察] R-AUD-05 可组合过滤仅测 action
- 严重度：建议
- 文件+引用：`contract.md` R-AUD-05；`acceptance-plan.md` AC-08。
- 为什么：R-AUD-05 允许 action/actorId/targetId/outcome/since/until 组合过滤，AC-08 仅测 action 与 workspaceId，其余过滤器未覆盖。
- 具体修法：AC-08 扩展断言或新增用例覆盖 actorId/targetId/outcome/since/until。

### S2 [可执行] trustedProxyCidrs 跳过受信代理未测
- 严重度：建议
- 文件+引用：`contract.md` R-AUD-08、params `trustedProxyCidrs=[]`；`acceptance-plan.md` AC-07。
- 为什么：AC-07 在默认空 trusted 列表下仅区分左右两端，R-AUD-08 的核心"从右向左跳过 trustedProxyCidrs 内地址"分支未被验收。
- 具体修法：AC-07 增加 trustedProxyCidrs 非空场景，或新增用例。

### S3 [追溯] 追溯表 R-AUD-07 映射不贴切
- 严重度：建议
- 文件+引用：`contract.md` §8 `R-AUD-07→AC-06,AC-13`；`acceptance-plan.md` AC-06/AC-13/AC-20。
- 为什么：AC-13 校验导出令牌数据库存储，不校验审计条目脱敏；审计脱敏的直接断言在 AC-06（密码）与 AC-20（metadata 无令牌）。
- 具体修法：追溯表改为 `R-AUD-07→AC-06,AC-20`。

### S4 [追溯] R-AUD-04 未映射 AC-05
- 严重度：建议
- 文件+引用：`contract.md` §8 `R-AUD-04→AC-08`；`acceptance-plan.md` AC-05「`sequence` 严格递增」。
- 为什么：AC-05 也断言 sequence 严格递增，但追溯表未将 R-AUD-04 映射到 AC-05，双向追溯不完整。
- 具体修法：追溯表补充 `R-AUD-04→AC-05`（或注明 AC-08 为主要覆盖）。

### S5 [追溯] export.cancelled/expired 审计事件未断言
- 严重度：建议
- 文件+引用：`contract.md` R-EXP-14/R-AUD-01；`acceptance-plan.md` AC-19/AC-16。
- 为什么：R-EXP-14 要求 export.cancelled/expired 写入审计，但 AC-19/AC-16 未检查 audit.list，无法判定。
- 具体修法：AC-19/AC-16 增加 audit.list 断言（action=export.cancelled/expired，targetId=jobId）。

### S6 [缺口] 导出下载单次使用的并发原子性未定义
- 严重度：建议
- 文件+引用：`contract.md` R-EXP-05；`acceptance-plan.md` AC-15。
- 为什么：R-EXP-05 仅说"同一令牌第二次 → 410"，未规定并发两次请求的原子消费，实现可能两次都 200。
- 具体修法：contract 增加"令牌消费必须为原子条件更新"。

### S7 [安全] 令牌摘要比较未要求恒定时间
- 严重度：建议
- 文件+引用：`contract.md` R-EXP-04/R-DEL-02；`MODULE.md` 第十条判断 10（阈值为上下界，未提比较）。
- 为什么：令牌/摘要比较若用普通字符串比较，存在计时侧信道；契约未要求恒定时间比较。
- 具体修法：在 §6 或 R-EXP-04/R-DEL-02 增加"摘要比较须用恒定时间"（或放入"建议，验收不测"）。

### S8 [缺口] 保留清理后审计链完整性语义未定义
- 严重度：建议
- 文件+引用：`contract.md` R-RET-02、R-AUD-06；`acceptance-plan.md` AC-30。
- 为什么：清理移除旧审计条目后，剩余条目的 prevDigest 指向已删条目，audit.integrity 的判定语义未定义。
- 具体修法：明确清理后的链处理方式（重置首条 prevDigest 或保留链头摘要）。

### S9 [追溯] failed scope 与整体 failed 无用例
- 严重度：建议
- 文件+引用：`contract.md` R-DEL-05；`acceptance-plan.md` AC-25。
- 为什么：R-DEL-05 要求任一 scope 为 failed → 整体 failed（可重试），但 AC-25 仅覆盖 completed/skipped，failed 分支未测。
- 具体修法：新增用例或允许宿主声明一个会 failed 的 scope 以覆盖。

### S10 [追溯] 非本人取消删除的 403 未覆盖
- 严重度：建议
- 文件+引用：`contract.md` R-DEL-03「非本人 → 403+FORBIDDEN」；`acceptance-plan.md` AC-24。
- 为什么：R-DEL-03 明确非本人取消返回 403，但 AC-24 仅测本人取消与过期取消，403 分支未覆盖。
- 具体修法：AC-24 增加非本人账号取消的断言。

## 4. 其他检查
- 越界与引用：模块名均在 `modules.json`；未发现品牌/厂商名；MODULE.md §6 引用模块均存在。
- 文字与篇幅：MODULE.md 12283B(<15KB)、contract.md 14274B(<17KB)、acceptance-plan.md 10233B(<13KB)、decisions.md 4081B(<7KB)；UTF-8 无乱码；未发现明显错字。
- 可观察性：除上述追溯缺口外，每条 MUST 均有至少一个用例映射；不可观察项（HMAC 链头锚定、schema 兼容、压缩分片等）已置于 contract.md §7"建议，验收不测"。

DONE