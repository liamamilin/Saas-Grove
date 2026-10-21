# web-security — 认知模板

## 必读：一页速览

**模块边界**：应用门口的一层守卫。对外只做四件事：进来时判断“谁、从哪来、能不能改”；数据判断“形状对不对”；出去时判断“带什么头、报什么错”；密钥不许被记录，也不许被回声。

**八条核心规则**（细则在 contract.md）：

1. **判定顺序固定**：来源(Origin) → 客户端身份(bot challenge) → 令牌(CSRF) → 认证/授权 → 业务校验。顺序不定就会出现“同一情况两个状态码”。
2. **所有响应带同一套安全头**（含 404/422/500）。只给成功路径加头是最常见的漏。
3. **CSRF token 必须与 cookie 配对、绑定会话**；Origin/Referer 检查不能替代 token。
4. **CORS 管“跨域读”，不是 CSRF 的替代**；`*` 与凭据互斥；允许来源必须带 `Vary: Origin`。
5. **一次性令牌必须真单次**：并发下也只允许一次成功，否则是竞态漏洞。
6. **客户端 IP 只取 X-Forwarded-For 右侧第一个非可信 hop**，绝不取最左侧。
7. **校验失败返回字段级错误码，且不回显用户输入**（防 XSS、防枚举、防泄密）。
8. **错误响应只有一个形状**：`{"error":{"code","message"}}`，不含堆栈、路径、密钥。

**状态码速查**（contract.md §3 为唯一真相）：
`400 invalid_json` / `403 csrf_failed` / `403 origin_not_allowed` / `403 bot_challenge_missing|invalid|expired|reused` / `403 bot_detected` / `404 not_found` / `413 payload_too_large` / `415 unsupported_media_type` / `422 validation_failed`

**三起典型事故**：

- 只给 200 响应加 CSP：诱导受害者请求一个返回 500 的地址，错误页没有 CSP → XSS 照样生效。
- CSRF 只看 Referer：跨站跳转可以不带 Referer → 直接绕过；只信 Origin 又会被同站子域绕过。
- 取 X-Forwarded-For 最左侧：攻击者自带 `X-Forwarded-For: 127.0.0.1` → 绕过限流、白名单、IP 绑定。

---

## 1. 这个模块是什么

`web-security` 是**应用边界的守卫层**，六件事：

| 能力 | 一句话 |
|---|---|
| 安全响应头 | 每个响应都带 CSP、nosniff、Referrer-Policy、防点击劫持等头 |
| CSRF | 带会话的状态变更必须携带与 cookie 配对、绑定会话的 token |
| CORS | 决定哪些来源可以读跨域响应 |
| bot 保护 | 用一次性 challenge 证明“这是真人客户端” |
| 输入校验 | 结构、类型、长度、范围、未知字段 |
| 密钥与错误形态 | 密钥不进代码库/前端包/日志/响应；错误只有一个统一形状 |

**心智模型**是“闸门 + 收据”：闸门在业务逻辑之前，不合规请求被拒且**没有副作用**；收据在响应离开之前，错误必须能被机器判断（稳定 code）。它**不是**认证、权限、限流系统或 WAF：它假设 `auth` 已签好会话 cookie、`workspaces-and-permissions` 已能判断授权，自己只判断“请求的形状与来源是否可信”。

---

## 2. 成熟版应该有什么（MVP→成熟，逐条）

**2.1 安全响应头**
- MVP：`nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`，加在**所有**响应上（含错误页）。
- 进阶：完整 CSP（`default-src 'self'`、`object-src 'none'`、`base-uri 'self'`、`frame-ancestors 'none'`）；`Permissions-Policy`；会话接口 `Cache-Control: no-store`。
- 成熟：`script-src` 用 per-request nonce，去掉 `unsafe-inline`/`unsafe-eval`；HSTS；成功与错误响应共用一套头生成逻辑。

**2.2 CSRF**
- MVP：状态变更端点要求自定义头（`x-csrf-token`），值与 cookie 一致，否则 403。
- 进阶：token 绑定会话；cookie 加 `HttpOnly`、`SameSite`；被拒请求零副作用。
- 成熟：token 短 TTL；配合 Origin 允许列表纵深防御；高危操作用一次性 token；轮换期新旧 token 并存。

**2.3 CORS**
- MVP：允许来源是**精确列表**而非通配符，不匹配就拒绝。
- 进阶：预检(OPTIONS)单独处理；带 `Vary: Origin`；凭据模式禁用 `*`。
- 成熟：允许列表来自配置；预检带 `Access-Control-Max-Age`（有上限）；跨域读与跨站改各归各的机制。

