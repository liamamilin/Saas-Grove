阻断 0 | 应修 6 | 建议 8 | 追溯缺口 4 | 可用性 3/5 | 结论: 修后可用

# payments-billing 独立审查（r1）

审查对象：`module/MODULE.md`、`module/contract.md`、`module/acceptance-plan.md`、`module/decisions.md`；对照 `HOST.md`、`modules.json`。文件篇幅：MODULE 12301B（≤15KB）、contract 14352B（≤17KB）、plan 10304B（≤13KB）、decisions 4112B（≤7KB），均未超限。

## 问题列表

### 应修（6）

1. [追溯] **contract.md §13/§14 + acceptance-plan.md 全表** — 测试钩子 TH-01~TH-04 未进入追溯表，且 TH-04（`TEST_MODE != 1` 时三个钩子路径必须 404）没有任何验收用例。  
   为什么：HOST.md §3b 要求每条 MUST 至少一个用例；TH-04 明文"必须 404"，但 PB-01~PB-30 均未覆盖非测试模式下的钩子不可用。TH-01~TH-03 仅被 PB-12/PB-15/PB-29 间接使用。  
   修法：新增 PB-31 覆盖 TH-04；在 §14 追溯表补 `TH-01 → PB-10/PB-15`、`TH-02 → PB-29`、`TH-03 → PB-29`、`TH-04 → PB-31`。

2. [一致] **acceptance-plan.md PB-17** — 期望"两张发票 `number` 不同且递增"，但前置为"管理+W 已付"且 §0 规定"每条用例用全新账号，不共享状态"，实际仅 1 张发票，无法满足。  
   为什么：用例不可执行/不可通过，属于计划层缺陷。  
   修法：前置改为"已创建两张发票（PB-10 + 一次续期/周期结束）"，或把期望改为"若存在多张发票则编号严格递增且不复用"。

3. [一致] **contract.md G-03 / 0.2 / acceptance-plan.md PB-04** — PB-04 期望 `workspace_not_found`/`not_found`，但 G-03 只规定"跨租户的发票/订阅/结账会话 → 404 `not_found`"，未定义工作区归属失败的错误码；0.2 却列出 `workspace_not_found`。  
   为什么：同一情形的错误码不唯一，宿主无法判定。  
   修法：G-03/CH-01 明确：工作区不存在或不属于调用者 → 404 `workspace_not_found`；发票/订阅/会话属他人 → 404 `not_found`。

4. [可执行] **contract.md DN-05 / acceptance-plan.md PB-24** — PB-24 假设 `DELETE /api/__test__/rate-limits` 能重置令牌失败计数，但契约未说明计数存储位置。  
   为什么：若实现按令牌持久化计数，清全局限流不会恢复令牌，用例无法通过；反之若计数在限流器里，契约又未声明。  
   修法：DN-05 明确失败计数是"按令牌的限流桶"且 `DELETE /api/__test__/rate-limits` 重置；或提供 payments-billing 专用重置钩子。

5. [安全] **contract.md WH-04** — "`version` 可省略（视为最新）"。  
   为什么：INV-03 要求"状态不得回退"；允许缺失 version 被视为最新，弱化乱序保护，迟到事件可能覆盖新状态。  
   修法：version 缺失按 0 处理（或要求必填），并在 WH-04 写明。

6. [安全] **contract.md CH-03** — 仅在 `Origin` 头存在且 host 不匹配时拒绝；缺失 `Origin` 时放行。  
   为什么：浏览器可省略 Origin，结账为状态变更端点，存在 CSRF 绕过风险；与 web-security 的分工未写清。  
   修法：CH-03 明确"缺失 Origin 的浏览器请求按 web-security 的 CSRF 规则处理，payments-billing 不单独放行"，或要求 Origin 必须存在。

### 建议（8）

7. [安全] **contract.md WH-01 / DS-01** — HMAC 与令牌比较未要求恒定时间。  
   为什么：签名/令牌比较若用普通字符串比较，存在时序侧信道。  
   修法：在 WH-01/G 说明比较必须常数时间。

8. [可观察] **contract.md DS-01/DS-02** — DS-01 要求结账会话令牌、幂等键也只存摘要，但 DS-02 只扫描催收令牌。  
   为什么：黑盒下无法验证 DS-01 的其余两项。  
   修法：DS-02 扩展扫描所有已知明文令牌；或把非可测项移入"建议，验收不测"。

9. [追溯] **contract.md CH-05 / WH-03** — 并发/重放去重仅按事件 `id`，未规定按会话/订阅去重。  
   为什么：PB-11 期望不同 event_id 的两次完成事件只激活一次，仅靠 WH-03 无法推出。  
   修法：新增规则（如 WH-10）："同一 checkout session 的完成事件只生效一次，第二次 `applied:false`"。

10. [追溯] **contract.md SB-04 / WH-06 / WH-09 / SB-05** — 多个分支无用例：SB-04 跨币种 400、WH-06 `invoice.created` 金额不一致、WH-09 `subscription.updated`/`subscription.deleted`、SB-05 不得缩短周期。  
    为什么：契约末尾追溯表声称覆盖，实际 PB 表未测这些分支。  
    修法：补充 PB-32~PB-35 或在追溯表注明"由 PB-10/PB-13 间接覆盖"。

11. [可执行] **contract.md WH-09 / CH-01** — PB-10 未说明 `checkout.session.completed` 如何绑定 workspace/plan（信封字段无 workspace_id/plan_key）。  
    为什么：宿主必须从会话 id 反查，但契约未写，验收脚本无法构造/判定。  
    修法：WH-09/CH-01 说明完成事件的 `data.object.id` 为会话 id，宿主凭会话取 workspace/plan，`subscription_id` 为新订阅 id。

12. [可观察] **contract.md G-06** — "游标不重不漏"无用例；PB-17 仅测超限。  
    为什么：分页正确性无法判定。  
    修法：增加两页遍历用例。

13. [一致] **contract.md G-05** — 未定义幂等键作用域（账号/端点/全局）。  
    为什么：决策 D-06 建议"账号 + 端点"，但契约未写，不同宿主实现可能撞键或不撞。  
    修法：G-05 明确作用域为"账号 + 端点"。

14. [一致] **contract.md DN-02 / decisions.md D-03** — 重试节奏（0/1/3/7 天）仅在 decisions，契约只给 `dunning_max_attempts`。  
    为什么：验收无法判定节奏，且 D-03 未进入契约/用例。  
    修法：DN-02 补充重试节奏参数或明确"节奏由宿主声明，验收只校验上限"。

## 规则→用例追溯（自建）

- contract.md §14 追溯表除 TH-01~TH-04 外基本准确：全部 30 条 PB 均在表中出现，所有非 TH 规则均有至少一个用例。
- 追溯缺口（4）：TH-01、TH-02、TH-03、TH-04 未在 §14 中出现，且 TH-04 无用例。
- 缺口（非追溯）：SB-04 跨币种、WH-06 invoice.created、WH-09 updated/deleted、SB-05 不缩短、G-06 游标、EN-01 字段集、CH-05 并发去重、DS-01 非催收令牌哈希。

## 越界与引用

- 模块名均来自 `modules.json`（auth、workspaces-and-permissions、usage-metering-and-budgets、async-jobs、email-transactional、notifications、rate-limiting、web-security、file-storage、webhooks-outbound、observability、feature-flags、analytics、internationalization、audit-and-data-export）；"不涉及"列表中的 AI 模块名亦在 `modules.json`。未发现品牌/厂商名。

阻断 0 | 应修 6 | 建议 8 | 追溯缺口 4 | 可用性 3/5 | 结论: 修后可用
DONE