# web-security — 契约（黑盒）

本契约只描述**从外部可观察**的行为。宿主用 `module-map.json` 把“概念”映射到真实路径（HOST.md §2）；数值以**界限**给出，宿主在 `params` 里声明实际值（HOST.md §2b）。每条 MUST 至少有一条验收用例，末尾附追溯表。

## 0. 阅读方式

- 未在 `module-map.json` 中出现的概念记为“宿主未声明”，不算失败也不算通过。
- `params` 未声明的项按 §2 的**默认值**验收。
- 状态码与 `error.code` 以 §3 为唯一真相，三个文件不得有第二套说法。

## 1. 概念清单

| 概念（module-map.json 的键） | method | 用途 | 必需 |
|---|---|---|---|
| `web-security.headers_probe` | GET | 免登录页面，读响应头 | 是 |
| `web-security.csrf_token` | GET | 签发 CSRF token 与 cookie | 是 |
| `web-security.csrf_protected` | POST | 受 CSRF 保护的状态变更端点 | 是 |
| `web-security.csrf_protected_state` | GET | 同资源只读视图，返回 `seq` | 是 |
| `web-security.cors_probe` | GET | CORS 敏感端点（实际请求） | 是 |
| `web-security.cors_preflight` | OPTIONS | 预检目标，可与上条同路径 | 是 |
| `web-security.bot_challenge` | GET | 签发一次性 challenge | 是 |
| `web-security.bot_protected` | POST | 需要有效 challenge 的端点 | 是 |
| `web-security.validation_probe` | POST | 校验 JSON 请求体 | 是 |
| `web-security.not_found` | GET | 必须返回 404 的路径 | 否（未声明则跳过该子断言） |

固定响应：`web-security.csrf_protected` 成功 → `200 {"applied":true,"seq":<int>}`；`web-security.csrf_protected_state` → `200 {"seq":<int>}`，`seq` 只在成功请求后 +1。`web-security.csrf_token` 与 `web-security.bot_challenge` → `200 {"token":"<长度 ≥ 16 的随机串>"}`（challenge 可另带 `expiresAt`）；宿主若只支持已登录会话签发 CSRF token，必须额外映射 `auth.signup`，否则必须支持匿名会话。`web-security.validation_probe` 合法输入 → `200 {"ok":true}`。

**令牌传递位置固定**：CSRF token 用头 `x-csrf-token`，challenge 用头 `x-bot-challenge`；两者都**不得**从 query string 读取（W-B11）。请求的 method 与上表声明不符 → `405 method_not_allowed`。

`web-security.validation_probe` 的 schema（宿主必须实现，验收按它造样本）：

| 字段 | 规则 |
|---|---|
| `name` | 字符串，1–64 字符 |
| `email` | 合法邮箱，≤ 254 字符 |
| `count` | 整数，1–1000 |
| `mode` | 枚举 `basic` / `pro` |
| `note` | 可选字符串，≤ 1024 字符 |
| `blob` | 可选字符串，长度不限（由 `maxRequestBodyBytes` 约束） |

## 2. 参数（宿主声明实际值；契约给界限）

- `maxRequestBodyBytes` ≤ 1048576，默认 65536：请求体上限，超过即 413
- `botChallengeTtlSeconds` ≤ 300，默认 60：challenge 有效期
- `corsMaxAgeSeconds` ≤ 86400，默认 600：预检 `Access-Control-Max-Age`
- `corsAllowedOrigins` 精确来源列表，默认 `[APP_BASE_URL]`（取自 HOST.md）：允许的来源
- `trustedProxyCidrs` CIDR 列表，默认 `[]`：可信代理网段；不在其中的 XFF 条目视为客户端候选
- `botUserAgentPatterns` 子串列表，默认 `["googlebot","bingbot","yandexbot","curl/","python-requests","go-http-client","headlesschrome"]`：命中即视为自动化客户端（大小写不敏感）
- `botAllowedUserAgents` 子串列表，默认 `[]`：豁免名单（知名爬虫）
- `csrfCookieName` 名称，默认 `csrf_token`：CSRF cookie 名（生产建议 `__Host-csrf`，需 HTTPS）
- `strictUnknownFields` 布尔，默认 `true`：为 `false` 时 W-V4 不适用
- `allowPlaintextTokenStorage` 布尔，默认 `false`：为 `true` 时 W-T1 不适用
- `cspAllowUnsafeEval` / `cspAllowWildcardScriptSrc` / `cspAllowUnsafeInline` 布尔，默认 `false`：为 `true` 时 W-H1 对应子断言跳过

