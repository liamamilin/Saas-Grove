阻断 1 | 应修 7 | 建议 11 | 追溯缺口 5 | 可用性 3/5 | 结论: 修后可用

# async-jobs 模块独立审查（r1）

对照 `HOST.md`、`modules.json` 与业界常见做法审查 `module/` 四文件。仅写本文件。

## 0. 审查范围与基础数据

- 模块：`async-jobs`（`modules.json` 中 tier=core，scope 含" survive restarts"）。
- 文件大小：`MODULE.md` 11996 B（≤15KB）、`contract.md` 13936 B（≤17KB）、`acceptance-plan.md` 9999 B（≤13KB）、`decisions.md` 3978 B（≤7KB），均未超限。
- 未发现错字/乱码；引用的模块名均在 `modules.json` 中；未发现品牌/厂商名。
- 本模块不直接做请求级限流/IP 封禁，符合"不越界"（交给 `rate-limiting`/`web-security`）。

## 1. 规则 → 用例 追溯表（我方重建）

| 规则 | 契约追溯表 | 我方判定 |
|---|---|---|
| R-AUTH-1 | AC-10 | 覆盖 |
| R-AUTH-2 | AC-11, AC-24 | 覆盖（AC-24 为令牌跨任务，表未列，见问题 18） |
| R-AUTH-3 | AC-12 | 有条件覆盖（宿主需暴露账号状态） |
| R-AUTH-4 | AC-11 | 部分覆盖；令牌/任务绑定见 AC-24，表未映射 |
| R-SUB-1 | AC-01 | 部分覆盖；随机性/非推导性未测 |
| R-SUB-2 | AC-02 | 部分覆盖；"类型名不作代码/模板路径"未测 |
| R-SUB-3 | AC-03 | 覆盖 |
| R-SUB-4 | AC-04 | 覆盖 |
| R-SUB-5 | AC-05 | 覆盖 |
| R-SUB-6 | AC-06–09 | 覆盖（a/b/c/d） |
| R-STATE-1 | AC-01,13,14,15,30 | 覆盖 |
| R-PROG-1 | AC-01,30 | 覆盖 |
| R-STEP-1 | AC-16,30 | 覆盖；AC-18 也验证 effectKey，表漏（问题 19） |
| R-CANCEL-1 | AC-13,14,18 | 表错误：AC-18 无取消（问题 5） |
| R-RETRY-1 | AC-16,17 | 部分覆盖；非可重试错误分类未测（问题 12） |
| R-RETRY-2 | AC-21 | 覆盖，但与 I-5 互斥（问题 1） |
| R-TIME-1 | AC-19,20 | 覆盖 |
| R-TIME-2 | AC-17,19,20 | 覆盖 |
| R-PERSIST-1 | AC-18,20,29 | 表错误：仅 AC-29 沾边；重启未测（问题 6/14） |
| R-RESULT-1 | AC-22 | 覆盖 |
| R-TOKEN-1 | AC-23 | 覆盖 |
| R-TOKEN-2 | AC-24 | 覆盖 |
| R-TOKEN-3 | AC-25 | 覆盖 |
| R-TOKEN-4 | AC-26 | 覆盖 |
| R-TOKEN-5 | AC-23 | 无有效用例（问题 7） |
| R-DATA-1 | AC-09,23,27 | 覆盖 |
| R-LIMIT-1 | AC-11,28 | 覆盖；params 相容性未约束（问题 16） |
| R-OUTBOX-1 | AC-18 | 覆盖 |

- **没有用例的 MUST**：`R-TOKEN-5`（哈希算法升级）没有任何能观察到其成立的用例；`R-PERSIST-1` 的"重启后仍可读"也没有重启步骤。
- **追溯不到规则的用例**：无完全无对应规则的用例；`AC-30` 追溯到不变量 `I-1..I-7` 与 `R-STATE-1`/`R-PROG-1`/`R-STEP-1`。
- **契约追溯表准确性**：存在 5 处映射错误/遗漏（问题 5、6、7、18、19）。

## 2. 问题清单

### 阻断

