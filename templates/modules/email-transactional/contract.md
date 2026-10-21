# email-transactional 契约（黑盒）

读者：实现方与验收方。契约里的"概念名"由宿主在 `module-map.json` 映射到真实路径（HOST.md 第 2 节）；未映射的概念记"宿主未声明"。阈值由宿主在 `params` 声明（§3），未声明时按契约默认值验收。

## 1. 概念与鉴权

| 概念 | 方法 | 含义 | 鉴权 |
|---|---|---|---|
| `email.send` | POST | 提交一封待发邮件（入队） | 需登录 |
| `email.status` | GET | 查单封邮件状态 | 需登录，仅本人邮件 |
| `email.unsubscribe` | GET | 退订链接落地页（不消费令牌） | 凭令牌 |
| `email.unsubscribe.confirm` | POST | 一次性退订确认（provider 一键退订同此接口） | 凭令牌 |
| `email.preferences` | GET/POST | 读/改本账号的类别偏好 | 需登录，POST 需 `Origin` |
| `email.feedback` | POST | provider 投递反馈（退信/投诉） | 凭签名 |
| `email.test.provider` | POST | 模块附加钩子：设定假 provider 行为 | 无（仅 `TEST_MODE=1`） |

## 2. 响应形状与状态码

- 成功入队：`202`，体为 `{"id","status":"queued","template","to","category","createdAt"}`。不得用 `200` 表示"已排队"。
- 所有 `4xx/5xx` 的体固定为 `{"error":{"code":"<snake_case>","message":"<文本>"}}`；`2xx` 体不得出现 `error`。
- 同一 code 在任何接口下含义一致；同一情况在任何接口下都是同一状态码与同一 code。

| 情况 | 状态码 | code |
|---|---|---|
| 请求体缺字段/类型错/多余 envelope 字段 | 400 | `invalid_request` |
| 模板名形态非法（非 `<模块>.<名>`） | 400 | `invalid_template_name` |
| 退订令牌不存在/已过期/已使用 | 400 | `invalid_token` |
| provider 反馈签名缺失或不匹配 | 401 | `invalid_signature` |
| 未登录 | 401 | `unauthorized` |
| `Origin` 缺失或与本应用不符 | 403 | `origin_forbidden` |
| 邮件 id 不存在或不属于调用者 | 404 | `not_found` |
| 收件地址格式非法 | 422 | `invalid_recipient` |
| 模板未注册 | 422 | `unknown_template` |
| 缺少模板必需变量 | 422 | `missing_variables` |
| 出现模板未声明的变量 | 422 | `unknown_variables` |
| 地址已被退信/投诉抑制 | 422 | `recipient_suppressed` |
| 该类别已退订 | 422 | `not_subscribed` |
| 偏好类别未注册 | 422 | `unknown_category` |
| 同一幂等键载荷不同 | 409 | `idempotency_conflict` |
| 强制类别不可退订 | 409 | `category_protected` |
| 触发限流 | 429 | `rate_limited` |

`429` 必须带 `Retry-After`（整数秒 ≥ 1）。

## 3. 参数（宿主在 `module-map.json` 的 `params` 声明）

| 参数 | 默认 | 契约界限 | 含义 |
|---|---|---|---|
| `email_max_attempts` | 5 | 2–10 | 单封邮件最大尝试次数 |
| `email_retry_backoff_seconds` | 60 | ≥1 | 重试最小退避间隔 |
| `email_rate_limit_per_recipient` | 5 | ≤10 | 窗口内每收件地址发送上限 |
| `email_rate_limit_window_seconds` | 3600 | ≥1 | 上述窗口长度 |
| `email_token_rate_limit_per_ip` | 10 | ≤10 | 窗口内每客户端 IP 的令牌尝试上限 |
| `email_trusted_proxies` | `["127.0.0.1/32","::1/128"]` | — | 可信代理网段（是否采信 `X-Forwarded-For`） |
| `email_unsubscribe_token_ttl_seconds` | 2592000 | 3600–7776000 | 退订令牌有效期 |
| `email_suppression_ttl_seconds` | 0（永久） | ≥0 | 抑制名单存活时长，0=永久 |
| `email_retention_days` | 90 | 7–365 | 发送记录保留天数 |
| `email_categories` | `["transactional","product"]` | — | 已注册类别 |
| `email_mandatory_categories` | `["transactional"]` | — | 强制类别（不可退订） |
| `email_feedback_secret` | 无 | — | 反馈签名密钥（未声明则相关用例记"未声明"） |