**2.4 bot 保护**
- MVP：高价值端点（注册、找回密码、发信）要求服务端签发的一次性 challenge 头（`x-bot-challenge`）。
- 进阶：challenge 短 TTL、绑定有效客户端 IP、单次消费；客户端 IP 取值可信。
- 成熟：challenge 与会话/指纹绑定；UA 特征作辅助信号；拒绝事件可被审计消费。

**2.5 输入校验**
- MVP：JSON 语法、Content-Type、必填、类型、长度上限，各有明确状态码。
- 进阶：请求体上限（在读之前限）；未知字段拒绝（防批量赋值）；字段级错误码。
- 成熟：校验规则单一入口、写端点共用；错误不回显输入；校验失败零副作用。

**2.6 密钥处理与错误形态**
- MVP：密钥只从环境/密钥管理读，不进代码库、前端 bundle、日志；错误统一形状。
- 进阶：错误里不出现堆栈、路径、SQL；带 request id；缺密钥时拒绝启动。
- 成熟：密钥可轮换（双密钥窗口，旧的过期后再撤）；密钥使用记入审计；日志脱敏。

---

## 3. 每项的正确行为

**3.1 安全响应头**：一个出口统一加头（含错误响应），逐个 handler 手工加头最容易漏；CSP 给 `default-src`、`object-src 'none'`、`base-uri 'self'`、`frame-ancestors`，`script-src` 不出现 `unsafe-eval` 与裸 `*`；`frame-ancestors` 与 `X-Frame-Options: DENY|SAMEORIGIN` 同时给；带会话的响应加 `Cache-Control: no-store`，否则代理缓存会把 A 用户页面发给 B 用户。

**3.2 CSRF**：签发 token → 写 cookie → 前端放进请求头 → 服务端比对头与 cookie，绑定同一会话；缺 token、token 错、cookie 缺失、token 属于别的会话 → 同一个 403 与同一个 code（不同 code 等于给攻击者一个调试器）；被拒请求**不得**进业务逻辑；Origin 检查是纵深防御、不是替代（同站子域也能带合法 Origin）。

**3.3 CORS**：带了 `Origin` 才判定来源；**不带 Origin 的请求（服务端到服务端、curl）不得因来源被拒**；允许则 ACAO 精确等于来源，不允许则 403 且响应里不能有该头；带凭据时 ACAO 不能是 `*`；`Vary: Origin` 必带（缺它会把 A 域的 CORS 头缓存给 B 域）；预检**不要求会话与 CSRF token**，成功 204，带 Allow-Methods、Allow-Headers（含 `content-type`、`x-csrf-token`）、Max-Age。

**3.4 bot 保护**：challenge = 短 TTL、绑定有效客户端 IP、单次消费的随机串；判定顺序：来源 → 存在 → 有效 → 过期 → 已用过 → 机器人特征；单次消费必须**原子**（并发下最多一次成功）；有效 IP = XFF **右往左**第一个不属于可信代理网段的条目，无该头就用连接对端地址；**永远不要取最左侧**。

**3.5 输入校验**：Content-Type（非 JSON → 415）→ 体大小（超限 → 413，读进内存之前限）→ 解析（失败 → 400）→ 字段校验（失败 → 422 + 字段级错误）；字段错误给 `path` 与稳定 `code`，**不回显输入值**；未知字段默认拒绝（否则能塞 `role`/`isAdmin` 做批量赋值）；校验失败零副作用。

**3.6 密钥与错误形态**：密钥只在服务端读；错误固定 `{"error":{"code","message"}}`，`fields` 只在校验失败时出现；`message` 短且稳定，不含堆栈/路径/SQL/环境变量值/用户输入；请求里的密钥字段不得被回声（回声即泄露，回声用户输入即反射型 XSS 与枚举）。

---

## 4. 容易做错的地方（具体到会出什么事故）