1. [一致] **阻断** — `contract.md` §7 `I-5` 与 §4 `R-RETRY-2`、`acceptance-plan.md` `AC-21` 互斥。  
   - 引用：`I-5` "0≤attempt≤maxAttempts 且只增不减"；`R-RETRY-2` "attempt 继续增长"；`AC-21` "重跑前 … attempt=M；… 之后 succeeded、attempt>M"。  
   - 为什么：自动重试上限为 `maxAttempts`，但手动重跑要求 `attempt` 超过 `maxAttempts`，没有实现能同时满足 `attempt≤maxAttempts` 与 `attempt>M`。  
   - 修法：把 `I-5` 改为"自动重试阶段 attempt≤maxAttempts，手动重跑允许 attempt 超过 maxAttempts"，或拆分 `autoAttempt` 与 `manualRetryCount`。

### 应修

2. [一致] **应修** — `MODULE.md` 不变量 1 的状态机遗漏 `cancelling` 与租约回收重排。  
   - 引用：`MODULE.md` "状态机封闭：`queued → running → succeeded/failed/cancelled`"；`contract.md` §2 "合法迁移：`queued → running|cancelled|failed`；`running → succeeded|failed|cancelling|queued`（末者为租约回收重排）；`cancelling → cancelled|failed|succeeded`"。  
   - 为什么：认知模板与硬契约状态集不一致，实现者可能不实现 `cancelling` 或重排。  
   - 修法：同步 `MODULE.md` 不变量 1 为契约 §2 的六状态与迁移。

3. [一致] **应修** — 退避上限与 params 上限不一致。  
   - 引用：`contract.md` §4 `R-RETRY-1` "退避有界（首次 ≤ 60s、其后 ≤ 300s，实际值 `params.retryBackoffSeconds`）"；§5 "`retryBackoffSeconds` 1..60（5）"。  
   - 为什么：`retryBackoffSeconds` 最大 60，无法表达"其后 ≤300s"的后续退避，验收脚本只能猜公式。  
   - 修法：拆分为 `retryBackoffBaseSeconds`/`retryBackoffMaxSeconds`，或明确倍数与上限公式。

4. [一致] **应修** — params 相容性未约束。  
   - 引用：`contract.md` §5 "`maxConcurrentPerWorkspace` 1..64（默认 1）"、"`queueLimitPerWorkspace` 1..100（20）"；§4 `R-LIMIT-1` "`queued`+`running` ≤ queueLimitPerWorkspace" 且 "`running` ≤ maxConcurrentPerWorkspace"。  
   - 为什么：允许 `maxConcurrentPerWorkspace=4`、`queueLimitPerWorkspace=1`，此时无法同时满足并发上限与队列上限。  
   - 修法：在 §5 或 HOST params 校验中声明 `maxConcurrentPerWorkspace ≤ queueLimitPerWorkspace`。

5. [追溯] **应修** — 追溯表把 `R-CANCEL-1` 映射到 `AC-18`，但 `AC-18` 没有取消动作。  
   - 引用：`contract.md` §9 "R-CANCEL-1 | AC-13, AC-14, AC-18"；`acceptance-plan.md` `AC-18` "submit `demo.email` … 等所有 attempt 结束 … 恰好 1 条"。  
   - 为什么：`AC-18` 测副作用去重，不测取消；映射造成"取消规则已覆盖"的假象。  
   - 修法：移除 `AC-18`，保留 `AC-13/14`；如需测取消+副作用，新增用例。

6. [追溯] **应修** — 追溯表把 `R-PERSIST-1` 映射到 `AC-18/AC-20`，二者都不验证持久化/重启。  
   - 引用：`contract.md` §9 "R-PERSIST-1 | AC-18, AC-20, AC-29"；`acceptance-plan.md` `AC-18`（邮件去重）、`AC-20`（hang 重排）、`AC-29`（P1 只读扫描）。  
   - 为什么：`AC-20` 只能说明失联重排，不能说明进程重启后任务仍可读；`AC-18` 与持久化无关。  
   - 修法：保留 `AC-29`，并按问题 14 补重启用例或明确 HOST 重启步骤。

7. [追溯] **应修** — `R-TOKEN-5` 映射到 `AC-23`，但 `AC-23` 不测哈希升级/双键。  
   - 引用：`contract.md` §4 `R-TOKEN-5` "哈希升级用双键（旧新并存直到旧令牌全部过期）"；§9 "R-TOKEN-5 | AC-23"；`acceptance-plan.md` `AC-23` "再调一次得不同令牌"。  
   - 为什么：签发两次不同令牌无法证明旧哈希在升级期间继续有效。  
   - 修法：将 `R-TOKEN-5` 移入 §8 建议，或定义可观察的迁移验收。

