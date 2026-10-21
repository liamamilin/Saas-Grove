# feature-flags 契约（黑盒可测）

宿主通用约定见 `../HOST.md`，本文件不重复。契约里的路径是**概念名**，宿主在 `module-map.json` 里映射，验收只认映射；没有映射的概念记为"宿主未声明"，既不算失败也不算通过。

## 0. 怎么读这份契约

1. 每条 `F-xx` 是 MUST，都能从宿主外部观察（状态码、响应体、Cookie、邮件 outbox、只读库查询）。
2. 数值只给**界限**，实际值由宿主在 `params` 声明；未声明时按 §6 取值。
3. 错误体统一为 `{"error":{"code":"...","message":"..."}}`；`code` 稳定可断言，`message` 不得含 SQL、堆栈、路径或其他租户数据。
4. `{key}`、`{id}` 是路径参数。
5. 调用资格由宿主能力体系判定（auth 给主体，workspaces-and-permissions 给成员资格与管理能力）；本模块只落地判定，不自己实现权限。

## 1. 概念与端点

建议路径前缀 `/api/feature-flags`，后缀为 `/evaluate`、`/definitions`、`/flags`、`/flags/{key}`、`/flags/{key}/archive|/kill|/unkill`、`/overrides`、`/overrides/{id}`、`/tenant-invites`、`/tenant-invites/redeem`、`/tokens`、`/tokens/{id}/revoke`。

| 概念 | 方法 | 成功码 | 调用资格 |
| --- | --- | --- | --- |
| `feature-flags.evaluate` | POST | 200 | 会话主体或服务令牌 |
| `feature-flags.definitions` | GET | 200 | 会话主体或服务令牌 |
| `feature-flags.flags.list` | GET | 200 | flag 管理权 * |
| `feature-flags.flags.create` | POST | 201 | flag 管理权 * |
| `feature-flags.flags.update` | PATCH | 200 | flag 管理权 * |
| `feature-flags.flags.archive` | POST | 200 | flag 管理权 * |
| `feature-flags.flags.kill` | POST | 200 | flag 管理权 * |
| `feature-flags.flags.unkill` | POST | 200 | flag 管理权 * |
| `feature-flags.overrides.list` | GET | 200 | 目标工作区成员 |
| `feature-flags.overrides.create` | POST | 201 | 工作区管理员 |
| `feature-flags.overrides.delete` | DELETE | 204 | 工作区管理员 |
| `feature-flags.invites.request` | POST | 200 | 工作区管理员 |
| `feature-flags.invites.redeem` | POST | 200 | 持令牌者 |
| `feature-flags.tokens.create` | POST | 201 | 工作区管理员 |
| `feature-flags.tokens.list` | GET | 200 | 工作区管理员 |
| `feature-flags.tokens.revoke` | POST | 200 | 工作区管理员 |

\* flag 管理权由 `params.feature-flags.manageRole` 声明（平台角色或工作区 owner/admin）；**未声明时按"目标工作区的 owner/admin"判定**。

## 2. 数据模型

- **Flag definition**：`key`、`type`（`boolean|string|number|json`）、`defaultValue`、`description`、`scope`（`workspace|user`，缺省 `workspace`）、`status`（`draft|active|archived`）、`rollout{percentage,value}`、`rules{allow[],deny[],ipCidrs[],attributes[]}`、`killSwitch{active,reason,activatedAt,activatedBy}`、`killValue?`；名单条目 `{"kind","id"}`，属性规则 `{"attribute","operator","value"}`，IP 规则是 CIDR。
- **Tenant override**：`id`、`flagKey`、`workspaceId`、`value`、`expiresAt?`、`source`（`admin|invite`）。
- **求值结果项**：`key`、`value`、`source`、`reason`；`source` ∈ `kill_switch|tenant_override|deny_list|allow_list|ip_rule|attribute_rule|rollout|default`。
- **服务令牌**：`id`、`name`、`createdAt`、`revokedAt?`、`lastUsedAt?`；明文仅在创建响应出现一次。

