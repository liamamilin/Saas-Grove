阻断 2 | 应修 10 | 建议 12 | 追溯缺口 10 | 可用性 3/5 | 结论: 修后可用

# workspaces-and-permissions 独立审查 r1

审查对象：MODULE.md、contract.md、acceptance-plan.md、decisions.md，对照 HOST.md 和 modules.json。
篇幅：MODULE 12281B、contract 14316B、plan 10225B、decisions 4024B，都在上限内。
模块名引用：只用了 modules.json 里的名字，没有厂商或品牌名。
通过标准是阻断 0 且应修 ≤3，本轮不满足。

规则到用例的对应：54 条规则（WSP-001 到 WSP-054）整条都有用例，没有整条空缺的 MUST。缺口主要是规则里的子句没被测到，以及追溯表有两处不准，见"追溯缺口"一节。

---

## 一、阻断（2）

### B1 [安全] WSP-048 / AP-28 / MODULE §2 L2：没有受信代理时取 XFF 最右项，等于信任伪造头
- 位置：
  - contract.md WSP-048 写"未声明时取最右一项"。
  - contract.md §4 同时写 `trusted_proxy_cidrs` 默认"空（不信任任何代理）"。
  - acceptance-plan.md AP-28 要求 `data.source_ip` = 198.51.100.9。
  - MODULE.md 的客户端 IP 条目（"从右往左跳过受信代理，取第一个非受信 hop"）也漏了套接字对端。
- 为什么：业界做法是把 TCP 对端地址当第 0 跳。对端不受信时，整个 XFF 都不可信，直接取对端地址。契约自己的默认值"不信任任何代理"和 WSP-048 的"取最右一项"互相矛盾。
  - 默认配置下，客户端只发一个 `X-Forwarded-For: 1.2.3.4`，宿主就把 1.2.3.4 当成它的 IP。这正是 MODULE 自己列为"最贵的坑"的伪造。
  - 符合业界做法的宿主（对端 127.0.0.1 不受信，所以取 127.0.0.1）会在 AP-28 里失败。AP-28 把不安全行为当成唯一正确答案。
  - AP-28 也没读 `trusted_proxy_cidrs`。宿主一旦声明了含 198.51.100.9 的网段，期望值就变了。
- 修法：
  - WSP-048 改成：先取对端地址；对端不在 `trusted_proxy_cidrs` 内，就忽略 XFF，取对端；在内才从右往左跳过受信 hop。
  - AP-28 拆成两例。例 A 用空 `trusted_proxy_cidrs`，期望 `source_ip` 不等于 203.0.113.7，也不等于头里任何一项，是对端地址。例 B 只在宿主声明了含测试客户端对端的 CIDR 时执行，否则 skip；期望值按 params 算。
  - 补多个 XFF 头、带端口、IPv6、垃圾值的处理。
  - 把 `data.source_ip` 放进邀请邮件事件会把邀请人 IP 发给被邀请人，是隐私外泄。建议删掉，或放进不对外发的审计事件。见建议 G7（越界）。

### B2 [一致] WSP-012 与 WSP-024 / AP-25 / AP-26 互斥：软删租户一律 404，但 restore 必须能看见它
- 位置：
  - WSP-012 写"已软删 → 404 `workspace_not_found`，三者不可区分"。
  - §1 把 `workspace.restore` 列为带租户作用域的概念，WSP-011 和 WSP-012 对它同样适用。
  - WSP-024 要求软删后 restore 返回 200 或 410。
  - AP-25 / AP-26 也据此断言。
- 为什么：按字面实现 WSP-012，软删租户对 restore 也是 404，AP-25 和 AP-26 必然失败。按 WSP-024 实现，则需要对 restore 例外，但契约没有写这个例外。没有任何字面合规的实现能同时通过 WSP-012 和 AP-25/26。
  - 例外还会引出新问题：谁可以对已删租户 restore？是原来的 owner，还是任何曾经的成员？
  - 非 owner 对已删租户 restore，应该是 404 还是 403？
  - 这个例外本身是个信息泄露点，需要明确。
