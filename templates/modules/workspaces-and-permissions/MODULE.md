# workspaces-and-permissions · 模块认知模板

> 这是一份**认知模板**：一个成熟的 workspaces-and-permissions 长什么样、每项能力的正确行为、以及会在生产上出事的坑。不含实现代码。
> 规则见 `contract.md`，用例见 `acceptance-plan.md`，待人拍板见 `decisions.md`；宿主约定见 `HOST.md`，本文不重复。

---

## 0. 必读摘要（只读这一页也能开工）

**一句话**：这个模块把「一群人 + 一堆只属于他们的数据」组织成多个互不看见的租户，回答三个问题——**你是谁**、**你在哪个租户里**、**你在那租户里能做什么**。

**产物**：租户（workspace）、成员（member）、邀请（invitation）、角色（role）与权限目录，外加每个请求都要过的**租户上下文**。
**不拥有**：账号密码、会话、邮件发送、计费、限流器、审计存储（第 5 节）。

**五条不可妥协的规则**（违反任何一条都是安全事故，不是 bug）：

1. **跨租户访问一律 404，绝不 403。** 403 与 404 的差别 = 租户存不存在 = 信息泄露。
2. **权限判定只信服务端查到的成员关系**，不许信客户端传来的 `workspace_id`、`role`、`user_id`。
3. **邀请令牌只存摘要**；明文只允许出现在 outbox 邮件的 `token` 字段；令牌一次性、可撤销、可过期、可轮换。
4. **移除成员 / 删除租户 = 软删除 + 个人数据清除**：行要留着（审计、统计），PII 要没有（合规、删除请求）。
5. **每张租户 scoped 的表都要有 `workspace_id`，且每个查询都带这个过滤条件**——漏一个端点就是一个跨租户漏洞，漏在列表类端点上的概率最高。

**五个最贵的坑**：owner 把自己降级导致租户失去管理员；成员被移除后旧会话仍能读写；拿 `X-Forwarded-For` **最左**项当客户端 IP；邀请失败用不同文案暴露"邮箱已注册"；用 `email` 当身份主键。

**开工前必须先定的三个决定**（`decisions.md`）：租户标识走路径还是 header；角色固定四个还是允许自定义；邀请已有账号时统一走邀请还是直接拉入。

**怎么算做对了**：`contract.md` 每条 MUST 规则都有黑盒用例（`acceptance-plan.md`），追溯表在 `contract.md` 末尾。

---

## 1. 这个模块是什么

**职责**：提供**租户边界**与**租户内授权**。所有租户 scoped 的业务数据（对话、文件、用量、账单）都靠本模块划的边界隔离。

| 词 | 含义 | 关键属性 |
| --- | --- | --- |
| workspace（租户） | 数据隔离的最小单位 | 有名字、有生命周期、软删除 |
| member（成员） | 用户在某租户里的一条成员关系 | 唯一键 (workspace_id, user_id)，软删除 |
| invitation（邀请） | 把人拉进租户的凭证 | 绑定 (workspace_id, email, role)，一次性，带 TTL |
| role（角色） | 一组权限的命名包 | 内置 4 个 + 工作区级自定义 |
| permission（权限） | 一个可判定的能力名 | 固定目录 13 项，角色是它的子集 |
| tenant context | 一次请求里"哪个租户 + 什么身份"的解析结果 | 每个 scoped 端点都要有 |

**核心数据形状**（概念模型，不绑定任何数据库实现）：

```
workspace(id, name, status, created_at, updated_at, deleted_at, deleted_by)
member(id, workspace_id, user_id, role_key, status, invited_by, created_at, updated_at, deleted_at)
invitation(id, workspace_id, email_normalized, role_key, token_digest, status, invited_by,
           expires_at, accepted_at, accepted_by, created_at)
role(id, workspace_id|null, key, name, permissions[], is_builtin, created_at, deleted_at)
```

约束：`member` 在 active 时 `(workspace_id, user_id)` 唯一；`invitation` 在 pending 时 `(workspace_id, email_normalized)` 唯一；同一 workspace 任意时刻**有且仅有一个 active owner**。

---

## 2. 成熟版应该有什么（MVP → 成熟分层）

### L1 · MVP：能上线的最小闭环