## 3. 状态码与错误形态（唯一真相）

### 3.1 错误响应形状

任何 `status ≥ 400` 的响应体必须是 `{"error":{"code":"<snake_case>","message":"<≤200 字符>"}}`：顶层**只有** `error`；`error` 内只允许 `code`、`message`，以及仅在 `validation_failed` 时出现的 `fields`（数组，每项只有 `path` 与 `code`）；`message` 不得含堆栈、文件路径、SQL、驱动错误、环境变量值、密钥、请求里的任何输入值。成功响应不受此约束。

### 3.2 情况 → 状态码 → `error.code`

- `400 invalid_json`：请求体不是合法 JSON
- `403 origin_not_allowed`：带 `Origin` 且不在允许列表（实际请求或预检）
- `403 csrf_failed`：状态变更缺 token / token 错 / 与 cookie 不配对 / 属于别的会话
- `403 bot_challenge_missing`：缺 bot challenge 头
- `403 bot_challenge_invalid`：challenge 未知、畸形、与本次请求的有效客户端 IP 不匹配
- `403 bot_challenge_expired`：challenge 已过期
- `403 bot_challenge_reused`：challenge 已被使用过（重放或并发竞争失败）
- `403 bot_detected`：UA 命中黑名单且不在豁免名单
- `404 not_found`：路径不存在
- `405 method_not_allowed`：方法不允许
- `413 payload_too_large`：请求体超过 `maxRequestBodyBytes`
- `415 unsupported_media_type`：`Content-Type` 不是 `application/json`
- `422 validation_failed`：JSON 合法但字段校验不通过

同一个情况在所有文件里只能有这一个状态码与这一个 code。

### 3.3 判定顺序（命中多条以先命中者为准）

`媒体类型/体积 → Origin → CSRF token → bot challenge → bot 特征 → 认证 → 授权 → 业务校验`

- **媒体类型先于体积，体积先于字段校验**：Content-Type 不对 → 415；体积超限 → 413；两者都通过才校验字段。
- **Origin 先于 CSRF**：带非法 `Origin` 的状态变更请求一律 `403 origin_not_allowed`。
- **CSRF 先于 bot challenge**；**challenge 过期判定先于会话有效性**（会话已过期时，过期 challenge 仍返回 `403 bot_challenge_expired`）。
- 不带 `Origin` 头的请求**不**做来源判定（服务端到服务端调用不得被误伤）。

### 3.4 Origin 头的来源（验收脚本怎么提供）

- 允许来源：取 `APP_BASE_URL`（HOST.md §1），必须与 `params.corsAllowedOrigins` 中某项**完全相等**。
- 拒绝来源：固定 `https://evil.example`。
- 预检额外带 `Access-Control-Request-Method: POST` 与 `Access-Control-Request-Headers: content-type, x-csrf-token`。

## 4. MUST 规则

每行一条 MUST：左列为规则号与名字，右列为必须满足的可观察行为。分组：H=安全响应头，C=CSRF，O=CORS，B=bot 保护，V=输入校验，T=令牌存储，S=错误形态。