| 常见做法 | 触发条件 | 事故 | 正确做法 |
|---|---|---|---|
| 只给成功响应加安全头 | 请求一个返回 500/404 的 URL | 错误页无 CSP → XSS 生效；可嵌套 → 点击劫持 | 出口统一加头，含错误路径 |
| CSP 写 `unsafe-inline`/`unsafe-eval` | 页面要内联脚本 | CSP 形同虚设，一次注入即逃逸 | nonce/hash，至少去掉 `unsafe-eval` |
| ACAO 为 `*` 且带凭据 | 前后端不同域又要带 cookie | 浏览器拒绝；更糟的是有人改成放行 `Origin: null` | 精确来源列表 + 凭据 |
| 允许来源缺 `Vary: Origin` | 前面有 CDN/共享缓存 | 缓存把 A 域 ACAO 返回给 B 域 → B 域读到 A 域数据 | 随 Origin 变化的响应都带 `Vary: Origin` |
| CSRF token 不绑会话 | 攻击者自己申请 token | 任意来源都能带“合法”token | token 绑定会话/用户 |
| 一次性 token 校验与消费不原子 | 两个并发请求用同一 token | 两次都成功 → 重放/竞态 | 数据库层原子消费（唯一约束/条件更新） |
| 取 XFF 最左侧当客户端 IP | 攻击者自带 `X-Forwarded-For: 127.0.0.1`，或没有可信代理列表 | 绕过限流、白名单、challenge 的 IP 绑定 | 声明可信代理网段，取右侧第一个非可信 hop |
| 只校验类型，不管未知字段 | 请求多带 `role:"owner"` | 批量赋值 → 提权 | 未知字段拒绝（422） |
| 校验失败仍执行写入 | 校验在写之后 | 脏数据、无效扣费、脏邮件 | 校验前置，失败零副作用 |
| 错误信息回显用户输入 | 字段名/值拼进 message | 反射型 XSS；还能枚举账号 | 固定 code + 稳定短 message |
| 请求体不限，先读进内存 | 大 body 打过来 | 内存打满 → OOM | 读之前按上限截断并 413 |
| 预检也要求 CSRF token | 中间件没区分 OPTIONS | 浏览器跨域 POST 全失败 | 预检不校验会话与 token |
| 密钥进前端 bundle 或日志 | 想在浏览器里签请求 / 调试方便 | 密钥公开，日志出现密码、token | 密钥只在服务端；日志脱敏 |

---

## 5. 与其他模块的接口

| 模块 | 接口含义（本模块只用/只产出） |
|---|---|
| auth | 会话 cookie 的签发与校验。本模块只判断“是否存在已认证会话”，不签发会话令牌、不做密码哈希。 |
| workspaces-and-permissions | 授权判定：越权用 403，资源不存在用 404。本模块不做资源级权限计算。 |
| rate-limiting | IP/账号级计数与 429、Retry-After。本模块**不计数**；bot 拒绝先于限流判定。 |
| audit-and-data-export | 安全事件（csrf_failed、origin_not_allowed、bot_* 拒绝、密钥使用）交给它落审计；本模块只产出事件。 |
| observability | 拒绝原因计数、客户端 IP 取值来源等指标与日志字段；本模块不实现指标，不把 token/请求体写进日志。 |
| file-storage | 上传请求的类型/大小/内容嗅探校验规则由它定义；本模块只提供通用校验入口。 |
| prompt-injection-and-guardrails | 外部内容进 prompt 前的语义级净化；本模块只做形状与范围校验。 |
| ai-retrieval / ai-model-gateway | 上游返回内容里的链接与不可信数据处理；本模块只管 HTTP 边界。 |
| payments-billing | 支付回调签名验证属于它。 |
| notifications | 安全事件通知由它发送；若本模块发“验证/解锁”邮件，模板名 `web-security.<name>`，链接放 `data.link`，明文令牌只出现在名字含 `outbox` 的表。 |

---

## 6. 不做什么

- 不做登录、登出、会话签发、密码哈希与重置令牌——属于 `auth`。
- 不做角色、工作区成员、资源级权限——属于 `workspaces-and-permissions`。
- 不做限流、配额、预算——属于 `rate-limiting` 与 `usage-metering-and-budgets`。
- 不做业务规则校验（价格、库存、额度），只做形状与范围校验。
- 不做 KMS/密钥轮换执行、静态数据加密、常数时间比较（见 contract.md §6）。
- 不做 WAF、DDoS 防护、边缘限速、CDN 规则；不做人机验证界面、依赖漏洞扫描、SBOM、CI 安全流水线。
- 不做 CSP 报告平台接入；不做日志与指标实现——属于 `observability`。
- 不做支付回调签名与出站 webhook 签名——属于 `payments-billing` 与 `webhooks-outbound`。
- 不做 prompt 内容净化与模型输出过滤——属于 `prompt-injection-and-guardrails`。
