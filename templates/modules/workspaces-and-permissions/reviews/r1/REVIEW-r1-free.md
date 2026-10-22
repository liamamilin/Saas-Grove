# workspaces-and-permissions 模块独立审查（第 1 轮）

阻断 0 | 应修 8 | 建议 4 | 追溯缺口 9 | 可用性 3/5 | 结论: 修后可用

> 审查对象：`module/MODULE.md`、`module/contract.md`、`module/acceptance-plan.md`、`module/decisions.md`；对照 `HOST.md`、`modules.json`。未写入其它文件，未读 `.env`。

## 0. 总体判断

契约骨架完整（54 条 MUST、30 条用例、13 个决策点），核心安全边界（跨租户 404、令牌只存摘要、软删 + PII 清除、owner 保护）方向正确。但存在 8 条应修问题：其中 1 条默认配置下的 IP 解析会接受伪造的 `X-Forwarded-For`；多条 MUST 条款在黑盒下不可判定或缺少用例；契约末尾追溯表有 3 处映射与实际用例不符。无阻断级矛盾，修后可用。

---

## 1. 安全 / 领域正确性

### [安全] 应修：无受信代理时仍解析 `X-Forwarded-For`

- **文件+引用**：`contract.md` §4 params 表 `trusted_proxy_cidrs`（"未声明时验收取值：空（不信任任何代理）"）；§5 **WSP-048**（"trusted_proxy_cidrs 未声明时取最右一项"）；`acceptance-plan.md` **AP-28**（期望 `data.source_ip=198.51.100.9`）。
- **为什么**：空受信列表的语义应是"不信任任何代理"，此时整条 `X-Forwarded-For` 都不可信，应使用直连对端 IP。规范却在无受信代理时仍取 XFF 最右项，攻击者可伪造 `X-Forwarded-For` 改写 `data.source_ip`（并可能污染风控/审计）。这与 MODULE.md §4 "拿 XFF 最左项当客户端 IP" 的防线精神一致但未闭合。
- **修法**：当 `trusted_proxy_cidrs` 为空时忽略 XFF、取直连 IP；AP-28 改为声明一个受信代理 CIDR 后再测"右起第一个非受信 hop"。

### [安全] 建议：令牌比较未要求恒定时间

- **文件+引用**：`contract.md` §5 **WSP-039**/**WSP-041**；`MODULE.md` §4 表（"非恒定耗时比较"未列入防线）。
- **为什么**：邀请令牌校验若用普通字符串比较，可能通过响应时间泄露前缀。黑盒按 HOST.md §6 不测耗时，但规范应把"恒定时间比较"写入"建议，验收不测"或 WSP-039，避免实现者用 `==`。
- **修法**：在 contract §6 增加"令牌比较使用恒定时间"；或在 WSP-039 注明。

---

## 2. 可观察性

### [可观察] 应修：WSP-039 的"熵 ≥ 256 bit / 密码学安全随机"不可黑盒判定

- **文件+引用**：`contract.md` §5 **WSP-039**（"令牌密码学安全随机、熵 ≥ 256 bit"）；`acceptance-plan.md` **AP-08**（"outbox token ≥ 32 字节"）。
- **为什么**：HOST.md §4 黑盒只能读 HTTP/Cookie/outbox/只读 DB，无法判定"密码学安全"或精确熵。AP-08 仅能检查长度，且"字节"与字符串编码不对应。MUST 必须可判定，否则验收无法执行。
- **修法**：把"密码学安全随机/熵"移入 §6"建议，验收不测"；MUST 仅保留可测的"令牌字符串长度 ≥ 43（base64url 编码的 32 字节）且 DB 只存摘要"，并在 AP-08 改为测字符串长度。

### [可执行] 应修：AP-15 的"禁用 / 未验证账号"状态可能无法构造

- **文件+引用**：`contract.md` §5 **WSP-051**；`acceptance-plan.md` **AP-15**（"已注册且被禁用、已注册但未验证 … 后两态记『宿主未声明』"）。
- **为什么**：WSP-051 是 MUST，但 AP-15 允许在 auth 未公开构造方式时跳过。若大量宿主跳过，该 MUST 实际无人验证，且"未注册 / 已注册未入组 / 禁用 / 未验证"四种状态的同形响应无法在黑盒下稳定复现。
- **修法**：要求 auth 模块提供构造禁用/未验证账号的测试入口，或把 WSP-051 的状态范围收紧为公开可构造的子集，并在 HOST.md 依赖里声明。

---

## 3. 一致性

### [一致] 应修：`workspace.update` 与 `role.create` 的非法输入缺少明确错误码

- **文件+引用**：`contract.md` §3 错误码表；§5 **WSP-022**（"只接受 `name`/`settings`"）；§5 **WSP-037**（"permissions 非空且为 §2 子集"）；`acceptance-plan.md` **AP-19**/**AP-23**。
- **为什么**：WSP-022 未说明多传字段或 `settings` 非法时是 400 `invalid_body` 还是忽略；WSP-037 未说明空权限数组的码（`unknown_permission` 还是 `invalid_body`）。AP-19/AP-23 也未覆盖这两个分支，实现者只能自行猜测，跨宿主行为不一致。
- **修法**：在 WSP-022/WSP-037 明确"未知字段/非法 settings → 400 `invalid_body`；空 permissions → 400 `invalid_body`"，并给 AP-19/AP-23 增加对应断言。