8. [可观察] **应修** — 多条 MUST 在 HOST 黑盒下不可判定，却留在 MUST。  
   - 引用：`HOST.md` §3b "黑盒下观察不到的建议 … 写在 contract 的'建议，验收不测'一节，不放进 MUST"；`contract.md` §4 `R-TOKEN-5`、`R-SUB-1`（≥128 bit 随机/非推导）、`R-SUB-2`（类型名不作路径）、`R-AUTH-3`（宿主需暴露账号状态）。  
   - 为什么：验收无法判定这些条款，形成"不可测的 MUST"，与 HOST §3b 矛盾。  
   - 修法：不可观察条款移到 §8；或补可观测代理（多 id 唯一性/不可推导、未知类型不触发副作用、升级前后旧令牌仍可用）。

### 建议

9. [安全] **建议** — 令牌放在 URL query，存在日志/Referer 泄露风险。  
   - 引用：`contract.md` §1 "`async-jobs.result` 的令牌授权形式为 `?jobId=<id>&token=<token>`"。  
   - 为什么：一次性令牌虽短 TTL，但 URL 常被代理/访问日志记录；契约未要求脱敏。  
   - 修法：在 §8 或 MUST 中要求访问日志与 Referer 不记录 `token`，或提供 header 授权形式。

10. [安全] **建议** — Origin/CSRF 校验仅属建议，写接口在未实现 `web-security` 时无强制来源校验。  
    - 引用：`contract.md` §8 `S-2` "写请求的来源校验（Origin/CSRF）复用 `web-security` 的允许来源集合"；`acceptance-plan.md` `AC-11` 负例 `Origin: https://evil.example` 仅"若宿主实现 §8 S-2"。  
    - 为什么：宿主若声明本模块但不实现 `web-security`，写接口可能无 CSRF 防护。  
    - 修法：把来源校验提升为 MUST（在宿主声明 web-security 时），或在模块声明中要求依赖。

11. [安全] **建议** — 未要求令牌哈希比较使用恒定时间。  
    - 引用：`contract.md` §4 `R-TOKEN-1` "库中只存哈希（P3）"。  
    - 为什么：字符串/哈希直接比较可能引入时序侧信道，帮助猜令牌。  
    - 修法：在 §4 或 §8 中要求比较使用恒定时间函数。

12. [缺口] **建议** — 非可重试错误分类未覆盖。  
    - 引用：`contract.md` §4 `R-RETRY-1` "区分'可重试'（超时、限流、5xx）与'不可重试'（参数非法、权限不足）"；§6 `demo.*` 无产生不可重试错误的类型；`acceptance-plan.md` `AC-16/17`。  
    - 为什么：验收无法触发不可重试分支，无法验证其不重试/直接 `failed`。  
    - 修法：增加 `demo` 类型或约定错误语义，并补用例。

13. [缺口] **建议** — 取消后"已发生副作用不回滚"未验证。  
    - 引用：`contract.md` §4 `R-CANCEL-1` "已发生的副作用**不回滚**"；`acceptance-plan.md` `AC-18` 只断言消息恰好 1 条，不涉及取消。  
    - 为什么：无法证明取消不会撤销已完成副作用。  
    - 修法：补"取消 `demo.email`（failAfterSend=true）后 outbox 仍 1 条"用例。

14. [缺口] **建议** — 无进程重启验收，尽管 scope 与 R-PERSIST-1 要求任务跨重启存活。  
    - 引用：`MODULE.md` "任务要活得比进程久"；`contract.md` §4 `R-PERSIST-1` "重启后 `get` 仍返回该任务及状态"；`HOST.md` §1 仅定义启动命令，无重启步骤。  
    - 为什么：`modules.json` scope 明确"survive restarts"，但验收计划没有重启步骤，HOST 也未定义如何重启。  
    - 修法：在 HOST §1 或契约中定义重启步骤，并补重启后 `get` 用例。

15. [缺口] **建议** — 跨工作区幂等键隔离未测。  
    - 引用：`contract.md` §4 `R-SUB-6` "按 (工作区, 键) 去重"；`acceptance-plan.md` `AC-06/07/08` 均在同一工作区。  
    - 为什么：无法证明不同工作区相同 `Idempotency-Key` 不会互相撞键。  
    - 修法：补跨工作区同键应产生两个任务的用例。