- 修法：
  - 在 WSP-012 加例外：`workspace.restore` 对"保留窗口内的软删租户"，对其删除时的 active owner 可见。
  - 其他情形仍是 404：非成员、不存在、已超窗但调用者不是 owner。
  - 补用例：窗口内的非 owner（例如原 admin）restore，期望 404。

---

## 二、应修（10）

### S1 [可执行] 只读查库没法定位表和列（AP-08、AP-24、AP-25；WSP-039、WSP-049、WSP-050、WSP-053）
- HOST.md 只允许"契约里写明的项"只读查库，但 module-map 里没有表名和列名。验收不能读源码，就无从知道令牌摘要、`deleted_at`、成员邮箱在哪张表哪一列。
- MODULE §1 的数据模型里 `member` 根本没有 email、name、avatar 列。WSP-050 说"该成员行的个人数据被清空"，可对应的列不存在。真正的邮箱在 auth 的用户表里，而本模块没有删账号。
- 修法：
  - 在 contract 加 `module-map` 的 `db` 声明，例如 `{table, workspace_id_col, deleted_at_col, token_digest_col, pii_cols[]}`，缺失则 skip。
  - 或者把校验改成"全库文本扫描"：令牌明文只准出现在名字含 outbox 的表；被移除成员的邮箱字符串，在 member 类表和 invitation 类表里不再出现。
  - 同时改写 WSP-050，明确"个人数据"具体指哪些列。

### S2 [可执行] 请求体字段名和标识符没定义
- `invitation.accept` 的 body 里令牌叫什么（`token`？）没写。AP-29 暗示是 token，契约没说。
- `member.update` 的 body 字段、`role.create` 的 `name` 字段都没写。`role.delete` 按 role id 还是 key 删，没写。自定义角色的 key 从哪来也没写。
- `workspace.update` 里 `settings` 的形状没写。
- AP-06 对非成员发 `member.invite`，没说 body 要合法。按 §3 判定顺序，body 不合法会先返回 400 `invalid_body`，而 AP-06 期望 404。
- 修法：在 contract 加一张"请求体与响应体字段表"，或在 §1 概念清单加一列"body"。AP-06 注明发合法 body。

### S3 [可执行] outbox 的取用和事件内容有缺口（AP-12、AP-30、WSP-044、WSP-054）
- HOST.md 的 outbox 接口必须带 `to=<email>` 参数，没有列出全部消息的办法。AP-30 要求"读 outbox 全部消息"，做不到。
- WSP-044 只说重发生成新令牌，没说这个令牌通过 outbox 的哪个模板、哪个字段发出来。AP-12 要靠它取新令牌，所以必须规定：重发也产出 `workspaces-and-permissions.invitation_created`（或 `invitation_resent`），含 `token` 和 `data.link`。
- 同一收件人有多封时，"哪封是最新"要有规则（按 `createdAt` 最大）。重发是否刷新 `expires_at` 也没写。
- WSP-054 举例的 `member_added` 等事件，没有任何规则要求必须产出。如果宿主一个都不发，AP-30 也能空过。
- 修法：
  - AP-30 改成针对本用例涉及的几个邮箱分别查 outbox。
  - 给 WSP-044 补 outbox 内容、"取最新一封"的规则、是否重置 TTL。
  - 要么把 `member_added` 等事件写成明确的 MUST，并指定 `to`，要么删掉这个例子。

### S4 [安全] 缺"目标角色层级"护栏：权限弱的人能降级或移除权限更强的人
- WSP-028 / WSP-031 / WSP-034 只校验"被授的新角色 ⊆ 操作者权限"。没有校验"被操作成员当前的权限 ⊆ 操作者权限"。
- 例：自定义角色 hr 有 `member.update_role` 和 `member.remove`，但没有 `workspace.update`。hr 可以把 admin 降成 viewer，再移除他，等于接管了 admin 的位置。
- 修法：新增一条 MUST：对目标成员的改角色和移除，要求目标当前角色权限集 ⊆ 操作者权限集，否则 403 `escalation_forbidden`。加用例：hr 降级或移除 admin 被拒。