---

## 4. 追溯

### [追溯] 应修：契约末尾追溯表与实际用例不符（3 处）

- **文件+引用**：`contract.md` §7 追溯表；`acceptance-plan.md` **AP-06**、**AP-09**、**AP-11**。
- **为什么**：
  - **WSP-041** 映射到 AP-06/AP-13，但 AP-06 并未调用 `invitation.accept`，成功路径实际在 AP-09（响应体 `{workspace_id,role,member_id}`）。
  - **WSP-042** 映射到 AP-09/AP-10/AP-13，遗漏 AP-11（revoke 后 accept → 400 `invitation_token_invalid`）。
  - **WSP-049** 映射到 AP-04/AP-24/AP-25，但 AP-04 是跨租户列表隔离，不是软删除证据；软删除证据仅 AP-24/AP-25。
- **修法**：修正 §7 映射为 WSP-041→AP-09/AP-13，WSP-042→AP-09/AP-10/AP-11/AP-13，WSP-049→AP-24/AP-25。

### [追溯] 应修：9 条 MUST 条款/分支缺少用例

- **文件+引用**：`contract.md` §5；`acceptance-plan.md` 用例表。
- **为什么**（规则 → 缺失分支）：
  - **WSP-011** "租户标识两处都缺失 → 400 `invalid_body`"：AP-03 仅测不一致，未测缺失。
  - **WSP-022** "改后 name 非法 → 400 `invalid_name`"：AP-19 未测。
  - **WSP-024** "未删除 → 409 `workspace_not_deleted`"：无用例。
  - **WSP-025** "已软删不计入上限"：AP-18 未覆盖软删释放配额。
  - **WSP-030** "撤销后释放 pending 配额"：无用例。
  - **WSP-031** "目标非 active → 404 `member_not_found`"：无用例。
  - **WSP-032** "他人把最后一个 owner 降级 → 409 `last_owner_required`"：AP-21 仅测移除，未测降级。
  - **WSP-038** "删除后不可再分配"：无用例。
  - **WSP-043** "非 pending → 409 `invitation_not_pending`"：AP-11 仅测一次 revoke，未测重复 revoke。
- **修法**：为上述 9 个分支各增一条用例，或把分支从 MUST 移入"建议"。边界值（`limit` 的 0/1/上限、name 的 1/64 字符）也应补测。

### [可执行] 应修：跨租户写路径未覆盖 WSP-047

- **文件+引用**：`contract.md` §5 **WSP-047**；`acceptance-plan.md` **AP-05**/**AP-06**/**AP-19**。
- **为什么**：WSP-047 声称"所有 workspace-scoped 读写按调用者所在 workspace 过滤"，但验收只测了 GET `workspace.get`/`member.list`/`invitation.list`/`role.list` 与 POST `member.invite` 的跨租户 404；`workspace.update/delete/restore`、`member.update/remove/leave`、`role.create/delete`、`invitation.revoke/resend/accept` 的跨租户场景均未测，漏测概率最高的正是列表/写类端点。
- **修法**：为每个 scoped 写概念增加一条"非成员 → 404 `workspace_not_found`"用例，或在 AP-06 扩展为覆盖全部 scoped 概念。

---

## 5. 可执行性

### [可执行] 应修：AP-08 以"字节"衡量字符串令牌

- **文件+引用**：`contract.md` §4 `invitation_token_bytes`（32..64）；§5 **WSP-039**；`acceptance-plan.md` **AP-08**（"outbox token ≥ 32 字节"）。
- **为什么**：outbox 的 `token` 是 JSON 字符串，黑盒无法可靠换算"字节"（base64/hex 的字符串长度 ≠ 原始字节长度）。验收脚本无法稳定判定。
- **修法**：把 AP-08 改为检查字符串长度下限（如 base64url ≥ 43），并在 contract 中写明令牌的编码格式。

---

## 6. 越界与引用