## 4. 规则

G1、G3、J2 三条用数据库**只读**查询验收（HOST.md 第 4 节允许）。

### A 请求与形状

- **A1** `email.send` 被受理时返回 `202`，体含 `id`、`status="queued"`、`template`、`to`、`category`、`createdAt`。
- **A2** 错误体恒为 `{"error":{"code","message"}}`。
- **A3** 状态码与 code 的对应由 §2 表固定，不得同一情况出现两个码。
- **A4** 同一 code 在不同接口下必须给出同样的状态码（令牌无效在 GET 与 POST 上一律 `400 invalid_token`）。

### B 模板与变量

- **B1** 模板名必须匹配 `^[a-z][a-z0-9-]*\.[a-z][a-z0-9._-]*$`（即 `<模块>.<名>`）；否则 `400 invalid_template_name`。
- **B2** 形态合法但未注册的模板 → `422 unknown_template`。
- **B3** 变量在**请求时**校验：缺必需变量 → `422 missing_variables`；出现未声明变量 → `422 unknown_variables`；两者都不得产生记录。
- **B4** 模块自带两个模板（宿主可增补但须声明类别）：`email-transactional.contact` = {name,email,message}，类别 `transactional`（强制）；`email-transactional.product_update` = {title,body}，类别 `product`（可选）。

### C 队列与状态

- **C1** 状态仅 `queued/sent/bounced/failed/suppressed`，终态为后四者；允许流转 `queued→sent→bounced`、`queued→failed`、`queued→suppressed`，不得回退。
- **C2** `email.status` 返回 `id,to,template,category,status,attempts,createdAt,updatedAt,sentAt?,lastError?`；不得返回正文、变量、令牌。
- **C3** 未知 id 与"属于其他账号的 id"必须返回**完全相同**的 `404 not_found` 响应。
- **C4** `suppressed` ⇒ `attempts=0`；`sent/bounced/failed` ⇒ `attempts≥1`；`attempts` 单调不减且 ≤ `email_max_attempts`。
- **C5** `TEST_MODE=1` 时队列不得依赖真实等待：推进时钟 ≤60 秒（或轮询 ≤50 次）后必须至少发生一次投递尝试（`attempts` 增加或状态进入终态）。

### D 投递与重试

- **D1** 投递尝试次数不得超过 `email_max_attempts`。
- **D2** 瞬时失败必须重试；两次尝试间隔 ≥ `email_retry_backoff_seconds`，且由测试时钟驱动（推进时钟即触发下一次尝试）。
- **D3** 永久失败（地址非法、模板渲染失败、provider 明确拒绝）不重试：`attempts=1`，`status=failed`。
- **D4** 重试耗尽后 `status=failed`、`sentAt` 为空、`lastError.code ∈ {transient_provider_error, permanent_provider_error, template_render_error, invalid_recipient}`。

### E 反馈与抑制

- **E1** `email.feedback` 只接受 `type ∈ {hard_bounce, soft_bounce, complaint}`，其它 → `400 invalid_request`；请求必须带签名（`X-Email-Signature: sha256=<hex>`，HMAC-SHA256 覆盖原始 body，密钥见 §3），缺失或不匹配 → `401 invalid_signature`。先校验签名再校验 body。
- **E2** `hard_bounce` → 该邮件 `status=bounced`；该地址在**非强制类别**被抑制；此后发送 → `422 recipient_suppressed` 且不创建新记录。
- **E3** `complaint` → 该地址在**所有类别**被抑制；此后任何类别发送 → `422 recipient_suppressed`。
- **E4** `soft_bounce` → 不抑制；该邮件仍为 `sent`；此后发送 → `202`。
- **E5** 抑制默认永久有效；`email_suppression_ttl_seconds>0` 时，时钟推进超过该值后该地址恢复可发。

