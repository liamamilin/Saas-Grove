# web-security — 验收计划（黑盒）

本计划只依赖 HTTP 客户端 + HOST.md 的钩子；**可执行脚本下一步生成**。表中概念名省略 `web-security.` 前缀。

## 0. 执行前置与工具

| 项 | 约定 |
|---|---|
| 启动 | 按 HOST.md §1：`npm install && npm run build && npm start`，`GET /api/health` 返回 200 即就绪；`TEST_MODE=1`。 |
| 概念与参数 | 读 `module-map.json`（概念映射 + `params`）。未声明的概念记为“宿主未声明”，跳过其子断言，不算失败也不算通过。 |
| 数值阈值 | 从 `params` 读：请求体上限 `maxRequestBodyBytes`（未声明 65536）、challenge TTL `botChallengeTtlSeconds`（未声明 60）、`corsMaxAgeSeconds`（未声明 600）、`botUserAgentPatterns`、`trustedProxyCidrs`（默认见契约 §2）。**脚本不写死数字。** |
| 会话与 token | 每条用例一个全新 cookie jar，不共享 token。CSRF token 取自 `GET csrf_token` 的 `token`（配该次种下的 cookie），challenge 取自 `GET bot_challenge` 的 `token`；头名固定 `x-csrf-token`、`x-bot-challenge`。 |
| 账号夹具 | 若声明 `auth.signup`，用唯一邮箱注册一次取会话 cookie，否则只用匿名会话（仅 E-01 用它比较会话状态）。 |
| Origin 头 | 需要来源判定的请求都显式带 `Origin`：允许 = `APP_BASE_URL`（须与 `params.corsAllowedOrigins` 某项完全相等）；拒绝 = `https://evil.example`。 |
| 时钟 / 并发 | 时钟 `POST /api/__test__/clock {"advanceSeconds": N}`，N = 声明 TTL + 1；B-06 用同一时刻并发的多个请求（同一 jar、同一 token）。 |
| 观察 | 只看状态码、响应头、响应体；`csrf_protected_state` 的 `seq` 是唯一可观察状态。不读源码、不写库、不用限流钩子（属 `rate-limiting`），本模块不发邮件。 |

## 1. 用例表

