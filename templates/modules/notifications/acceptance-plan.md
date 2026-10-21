# notifications 模块验收计划（黑盒）

可执行脚本在下一步产出；本文件只定义**测什么**。规则编号见 `contract.md` §5，追溯表见 `contract.md` §9。

## 1. 通用前置

- 启动、夹具、时钟、限流清桶、邮件钩子、只读数据库查询全部按 HOST.md；本文件不重复。
- 每个用例用**全新账号**（唯一邮箱）；用户、工作区、成员只经 auth 与 workspaces-and-permissions 的**公开接口**创建，不绕过。发布者 P 使用宿主可用的最高角色（owner/admin）以具备发送权限，被投递方 U 用普通成员角色。
- 概念路径从 `module-map.json` 读；未映射的概念记为"宿主未声明"，用例跳过、不判失败。
- **数值一律从 `params` 读**（`notifications.announceRateLimit`、`notifications.retentionDays`、`notifications.viewTokenTtlSeconds`、`notifications.channels`、`notifications.trustedProxies`、`digest.timezone`、`digest.weekStart`、`csrf.mode`）；未声明时按 `contract.md` §2b 的界限。
- 所有写请求带 `Origin: $APP_BASE_URL`（web-security 约定）；只有 A26 故意不带或换成 `Origin: https://evil.example`。
- 令牌与 id 的来源：令牌来自 `notifications.view-token` 响应；通知 id 来自 `notifications.list` 响应；工作区 id 来自 workspaces-and-permissions 的公开接口。
- 并发用例（A16、A22）：同一连接上同时发出两个请求，不等第一个返回，统计各自状态码。
- 只读数据库查询用 `DATABASE_URL` 以只读方式执行（或宿主提供的只读查询接口）；只查不改。

## 2. 用例表

