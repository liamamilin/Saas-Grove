# feature-flags 验收计划（黑盒用例）

本文只是**计划**：可执行测试随后再写。每条用例都能从运行的宿主外部观察，不读源码、不改数据库（只读查询除外，见 A-23 / A-24）。状态码与错误码以 `contract.md` §4 为唯一口径。

## 0. 前置：夹具、凭据、参数

- **路径**：全部读 `module-map.json` 的概念映射；未声明的概念记"宿主未声明"，跳过并单独统计，不算失败也不算通过。
- **账号与工作区**：用 auth / workspaces-and-permissions 的公开接口创建；每条用例用全新账号（唯一邮箱），不共享状态。
- **管理账号**：按 `params.feature-flags.manageRole` 选角色；未声明时用工作区 owner/admin。
- **普通成员**：工作区里非管理的成员（workspaces-and-permissions 的公开接口创建）。
- **邀请令牌**：从 `GET /api/__test__/outbox?to=<email>` 取 `token` 与 `data.link`。
- **时钟**：`POST /api/__test__/clock {advanceSeconds}`。
- **请求头**：会话型请求默认带 `Origin: $APP_BASE_URL` 与 `X-Feature-Flags-Client: 1`；只有 A-18 动这两个头。
- **数值**：TTL、缓存、Origin 列表、可信代理、key 上限等一律从 `params` 读，脚本不得写死；未声明时按 `contract.md` §6 的缺省值。
- **只读数据库查询**：仅用于 A-23 / A-24 检查"明文是否入库"，用法见 HOST.md §4。

## 1. 用例表