### S5 [缺口] 对象级跨租户（IDOR）只测了"非成员读列表"，没测"用 A 的对象 id 打 B 的路径"
- AP-04 到 AP-06 只覆盖非成员访问 B 的列表类端点，以及一次 `member.invite`。
- 最常见的漏洞是：调用者同时是 A 和 B 的成员，路径写 B，对象 id 却用 A 的。涉及的端点包括 `invitation.revoke` / `resend`、`member.update` / `remove`、`role.delete`，以及 `member.invite` 的 role 用 A 的自定义角色。
- 修法：加用例。owner 同时在 A 和 B，用 A 的 invitation_id、user_id、role_id 打 B 的路径，期望 404（`invitation_not_found` / `member_not_found` / `role_not_found`）。用 A 的自定义角色邀请进 B，期望 400 `invalid_role`。非成员对 B 的写端点（`update`、`delete`、`remove`）也要测 404。

### S6 [一致] AP-15"除 email 外值一致"没法通过
- 每次邀请的 `invitation_id`、`created_at`、`expires_at` 必然不同，字面要求"值一致"没有实现能通过。
- 修法：改成"字段集（key 集合与类型）相同，状态码相同，`message` 文本相同，没有额外的提示字段"。顺手把"文案不含已注册/已存在"改成断言所有 `message` 字段完全相同。

### S7 [缺口] 对同一邮箱已有 pending 邀请时再次邀请，行为未定义
- MODULE §1 说 pending 时 `(workspace_id, email_normalized)` 唯一。契约没有对应的 MUST：返回 409、幂等返回原邀请、还是替换旧令牌，都没写。
- 这同时影响 WSP-051 的枚举安全：第二次邀请的响应如果和第一次不同，会泄露"这个邮箱已有邀请"。
- 修法：新增一条 MUST。建议：同邮箱已有 pending 邀请时，等价于重发（返回 201 或 200，字段集与首次相同，旧令牌作废）。加用例，并断言它不占用第二个 pending 名额。

### S8 [缺口] `workspace.update` 的"只接受 name/settings"不明确，缺 mass assignment 防护
- WSP-022 没说收到别的字段（`status`、`deleted_at`、`id`、`role`、`owner`、`workspace_id`）怎么办：忽略还是 400。没有用例。
- PATCH 里夹带 `status:"active"` 或 `owner` 是典型的批量赋值攻击。
- 修法：写明未知字段一律 400 `invalid_body`（或明确忽略且不改库）。加用例：PATCH 夹带 `status`、`deleted_at`、`role`，断言库值不变。`member.update` 同理。

### S9 [可执行] AP-03 的上下文冲突用例没有说明用哪个概念
- AP-03 先说 `workspace.create` 是不带租户作用域的，最后一步却要"同时用路径与 header 传不同租户 id"，没说针对哪个概念，也没说两个 id 从哪来。AP-03 的 given 只有一个已登录的 owner，没有租户。
- WSP-011 的"都缺失 → 400 `invalid_body`"没有用例。路径映射宿主根本发不出"缺失"。
- 修法：AP-03 拆出独立用例。给定 owner 已建租户 A 和 B，对一个带作用域的概念（如 `workspace.get`）同时发路径 A 和 header B，期望 400 `workspace_context_mismatch`。对 header 型宿主，补"不发 header"，期望 400 `invalid_body`；路径型宿主记 skip。