| 能力 | 做到什么算完成 |
| --- | --- |
| 租户生命周期 | create/list/get/update/delete（软）；创建者自动成为唯一 owner |
| 固定角色 | owner/admin/member/viewer 四个 + 13 项权限目录，判定只查目录 |
| 成员管理 | list/invite(邮件)/改角色/移除/退出 |
| 邀请闭环 | 一次性令牌 + TTL + 撤销 + 重发轮换 |
| 租户上下文 | 所有 scoped 端点强制 `workspace_id` 过滤，404/403 分工明确 |
| 错误形状 | 统一 JSON 错误体 + 稳定 code 表 |
| 枚举安全 | 邀请与接受失败同形同码 |
| 令牌哈希 | 只存摘要，明文只进 outbox |
| 软删除 + PII 清除 | 行保留、`deleted_at` 落库、个人数据抹掉 |
| 状态型上限 | 每用户租户数、每租户 pending 邀请数 |

### L2 · 真实上线前补齐

| 能力 | 做到什么算完成 |
| --- | --- |
| 自定义角色 | 工作区级角色，权限取自固定目录；建/删/占用检测 |
| 有效权限查询 | 一个端点返回"当前租户 + 角色 + 权限集合" |
| 所有权转移 | 转移后恰好一个 owner，原 owner 降为 admin，原子完成 |
| 恢复窗口 | 软删除后可在保留窗口内 restore，超窗明确失败 |
| email 可见性 | 单独的 `member.read_email` 权限；无权限则列表不返回 email |
| 事件 outbox | 成员/角色/租户变更发事件，模板名 `<模块>.<名>` |
| 客户端 IP 解析 | 从右往左跳过受信代理，取第一个非受信 hop |
| 权限实时性 | 角色变更后下一请求即生效，不留陈旧缓存窗口 |
| 并发正确性 | 唯一约束 + 原子转移 + 事务 |

### L3 · 规模化运营后再做

团队/组与组权限；企业目录（SCIM/SSO）映射成成员与角色；跨租户共享只读对象（绝不共享写）；按属性覆写角色；批量导入与改角色；租户容量配额（与 usage-metering-and-budgets 对接）；委托管理（代理排障留痕）；细粒度 ABAC；单租户私有部署模式。

---

## 3. 每项的正确行为

| 能力 | 正确行为 | 验收信号 |
| --- | --- | --- |
| 创建/列/看租户 | 创建者自动成为唯一 owner；只列我是 active 成员的租户；不可见一律 404 | 201 且 `role=owner`；非成员拿 404 不是 403 |
| 改/删/恢复租户 | 改需 `workspace.update`（name trim 后 1..64 字符）；删需 `workspace.delete`（仅 owner）且软删除；恢复仅保留窗口内 | member 改 → 403；删后 get/list 404 且库中 `deleted_at` 非空；超窗 → 410 |
| 成员列表 | 需 `member.read`；无 `member.read_email` 则不返回 email | viewer 拿不到 email |
| 邀请 | 需 `member.invite`；email trim+小写；role 须属本租户 | 201 且 outbox 出现邀请邮件 |
| 接受邀请 | 令牌绑定 (租户, email, role)；会话用户 email 必须匹配 | 错账号 → 400 |
| 重放/过期/撤销/重发 | 令牌一次性、到期作废、撤销即失效、重发换新令牌旧令牌即失效 | 第二/旧令牌 → 400，成员数仍为 1 |
| 改角色/移除/退出 | 改需 `member.update_role`，不能改自己，不能降级最后一个 owner；移除软删并抹个人数据；owner 退出前须先转移 | 403 / 409；被移除者其请求 404 |
| 角色目录与自定义 | 内置四角色权限集固定；自定义角色是 13 项目录子集；授予权限不得超过操作者；一个端点返回租户 + 角色 + 权限集合 | 目录外权限 → 400；admin 授 owner → 403；降级后权限立即变化 |
| 错误形状 | 统一 `{"error":{"code","message"}}`，code 唯一稳定 | 无 stack / SQL / 内部路径 |
| 枚举安全 | 未知邮箱 / 已注册 / 已注册但禁用或未验证 → 同状态同形状 | 三种邮箱返回体结构一致 |
| 令牌存储与事件 | 只存摘要，明文只在 outbox；模板名 `<模块>.<名>`，链接放 `data.link` | 库里查不到明文；outbox 名字对得上 |

---

## 4. 容易做错的地方（具体到会出什么事故）