| id | given | action | expected | negative |
| --- | --- | --- | --- | --- |
| A-01 | 管理账号已登录，工作区 W | 创建 boolean flag `billing.new_invoice`；再用同 key 创建；再建 key `Bad Key!` | 201；409 `flag_exists`；400 `invalid_request` | yes |
| A-02 | 已有 boolean flag | 创建时 `defaultValue` 传字符串；再对该 flag 更新 `type` | 400 `type_mismatch`；400 `type_immutable` | yes |
| A-03 | 已有 flag | update / evaluate 未知 key；evaluate 批量含一个未知 key；发缺字段的 body | 都 404 `unknown_flag`；整单 404 且无部分结果；400 `invalid_request`，错误体只有 code + message | yes |
| A-04 | 已有 flag | archive 后求值；再 update 它 | 200，value=default、source=default、reason=archived；409 `flag_archived` | yes |
| A-05 | flag：default false、allow 含用户 U、rollout 100% | 依次求值 → 把 U 加入 deny 后求值 → 建覆盖（ws W，value false）后求值 → kill 后求值 | source 依次 `allow_list` → `deny_list` → `tenant_override` → `kill_switch`，值依次 true → false → false → false（kill 值=defaultValue） | no |
| A-06 | 已有 flag | kill 不带 reason | 400 `invalid_request` | yes |
| A-07 | 已有 flag，先求值一次（可能命中缓存） | 立刻 kill 同一 flag，再求值 | 下一次求值立即是 kill 值（source=kill_switch），不接受旧值 | yes |
| A-08 | flag 处于 kill 态 | 用 flags.update 带 kill 字段；再 unkill | 400 `kill_state_readonly`；unkill 后回到 kill 前的定向结果 | yes |
| A-09 | scope=user 的 flag | 设 percentage=101；设 0；设 100；同一用户连续求值两次；再带 `rollout.salt` 更新 | 400 `percentage_out_of_range`；0% 全部不命中；100% 全部命中且 source=rollout；两次结果一致；400 `invalid_request` | yes |
| A-10 | 8 个用户账号，scope=user 的 flag，rollout 30% | 记录命中集合 S1；改成 50% 再求值得 S2 | S1 ⊆ S2（已命中的人不能被踢出灰度） | no |
| A-11 | 用户 U 同时是 W1、W2 的成员 | 给 W1 建覆盖 value=true；对 W2 求值 | 对 W2 求值时 source ≠ `tenant_override`，值等于默认值 | yes |
| A-12 | 覆盖带 expiresAt（当前 +60s） | 求值；用时钟推进到 expiresAt 之后 1 秒；再求值 | 第一次 source=`tenant_override`；第二次不再命中 | no |
| A-13 | W1 已有一条覆盖 | 再建同 (flag, W1) 覆盖；删除该覆盖；再求值；再删一次 | 409 `override_exists`；204；求值 source 不再是 `tenant_override`；404 `unknown_override` | yes |
| A-14 | 普通成员 M（非 W1 管理员）；陌生工作区 W2 | M 建 / 删覆盖；M 求值 W2；W1 管理员求值 W2 | 403 `forbidden`；403 `not_a_member`；403 `not_a_member` | yes |
| A-15 | 会话账号 U；服务令牌 T | U 求值带 asUserId=他人；U 求值带 attributes；T 代办求值 | 403 `forbidden_subject`；400 `attributes_not_allowed`；200 | yes |
| A-16 | 无任何凭据 | 依次调 evaluate / definitions / flags.list / overrides.create / invites.request / tokens.create | 全部 401 `unauthenticated` | yes |
| A-17 | flag 带 allow 名单用户 id、rollout salt、覆盖、管理员邮箱 | GET definitions | 只出现 key/type/defaultValue/description/scope/status；不出现名单 id、salt、邮箱、覆盖值 | yes |
| A-18 | 会话账号 | 请求带 `Origin: https://not-allowed.example`；再带合法 Origin 但去掉 `X-Feature-Flags-Client` | 403 `origin_not_allowed`；403 `missing_client_header` | yes |
| A-19 | flag 带 ipCidrs `203.0.113.0/24` | 求值时分别带 XFF `198.51.100.9, 203.0.113.7` 与 `203.0.113.7, 198.51.100.9` | 按 params.trustedProxies 分支：peer 可信 → 前者命中、后者不命中；peer 不可信 → 两者都不命中（最左侧永不被采用） | yes |
| A-20 | 管理员；e1 存在、启用、邮箱已验证且是 W 成员；e2 存在但账号被禁用；e3 存在、启用、是 W 成员但邮箱未验证；e4 不存在 | 对四个邮箱各发一次 invites.request | 四次状态码与响应体逐字节相同（200 `{"status":"accepted"}`）；宿主若建不出未验证账号，e3 一项记"宿主未声明"并跳过 | yes |
| A-21 | 同 A-20 | 查 outbox | 只有 e1 收到模板 `feature-flags.tenant_override_invite`，`data.link` 含兑换链接、`token` 字段有令牌；e2 / e3 / e4 均无邮件 | yes |
| A-22 | 已发出的令牌 t | 先兑换一次；再兑换一次；再并发兑换 5 次 | 首次 200；再次 404 `invalid_or_expired_token`；并发中恰好 1 个 200，其余 404 | yes |
| A-23 | 令牌 t，时钟可用 | 时钟推进 `params.inviteTokenTtlSeconds` + 1 秒后兑换；再做只读库查询搜明文 | 404 `invalid_or_expired_token`；明文在库中出现 0 次，存储列是摘要 | yes |
| A-24 | 管理员 | 创建服务令牌；再 GET tokens.list；只读查该 token 的存储列；再 revoke 它并用它 evaluate | 创建响应含一次明文；列表只有 id/name/createdAt/revokedAt/lastUsedAt，无明文无摘要；存储列是摘要、不含明文；撤销后 401 `unauthenticated` | yes |
| A-25 | 三个 flag（boolean / string / number） | 一次 evaluate 请求这三个 key | 恰好三条结果、顺序与请求一致、value 类型分别匹配、响应含 evaluatedAt | no |
| A-26 | 工作区 W 有成员 M1、M2 | scope=workspace 的 flag，分别以 M1、M2 求值 | 两者 value 与 source 相同 | no |

## 2. 覆盖与执行说明

- **规则 → 用例**：`contract.md` §9 是唯一追溯表；本表的每个 id 至少被一条规则引用，每条 MUST 规则至少被一个用例覆盖。
- **顺序**：用例之间不共享账号与工作区；A-05、A-07、A-08、A-12 在各自用例内部按 given → action 顺序推进，不跨用例复用状态。
- **并发**：A-22 的"并发 5 次"是固定测试形状（≥2 路并行），不是产品限额；必须断言"恰好一个 200"。
- **分支**：A-19 的两种结果都算通过，只要与 `params.trustedProxies` 的声明一致；断言的是"取最右侧非可信跳数、且永不取最左侧"这条性质。
- **未声明**：宿主未在 `module-map.json` 声明的概念或 `params`，相关行跳过并单独统计（HOST.md §2、§2b）。