### S10 [安全] WSP-050 在可恢复的软删除里就不可逆地擦除个人数据，自相矛盾
- WSP-050 / AP-25：删除 workspace 时就清除成员个人数据，但 WSP-024 允许 30 天内恢复。恢复后成员数据已不可逆，恢复的成员行没法展示 email。
- D5 写"软删 + 清个人数据 + 窗口内可 restore"，两者同时成立只能靠"PII 实际在别处"，这又回到 S1。
- 业界做法：删租户进入保留期，保留期内只做不可见；保留期结束后的清理作业才抹 PII。"移除单个成员"才是立即抹。
- 修法：把"删除 workspace 时立即清除"改成"超过 `workspace_retention_seconds` 后清除"。验收对应改成：窗口内成员 PII 仍在，窗口外不可恢复且已清除。

---

## 三、建议（12）

- **G1 [安全]** WSP-029 `member.invite` 对已是成员返回 409，对非成员返回 201。持有 `member.invite` 但没有 `member.read_email` 的自定义角色，可以借此逐个邮箱探测谁是成员。建议：没有 `member.read_email` 时，已成员也返回与普通邀请相同的 201（实际不发邮件）。
- **G2 [缺口]** 并发只测了 accept（WSP-045）。资深审查者会攻击这些竞态：
  - 同一用户并发建 `max_workspaces_per_user + 1` 个租户，看是否超限；
  - 并发邀请 `max_pending_invitations_per_workspace + 1` 个邮箱，同样看是否超限；
  - 两个并发的所有权转移，看是否出现两个 owner；
  - owner 退出与转移并发，看是否出现零个 owner；
  - 同一邮箱并发邀请，看是否出现重复 pending。
- **G3 [缺口]** 边界值：
  - name 恰为 1 个字符和 64 个字符，应成功；"字符"按 Unicode 码点还是字节也要写明。全空白和 emoji 也要覆盖。
  - `invitation_ttl_seconds - 1` 时令牌仍有效，`+1` 无效；`workspace_retention_seconds - 1` 时恢复仍成功，`+1` 为 410。
  - 畸形或非 UUID 的 workspace id，应返回 404，不是 400，更不能是 5xx（WSP-012 要求不可区分）。
  - `limit=0`、`limit=-1`、`limit=abc`，以及 `limit` 恰好等于 `max_members_per_page`。
- **G4 [缺口]** `invitation.accept` 的边界：
  - 令牌所属租户已软删，应返回 400 `invitation_token_invalid`；
  - 接受者已经是该租户 active 成员；
  - 接受者已达租户上限。`max_workspaces_per_user` 到底只算自己创建的，还是算全部成员关系，WSP-025 没写清；
  - 被移除的成员重新被邀请。
- **G5 [一致]** §3 判定顺序里，`escalation_forbidden`（403）取决于输入的 role，而 `invalid_role`（400）排在最后，但无法对一个不存在的角色算出是否越权。需要写明：role 未知时先返回 400 `invalid_role`，再做越权判断。`member_not_found` 在判定顺序里也没有位置。
- **G6 [可观察]** WSP-039 的"密码学安全随机、熵 ≥256 bit"和 WSP-053 的"不存密码、API key"黑盒下无法判定，只能测长度和唯一性。建议把不可测的部分移到 §6，MUST 只留"令牌长度 ≥ `invitation_token_bytes`、互不重复、库中无明文"。AP-08 的"无密码/凭据类列值"也只能靠 S1 的扫描方案。令牌编码（hex / base64url）会影响"≥32 字节"的换算，需要声明。
- **G7 [越界]** 客户端 IP 解析和 `source_ip` 属于 `rate-limiting` 和 `web-security`（MODULE §5 也写了限流归 rate-limiting）。本模块把它做成 MUST 并放进邀请邮件，职责不清，且泄露邀请人 IP（见 B1）。建议降为"建议，验收不测"，或只留"不信任 XFF 最左项"这一条。
- **G8 [安全]** 邮箱规范化只做 trim 加小写（WSP-027、D4）。国际化域名（IDN）、Unicode 归一化、plus 别名、尾部点号没有决定。建议写明采用的规范化，并加一个"全角字符或大小写混写邮箱"用例。
- **G9 [可执行]** AP-17（100 次邀请）、AP-18（20 次建租户）会连续打很多请求，容易触发限流；"429 跳过断言"会让这两条在许多宿主上变成 skip，没有实际验证。建议用例使用独立来源标识，或在 params 里读取限流豁免。
- **G10 [文字]** AP-12、AP-19 里把 `workspace.update` 写成 POST，§1 里它是 PATCH。AP-14"至多一个 200"太松，应该是"恰好一个 200，其余全是 400 `invitation_token_invalid`"。
- **G11 [一致]** `workspace.transfer_ownership` 权限在整份契约里没有任何规则用到：WSP-033 只写"设为 owner 视为转移"，没写它需要这个权限，也没写目标必须是 active 成员。`invitation_token_bytes` 这个 param 没有任何用例读取，AP-08 把 32 写死了。
- **G12 [缺口]** invitation 行持有 `email_normalized`，接受、过期、撤销之后永不清除；删除租户和移除成员时也没有处置规则。PII 留存有缺口。建议在 WSP-050 里补上邀请记录的邮箱。