请求体字段名可由宿主映射，语义不得变；规则点名的字段必须可传入：`workspaceId` `flagKey` `key` `type` `defaultValue` `scope` `rollout` `rules` `value` `expiresAt` `reason` `email` `token` `keys` `asUserId` `attributes`。

## 3. MUST 规则

**F-01 key 形状与不可变**：`key` 须匹配 `^[a-z0-9][a-z0-9._-]{0,63}$`，否则 400 `invalid_request`；同名重复创建 → 409 `flag_exists`；更新带出不同 `key` → 400 `key_immutable`。

**F-02 类型、默认值、作用域不可变**：`type` ∈ `boolean|string|number|json`；`defaultValue` 必须存在且类型匹配，否则 400 `type_mismatch`；改 `type` → 400 `type_immutable`；改 `scope` → 400 `scope_immutable`。

**F-03 未知 flag、坏请求、错误形状**：未知 key 的 update / archive / kill / unkill / evaluate → 404 `unknown_flag`；evaluate 里有一个未知 key 就整单 404；body 缺字段、类型错、越界 → 400 `invalid_request`；错误体按 §0。

**F-04 归档语义**：archive 后 `status=archived`；对 archived flag 求值返回 `defaultValue`、`source=default`、`reason=archived`（200）；对 archived flag 写入 → 409 `flag_archived`；definitions 仍可读到其元数据。

**F-05 优先级固定**：顺序恒为 kill switch → 租户覆盖 → deny list → allow list → IP 规则 → 属性规则 → 灰度 → 默认值；每条结果必带 `source`（取值见 §2）；deny list 命中即返回其 `value`（缺省 `false`）并压过 allow list；allow list 命中返回其 `value`（缺省 `true`）。

**F-06 kill switch 语义**：kill 激活时任何主体都得 `killValue`（缺省等于 `defaultValue`）、`source=kill_switch`，压过覆盖、allow list、灰度；kill 必须带非空 `reason`（≤500 字符），否则 400 `invalid_request`；响应回显 `killSwitch`（账号与时间）。

**F-07 写后立即可见**：任何改变判定结果的写操作（flag 更新、kill、unkill、覆盖增删改）之后，该 flag 的下一次求值必须返回新结果——缓存须被旁路或失效；求值缓存 TTL 不得超过 `params.feature-flags.cacheTtlSeconds`（缺省 0）。

**F-08 kill 状态只能由 kill / unkill 改**：`flags.update` 带 kill 字段 → 400 `kill_state_readonly`；`unkill` 后回到 kill 前的定向结果。

**F-09 灰度百分比与确定性分桶**：`rollout.percentage` 须为 0..100 整数，否则 400 `percentage_out_of_range`；0% 全部不命中，100% 全部命中且 `source=rollout`；同一 `(flag key, 主体 id)` 重复求值结果一致；salt 由服务端持有，请求带 `rollout.salt` → 400 `invalid_request`。

**F-10 灰度单调**：salt 不变时把 percentage 从 p1 提到 p2 > p1，原本命中的主体集合不得缩小。

**F-11 覆盖的作用域**：覆盖只对自己的 `workspaceId` 生效，同一用户换到别的 `workspaceId` 求值不受影响且 `source` 不是 `tenant_override`；`overrides.list` 只返回调用者所在工作区的覆盖，对非成员工作区 → 403 `not_a_member`。

**F-12 覆盖过期与删除**：带 `expiresAt` 的覆盖过期后不再命中（按宿主时钟）；删除后立即回到继承。

**F-13 覆盖增删**：同一 `(flagKey, workspaceId)` 只允许一条覆盖，重复创建 → 409 `override_exists`；删除成功 → 204；删除不存在的 id → 404 `unknown_override`。

**F-14 租户隔离与管理权限**：对不是自己工作区的 `workspaceId` 求值、读覆盖、写覆盖 → 403 `not_a_member`；在目标工作区无管理能力（普通 member）的写操作 → 403 `forbidden`；错误响应不得透露目标工作区是否存在。

**F-15 主体不可冒充**：会话主体不能替别人求值，请求带 `asUserId` 且与当前主体不符 → 403 `forbidden_subject`；服务令牌可代办；会话主体调 evaluate 带 `attributes` → 400 `attributes_not_allowed`（属性只吃服务端权威值）。