| ID | 规则 | 前置 | 操作 | 期望 | 负例 |
|---|---|---|---|---|---|
| A01 | E1,F1 | 无会话 | 不带 Cookie 依次请求 list / unread-count / mark-read / preferences.get / preferences.update / announce / view-token | 全部 401；体为 JSON，含 `error.code=unauthenticated` 与 `error.message`；响应体不含任何通知数据 | 是 |
| A02 | F4,F7 | Z 的成员 U（无通知）与发布者 P | GET list、GET unread-count；P 向 Z 派发一条公告后，U 再 GET list | 前两者 200 且 `items=[]`、`unread=0`；后者每项含 id/category/title/body/createdAt/readAt/link，未读项 `readAt=null` | 否 |
| A03 | F2 | U 有 3 条通知（不同时刻） | 连续两次 GET list | `createdAt` 降序；两次顺序完全一致；无他人通知 | 否 |
| A04 | F3 | U 已登录 | GET list 依次带 limit=0、limit=-1、limit=101、limit=1.5、offset=-1，再带 limit=2、offset=9999 | 前五个 400 `invalid_request`；limit=2 时 `items` 长度 ≤2；offset 超界时 200 且 `items=[]` | 是 |
| A05 | F5 | U 有 2 条未读，V 另有 1 条未读 | mark-read `ids=[id1]` → unread-count；再 mark-read 同一 id → GET list；最后 mark-read `all=true` → unread-count | 首次 unread 减 1；重复标记 200 且 `readAt` 仍是首次时间；all 后 U 的 unread=0；V 的 unread 不变 | 否 |
| A06 | F6 | U、V 各有通知 | V 用 U 的通知 id 调 mark-read；再用随机 id 调 mark-read | 两次都 404；两次 `error.code` 与 `error.message` 完全一致 | 是 |
| A07 | P1,P2 | U 从未设过偏好 | GET preferences.get → PUT preferences.update（只含 announcement.email=true）→ 再 GET | 首次返回全部支持分类与默认值 inApp=true/email=false/digestFrequency=off；更新后 GET 回显同样值，digestFrequency 仍 off，别的分类未变 | 否 |
| A08 | P3 | U 已有 announcement.inApp=false | PUT 非法值（未知分类 / 频率 `dailyx` / inApp="yes"） | 400 `invalid_request`；再 GET，所有值与更新前完全一致 | 是 |
| A09 | P4,P7 | U 默认偏好 | PUT announcement.inApp=false 与 system.inApp=false → 发布者向 U 派发公告 → U GET list 与 unread-count | announcement 通知不出现且 unread 不变；GET 偏好回显 system.inApp 仍为 true | 是 |
| A10 | P6 | U、V | U 关掉 announcement.inApp；V GET 偏好与列表 | V 的偏好仍是默认；V 仍能收到公告 | 否 |
| A11 | D1 | U 的 digestFrequency=off | 推进时钟 48h → GET list | 无 `category=digest` 的项 | 否 |
| A12 | D2,D3,D4 | U 有 2 条未读公告，digestFrequency=daily | 推进 48h → GET list → 再推进 1h → GET list | 恰好一条 digest 项且 `count=2`；第二次仍只有一条；被摘要的两条公告 `readAt` 仍为 null | 否 |
| A13 | D5 | U 无未读通知，digestFrequency=daily | 推进 48h → GET list | 无 digest 项 | 否 |
| A14 | T1,T2 | U 有 1 条未读公告 | POST view-token 两次 → 各 GET `view?token=` | 两次 token 不同、长度 ≥32；两次 view 均 200，body 只含 `unread` 与 `categories`，不含公告标题/正文 | 否 |
| A15 | T3 | U 领取 token1、token2；随机串 tokenX | GET view 用 token1（成功）→ 再用 token1 → 用 tokenX；推进时钟超过 token2 的 `expiresAt` 后用它 | 三次失败响应状态、`error.code`、`error.message` 完全一致，均 401 | 是 |
| A16 | T4 | U 领取 token | 并发两个 GET `view?token=` | 恰好一个 200，另一个 401（`unauthenticated`） | 是 |
| A17 | T5 | U 领取 token（明文 P） | 只读查库：列出所有表与文本列 | 存在等于 `sha256(P)` 小写十六进制（64 字符）的值；明文 P 不出现在任何名字不含 `outbox` 的表 | 是 |
| A18 | T6,T7 | U 领取 token | GET `view?token=` 读响应头；再用同一 token 调 mark-read | 响应头含 `Cache-Control: no-store` 与 `Referrer-Policy: no-referrer`；mark-read 返回 401 | 是 |
| A19 | AN1 | 工作区 Z 的成员 U；非成员 Y | Y POST announce(Z)；未登录 POST announce(Z) | Y 得 403 `forbidden`；未登录得 401 | 是 |
| A20 | AN2,AN3 | Z 含成员 U；V 不在 Z | 成员 P 在 Z POST announce（带正文与站内链接） | 响应含 announcementId/category=announcement/recipients/created；U 列表出现该通知且 unread +1；V 列表与 unread 不变 | 否 |
| A21 | AN4 | 同 A20 | 用**相同** idempotencyKey 再 POST 一次 | 第二次 200，announcementId 与首次相同、`created=false`；U 的通知条数与 unread 不变 | 是 |
| A22 | AN5 | 同 A20 | 并发两个**相同** idempotencyKey 的 POST | U 恰有 1 条新增通知；两次响应 announcementId 相同 | 是 |
| A23 | AN6 | 同 A20 | 依次 POST：link 为 `//evil.com`、`https://x/y`、`javascript:alert(1)`、`data:text/html,x`、含 `\n` 的路径；再 POST title 201 字符、body 2001 字符 | 每次 400 `invalid_request`；每次之后 U 的列表与 unread 完全不变（无残留通知） | 是 |
| A24 | L1,L2 | 限额 N 读自 params，未声明则 10 次/60s | 先 `DELETE /api/__test__/rate-limits`；连续派发 N 次（XFF `1.1.1.1, 5.5.5.5`），第 N+1 次改 XFF 为 `2.2.2.2, 5.5.5.5` | 前 N 次成功；第 N+1 次 429 + `error.code=rate_limited` + `Retry-After` 头；改最左跳仍在同一桶（同样被限流） | 是 |
| A25 | AN7,P5 | 宿主 `params.notifications.channels` 含 `email`；U 偏好 announcement.email=false | 派发公告 → 读 `GET /api/__test__/outbox?to=U邮箱`；再把 U 的 announcement.email 置 true 并换 idempotencyKey 重新派发 | 第一次 outbox 无该模板消息；第二次有 `template=notifications.announcement` 且 `data.link` 非空 | 是 |
| A26 | S1 | 宿主 `params.csrf.mode` 不为 `off` | 写请求带 `Origin: $APP_BASE_URL` → 成功；再不带 Origin（以及带 `Origin: https://evil.example`）做同样写操作 | 前者 200；后者 403 `forbidden` 且状态未变（列表/偏好与操作前一致） | 是 |
| A27 | S2,S3 | 宿主声明 `notifications.retentionDays`；auth 映射了删除账号接口 | 派发通知后推进时钟超过保留期 → GET list 与 unread-count；再删除账号 → 只读查库 | 老通知不再出现在列表且不计入 unread；库中该用户的通知与偏好行已消失 | 否 |
| A28 | D2,AN7 | U 有 2 条未读公告，digestFrequency=weekly；宿主提供邮件通道 | 推进 8 天 → GET list；读 outbox | 恰好一条 digest 项且 `count=2`；outbox 有 `template=notifications.digest` 且 `data.link` 非空 | 否 |

## 3. 说明

- **条件性用例**：A25/A28 需要邮件通道（`params.notifications.channels` 含 `email`）；A26 需要 `params.csrf.mode` 不为 `off`；A27 需要宿主声明了保留期与 auth 删除接口。条件不满足时记为"宿主未声明"，跳过且不判失败。
- **并发用例**：A16、A22 必须真正并发（两个请求同时在飞），串行执行不算通过。
- **只读数据库检查**：仅 A17、A27 使用，查的是"哈希存储"与"个人数据是否清除"两项，不得写入。
- **阈值来源**：A12/A28 的推进量固定取契约界限（daily 48 小时、weekly 8 天），足以跨过 `digest.timezone` / `digest.weekStart` 声明的任何日/周边界；A15 的过期判定按 `notifications.viewTokenTtlSeconds` 声明值取（未声明按 3600 秒，脚本推进 25h 必定过期）。
- **幂等键**：由脚本生成唯一串（如 `idem-<uuid>`），A21/A22 必须复用同一个键，A25 换新键。
- **长时推进**：A12/A13/A27 会把时钟推进 48 小时至数天，若会话因此失效，先重新登录再读列表。