| 规则 | 必须满足 |
|---|---|
| W-H1 安全头基线 | `web-security.headers_probe` 的 200 响应含 `X-Content-Type-Options: nosniff`；`Referrer-Policy` ∈ {no-referrer, strict-origin-when-cross-origin, same-origin, no-referrer-when-downgrade}；`Content-Security-Policy` 的 `script-src` 不含 `unsafe-eval`、裸 `*`、`unsafe-inline`（params 放宽则跳过对应子断言）；CSP 含 `frame-ancestors`；`X-Frame-Options` ∈ {DENY, SAMEORIGIN} |
| W-H2 错误响应带同样头 | 任何 `status ≥ 400`（含 404、422、500）必须带 W-H1 的上述四项头 |
| W-H3 会话响应不可缓存 | 带会话 cookie 或个人数据的响应，`Cache-Control` 含 `no-store` |
| W-H4 CSRF cookie 属性 | CSRF cookie 的 `Set-Cookie` 含 `HttpOnly`，`SameSite` 存在且不为 `None` |
| W-C1 缺 token 即拒 | POST `web-security.csrf_protected` 缺 CSRF token 头 → `403 csrf_failed`，且不得调用业务逻辑 |
| W-C2 token 与 cookie 配对 | 有 token 但 cookie 缺失/不一致/格式非法 → `403 csrf_failed` |
| W-C3 token 绑定会话 | 会话 A 的 token 配会话 B 的 cookie → `403 csrf_failed` |
| W-C4 有效 token 通过 | 同会话合法 cookie + token → `200 {"applied":true,"seq":<n>}`，且 `web-security.csrf_protected_state` 的 `seq` +1 |
| W-C5 被拒请求零副作用 | 被 W-C1/W-C2/W-C3/W-C6 拒绝后，`seq` 与请求前相同 |
| W-C6 非法 Origin 一律拒 | `Origin` 不在 `params.corsAllowedOrigins` → `403 origin_not_allowed`；响应体不含 `Access-Control-Allow-Origin` |
| W-C7 合法 Origin 不额外拦 | 合法 `Origin` + 有效 token → `200` |
| W-O1 允许来源的响应 | 合法 `Origin` 的 `web-security.cors_probe` → 200，含 `Access-Control-Allow-Origin: <与请求完全相同>`、`Vary` 含 `Origin`；ACAO 不得为 `*`；含 `Access-Control-Allow-Credentials: true` 时 ACAO 也不得为 `*` |
| W-O2 非法来源被拒 | `Origin: https://evil.example` → `403 origin_not_allowed`，响应不含 ACAO |
| W-O3 预检成功 | 预检（OPTIONS，合法 `Origin` + `Access-Control-Request-Method: POST`）→ `204`，含 `Access-Control-Allow-Methods`（含 `POST`）、`Access-Control-Allow-Headers`（含 `content-type`、`x-csrf-token`）、`Access-Control-Max-Age`（≤ 86400） |
| W-O4 预检不校验会话 | 预检不带 cookie 与 CSRF token 时结果与 W-O3 相同（仍 `204`） |
| W-O5 预检也拒非法来源 | 预检带 `https://evil.example` → `403 origin_not_allowed` |
| W-B1 challenge 可取 | `web-security.bot_challenge` → `200`，token 长度 ≥ 16、随机、每次不同 |
| W-B2 缺 challenge 即拒 | POST `web-security.bot_protected` 不带 challenge 头 → `403 bot_challenge_missing` |
| W-B3 无效 challenge 即拒 | token 未知、被篡改、与本次请求的有效客户端 IP 不匹配 → `403 bot_challenge_invalid` |
| W-B4 有效 challenge 通过 | 刚签发、未过期、未用过、IP 匹配 → `200` |
| W-B5 单次消费 | 用过的 challenge 再次使用 → `403 bot_challenge_reused`，此后仍不可用 |
| W-B6 并发下单次消费 | 同一 challenge 并发提交，最多一次 `200`，其余 `403 bot_challenge_reused` |
| W-B7 challenge 过期 | 超过 `params.botChallengeTtlSeconds` → `403 bot_challenge_expired` |
| W-B8 绑定有效客户端 IP | 用签发时 IP 之外的 IP 提交 → `403 bot_challenge_invalid` |
| W-B9 有效 IP 取法 | 有效 IP = `X-Forwarded-For` 中**从右往左第一个不属于 `params.trustedProxyCidrs` 的条目**；无该头用连接对端地址；**不得取最左侧**；签发与使用两侧同一算法 |
| W-B10 自动化客户端被拒 | `User-Agent` 命中 `params.botUserAgentPatterns` 且不命中 `params.botAllowedUserAgents` → `403 bot_detected` |
| W-B11 不得经 URL 传 | 只在 query 里带 challenge 而无 challenge 头 → `403 bot_challenge_missing` |
| W-V1 非法 JSON | 请求体不是合法 JSON → `400 invalid_json` |
| W-V2 媒体类型 | `Content-Type` 不是 `application/json`（可带 charset）→ `415 unsupported_media_type` |
| W-V3 字段校验失败 | 缺必填、类型错、枚举非法、超长（`name` > 64、`email` > 254、`note` > 1024、`count` 越界）→ `422 validation_failed`，`error.fields` 至少一项且每项含 `path` 与 `code`；响应体不得出现请求提交的任何输入值 |
| W-V4 未知字段被拒 | 含 schema 外字段 → `422 validation_failed`，该字段 `code` 为 `unknown_field`（`params.strictUnknownFields=false` 时豁免） |
| W-V5 体积超限 | 请求体超过 `params.maxRequestBodyBytes` → `413 payload_too_large` |
| W-V6 合法输入 | 满足 §1 schema → `200 {"ok":true}` |
| W-T1 令牌只存摘要 | 存放 challenge/CSRF token 的存储不得出现明文，只存不可逆摘要（验收用只读数据库查询确认；`params.allowPlaintextTokenStorage=true` 可豁免）。明文只允许出现在名字含 `outbox` 的表（HOST.md §3） |
| W-S1 错误体统一 | 所有 `status ≥ 400` 满足 §3.1：只有 `error` 顶层键；`code` 稳定；`message` 不含堆栈、路径、SQL、环境变量值、密钥、请求输入值；请求里的敏感值（如随机 canary）不得出现在响应体 |
| W-S2 同一原因同一答案 | 同一失败原因在不同会话状态（匿名、已登录）与账号状态（不存在、未验证、已禁用、已存在）下，状态码与 `error.code` 必须完全相同，不得用不同 code/message 区分账号状态（防枚举）。账号状态深度矩阵属 `auth` |

