# workspaces-and-permissions 验收计划（黑盒）

宿主约定见 `HOST.md`（启动、路径映射、params、测试钩子、观察边界、依赖顺序）；本文只写执行细节与用例。

## 0. 执行约定

- **账号与会话**：用户用 `auth` 的公开概念创建与登录（`auth.signup`/`auth.login`），会话 cookie 取自 `Set-Cookie`；**每例用全新唯一邮箱**，不共享状态。
- **租户标识**：`module-map.json` 的映射路径含 `{workspaceId}` 则填路径，否则发 header `X-Workspace-Id`；两者都发时必须一致（制造冲突的用例除外）。
- **请求头**：所有非 GET 请求带 `Content-Type: application/json` 与 `Origin: <APP_BASE_URL>`（取宿主声明的 `APP_BASE_URL`，不写死域名）；宿主若校验 Origin/CSRF，脚本已满足。
- **令牌**：`GET /api/__test__/outbox?to=<email>` → `messages[]`；明文令牌在 `token`，接受链接在 `data.link`，模板名在 `template`（明文只出现在这里）。
- **时钟**：`POST /api/__test__/clock {advanceSeconds}` 推进令牌 TTL 与保留窗口（同一用例内累积）。
- **params**：从 `module-map.json` 的 `params` 读 `max_workspaces_per_user`、`max_pending_invitations_per_workspace`、`max_members_per_page`、`invitation_ttl_seconds`、`workspace_retention_seconds`、`trusted_proxy_cidrs`；**没声明就按 `contract.md` §4 的取值列**，数值不写死在脚本里。
- **数据库只读**：用 `DATABASE_URL` 执行只读 SELECT，只查令牌列是否摘要、`deleted_at` 是否非空、个人数据是否已清除。**不得写入**。
- **限流**：每例前 `DELETE /api/__test__/rate-limits` 清零；返回 429 记「属 rate-limiting 模块」并跳过该断言。
- **判定**：期望 4xx 却返回 2xx → 失败；5xx → 失败；错误体缺 `error.code` → 失败；概念未声明 → 记「宿主未声明」，不算通过也不算失败。

## 1. 用例表

`负例 = 是` 表示宿主实现正确时该请求**必须**失败（返回 2xx 即失败）。