**F-16 认证**：除 redeem 外所有端点缺凭据或凭据无效 → 401 `unauthenticated`；redeem 以令牌本身为凭据。

**F-17 definitions 只含元数据**：响应只能含 key、type、defaultValue、description、scope、status、可选值集合；不得含主体的求值结果、allow / deny 名单 id、rollout salt、IP 规则、覆盖内容、创建者或管理员邮箱。

**F-18 浏览器来源与 CSRF**：带 `Origin` 时它必须在 `params.feature-flags.allowedOrigins` 内，否则 403 `origin_not_allowed`；Cookie 会话请求若既无合法 `Origin` 也无 `X-Feature-Flags-Client: 1` → 403 `missing_client_header`；服务令牌不受限。**脚本如何提供**：会话请求默认带 `Origin: $APP_BASE_URL`（取 `params` 的 `allowedOrigins` 首项，未声明时取环境变量 `APP_BASE_URL`）与 `X-Feature-Flags-Client: 1`；测拒绝分支时把 `Origin` 换成 `https://not-allowed.example`，或去掉 `Origin` 且不带自定义头。

**F-19 客户端 IP**：`X-Forwarded-For` 里**最右侧的非可信代理那一跳**才是客户端 IP；直连对端不在 `params.feature-flags.trustedProxies` 内时整个头必须被忽略；最左侧永远不得采用（除非它右侧每一跳都可信）。IP 规则用这个 IP 判定。

**F-20 邀请请求的枚举安全**：对"存在且启用 / 存在但禁用 / 存在但邮箱未验证 / 不存在"四种邮箱，`invites.request` 的状态码与响应体必须逐字节一致（统一为 200 `{"status":"accepted"}`）；只有"该邮箱是目标工作区的启用成员、且邮箱已验证"才投递邮件，另外三种一律不投递；账号状态由 auth 判定；该端点须经 rate-limiting 限流（数值取 rate-limiting 的 params）。

**F-21 邀请令牌一次性**：首次兑换 → 200 `{"status":"redeemed","flagKey","workspaceId"}`；第二次 → 404 `invalid_or_expired_token`；并发兑换同一令牌时恰好一个 200，其余 404。

**F-22 令牌 TTL 与哈希存储**：超过 `params.feature-flags.inviteTokenTtlSeconds`（未声明时按 60 秒）后兑换 → 404 `invalid_or_expired_token`；库里存摘要，明文不得出现在数据库任何位置，也不得由读接口返回。

**F-23 邀请邮件形状**：模板名 `feature-flags.tenant_override_invite`；兑换链接放 `data.link`；令牌明文放 `token`（唯一允许出现明文的地方）。

**F-24 服务令牌**：创建响应返回一次明文，之后任何接口不得返回明文或摘要；`tokens.list` 只返回 `id/name/createdAt/revokedAt/lastUsedAt`；库里只有摘要；吊销后再用它调 evaluate → 401 `unauthenticated`。

**F-25 求值响应形状**：请求的每个 key 恰好一条结果，顺序与请求一致；`value` 的 JSON 类型与 flag `type` 一致；响应带 `evaluatedAt`（ISO8601）；`keys` 条数超过 `params.feature-flags.maxEvaluateKeys` → 400 `invalid_request`。

**F-26 作用域决定分桶主体**：`scope=workspace` 时按 `workspaceId` 分桶，同工作区不同成员结果必须相同；`scope=user` 时按用户 id 分桶，同工作区成员可以不同。

## 4. 状态码与错误码总表

同一情形只用一个码，不允许一情多码：

- **401** `unauthenticated`：无凭据 / 凭据失效 / 令牌被吊销。
- **403** `not_a_member`（跨工作区）、`forbidden`（无管理能力）、`forbidden_subject`（冒充他人主体）、`origin_not_allowed`（Origin 不在允许列表）、`missing_client_header`（Cookie 会话请求缺自定义头）。
- **400** `invalid_request`（body 非法 / 字段缺失 / 格式错）、`key_immutable`、`type_immutable`、`scope_immutable`、`type_mismatch`、`kill_state_readonly`、`attributes_not_allowed`、`percentage_out_of_range`。
- **404** `unknown_flag`、`unknown_override`、`invalid_or_expired_token`。
- **409** `flag_exists`、`override_exists`、`flag_archived`。
- **201** 创建成功、**204** 删除成功、**200** 其他成功。