### F 订阅、退订与偏好

- **F1** 可选类别邮件必须带退订能力：outbox 记录中 `token` 非空、`data.link` 是含令牌的绝对 URL、`data.listUnsubscribePost` 是可 POST 的绝对 URL；强制类别邮件不得带 `token` 与 `data.listUnsubscribePost`。
- **F2** 退订令牌不可预测、≥32 字符；只以 SHA-256 小写十六进制存储。
- **F3** `email.unsubscribe`（GET）不得改变任何状态：之后该地址该类别仍可发信、令牌仍可用。
- **F4** `email.unsubscribe.confirm`（POST）消费令牌并把令牌指定的类别置为已退订；同一令牌再次使用 → `400 invalid_token`；未知令牌 → `400 invalid_token`，两者响应体一致。
- **F5** 退订只影响令牌指定的那一个类别。
- **F6** 强制类别不可退订：`email.preferences` POST 把强制类别置为退订 → `409 category_protected`，且订阅状态不变。
- **F7** `email.preferences` GET → `200 {"recipient","categories":{<类别>:{"subscribed":<bool>}}}`；POST `{category,subscribed}` → `200`；未注册类别 → `422 unknown_category`。
- **F8** 令牌超过 `email_unsubscribe_token_ttl_seconds` 后使用 → `400 invalid_token`（与未知令牌响应体一致）。
- **F9** 向已退订类别发送 → `422 not_subscribed`（与 `recipient_suppressed` 区分：前者是偏好，后者是投递健康）。

### G 令牌与存储

- **G1** 明文退订令牌不得出现在任何表（表名含 `outbox` 的测试表除外）；**令牌有效期间**，其 SHA-256 小写十六进制摘要必须能在库中查到。
- **G2** 明文令牌不得出现在任何 API 响应中（`outbox` 测试钩子除外）。
- **G3** 已使用或已过期（超过 TTL + 24 小时）的令牌记录必须删除：只读查库时该令牌的 SHA-256 摘要在任何表都查不到；在删除之前验证必须已失败（`400 invalid_token`）。

### H 限流与客户端 IP

- **H1** 同一收件地址在窗口内发送达 `email_rate_limit_per_recipient` 后必须被拒：`429 rate_limited` + `Retry-After`；上限 ≤10，即最迟第 11 次请求就要 429。
- **H2** 窗口按 `email_rate_limit_window_seconds` 计时，时钟推进过窗口或计数被清空后恢复可发。
- **H3** 令牌端点（`email.unsubscribe` / `email.unsubscribe.confirm`）按客户端 IP 限流（窗口同 `email_rate_limit_window_seconds`）：失败尝试达 `email_token_rate_limit_per_ip` → `429 rate_limited`。
- **H4** 客户端 IP 解析：仅当直接对端（socket peer）属于 `email_trusted_proxies` 时才采信 `X-Forwarded-For`；采信时从右往左剥掉尾部可信代理段，取**剩余最右一项**为客户端 IP，绝不取最左项；对端不可信则忽略该头，回落到对端地址。

### I 鉴权与请求来源

- **I1** `email.send` 必须鉴权；未登录 → `401 unauthorized`。
- **I2** 面向浏览器的写接口 `email.preferences`（POST）必须校验 `Origin`：缺失或不等于应用自身 origin → `403 origin_forbidden`。验收脚本用环境变量 `APP_BASE_URL` 作为 `Origin` 值（只取 scheme://host[:port]）。`email.send` 是服务端接口，**不得**要求 `Origin`。
- **I3** `email.unsubscribe.confirm` 是 provider 的机器调用，**不得**因缺少 `Origin` 被拒（不得返回 `403 origin_forbidden`）；它只凭令牌与防重放校验。

### J 记录生命周期

- **J1** 邮件记录只存元数据（收件人、模板、类别、状态、尝试次数、时间、provider 消息 id）；不存渲染正文、模板变量、链接、令牌。
- **J2** 超过 `email_retention_days`（+ ≤24 小时宽限）后，该邮件的 `email.status` 必须返回 `404 not_found`，且该记录被删除。只读查库核对：取一个未被抑制、未被退订的地址样本（表名含 `outbox` 者除外）不再出现该地址（抑制与偏好条目可合法保留地址）。