| 做法 | 会出什么事故 | 防线 |
| --- | --- | --- |
| 跨租户返回 403 | 遍历 id 就能枚举出哪些租户存在、多大 | 不可见一律 404 |
| 信任请求里的 role/workspace_id | 改一个字段就是别的租户的 owner | 每次请求重查成员关系 |
| 权限判定走缓存（哪怕 60 秒） | 被降权/移除的人仍能读写删 | 实时判定或显式失效 |
| 移除成员不吊销会话 | 他手里的 cookie 仍能访问租户数据 | 移除即刻判成员关系失效 |
| 令牌明文入库或进日志 | 备份、日志平台、CI 输出全成泄露源 | 只存摘要（不可逆），日志只打前 8 位 |
| 邀请失败用不同文案 | "该邮箱已注册" = 邮箱枚举、撞库名单 | 全部失败同码同形状 |
| 拿 XFF 最左项当客户端 IP | 伪造 `X-Forwarded-For` 就换 IP，绕开限流风控 | 从右往左跳过受信代理 |
| owner 可自我降级/移除 | 租户失去唯一管理员，没人能加回成员 | 最后一个 owner 不可降级/移除/退出 |
| "先查再插"判重复 | 并发同时通过检查 → 两条成员记录 / 两个 owner | 唯一约束 + 事务 |
| 软删只标记不清 PII | 删除请求无法真正落地，审计还留着邮箱 | 删除时抹 email/name/avatar |
| 删租户级联物理删各表 | 用量与账单记录被抹，账对不上 | 只软删租户，各模块按状态处置 |
| 邀请链接带 workspace id 与 role | 链接转发 = 越权邀请，可能被收录 | 链接只带不可猜的一次性令牌 |
| 想靠"重算摘要"给过期令牌续命 | 摘要不可逆，且等于绕过 TTL | 过期就作废；算法迁移用双摘要并行过渡 |

---

## 5. 与其他模块的接口

| 模块 | 接口含义 |
| --- | --- |
| auth | 提供"当前是谁"（已认证 user id）与账号状态；身份判定基于 user id，**不以 email 当身份** |
| email-transactional | 消费本模块的邀请邮件事件（template、token、data.link），发送与退信归它 |
| notifications | 消费邀请/成员变更事件做站内通知，本模块只发事件 |
| audit-and-data-export | 消费成员/角色/租户事件做审计与导出，本模块负责"发生了什么" |
| usage-metering-and-budgets | 以 `workspace_id` 为计量主体，成员归属由本模块判定 |
| payments-billing | 以 `workspace_id` 为账单主体，账单动作的权限由它实现 |
| rate-limiting | 负责本模块端点的 IP/账号限流；本模块只做**状态型上限** |
| async-jobs | 后台任务显式携带 `workspace_id`；再调本模块用服务身份，别用过期的人工会话 |
| ai-model-gateway | 调用前校验 `data.read`/`data.write`，按 `workspace_id` 记账与过滤 |
| ai-retrieval | 检索范围按 `workspace_id` 过滤，不允许跨租户召回 |
| file-storage | 路径与配额按 `workspace_id` 划分 |
| webhooks-outbound | 订阅事件按 `workspace_id` 分发 |
| observability | 接收结构化日志与指标（workspace_id、actor、action、result） |
| feature-flags / analytics | 按 `workspace_id` 灰度；消费租户与成员事件做漏斗分析 |
| internationalization | 邮件与错误文案由它提供，本模块只给 template 名与结构化 data |

---

## 6. 不做什么

- **不做认证**：账号、密码、会话、MFA、账号禁用判定属 `auth`；本模块不存密码与凭据。
- **不做邮件发送**：只产出事件与模板数据，发送交给 `email-transactional`。
- **不做限流器**：频率限制交给 `rate-limiting`，本模块只做状态型上限。
- **不做计费与配额**：交给 `usage-metering-and-budgets` 与 `payments-billing`。
- **不做审计存储与导出**：只发事件，交给 `audit-and-data-export`。
- **不做物理删除与保留策略作业**：本模块只负责"软删除 + 恢复窗口 + 抹个人数据"。
- **不做跨租户共享写对象**：不提供绕过租户边界的"全局资源"抽象。
- **不做细粒度 ABAC / 策略引擎**：只做"角色 → 权限集合"两层，规则不写进代码。
- **不做 SSO / SCIM / 企业目录同步**（L3 再说）；不做文件与对象存储、实时协作。
- **不承诺实名验证**：邀请凭据是邮箱持有性，不是实名。