| id | given | action | expected | 规则 | 负例 |
| --- | --- | --- | --- | --- | --- |
| AP-01 | 无会话 | GET `workspace.list` | 401 `unauthenticated`；体含 `error.code`；无 5xx | WSP-001 WSP-010 | 是 |
| AP-02 | owner 已登录 | POST `workspace.create {name:"Acme"}`；再 GET `context.get` | 201 且 `role=owner`、`member_count=1`；context 返回 `role=owner`、`permissions`=§2 全集、`member_status=active` | WSP-013 WSP-020 WSP-021 | 否 |
| AP-03 | owner 已登录 | `workspace.create` 依次传 `{name:""}`、65 字 name、缺 name 的 body；再同时用路径与 header 传不同租户 id | 依次 400 `invalid_name`、`invalid_name`、`invalid_body`、`workspace_context_mismatch` | WSP-002 WSP-011 WSP-020 | 是 |
| AP-04 | owner1 建租户 A、owner2 建租户 B | owner1 GET `workspace.list`；owner2 GET `workspace.list` | 各自只看到自己的租户；互不可见；项含 `id`/`name`/`role`/`member_count`/`created_at` | WSP-021 WSP-049 | 是 |
| AP-05 | owner1 持有 B 的 workspace id | owner1 GET `workspace.get`(B) | 404 `workspace_not_found`（非 403）；与查不存在租户同形 | WSP-012 WSP-021 WSP-047 | 是 |
| AP-06 | owner1 不是 B 的成员 | owner1 依次 GET `member.list`(B)、`invitation.list`(B)、`role.list`(B)，POST `member.invite`(B) | 全部 404 `workspace_not_found`；不泄露 B 存在 | WSP-012 WSP-041 WSP-047 | 是 |
| AP-07 | owner 已登录 | POST `member.invite {email:"  U2@Example.TEST ", role:"member"}`；读 outbox(to=u2@example.test) | 201；outbox template `workspaces-and-permissions.invitation_created`、`to`=u2@example.test、非空 `token`、`data.link` 含该 token、`data` 含 `workspace_name`/`role`/`expires_at` | WSP-027 WSP-040 WSP-054 | 否 |
| AP-08 | 同 AP-07 的邀请已发出 | 只读查库：邀请行令牌列、成员表列名 | 只有摘要（非明文），无明文 token；outbox token ≥ 32 字节；无密码/凭据类列值 | WSP-039 WSP-053 | 是 |
| AP-09 | u2 已登录、持有有效令牌 | 连续两次 POST `invitation.accept` | 第一次 200 返回 `workspace_id`/`role`/`member_id`；第二次 400 `invitation_token_invalid`；`member.list` 中 u2 只有 1 条 active 记录 | WSP-042 | 是 |
| AP-10 | 邀请 pending | 推进时钟 `invitation_ttl_seconds+1`；u2 POST `invitation.accept` | 400 `invitation_token_invalid`；成员数不变 | WSP-040 WSP-042 | 是 |
| AP-11 | 邀请 pending（id 取自 `member.invite`） | owner POST `invitation.revoke`；u2 POST `invitation.accept`；owner GET `invitation.list` | revoke 200；accept 400 `invitation_token_invalid`；list 不含该邀请，无 token 字段 | WSP-043 WSP-046 | 是 |
| AP-12 | 邀请 pending（id 取自 `member.invite`） | owner POST `invitation.resend`；先用旧令牌 accept，再用新令牌 accept | 旧令牌 400 `invitation_token_invalid`；新令牌 200 | WSP-044 | 是 |
| AP-13 | u3 已登录，手里是 u2 的令牌 | u3 POST `invitation.accept` | 400 `invitation_token_invalid`；`member.list` 无 u3；不因「邮箱不匹配」给别的码 | WSP-041 WSP-042 | 是 |
| AP-14 | 邀请 pending、u2 已登录 | 8 个并发 POST `invitation.accept`（同一 token） | 至多一个 200；最终 `member.list` 中 u2 恰 1 条 active | WSP-045 | 是 |
| AP-15 | owner 已登录 | 依次邀请：未注册、已注册未入组、已注册且被禁用、已注册但未验证的邮箱 | 四次都 201；响应体字段集相同、除 `email` 外值一致；文案不含「已注册/已存在」；`auth` 若未公开「禁用/未验证账号」创建方式，后两态记「宿主未声明」 | WSP-027 WSP-051 | 是 |
| AP-16 | u2 已是该租户成员 | owner POST `member.invite {email:u2}` | 409 `already_member` | WSP-029 WSP-052 | 是 |
| AP-17 | owner 已登录 | 邀请 `max_pending_invitations_per_workspace` 个不同邮箱，再多邀请 1 个 | 前 N 次 201；第 N+1 次 409 `invitation_limit_reached` | WSP-030 | 是 |
| AP-18 | 全新账号 | 建 `max_workspaces_per_user` 个租户，再建 1 个 | 前 N 次 201；第 N+1 次 409 `workspace_limit_reached` | WSP-025 | 是 |
| AP-19 | owner 把 u2 从 member 降为 viewer | u2 GET `context.get`；u2 POST `workspace.update`；owner POST `workspace.update {name:"新名"}` | u2 的 `permissions` 立即变 viewer 集合（无 `data.write`）；u2 改租户 403 `forbidden`；owner 改名 200 | WSP-013 WSP-014 WSP-022 WSP-047 | 是 |
| AP-20 | owner 把 u2 设为 admin | admin 邀请角色 `owner`；admin 建含 `workspace.delete` 权限的自定义角色 | 两次都 403 `escalation_forbidden`；owner 仍是原 owner | WSP-028 | 是 |
| AP-21 | owner 与 admin u2 同在租户 | owner 把自己降为 member；owner 移除自己；u2 改自己角色；u2 移除 owner；owner 把 u2 设为 owner | 前两步 403 `self_role_change_forbidden`、403 `self_removal_forbidden`；u2 改自己角色 403 `self_role_change_forbidden`；u2 移除 owner 409 `last_owner_required`；转移后 `owner` 恰 1 个且是 u2，原 owner 变 admin | WSP-031 WSP-032 WSP-033 | 是 |
| AP-22 | 租户含 viewer 成员 | viewer GET `member.list`；owner GET `role.list`；owner GET `member.list?limit=99999` | viewer 列表项不含 email；`role.list` 含 4 个内置角色且权限集与 §2 一致；`limit` 越界 400 `invalid_limit` | WSP-026 WSP-036 | 否 |
| AP-23 | owner 已登录 | `role.create` 建 `["data.read","data.write"]`；同名再建；建 `["data.write","nope"]`；赋给 u2 后 `role.delete`；`role.delete` 内置角色 owner | 201；409 `role_exists`；400 `unknown_permission`；409 `role_in_use`；400 `builtin_role_immutable` | WSP-037 WSP-038 | 是 |
| AP-24 | u2 是 member（id 取自 `member.list`） | owner DELETE `member.remove`(u2)；u2 GET `workspace.get`；owner GET `member.list`；只读查库 | 移除 200；u2 之后 404 `workspace_not_found`；列表无 u2；库中 u2 行仍在、`deleted_at` 非空、email 已清空或不可逆替换 | WSP-012 WSP-014 WSP-034 WSP-049 WSP-050 | 是 |
| AP-25 | owner 与 u2 在租户 A | owner DELETE `workspace.delete`；owner GET `workspace.get`、`workspace.list`；只读查库；owner POST `workspace.restore` | delete 200 含 `deleted_at`；get 404、list 不含 A；库中 A 行仍在、`deleted_at` 非空、成员 email 已清除；restore 200 后访问恢复 | WSP-023 WSP-024 WSP-049 WSP-050 | 是 |
| AP-26 | 租户已软删 | 推进时钟 `workspace_retention_seconds+1`；owner POST `workspace.restore` | 410 `restore_window_expired` | WSP-024 | 是 |
| AP-27 | u2 是 member；另有 owner 独占的租户 B | u2 POST `member.leave`(A)；owner POST `member.leave`(B) | u2 退出 200 且之后 404；owner 退出 409 `last_owner_required` | WSP-012 WSP-035 | 是 |
| AP-28 | owner 已登录 | POST `member.invite`，带 `X-Forwarded-For: 203.0.113.7, 198.51.100.9`；读 outbox | `data.source_ip` = 198.51.100.9（最右非受信 hop），不是 203.0.113.7 | WSP-048 | 是 |
| AP-29 | owner 已登录 | `invitation.accept` 依次传空串、垃圾串、超长串；`member.invite` 传 `email` 为数字、格式非法的 email、`role:"wizard"` | 一律 400 `invalid_body`/`invitation_token_invalid`/`invalid_email`/`invalid_role`，绝不 5xx；错误体只有 `code`+`message`，无 stack/SQL/表名/他人 email | WSP-001 WSP-002 WSP-027 WSP-028 WSP-052 | 是 |
| AP-30 | 已发生成员与邀请变更 | 读 outbox 全部消息 | `template` 全部以 `workspaces-and-permissions.` 开头；邀请邮件含 `data.link`；除该邮件 `token` 外无明文令牌 | WSP-054 | 是 |

## 2. 覆盖（风险 → 用例）

跨租户 AP-04~06；令牌重放/过期/撤销/轮换 AP-09~12；并发 AP-14；限额 AP-17/18；升级防护 AP-20；owner 保护 AP-21；失效即拒 AP-19/24/27；枚举 AP-15/16；令牌入库 AP-08/30；软删除与 PII AP-24~26；代理头伪造 AP-28；鲁棒性 AP-03/29；角色矩阵 AP-02/22/23。

## 3. 统计口径

每条用例输出 pass / fail / skip（宿主未声明、状态不可构造）/ 429（属 rate-limiting 模块）；任一 fail 即本模块未通过，skip 单独统计。`params` 已声明时阈值按声明值，超出 `contract.md` §4 界限 → 记契约违例。
