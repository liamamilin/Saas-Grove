# acceptance-plan.md — internationalization 验收计划

黑盒用例计划（可执行测试后续落地）。规则编号见 `contract.md` §3，追溯表见其 §7。

## 0. 前置与约定

- 宿主按 `HOST.md` 启动（`TEST_MODE=1`）；验收只读 `module-map.json` 取概念路径与 `params`。
- **每条用例用全新账号**（唯一邮箱），经 auth 公开接口注册；工作区经 workspaces-and-permissions 公开接口创建；需要"另一个工作区"时再建独立账号与工作区。
- 所有写请求带 `Origin: $APP_BASE_URL`（取自 HOST.md）；C26 专门验证缺失/错误 Origin。
- 时效用 `POST /api/__test__/clock {advanceSeconds}` 推进；数值上限、TTL 一律读 `params`。
- 覆盖范围：HTTP 响应、响应头、Cookie、数据库**只读**查询（仅 C24 的哈希核对）。
- 概念缺失的用例记"宿主未声明"，不判通过也不判失败。
- `locale` 与工作区上下文的取法按宿主声明的映射；源字典 key 取 `dict.get`（源 locale）响应的第一个 key，记为 K；目标 locale 记为 L（支持列表中任一非源 locale）。

| ID | Given | Action | Expected | 负向 |
|---|---|---|---|---|
| C01 | 匿名会话 | GET `locales.list` | 200；含 `sourceLocale`；`locales[]` 数量 ≥2 且 ≤100；每项有 `tag`/`direction`/`currency`/`timeZone`/`fallbackChain[]`，`fallbackChain` 末位 = `sourceLocale` | 否 |
| C02 | 匿名会话 | GET `locale.resolve?locale=EN-us` | 200；`requested` = `en-US`（语言小写、地区大写；语言/地区本身未变） | 否 |
| C03 | 账号 A（W1 管理员；用户偏好=A1、工作区偏好=A2、cookie=A3，取自支持列表且互不相同）；账号 B（W1 成员、无用户偏好）；账号 C（W2 成员、W2 未设工作区偏好、cookie=A3）。宿主支持 locale 少于 3 个时本例记"宿主未声明" | 依次 GET `locale.resolve`：A 带 `?locale=<支持列表中的某 locale>`；A 不带参数；B 不带参数；C 不带参数 | 四次 `source` 依次为 `explicit`/`user`/`workspace`/`cookie`，`locale` 分别等于显式值、A1、A2、A3；未设工作区偏好时不命中 workspace | 否 |
| C04 | 匿名会话 | GET `locale.resolve` 分别带：`fr;q=0.9, de;q=0.8`；`de;q=0, fr`；`*`；`de;q=abc, ;;`；无该头 | 依次：fr；fr（`q=0` 的 de 被排除）；默认且 `source=default`；默认且不报错；默认 | 是 |
| C05 | 匿名会话 | GET `locale.resolve?locale=xx-YY`；再带 `Cookie: <localeCookieName>=not-a-locale`；再 `?locale=<长度 200 的串>` | 均 200；`fallback=true`；`fallbackFrom` 在 `fallbackChain` 内；`locale` 为受支持的回退结果；绝不 4xx/5xx | 是 |
| C06 | 管理员账号，W1；K = 源字典第一个 key；L = 某非源 locale | `tr.apply` 写 K 的译文 T → `msg.format`{kind:message,key:K,locale:L} → `tr.clear` K → 再 `msg.format` | apply 200；首次 formatted = T 且 `fallback=false`；clear 200；再次 formatted = 源文本且 `fallback=true`、`fallbackFrom` = 源 locale | 否 |
| C07 | 管理员账号，W1，K 已有译文 | GET `dict.get?locale=L` 与 `tr.status` | 两处 coverage 满足 `translated+untranslated+missing==total`、`0≤stale≤translated`、`0≤needsReview≤translated`；`missingCount` 与 `missing` 一致（截断时 ≥） | 否 |
| C08 | 管理员账号，W1，K 已被 clear（处于回退态）；另有已翻译键 K2 | GET `msg.format`{kind:message,key:K} 与 key=K2 | K 的响应带 `X-Locale-Fallback`，且 `Cache-Control` 的 max-age ≤ `params.fallbackCacheMaxAgeSeconds`（未声明=0 时必须 `no-store`）；K2 无该头且不受此限 | 是 |
| C09 | 匿名会话 | GET `dict.get?locale=<支持 locale>` | 200；带 `Content-Language: <该 locale>`；带 `Vary` 且其中含 `Accept-Language` 与 `Cookie` | 否 |
| C10 | 匿名会话；宿主支持至少两种分组风格 | POST `msg.format`{kind:number, value:1234567.89, locale:A}，再 locale:B 且 value:-1234567.89 | 两次 200 且 formatted 不同；en 系结果含 `,` 与 `.`；de/fr 系含 `.` 不含 `,`；负值含该 locale 的负号。宿主只支持一种分组风格时记"宿主未声明" | 否 |
| C11 | 匿名会话 | POST `msg.format`{kind:currency, value:1234.5, currency:"EUR"}；{currency:"JPY"}；{currency:"eur"}；{currency:"XYZ"} | 前两次 200，EUR 2 位小数、JPY 0 位小数且 `resolved.fractionDigits` 回显；`eur` 与 `XYZ` 均 400 `invalid_currency`；换币种后数值部分不变（未做换算） | 是 |
| C12 | 匿名会话 | POST `msg.format`{kind:percent, value:0.25} | 200；结果含 `25` 与 `%`（按比例放大，不是 `0.25`）；符号与空格随 locale | 否 |
| C13 | 匿名会话；时区取 `params.supportedTimeZones`（未声明=全量 IANA） | POST `msg.format`{kind:datetime, value:"2026-01-15T12:00:00Z", timeZone:"America/New_York"}；同值 timeZone:"Asia/Shanghai"；value:"2026-07-15T12:00:00Z" + New_York | 三次 200 且 `resolved.timeZone` 回显；偏移依次 -05:00、+08:00、-04:00（夏季与冬季不同）；输出墙上时间与该偏移一致 | 否 |
| C14 | 匿名会话 | POST `msg.format`{kind:datetime, value:"2026-01-15T12:00:00Z", timeZone:"CST"}；{timeZone:"+08:00"}；{timeZone:"Mars/Olympus"} | 三次均 400 且 code=`invalid_time_zone`；无 5xx | 是 |
| C15 | 匿名会话 | POST `tz.convert`{localTime:"2026-03-08T02:30:00", timeZone:"America/New_York"}；{localTime:"2026-11-01T01:30:00", timeZone:"America/New_York"} | 第一次 400 `nonexistent_local_time`；第二次 200 且 `ambiguous=true`、`offset=-04:00`（较早的那个）、`alternativeOffset=-05:00` | 是 |
| C16 | 匿名会话；宿主支持至少一个复数规则不同于 en 的 locale（否则本例记"宿主未声明"） | POST `msg.format`{kind:plural, count:1, forms:{one:"a",other:"b"}, locale:en}；ru（或等效 locale）count:2；同 locale count:5；fr（或等效 locale）count:0 | `category` 依次为 one、few、many、one；forms 缺所选类别时 400 `missing_field`；en 的 count=2 必须是 other | 否 |
| C17 | 匿名会话 | POST `msg.format`{kind:message, key:"does.not.exist"} | 404；体为 `{"error":{"code":"unknown_key","message":...}}`；不得返回空串、`undefined` 或 key 原文 | 是 |
| C18 | 管理员账号，W1；K 的源文本含 `{count}` | `tr.apply` 文本含 `<b>x</b>` → 文本占位符为 `{total}` → 文本为空串 → key 不存在 | 依次 422 `invalid_translation`、422 `invalid_translation`、400 `missing_field`、404 `unknown_key`；四次均非 5xx | 是 |
| C19 | 管理员账号，W1；K 的源文本 S | `tr.apply` 文本恰等于 S | 200 且返回状态 `translated`（不是 `untranslated`）；`tr.status` 中该键计入 translated 而非 untranslated | 否 |
| C20 | 管理员账号，W1；先对 K 写入译文 T | POST `tr.sync`{locales:[L]} → GET `dict.get`?locale=L 与 `tr.status` | sync 200；K 的文本仍为 T 且状态未变；`added` 只计新增键；覆盖率不变式仍成立 | 是 |
| C21 | 管理员账号，W1；从 `tr.status` 取 L 的 revision = r | 并行发两个 `tr.apply`：同 locale、同 key K、不同文本，都带 `expectedRevision=r` | 恰一个 200（返回 revision=r+1），另一个 409 `revision_conflict`；K 的最终文本等于成功那次的文本；translated 计数只 +1 | 是 |
| C22 | 管理员账号，W1；记录 L 的 translated 计数 | 对同一 (locale,key,text) 连发两次 `tr.apply`（不带 `expectedRevision`） | 两次均 200；translated 计数相对发送前只 +1；该键仍只有一条条目 | 是 |
| C23 | 管理员账号，W1 | POST `tr.export` 得 link → GET link → 再 GET link → 再 POST `tr.export` 得 link2 → `POST /api/__test__/clock {advanceSeconds: params.bundleLinkTtlSeconds+1}` → GET link2 → 另一账号未登录 GET link | 依次 200（含导出包）、410 `link_used`、410 `link_expired`、401 `unauthenticated` | 是 |
| C24 | 管理员账号，W1；`tr.export` 得 link，从中取令牌串 T | 只读数据库查询：按明文 T 搜索所有文本列；再首次 GET link | 明文 T 在库中 0 命中（只有哈希）；同一链接仍能首次取回 200（校验基于哈希，不是明文比对） | 是 |
| C25 | 匿名会话 | GET `locale.resolve` 带 `X-Forwarded-For: 203.0.113.5, 198.51.100.9` | `clientIp` = `198.51.100.9`（最右侧不受信跳），不得为 `203.0.113.5`；若 `params.trustedProxyCidrs` 含 `198.51.100.9`，则 `clientIp` = `203.0.113.5` | 是 |
| C26 | 管理员账号，W1 | `tr.apply` 不带 `Origin`；再带 `Origin: https://evil.example`；再带 `Origin: $APP_BASE_URL` | 依次 403 `invalid_origin`、403 `invalid_origin`、200 | 是 |
| C27 | 账号 A（W1 管理员）、账号 B（W2 管理员）、账号 C（W1 非管理员成员） | A 对 W1 的 K 写译文；B 读 W1 的 `tr.status`；B 在 W2 上下文读 `dict.get`；C 对 W1 执行 `tr.apply`；C 读 W1 的 `ws.locale` | B 读 W1 → 404 `not_found`（不可见的工作区不因 403/404 差异泄露存在性）；B 的 `dict.get` 不含 A 的译文；C 的 apply → 403 `forbidden`；C 读 `ws.locale` → 200 | 是 |
| C28 | 匿名会话 | 依次请求：畸形 JSON 体；缺 `kind`；`kind:"nope"`；`Accept-Language: ;;;`；超长 timeZone；缺必填 value | 依次 400 `invalid_request`、400 `missing_field`、400 `invalid_kind`、200（非法头走默认）、400 `invalid_time_zone`、400 `missing_field`；全部为统一错误形状；无任何 5xx（畸形 locale 走 C05 的回退路径，不是 4xx） | 是 |
| C29 | 管理员账号，W1 | `tr.sync` 传 `params.maxSyncLocales+1` 个 locale；`tr.export` 传 `params.maxExportLocales+1` 个 | 两次均 400 `limit_exceeded`。宿主支持的 locale 数少于上限时记"宿主未声明" | 是 |
| C30 | 管理员账号，W1 | PUT `ws.locale`{locale:"<支持的 locale>", timeZone:"Asia/Shanghai"}；{locale:"en_US"}；{locale:"xx-YY"}；{timeZone:"CST"} → GET `locale.resolve` → POST `msg.format`{kind:datetime, value:"2026-01-15T12:00:00Z"} | 依次 200、400 `invalid_locale`、400 `unsupported_locale`、400 `invalid_time_zone`；随后 `locale.resolve` 的 `source`=workspace；`msg.format` 未给时区时 `resolved.timeZone`=Asia/Shanghai | 是 |