| id | given | action | expected | negative |
|---|---|---|---|---|
| H-01 | 声明了 `headers_probe` | GET `headers_probe`，不带 cookie | 200；含 `X-Content-Type-Options: nosniff`；`Referrer-Policy` 取值合法（见 W-H1）；含 `Content-Security-Policy`，其 `script-src` 不含 `unsafe-eval`、裸 `*`、`unsafe-inline`（params 放宽则跳过）；CSP 含 `frame-ancestors`；`X-Frame-Options` ∈ {DENY, SAMEORIGIN} | 否 |
| H-02 | 声明了 `headers_probe`、`validation_probe`、`csrf_protected`；`not_found` 若已声明 | (a) GET `not_found`；(b) POST `validation_probe` 非法 JSON；(c) 用 GET 打 `csrf_protected`（method 不符） | (a) 404 且 `error.code=not_found`；(b) 400 且 `error.code=invalid_json`；(c) 405 且 `error.code=method_not_allowed`；三个响应的头都含 H-01 的四项头 | 是 |
| C-01 | 声明了 `csrf_token`；全新 jar | GET `csrf_token` | 200；body 有 `token`（长度 ≥ 16）；`Set-Cookie` 含 `params.csrfCookieName`（默认 `csrf_token`），该 cookie 含 `HttpOnly`，`SameSite` 存在且不为 `None` | 否 |
| C-02 | 同一 jar 已取到 token；先记下 `csrf_protected_state` 的 `seq` | POST `csrf_protected`：带 cookie、不带 CSRF 头、不带 `Origin` | 403，`error.code=csrf_failed`；随后 GET `csrf_protected_state` 的 `seq` 与之前相同（无副作用） | 是 |
| C-03 | jar A 与 jar B 各自取到 token | (a) POST `csrf_protected`，带 jar A 的 cookie 与错误的 `x-csrf-token`；(b) POST 只带 `x-csrf-token`（jar B 的 token），不带 cookie | 两次都 403，`error.code=csrf_failed` | 是 |
| C-04 | jar A、jar B 各自取到 token | POST `csrf_protected`，带 jar A 的 cookie + jar B 的 token | 403，`error.code=csrf_failed` | 是 |
| C-05 | 同一 jar 取到 token；记下当前 `seq` | POST `csrf_protected`，带 cookie、`x-csrf-token: <token>`、`Origin: <APP_BASE_URL>` | 200；body `{"applied":true,"seq":n+1}`；GET `csrf_protected_state` 的 `seq` = n+1；响应 `Cache-Control` 含 `no-store` | 否 |
| C-06 | 同一 jar 取到 token | POST `csrf_protected`，带 cookie、正确的 `x-csrf-token`、`Origin: https://evil.example` | 403，`error.code=origin_not_allowed`；响应无 `Access-Control-Allow-Origin` 头 | 是 |
| O-01 | `params.corsAllowedOrigins` 含 `APP_BASE_URL` | GET `cors_probe`，带 `Origin: <APP_BASE_URL>` | 200；`Access-Control-Allow-Origin` 恰等于该来源且不为 `*`；`Vary` 含 `Origin`；含 `Access-Control-Allow-Credentials: true` 时 ACAO 也不为 `*` | 否 |
| O-02 | 同上 | GET `cors_probe`，带 `Origin: https://evil.example` | 403，`error.code=origin_not_allowed`；响应无 `Access-Control-Allow-Origin` | 是 |
| O-03 | 同上 | OPTIONS `cors_preflight`，带 `Origin: <APP_BASE_URL>`、`Access-Control-Request-Method: POST`、`Access-Control-Request-Headers: content-type, x-csrf-token`；**不带 cookie、不带 CSRF 头** | 204；含 `Access-Control-Allow-Methods`（含 `POST`）、`Access-Control-Allow-Headers`（含 `content-type`、`x-csrf-token`）、`Access-Control-Max-Age`（≤ 86400，未声明按 600） | 否 |
| O-04 | 同上 | OPTIONS `cors_preflight`，带 `Origin: https://evil.example` 与同样的 `Access-Control-Request-Method`/`Access-Control-Request-Headers` | 403，`error.code=origin_not_allowed` | 是 |
| B-01 | 声明了 `bot_challenge`；全新 jar | GET `bot_challenge` 两次；再用 `DATABASE_URL` 做**只读**查询（HOST.md §4），检查两个 token 是否以明文出现在任何文本列 | 两次都 200，`token` 长度 ≥ 16 且两次不同；只读查询不得命中明文（宿主声明 `params.allowPlaintextTokenStorage=true` 则跳过） | 否 |
| B-02 | 全新 jar | POST `bot_protected`，不带 challenge 头 | 403，`error.code=bot_challenge_missing` | 是 |
| B-03 | 全新 jar | POST `bot_protected`，带 `x-bot-challenge: <32 位随机串>` | 403，`error.code=bot_challenge_invalid` | 是 |
| B-04 | 刚取到一个未使用的 token | POST `bot_protected`，带 `x-bot-challenge: <token>` | 200（非错误响应即可） | 否 |
| B-05 | 刚取到的 token 已成功用过一次（B-04） | 用同一 token 再 POST 两次 | 两次都 403，`error.code=bot_challenge_reused`（token 永久消费，不随时间恢复） | 是 |
| B-06 | 刚取到一个未使用的 token | 同一时刻并发发起 5 个 POST `bot_protected`，请求头带同一个 token | 恰好 1 个 200，其余 4 个 403 `bot_challenge_reused` | 是 |
| B-07 | 刚取到一个未使用的 token；`params.botChallengeTtlSeconds`（未声明按 60） | `POST /api/__test__/clock {"advanceSeconds": ttl+1}`，然后 POST `bot_protected` 带该 token | 403，`error.code=bot_challenge_expired` | 是 |
| B-08 | 刚取到 token，签发时带 `X-Forwarded-For: 203.0.113.9` | POST `bot_protected`，带 `X-Forwarded-For: 203.0.113.10` 与该 token | 403，`error.code=bot_challenge_invalid` | 是 |
| B-09 | 按 W-B9 计算有效 IP（宿主声明 `trustedProxyCidrs` 时把右侧 hop 取为非可信地址） | GET `bot_challenge`，带 `X-Forwarded-For: 198.51.100.7, 203.0.113.9`；再 POST `bot_protected`，带 `X-Forwarded-For: 203.0.113.9` 与该 token | 200（两侧都取“右侧第一个非可信 hop”；若实现取最左侧，这里会 403） | 否 |
| B-10 | 刚取到一个未使用的 token | POST `bot_protected`，带该 token 与 `User-Agent: Googlebot/2.1 (+http://www.google.com/bot.html)` | 403，`error.code=bot_detected` | 是 |
| B-11 | 刚取到一个未使用的 token | POST `bot_protected?challenge=<token>`，请求头不带 challenge | 403，`error.code=bot_challenge_missing`（query 里的值不算提供） | 是 |
| V-01 | 声明了 `validation_probe` | POST，Content-Type `application/json`，body 为 `{` | 400，`error.code=invalid_json` | 是 |
| V-02 | 同上 | POST，Content-Type `text/plain`，body 为一段合法 JSON 文本 | 415，`error.code=unsupported_media_type` | 是 |
| V-03 | 同上；schema 见契约 §1 | POST 三次：① `{"name":"","email":"not-an-email","count":0,"mode":"pro"}`；② `{"name":"<70 字符>","email":"a@b.co","count":1,"mode":"basic"}`；③ `{"name":"ab","email":"a@b.co","count":1,"mode":"basic","note":"<1500 字符，内含 CANARY-<随机>>"}` | 三次都 422 `validation_failed`；`error.fields` 非空且每项含 `path` 与 `code`；② 的 `path` 指向 `name`，③ 指向 `note`；响应体都不出现请求里的任何输入值（含 CANARY 串） | 是 |
| V-04 | 同上 | POST `{"name":"ab","email":"a@b.co","count":1,"mode":"basic","isAdmin":true}` | 422 `validation_failed`；`error.fields` 中存在 `path=isAdmin`、`code=unknown_field`（宿主声明 `params.strictUnknownFields=false` 则跳过） | 是 |
| V-05 | `params.maxRequestBodyBytes`（未声明按 65536） | POST，body 为 `{"name":"ab","email":"a@b.co","count":1,"mode":"basic","blob":"<上限+512 字节的填充>"}` | 413，`error.code=payload_too_large` | 是 |
| V-06 | 同上 | POST `{"name":"ab","email":"a@b.co","count":1,"mode":"basic"}` | 200，`{"ok":true}` | 否 |
| E-01 | 声明了 `csrf_protected`、`validation_probe`；可选 `not_found`、`auth.signup` | (a) POST `csrf_protected` 缺 CSRF 头；(b) POST `validation_probe` 非法 JSON；(c) GET `not_found`（若已声明）；(a) 之后再用已登录会话重复一次 | 每个错误响应：顶层只有 `error`；`error` 只有 `code`/`message`（`validation_failed` 另有 `fields`）；`code` 属于契约 §3.2；`message` ≤ 200 字符且不含 `node_modules`、不含 ` at ` 堆栈帧；响应体不含 canary 值；(a) 匿名会话与已登录会话两次响应的 `error.code` 与 `error.message` 相同（`auth.signup` 未声明则跳过，记为宿主未声明） | 是 |

## 2. 覆盖与统计

- 用例 30 条：正向 9（H-01、C-01、C-05、O-01、O-03、B-01、B-04、B-09、V-06），负向 21；覆盖：安全头 2、CSRF 6、CORS 4、bot 11、输入校验 6、错误形态 1。
- 硬性负向已覆盖：跨会话 token（C-04）、token 与 cookie 不配对（C-03）、非法 Origin（C-06、O-02、O-04）、并发/顺序重放（B-05、B-06）、过期令牌（B-07）、IP 绑定（B-08）、XFF 伪造（B-09）、query 传令牌（B-11）、体积上限（V-05）、未知字段（V-04）、输入反射（V-03、E-01）。
- 契约 §6 的建议不可黑盒观测。
