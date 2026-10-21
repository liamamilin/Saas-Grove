# workspaces-and-permissions 契约（黑盒可测）

宿主约定（启动、路径映射、params、测试钩子、观察边界、依赖顺序）见 `HOST.md`。本文件只补充：概念命名、租户标识怎么传、错误体长什么样。

---

## 0. 约定补充

- **概念名**：`workspaces-and-permissions.<对象>.<动作>`，是 `module-map.json` 的键；宿主映射到自己的方法与路径，**没声明的概念记「宿主未声明」，不算失败也不算通过**。
- **租户标识**：workspace-scoped 概念从路径 `{workspaceId}` 或 header `X-Workspace-Id` 取；映射路径含占位符则填路径，否则发 header；两者都送时必须一致。
- **错误体**：`{"error":{"code":"<snake_case>","message":"<文本>"}}`；宿主已有别的信封时仍须把稳定 `code` 放在 `error.code`；断言只用 `code`。
- **成功体**：一律 JSON，不用 204 空体；创建 = 201，其余成功 = 200；时间为 ISO-8601；验收用 `POST /api/__test__/clock {advanceSeconds}` 推进时钟。

## 1. 概念清单（module-map 键）

| 概念 | 方法 | 需要权限 |
| --- | --- | --- |
| `workspace.create` | POST | 已认证 |
| `workspace.list` | GET | 已认证 |
| `workspace.get` | GET | `workspace.read` |
| `workspace.update` | PATCH | `workspace.update` |
| `workspace.delete` | DELETE | `workspace.delete` |
| `workspace.restore` | POST | `workspace.delete` |
| `member.list` | GET | `member.read` |
| `member.invite` | POST | `member.invite` |
| `member.update` | PATCH | `member.update_role` |
| `member.remove` | DELETE | `member.remove` |
| `member.leave` | POST | active 成员 |
| `invitation.list` | GET | `member.invite` |
| `invitation.accept` | POST | 已认证 |
| `invitation.revoke` | DELETE | `member.invite` |
| `invitation.resend` | POST | `member.invite` |
| `role.list` | GET | `role.read` |
| `role.create` | POST | `role.manage` |
| `role.delete` | DELETE | `role.manage` |
| `context.get` | GET | 已认证+成员 |

除 `workspace.create`/`workspace.list`/`invitation.accept` 外都带租户作用域，按 §0 传租户标识。成员以 `user_id` 标识，邀请以 `invitation_id` 标识（取自 `member.invite` 响应或 `invitation.list`）。

## 2. 权限目录与角色矩阵（规范值）

权限目录（13 项）：`workspace.read`、`workspace.update`、`workspace.delete`、`workspace.transfer_ownership`、`member.read`、`member.read_email`、`member.invite`、`member.update_role`、`member.remove`、`role.read`、`role.manage`、`data.read`、`data.write`。

`owner` = 全部 13 项；`admin` = 除 `workspace.delete`、`workspace.transfer_ownership` 外全部（11 项）；`member` = `workspace.read`、`member.read`、`member.read_email`、`role.read`、`data.read`、`data.write`（6 项）；`viewer` = `workspace.read`、`member.read`、`role.read`、`data.read`（4 项）。

内置角色不可改、不可删；`data.read`/`data.write` 是给其他模块用的能力位。

## 3. 状态码与错误码（一个场景一个码）

成功：**201** = 创建 workspace/invitation/role；**200** = 其余。

失败：

- **400**：`invalid_body`、`invalid_name`（name 非法）、`invalid_email`、`invalid_role`（role 不可用）、`unknown_permission`（不在 §2）、`invalid_limit`（limit 越界）、`workspace_context_mismatch`（租户标识冲突）、`invitation_token_invalid`（令牌不可用）、`builtin_role_immutable`。
- **401**：`unauthenticated`。
- **403**：`forbidden`（可见但权限不足）、`escalation_forbidden`（超操作者权限）、`self_role_change_forbidden`、`self_removal_forbidden`。
- **404**：`workspace_not_found`（不存在/已软删/非成员）、`member_not_found`、`role_not_found`、`invitation_not_found`。
- **405**：`method_not_allowed`。
- **409**：`already_member`、`invitation_limit_reached`、`workspace_limit_reached`、`last_owner_required`、`role_exists`、`role_in_use`、`invitation_not_pending`、`workspace_not_deleted`。
- **410**：`restore_window_expired`。