16. [缺口] **建议** — params 相容性与边界未约束。  
    - 引用：`contract.md` §5 bounds；`staleAfterSeconds` 5..600、`jobTimeoutSeconds` 5..3600。  
    - 为什么：允许 `staleAfterSeconds=600`、`jobTimeoutSeconds=300`，此时任务先超时，租约回收永远不会触发。  
    - 修法：声明 `staleAfterSeconds < jobTimeoutSeconds` 等相容性约束。

17. [可执行] **建议** — 退避公式未定义，`AC-17` 假设指数退避。  
    - 引用：`acceptance-plan.md` `AC-17` "再推进 `B×2^M+60`s"；`contract.md` §4 `R-RETRY-1` 仅给上下界。  
    - 为什么：实现采用其他有界策略时，时序用例可能不稳定。  
    - 修法：契约明确退避公式或验收只断言"延迟后才重试"而非固定倍数。

18. [追溯] **建议** — 追溯表未把 `AC-24` 纳入 `R-AUTH-4`。  
    - 引用：`contract.md` §9 "R-AUTH-4 | AC-11"；`acceptance-plan.md` `AC-24` "用 `result?jobId=T2&token=K1` … 401 `invalid_token`"。  
    - 为什么：`AC-24` 验证令牌/任务绑定，与 `R-AUTH-4` 的"绑定单一工作区/任务"相关，但表未映射。  
    - 修法：在追溯表补充 `R-AUTH-4 | AC-11, AC-24`。

19. [追溯] **建议** — 追溯表未把 `AC-18` 纳入 `R-STEP-1`。  
    - 引用：`contract.md` §9 "R-STEP-1 | AC-16, AC-30"；`acceptance-plan.md` `AC-18` "消息恰好 1 条"（effectKey 去重副作用）。  
    - 为什么：`AC-18` 实际验证 `effectKey` 至多一次副作用，但追溯表未列出。  
    - 修法：在追溯表补充 `R-STEP-1 | AC-16, AC-18, AC-30`。

## 3. 可观察性结论

- 大部分 MUST 可在 HOST 黑盒下判定（HTTP、outbox、只读 DB、时钟）。
- 不可观察项：`R-TOKEN-5`、随机性/非推导、类型名不作路径、恒定时间比较、哈希算法升级；应按 HOST §3b 移入"建议，验收不测"或补代理。

## 4. 一致性结论

- 状态机：MODULE 与 contract 不一致（问题 2）。
- 状态码/错误码：§3 与用例基本一致；`invalid_state`/`idempotency_key_conflict`/`token_used` 区分清晰。
- 数值：`retryBackoffSeconds` 与 R-RETRY-1 不一致（问题 3）；params 相容性未约束（问题 4/16）。
- 互斥用例：`I-5` 与 `AC-21`（问题 1）。

## 5. 可执行性结论

- 令牌、ID、params、请求头均可按 HOST §3 获取；时钟推进与 outbox 可用。
- 需要明确：重启步骤（问题 14）、退避公式（问题 17）、账号状态触发（`AC-12` 已标"宿主未声明"）。

## 6. 越界与引用结论

- 模块名均在 `modules.json`；未发现品牌/厂商名；未发现不属于本模块的内容被强纳入。

## 7. 文字与篇幅结论

- 未发现错字/乱码；四文件均在篇幅上限内。

## 8. 缺口（资深审查者视角）

- 并发/重放：幂等并发已测（AC-08），令牌并发已测（AC-25）；但租约过期与完成竞态、跨工作区幂等未测（问题 15）。
- 枚举：跨工作区返回 404 同形（AC-11），但 job id 随机性/非推导未测（R-SUB-1）。
- 租户隔离：跨工作区读写已测（AC-11），令牌跨任务已测（AC-24）；跨工作区令牌未测。
- 边界值：payload/result 上限已测；退避/超时/租约边界仅部分测。
- 故障模式：超时与失联已测；进程重启、毒任务隔离、重试风暴未测。

## 9. 汇总

- 阻断 1（问题 1）；应修 7（问题 2–8）；建议 11（问题 9–19）；追溯缺口 5（问题 5、6、7、18、19）；可用性 3/5；结论 修后可用。

阻断 1 | 应修 7 | 建议 11 | 追溯缺口 5 | 可用性 3/5 | 结论: 修后可用
DONE