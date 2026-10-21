# web-security — 决策点

每条给一个**推荐默认**。改变默认时把实际值写进 `module-map.json` 的 `params`（契约 §2），否则验收按推荐默认判定，判为不通过。

| # | 决策点 | 推荐默认 | 选别的会怎样 |
|---|---|---|---|
| D1 | CSP 严格程度 | `script-src` 只留 nonce/hash，去掉 `unsafe-inline`、`unsafe-eval` | 留 `unsafe-inline` 一次注入即逃逸 CSP；必须留则声明 `cspAllowUnsafeInline=true`，否则 W-H1 失败 |
| D2 | `unsafe-eval` | 不用；要用则声明 `cspAllowUnsafeEval=true` | 保留等于把 CSP 降级成摆设，扫描工具直接标记 |
| D3 | CSRF 机制 | 双提交 cookie + 会话绑定的 token，头 `x-csrf-token` | 不绑会话：攻击者可自申请 token 绕过；纯一次性 token 让多标签页频繁失败 |
| D4 | CSRF cookie 名 | 生产 `__Host-csrf`，本地 HTTP 验收 `csrf_token` | `__Host-` 要求 `Secure`+`Path=/`+无 `Domain`，HTTP 验收里客户端不发它，验收必失败；此时声明 `csrfCookieName` |
| D5 | cookie 的 `SameSite` | `Lax`（严格场景可 `Strict`） | `None` 必须配 `Secure` 且放弃第一层跨站防护，在本地 HTTP 验收里也发不出去 |
| D6 | 来源不匹配的 CORS 行为 | **拒绝**：403 `origin_not_allowed` 且不带 ACAO | 只省略 ACAO：状态码随客户端漂移，非浏览器客户端可能读到数据 |
| D7 | 不带 `Origin` 的请求 | 不做来源判定（服务端到服务端不该被误伤） | 一律拒绝会让 webhook、CLI、移动 SDK 全挂；一律放行则失去来源判定 |
| D8 | 判定顺序 | 来源 → CSRF → challenge → bot 特征 → 认证授权 → 业务校验 | 顺序不定会出现“同一情况两个状态码”，验收与排障失去确定性 |
| D9 | CORS 允许来源 | 来自配置，精确匹配，不含 `*` | 硬编码或用 `*` 让任意外站读走数据；`*` 与凭据同现时浏览器直接拒绝 |
| D10 | `Vary: Origin` | 必带 | 缺失时 CDN/共享缓存把 A 域 CORS 头返给 B 域 |
| D11 | 预检 `Access-Control-Max-Age` | 600 秒（上限 86400） | 设得过大让撤销某个来源一天才生效 |
| D12 | 客户端 IP 信任模型 | 声明可信代理网段，取 XFF 右侧第一个非可信 hop | 无条件信任 XFF：任何人可换 IP 绕过限流/白名单；取最左侧是常见实现错误 |
| D13 | bot 判定信号 | 一次性 challenge 为主，UA 特征为辅（黑名单 + 爬虫豁免） | 只靠 UA 可伪造等于没有；只靠 challenge 则浏览器接入成本高 |
| D14 | challenge 的 TTL 与 IP 绑定 | TTL ≤ 300 秒（默认 60），绑定有效客户端 IP | TTL 过长：一次泄露可长期复用；不绑 IP：challenge 可被转发使用 |
| D15 | 未知字段 | 拒绝（422 `unknown_field`） | 宽松忽略：可注入 `role`/`isAdmin` 做批量赋值；需宽松时声明 `params.strictUnknownFields=false` |
| D16 | 请求体上限 | 64 KB（上限 1 MB），读进内存之前截断 | 不限：一次大 body 打满内存；过大等于没限 |
| D17 | 字段级错误粒度 | 稳定 snake_case 码（`required`/`invalid_email`/`too_long`）+ 点分 `path` | 只回“参数错误”客户端无法定向修；回显输入值是反射型 XSS 与枚举 |
| D18 | 错误信息详细度 | 对外只有稳定 code + 短 message，细节进内部日志（带 request id） | 对外带堆栈/SQL：泄露表结构与路径，还给攻击者一个调试器 |
| D19 | 是否由本模块发安全告警邮件 | 不发，交给 `notifications`；确要发则模板名 `web-security.<name>`、链接放 `data.link`、明文令牌只在名字含 `outbox` 的表 | 自己发信与 `notifications` 的偏好/退订逻辑打架 |
| D20 | 密钥轮换 | 新旧双密钥并行验证，旧 token 自然过期后再撤；密码哈希下次登录时升级 | 轮换即失效旧 token（用户被登出）；用新密钥重算已存摘要不可行 |
| D21 | 参数放哪 | 数值与开关放 `params`，生产值放环境变量/配置中心 | 两处各写会漂移；只写常量则验收不知道你实际用了多少 |