### K 不变量

- **K1** 每次 `202` 恰好产生一条邮件记录，并可由 `id` 取回。
- **K2** outbox 每条消息：`template` 形如 `<模块>.<名>`，链接在 `data.link`，令牌在 `token`。
- **K3** 状态与 `attempts` 单调不回退；`suppressed ⇒ attempts=0`。
- **K4** 同一幂等键 + 同一载荷 ⇒ 同一个 `id`、只有一条记录；同键不同载荷 ⇒ `409 idempotency_conflict`。幂等键可用请求头 `Idempotency-Key` 或体字段 `idempotencyKey` 传入。
- **K5** 强制类别永远处于订阅状态；退订只影响指定类别。
- **K6** 任何 `4xx` 都不得创建记录、不得消费令牌、不得改变订阅状态。

### L 模块附加测试钩子（仅 `TEST_MODE=1`，其余情况必须 404）

`POST email.test.provider`，体：

```json
{"mode":"ok|transient_error|permanent_error|hard_bounce|soft_bounce|complaint",
 "times": 2, "to": "a@example.test"}
```

- `mode=transient_error|permanent_error`：投递尝试报错；`times=N` 表示前 N 次报错，省略表示一直报错。
- `mode=hard_bounce|soft_bounce|complaint`：provider 先接受再回报该事件；`times` 省略表示每封都回报。
- `to` 省略表示对所有收件人生效；`DELETE email.test.provider` 复位为 `ok`。

## 5. 建议，验收不测

- 退避用指数退避 + 抖动；provider 调用带超时与连接池；模板引擎不得执行任意代码。
- 应用日志不打印明文令牌；provider 密钥放密钥管理服务。
- 队列按至少一次投递；邮件正文可访问性等呈现细节不属于验收范围。
- 账号状态（存在/未验证/已禁用）不由本模块判定，响应状态码与结构应保持一致；账号状态由 auth 判定。
- 配合 audit-and-data-export 的删除请求清除本模块的记录与偏好（接口形式由宿主自定）。

## 6. 规则 → 验收用例追溯

| 规则 | 用例 | 规则 | 用例 | 规则 | 用例 |
|---|---|---|---|---|---|
| A1 | AC-06 | A2 | AC-01 | A3 | AC-01, AC-02, AC-03, AC-08, AC-22, AC-25, AC-28, AC-29 |
| A4 | AC-08, AC-20, AC-21 | B1 | AC-03 | B2 | AC-03 |
| B3 | AC-04, AC-05 | B4 | AC-06, AC-18 | C1 | AC-07, AC-14 |
| C2 | AC-07, AC-09 | C3 | AC-08 | C4 | AC-07, AC-11, AC-12, AC-14 |
| C5 | AC-07, AC-10 | D1 | AC-11 | D2 | AC-10 |
| D3 | AC-12 | D4 | AC-11, AC-12 | E1 | AC-29 |
| E2 | AC-14 | E3 | AC-15 | E4 | AC-16 |
| E5 | AC-17 | F1 | AC-06, AC-18 | F2 | AC-18 |
| F3 | AC-19 | F4 | AC-20, AC-21 | F5 | AC-21 |
| F6 | AC-22 | F7 | AC-24 | F8 | AC-23 |
| F9 | AC-21 | G1 | AC-18, AC-30 | G2 | AC-09 |
| G3 | AC-20, AC-23 | H1 | AC-25 | H2 | AC-25 |
| H3 | AC-26 | H4 | AC-27 | I1 | AC-08 |
| I2 | AC-28 | I3 | AC-20 | J1 | AC-09 |
| J2 | AC-30 | K1 | AC-06, AC-13 | K2 | AC-06, AC-18 |
| K3 | AC-07, AC-11, AC-14 | K4 | AC-13 | K5 | AC-21, AC-22, AC-24 |
| K6 | AC-01, AC-04, AC-05, AC-14 |  |  |  |  |