---

## 四、追溯缺口（10）

规则到用例的对应表（contract §7）与 plan 逐条核对：绝大多数一致，以下是缺口和错误。

| # | 规则 | 问题 |
| --- | --- | --- |
| T1 | WSP-011 | "都缺失 → 400 `invalid_body`"没有用例（见 S9） |
| T2 | WSP-024 | 对未删除租户 restore 返回 409 `workspace_not_deleted`，没有用例 |
| T3 | WSP-025 | "已软删不计入租户上限"没有用例 |
| T4 | WSP-036 | "不含别的租户的角色"没有用例，需要两个租户都有自定义角色 |
| T5 | WSP-038 / WSP-049 | "删除后不可再分配"没有用例；自定义角色软删后库中 `deleted_at` 非空也没有用例 |
| T6 | WSP-031 / WSP-034 | 目标成员不是 active 时返回 404 `member_not_found`，没有用例 |
| T7 | WSP-022 | "只接受 name/settings"没有用例（见 S8） |
| T8 | WSP-026 / WSP-037 | `limit` 为 0、负数和非数字没有用例（只测了 99999）；"列表只含 active 成员"没单独测；`role.create` 的 `permissions` 为空数组没有用例 |
| T9 | 追溯表错误 | contract §7 把 WSP-041 对应到 AP-06/13，AP-06 根本不涉及 accept，且 AP-09 的成功路径（200 返回 `workspace_id`、`role`、`member_id`）没有标 WSP-041。AP-21 测了 `self_removal_forbidden`，却没标 WSP-034 |
| T10 | 错误码表 | §3 列了 `method_not_allowed`、`invitation_not_found`、`role_not_found`，没有任何规则或用例会产出它们 |

---

## 五、各检查项的结论摘要

1. 安全/领域正确性：B1、B2、S4、S8、S10、G1、G8。令牌只存摘要、一次性、不用"重算存量哈希"续命，这些建议是对的。
2. 可观察性：G6。其余 MUST 在 HOST.md 的黑盒与钩子下基本可判定，但依赖 S1 的库表映射。
3. 一致性：B2 是互斥；AP-15（S6）无法通过；其余状态码、TTL、阈值、权限集（13 项、admin 11、member 6、viewer 4）在 MODULE、contract、decisions 之间一致，D9 的默认值与 params 默认值一致。
4. 追溯：见第四节。
5. 可执行性：S1、S2、S3、S9、G9。
6. 越界与引用：没有引用 modules.json 之外的模块名，也没有厂商名；G7 提出 IP 解析越界。
7. 文字：未见乱码和明显错字；G10 为小问题。
8. 缺口：S5、S7、S8、G2、G3、G4、G12。