## 5. 必须哈希存储的数据

- **邀请兑换令牌**：只存摘要；明文只允许出现在邮件 outbox 的 `token` 字段（名字含 outbox 的表）与 redeem 成功响应。
- **服务令牌**：只存摘要；明文只允许出现在 `tokens.create` 的创建响应里。
- 算法由 `params.feature-flags.tokenHash` 声明（`sha256` / `hmac-sha256`，缺省 `sha256`）；存储值不得含明文子串，长度 ≥ 32 字节（十六进制或 Base64）。

## 6. params 与界限

| params 键 | 含义 | 界限 | 未声明时 |
| --- | --- | --- | --- |
| `feature-flags.inviteTokenTtlSeconds` | 邀请令牌有效期（秒） | [60, 604800] | 60 |
| `feature-flags.trustedProxies` | 可信代理 CIDR | 0..20 条 | 空 |
| `feature-flags.cacheTtlSeconds` | 求值缓存 TTL（秒） | [0, 30] | 0（不缓存） |
| `feature-flags.tokenHash` | 令牌摘要算法 | `sha256` / `hmac-sha256` | `sha256` |
| `feature-flags.allowedOrigins` | 允许的 Origin | 1..20 条 | `APP_BASE_URL` |
| `feature-flags.manageRole` | flag 管理权角色 | 单个角色名 | 工作区 owner/admin |
| `feature-flags.maxEvaluateKeys` | 单次求值 key 上限 | [1, 100] | 50 |

## 7. 不变量

- **I-1** 无写操作时，同一 `(flag key, 主体, workspaceId, 请求上下文)` 的求值结果恒定（纯函数，可缓存可重放）。
- **I-2** 写操作后第一次求值即新结果（F-07）。
- **I-3** `evaluate` 无副作用：重复调用不改变 flag、覆盖、令牌。
- **I-4** 覆盖只在所属工作区内可见、只在该工作区内生效。

## 8. 建议，验收不测

- 灰度 salt 轮换：双 salt 并行一段时间再切换；切换会让全体人群重排。
- 哈希密钥轮换：新旧双密钥并行校验，等旧令牌自然过期再撤旧密钥；**不要重算或改写已存储的摘要**，否则在途令牌集体失效。
- "50% 是否真到 50%"的统计验收基于 analytics 分母，不在黑盒范围。
- 双人审批、变更窗口、批量操作、配置快照与回滚。
- 多环境隔离：dev / staging / prod 各自持有 salt 与覆盖。
- 判定解释器（"为什么命中"）的落库与可视化；客户端 SDK 本地求值只作装饰。
- 求值结果不依赖时钟（覆盖 `expiresAt` 除外）；多实例下结果一致：分桶依赖稳定 salt，不依赖实例本地状态。
- 压测与 P99 延迟目标；审计事件的长期保留与导出格式。

## 9. 规则 → 用例追溯表

| 规则 | 用例 | 规则 | 用例 | 规则 | 用例 |
| --- | --- | --- | --- | --- | --- |
| F-01 | A-01 | F-10 | A-10 | F-19 | A-19 |
| F-02 | A-02 | F-11 | A-11 | F-20 | A-20, A-21 |
| F-03 | A-03 | F-12 | A-12 | F-21 | A-22 |
| F-04 | A-04 | F-13 | A-13 | F-22 | A-23 |
| F-05 | A-05 | F-14 | A-14 | F-23 | A-21 |
| F-06 | A-05, A-06 | F-15 | A-15 | F-24 | A-24 |
| F-07 | A-07 | F-16 | A-16 | F-25 | A-25 |
| F-08 | A-08 | F-17 | A-17 | F-26 | A-26 |
| F-09 | A-09 | F-18 | A-18 | | |