判定顺序：认证(401) → 体与租户标识可解析(400) → 租户可见性(404) → 权限(403) → 自我操作(403) → 状态冲突(409) → 输入值(400)；同时违反多条按此顺序取码。

## 4. params（宿主声明实际值；契约只给界限）

| params 键 | 含义 | 契约界限 | 未声明时验收取值 |
| --- | --- | --- | --- |
| `max_workspaces_per_user` | 单用户 active 租户上限 | 1..20 | 20 |
| `max_pending_invitations_per_workspace` | 单租户 pending 邀请上限 | 1..100 | 100 |
| `max_members_per_page` | `member.list` 单次上限 | 1..200 | 200 |
| `invitation_ttl_seconds` | 邀请有效期 | 60..604800 | 604800 |
| `workspace_retention_seconds` | 软删除后的可恢复窗口 | 3600..2592000 | 2592000 |
| `trusted_proxy_cidrs` | 受信代理网段（解析 XFF） | 空或 CIDR 列表 | 空（不信任任何代理） |
| `invitation_token_bytes` | 令牌字节数 | 32..64 | 32 |

## 5. MUST 规则

每条都是 MUST（建议项见 §6）；规则 ID 是验收锚点。

### A. 通用

- **WSP-001** 失败响应一律是 JSON `{"error":{"code":…,"message":…}}`；每个错误场景用 §3 里唯一的 `code`，跨概念同码。
- **WSP-002** 错误响应不含 stack trace、SQL、内部表名/列名、文件路径或他人 email；出现 5xx 即违约。

### B. 会话与租户上下文

- **WSP-010** 未认证访问任一概念 → 401 `unauthenticated`，不泄露资源是否存在。
- **WSP-011** 租户标识取自路径 `{workspaceId}` 或 header `X-Workspace-Id`；两处都送且不一致 → 400 `workspace_context_mismatch`；都缺失 → 400 `invalid_body`。
- **WSP-012** workspace 不存在、已软删、或调用者不是 active 成员 → 404 `workspace_not_found`，三者不可区分（状态、code、体结构）；成员被移除或退出后同样 404。
- **WSP-013** `context.get` 返回 `workspace_id`/`role`/`permissions[]`/`member_status`；`permissions` 等于 §2 中该角色的集合。
- **WSP-014** 权限判定基于请求到达时库中的成员关系；角色变更后被改动成员的下一个请求即反映新权限，无陈旧窗口。

### C. 工作区生命周期

- **WSP-020** `workspace.create` → 201，body 含 `id`/`name`/`role:"owner"`/`member_count:1`/`created_at`；创建者为唯一 active owner；`name` trim 后 1..64 字符，否则 400 `invalid_name`；体非法 → 400 `invalid_body`。
- **WSP-021** `workspace.list` 只返回调用者为 active 成员且未软删的 workspace（项含 `id`/`name`/`role`/`member_count`/`created_at`）；`workspace.get` 返回详情与 `role`，不可见 → 404 `workspace_not_found`。
- **WSP-022** `workspace.update` 需 `workspace.update`，只接受 `name`/`settings`；权限不足 → 403 `forbidden`；改后 name 非法 → 400 `invalid_name`。
- **WSP-023** `workspace.delete` 需 `workspace.delete`（仅 owner）；软删除：`status=deleted`、写 `deleted_at`、成员访问立即失效；200 `{"deleted":true,"deleted_at":…}`；DB 行仍存在。
- **WSP-024** `workspace.restore` 需 `workspace.delete`；仅在 `workspace_retention_seconds` 内恢复成功（200）且访问恢复；未删除 → 409 `workspace_not_deleted`；超窗 → 410 `restore_window_expired`。
- **WSP-025** 单用户 active workspace 数 ≤ `max_workspaces_per_user`；超限 → 409 `workspace_limit_reached`；已软删不计入。