未发现问题。`MODULE.md` §5 引用的模块名（auth、email-transactional、notifications、audit-and-data-export、usage-metering-and-budgets、payments-billing、rate-limiting、async-jobs、ai-model-gateway、ai-retrieval、file-storage、webhooks-outbound、observability、feature-flags/analytics、internationalization）均在 `modules.json` 中；无品牌/厂商名；未把其它模块的内容据为己有。

---

## 7. 文字与篇幅

未发现问题。四文件字节数：MODULE.md 12281（≤15KB）、contract.md 14316（≤17KB）、acceptance-plan.md 10225（≤13KB）、decisions.md 4024（≤7KB）；未检测到乱码或控制字符。

---

## 8. 缺口（资深审查者会追加的点）

### [缺口] 建议：并发正确性仅覆盖 `invitation.accept`

- **文件+引用**：`contract.md` §5 **WSP-045**；`acceptance-plan.md` **AP-14**；`MODULE.md` §2 L2"并发正确性"。
- **为什么**：只有 accept 并发有测试；邀请重复（同一邮箱并发 invite）、所有权转移（并发 set owner）、成员移除与权限判定并发均无测试。"先查再插"的竞态在 invite/transfer 路径上同样存在。
- **修法**：为 invite 重复与 owner 转移各补一条并发用例，或在 contract 中把唯一约束/事务要求写成 MUST（目前仅 §1 数据形状描述）。

### [缺口] 建议：租户标识缺失分支与错误顺序未测

- **文件+引用**：`contract.md` §3"判定顺序"；§5 **WSP-011**。
- **为什么**：判定顺序规定"认证 → 体与租户标识可解析 → 可见性 → 权限"，但无用例验证未认证+非法体/缺失租户标识时返回 401 而非 400。实现者可能先解析 body 导致信息泄露。
- **修法**：AP-01 增加"未认证 + 非法 body/缺失租户标识 → 401"断言。

### [缺口] 建议：恢复窗口与配额的边界未测

- **文件+引用**：`contract.md` §4 params；`acceptance-plan.md` **AP-26**/**AP-17**/**AP-18**。
- **为什么**：仅测"超窗 → 410"，未测"窗口内刚好恢复"；配额仅测"超限 → 409"，未测"达到上限仍可通过、释放后可再创建"。边界 off-by-one 是常见 bug。
- **修法**：AP-26/AP-17/AP-18 各补一个边界值断言（retention_seconds 内、max-1、释放后）。

### [缺口] 建议：`member.read_email` 与其它模块的 email 暴露面未闭合

- **文件+引用**：`contract.md` §5 **WSP-026**；`MODULE.md` §5（audit/notifications 等消费事件）。
- **为什么**：contract 只控制 `member.list` 的 email 字段，但事件 payload、审计、通知中是否包含 email 未约束；`WSP-054` 仅要求"payload 不含凭据"，email 是否算凭据未定义。
- **修法**：在 WSP-054 明确事件 payload 可含 email 但不得含令牌/密码，并与 `member.read_email` 权限的关系说明。

---

## 9. 规则 → 用例 追溯表（缺口汇总）

| 规则 | 契约映射 | 实际覆盖 | 缺口 |
| --- | --- | --- | --- |
| WSP-011 | AP-03 | 仅 mismatch | 缺失分支 |
| WSP-022 | AP-19 | 仅 403/200 | 缺 invalid_name |
| WSP-024 | AP-25/AP-26 | 成功/超窗 | 缺 not-deleted |
| WSP-025 | AP-18 | 仅超限 | 缺软删释放 |
| WSP-030 | AP-17 | 仅超限 | 缺释放 |
| WSP-031 | AP-21 | 仅 self | 缺 non-active 404 |
| WSP-032 | AP-21 | 仅 remove | 缺 demote last owner |
| WSP-038 | AP-23 | in use/builtin | 缺 assign deleted |
| WSP-041 | AP-06/AP-13（应为 AP-09/AP-13） | 映射错误 | 修正映射 |
| WSP-042 | AP-09/AP-10/AP-13 | 遗漏 AP-11 | 修正映射 |
| WSP-043 | AP-11 | 仅一次 | 缺 non-pending |
| WSP-047 | AP-05/AP-06/AP-19 | 仅部分 scoped | 缺写路径 |
| WSP-049 | AP-04/AP-24/AP-25 | AP-04 非软删 | 修正映射 |
| WSP-039 | AP-08 | 仅长度 | 熵不可测 |

追溯缺口计数：9（上表中 9 条 MUST 分支/映射错误；其余为可观察/可执行/缺口类问题）。

---

## 10. 结论

- 阻断 0，应修 8，建议 4，追溯缺口 9，可用性 3/5。
- **结论：修后可用**。需先修正 XFF 默认策略、追溯表映射、9 条缺失 MUST 用例与 2 处不可测条款，再进入下一轮审查。