## 5. 不变量

- 任何 `status ≥ 400` 的响应只有一个顶层键 `error`，`code` 恒定。
- 同一失败原因在不同会话与账号状态下 `code` 与 `message` 一致。
- 被拒请求不改变任何可观察状态（`seq` 等）；单次令牌至多成功一次（并发下亦然）。
- 安全头出现在所有响应上；令牌不出现在 URL、响应体与日志中。

## 6. 建议，验收不测（黑盒观察不到，不放进 MUST）

- HSTS：生产 HTTPS 响应应带 `Strict-Transport-Security`（`max-age ≥ 31536000`、含 `includeSubDomains`）；验收通常是 `http://localhost`，无法观测。
- `Secure` cookie 属性：生产应为会话/CSRF cookie 加 `Secure`；HTTP 环境下客户端不发送带 `Secure` 的 cookie，无法观测。
- 密钥轮换：换密钥时“新旧双密钥并行验证，旧 token 自然过期后再撤”，而不是用新密钥重算已存摘要（摘要不可逆，令牌存储属 `auth`）；启动期环境校验、常数时间比较、哈希强度、日志脱敏质量、CSP nonce 与 `report-to` 均不可观测。
- 出站 SSRF 防护与第三方签名校验属 `webhooks-outbound`、`payments-billing`；KMS/Vault 托管、静态数据加密、轮换运维也不在本模块。

## 7. 规则 → 用例追溯表

| 规则 | 用例 | 规则 | 用例 |
|---|---|---|---|
| W-H1 | H-01 | W-C6 | C-06、O-02、O-04 |
| W-H2 | H-02 | W-C7 | C-05 |
| W-H3 | C-05 | W-O1 | O-01 |
| W-H4 | C-01 | W-O2 | O-02 |
| W-C1 | C-02 | W-O3 | O-03 |
| W-C2 | C-03 | W-O4 | O-03 |
| W-C3 | C-04 | W-O5 | O-04 |
| W-C4 | C-05 | W-B1 | B-01 |
| W-C5 | C-02 | W-B2 | B-02 |
| W-B3 | B-03 | W-B8 | B-08 |
| W-B4 | B-04 | W-B9 | B-09 |
| W-B5 | B-05 | W-B10 | B-10 |
| W-B6 | B-06 | W-B11 | B-11 |
| W-B7 | B-07 | W-V1 | V-01 |
| W-V2 | V-02 | W-V3 | V-03 |
| W-V4 | V-04 | W-V5 | V-05 |
| W-V6 | V-06 | W-T1 | B-01 |
| W-S1 | E-01 | W-S2 | E-01 |

反向检查：acceptance-plan.md 的 30 条用例全部在上表中，且每条至少追溯到一条 MUST 规则。