### D. 成员与角色

- **WSP-026** `member.list` 需 `member.read`；只返回 active 成员（`user_id`/`role`/`status`/`created_at`）；无 `member.read_email` 时不给 email；`limit` 非正或越界 → 400 `invalid_limit`。
- **WSP-027** `member.invite` 需 `member.invite`；body 必含 `email`/`role`，缺字段或类型错 → 400 `invalid_body`；`email` trim+转小写后校验，非法 → 400 `invalid_email`；存取都用规范化值。
- **WSP-028** `role` 须为本 workspace 可用角色，否则 400 `invalid_role`；被授角色权限集 ⊆ 操作者权限集，否则 403 `escalation_forbidden`。
- **WSP-029** `member.invite` 对已是该 workspace active 成员的 email → 409 `already_member`。
- **WSP-030** pending 邀请数 ≤ `max_pending_invitations_per_workspace`；超限 → 409 `invitation_limit_reached`。
- **WSP-031** `member.update` 需 `member.update_role`；目标非 active → 404 `member_not_found`；改自己角色 → 403 `self_role_change_forbidden`（有权限也不许改自己）；新角色按 WSP-028 校验。
- **WSP-032** 任何操作不得让 workspace 没有 active owner：他人降级或移除最后一个 owner → 409 `last_owner_required`；owner 自我降级/移除按 WSP-031/WSP-034 的自我操作码返回。
- **WSP-033** 设为 `owner` 视为所有权转移：原 owner 原子降为 `admin`，转移后 active owner 恰好 1 个；200 且响应含新 owner 的 `user_id`。
- **WSP-034** `member.remove` 需 `member.remove`；软删除并清除该成员个人数据（见 WSP-050）；目标非 active → 404 `member_not_found`；移除自己 → 403 `self_removal_forbidden`；他人移除唯一 owner → 409 `last_owner_required`。
- **WSP-035** `member.leave` → 200；owner 退出 → 409 `last_owner_required`（须先转移所有权）。
- **WSP-036** `role.list` 需 `role.read`；返回 4 个内置角色及 §2 权限集 + 本 workspace 自定义角色；不含别的 workspace 的角色。
- **WSP-037** `role.create` 需 `role.manage`；`permissions` 非空且为 §2 子集，否则 400 `unknown_permission`；同名 → 409 `role_exists`；超操作者权限 → 403 `escalation_forbidden`；201。
- **WSP-038** `role.delete` 需 `role.manage`；内置角色 → 400 `builtin_role_immutable`；仍被占用 → 409 `role_in_use`；删除后不可再分配；200。

### E. 邀请

- **WSP-039** 邀请令牌密码学安全随机、熵 ≥ 256 bit；DB 只存 SHA-256 或更强摘要；明文只在 outbox 表的 `token` 字段，DB 别处不出现。
- **WSP-040** `member.invite` → 201，body 含 `invitation_id`，并产出 outbox 邮件：template `workspaces-and-permissions.invitation_created`，`to`=规范化 email，`token`=明文令牌，`data.link`=含令牌的接受链接，`data` 另含 `workspace_name`/`role`/`expires_at`（=创建时间+`invitation_ttl_seconds`，到期作废）。
- **WSP-041** `invitation.accept` 需已认证会话；令牌绑定 (workspace_id, email, role)；会话 email（规范化）≠ 邀请 email → 400 `invitation_token_invalid`；成功 200 `{"workspace_id","role","member_id"}` 并建 active membership。
- **WSP-042** 令牌单次使用：已 accepted/撤销/过期/未知/email 不匹配 → accept 一律 400 `invitation_token_invalid`，不建成员。
- **WSP-043** `invitation.revoke` 需 `member.invite`；pending → 200 且令牌立即失效；非 pending → 409 `invitation_not_pending`。
- **WSP-044** `invitation.resend` 需 `member.invite`；生成新令牌并立即作废旧令牌；200。
- **WSP-045** 并发 accept 同一令牌：至多一个 200，最终 active 成员数恰为 1。
- **WSP-046** `invitation.list` 需 `member.invite`；只返回 pending 邀请（`invitation_id`/`email`/`role`/`expires_at`/`created_at`），不给令牌明文或摘要。

### F. 隔离与越权

- **WSP-047** 所有 workspace-scoped 读写按调用者所在 workspace 过滤；跨租户访问 404 不 403；可见但权限不足 → 403 `forbidden`。
- **WSP-048** 带 `X-Forwarded-For` 时客户端 IP 取最右侧非受信 hop（`trusted_proxy_cidrs` 未声明时取最右一项），不取最左项；结果写入邀请邮件事件 `data.source_ip`。

### G. 软删除与留存

- **WSP-049** 移除成员、删除 workspace、删除自定义角色都是软删除：`deleted_at` 非空、行仍在（DB 只读可见），且不出现在任何 list 或 scoped 结果中。
- **WSP-050** 移除成员或删除 workspace 时，该成员行的个人数据（email、display name、avatar 等）被清空或不可逆替换；`user_id`/`role`/`status`/时间戳保留。

### H. 枚举安全

- **WSP-051** `member.invite` 对「未注册」「已注册但非本 workspace 成员」「已注册且账号被禁用或未验证」返回相同状态码与响应体结构（201，字段集相同），不泄露账号存在性。
- **WSP-052** `member.invite` 对「已是成员」返回 409 `already_member`（只反映成员关系，不用于区分账号是否存在）；响应不出现「该邮箱已注册」文案，不用不同 `message` 区分失败原因。

### I. 存储与哈希

- **WSP-053** 本模块不存密码、API key、会话凭据；敏感值只存摘要；DB 只读查询读不到明文令牌或密码。

### J. 事件

- **WSP-054** outbox 事件 template 以 `workspaces-and-permissions.` 开头（如 `workspaces-and-permissions.member_added`）；邀请邮件事件满足 WSP-040；payload 不含凭据。

## 6. 建议，验收不测（黑盒观察不到或不该由本模块保证）

- 响应耗时、查询计划。
- 令牌摘要的具体算法；只看「库里没有明文」。
- 摘要算法迁移：**不要**用已存旧摘要再计算摘要；并行接受旧/新摘要，直到旧令牌全部过期再下线旧算法。
- 分布式部署下的缓存一致性机制。
- 密码哈希升级属 `auth`：下次登录时升级，不重算已存哈希。

## 7. 规则 → 用例追溯表

| 规则 | 用例 | 规则 | 用例 | 规则 | 用例 |
| --- | --- | --- | --- | --- | --- |
| WSP-001 | 01/29 | WSP-002 | 03/29 | WSP-010 | 01 |
| WSP-011 | 03 | WSP-012 | 05/06/24/27 | WSP-013 | 02/19 |
| WSP-014 | 19/24 | WSP-020 | 02/03 | WSP-021 | 02/04/05 |
| WSP-022 | 19 | WSP-023 | 25 | WSP-024 | 25/26 |
| WSP-025 | 18 | WSP-026 | 22 | WSP-027 | 07/15/29 |
| WSP-028 | 20/29 | WSP-029 | 16 | WSP-030 | 17 |
| WSP-031 | 21 | WSP-032 | 21 | WSP-033 | 21 |
| WSP-034 | 24 | WSP-035 | 27 | WSP-036 | 22 |
| WSP-037 | 23 | WSP-038 | 23 | WSP-039 | 08 |
| WSP-040 | 07/10 | WSP-041 | 06/13 | WSP-042 | 09/10/13 |
| WSP-043 | 11 | WSP-044 | 12 | WSP-045 | 14 |
| WSP-046 | 11 | WSP-047 | 05/06/19 | WSP-048 | 28 |
| WSP-049 | 04/24/25 | WSP-050 | 24/25 | WSP-051 | 15 |
| WSP-052 | 16/29 | WSP-053 | 08 | WSP-054 | 07/30 |

用例列 `03/09` 表示 AP-03 与 AP-09。
