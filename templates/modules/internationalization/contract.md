# contract.md — internationalization 黑盒契约

只写外部可观察到的行为。宿主在 `module-map.json` 把**概念名**映射到真实路径，验收只读映射（见 `HOST.md`）。数值给**界限**，宿主在 `params` 声明实际值；未声明时按本文件界限测。

## 1. 概念（宿主需映射）

| 短名（完整名 = `internationalization.` + 短名） | 方法 | 用途 | 访问条件 |
|---|---|---|---|
| `locales.list` | GET | 支持的 locale、源 locale、每 locale 元数据 | 公开 |
| `locale.resolve` | GET | 有效 locale、来源、回退链、clientIp | 公开（登录时叠加用户偏好） |
| `dict.get` | GET | 某 locale 的字典与覆盖率 | 公开（登录时叠加工作区译文） |
| `msg.format` | POST | 数字/货币/百分比/日期/时间/复数/取词 | 公开 |
| `tz.convert` | POST | 瞬时 ↔ 本地时间、偏移、歧义 | 公开 |
| `user.locale` | GET/PUT | 用户 locale 与时区偏好 | 需登录 |
| `ws.locale` | GET/PUT | 工作区默认 locale 与时区 | 读：成员；写：管理员 |
| `tr.status` | GET | 覆盖率、缺失/过期键、locale revision | 读：成员 |
| `tr.apply` | POST | 写入一条译文 | 管理员 + Origin |
| `tr.clear` | POST | 重置一条译文为未翻译 | 管理员 + Origin |
| `tr.sync` | POST | 把源新键登记到目标 locale | 管理员 + Origin |
| `tr.export` | POST | 生成一次性导出包链接 | 管理员 + Origin |
| `tr.download` | GET | 消费一次性链接取回导出包 | 需登录且限创建者工作区 |

工作区 id 的传递由宿主声明（路径参数或请求头）；验收用 workspaces-and-permissions 的真实 id。

## 2. 宿主参数（params）与契约界限

| 参数 | 契约界限 | 缺省 |
|---|---|---|
| `localeCookieName` | cookie 名 | `locale` |
| `bundleLinkTtlSeconds` | 60–86400 秒 | 3600 |
| `fallbackCacheMaxAgeSeconds` | 0–5 秒 | 0（须 `no-store`） |
| `maxSyncLocales` | ≤ 100 | 100 |
| `maxExportLocales` | ≤ 50 | 50 |
| `maxBundleEntries` | ≤ 20000 | 20000 |
| `trustedProxyCidrs` | CIDR 列表 | 空（无受信代理） |
| `xffMaxHops` | ≤ 32 | 32 |
| `supportedTimeZones` | IANA 名称集合 | 全部可解析 IANA 名 |
| `maxLocales` | 2–100 | — |

## 3. MUST 规则

### 3.1 locale 与协商

**R01 清单可发现** `[locales.list]` — 返回 200，含 `sourceLocale` 与 `locales[]`；每项含 `tag`、`direction`(`ltr|rtl`)、`currency`、`timeZone`、`fallbackChain[]`（末位为源 locale）。locale 数 ≥2 且 ≤100。

**R02 locale tag 规范化** `[locale.resolve]` — 所有 locale 输入规范化为 BCP 47：语言小写、脚本首字母大写、地区大写（`EN-us`→`en-US`）；只改大小写与分隔；长度 >35 非法。结果在 `locale.resolve` 的 `requested` 字段可见。

**R03 协商优先级** `[locale.resolve]` — 恒为：显式参数 > 用户偏好 > 工作区偏好 > locale cookie > Accept-Language > 默认（源 locale）；未设置的工作区偏好视为不存在。返回唯一命中的 `source ∈ {explicit,user,workspace,cookie,header,default}` 与 `locale`；同级取最先出现者。

**R04 Accept-Language 解析** `[locale.resolve]` — 按 q 降序取第一个可用语言；`q=0` 必须跳过；`*` → 默认且 `source=default`；非法条目（`de;q=abc`、空段）跳过而非报错；缺头 → `source=default`。匹配序：相等 → 去地区 → 去脚本 → 同语言其他已支持 locale → 默认。

**R05 未知/非法 locale 读取时回退** `[locale.resolve]` — 参数、cookie、偏好里的非法或不支持 locale 不得 4xx/5xx；回退到下一候选（完整 tag → 去地区 → 去脚本 → 源 locale），返回 `fallback=true` 与 `fallbackFrom`；无偏好时 `fallback=false`、`locale=sourceLocale`。

**R06 每键独立回退并标记层级** `[msg.format, dict.get]` — 逐键回退：目标 locale → 去地区 → 去脚本 → 源 locale。缺失或 `untranslated` 的键取到源文本，响应 `fallback=true`、`fallbackFrom` = 命中 locale；不影响同 locale 其他已翻译键。

**R07 覆盖率自洽** `[dict.get, tr.status]` — `translated + untranslated + missing == total`；`0 ≤ stale ≤ translated`；`0 ≤ needsReview ≤ translated`；`total` = 源键数；缺失键清单 ≤100 条并另给 `missingCount`。

**R08 回退内容不得被当成本地化内容缓存** `[dict.get, msg.format]` — 回退时响应必须带 `X-Locale-Fallback`，且 `Cache-Control` 的 max-age ≤ `params.fallbackCacheMaxAgeSeconds`（未声明按 0 → 必须 `no-store`）；未回退时不得带该头、不受此限。

**R09 响应声明 locale 归属** `[dict.get, msg.format, locale.resolve]` — 随 locale 变化的响应必须带 `Content-Language: <有效 locale>`；随协商（Accept-Language/Cookie）变化的必须带 `Vary: Accept-Language, Cookie`。

### 3.2 格式化

**R10 数字与百分比按 locale 格式化** `[msg.format]` — `kind=number` 用目标 locale 的分组符、小数符、千分位与负号（`en` 用 `,`/`.`，`de` 用 `.`/`,`）；`kind=percent` 把 `value` 视为比例（`0.25`→`25%`）。

**R11 货币按 locale 与 ISO 4217 格式化** `[msg.format]` — `currency` 须 ISO 4217 大写三字母，非法或小写 → 400 `invalid_currency`；小数位由**货币**最小单位决定（日元 0 位、欧元 2 位），可被 `options` 覆盖并由 `resolved.fractionDigits` 回显；符号与位置随 locale。**只格式化不换算**：同 `value` 换 `currency` 时数值部分不变。

**R12 日期时间按显式时区渲染** `[msg.format]` — `kind=date|datetime|time` 输入 ISO 8601（无偏移按 UTC 解释）；输出用 `timeZone`（未给则偏好、再无则 UTC），并在 `resolved` 回显 `timeZone` 与 `offset`（UTC 偏移，如 `-05:00`）；服务端本地时区不得影响结果。同一 UTC 瞬时在不同目标时区偏移必须不同；处于 DST 的时区夏冬偏移必须不同（NY 冬季 `-05:00`、夏季 `-04:00`）。

**R13 时区必须是可解析的 IANA 名称** `[msg.format, tz.convert]` — 接受 IANA 区域名（`Asia/Shanghai`、`America/New_York`、`UTC`）；固定偏移（`+08:00`）、缩写（`CST`、`PST`）或未知名 → 400 `invalid_time_zone`。

**R14 DST 边界显式处理** `[tz.convert]` — 以 `localTime` + `timeZone` 解析时：DST"不存在"的本地时间 → 400 `nonexistent_local_time`；"出现两次"的本地时间 → 200 且 `ambiguous=true`，偏移取**较早的一个**，另一偏移放 `alternativeOffset`。

**R15 复数按 locale 规则** `[msg.format]` — `kind=plural` 按目标 locale 的复数规则选形式（en：one/other；fr：0 与 1 同为 one；ru：one/few/many），响应回显选中的 `category`；缺该形式 → 400 `missing_field`（`details.category`）。不得以 `count === 1` 判定。

**R16 未知键必须报错** `[msg.format, tr.apply]` — key 不在源字典 → 404 `unknown_key`；不得返回空串、`undefined` 或 key 原文。

### 3.3 翻译工作流

**R17 翻译写入的四类校验** `[tr.apply]` — (a) key 在源字典，否则 404 `unknown_key`；(b) `text` 去空白后非空，否则 400 `missing_field`；(c) 不含 HTML 标记（`<`、`>`），否则 422 `invalid_translation`（`details.reason="markup"`）；(d) 占位符（`{name}`）集合与源一致，否则 422 `invalid_translation`（`details.missing`/`details.extra`）。

**R18 翻译状态是显式字段** `[tr.apply, tr.status]` — 状态取值 `translated` | `needs_review` | `approved`，必须写进存储；译文与源文本相同仍记 `translated`，不得判为 `untranslated`。

**R19 源版本与乐观并发** `[tr.apply]` — `sourceRevision` 与当前源版本不符 → 409 `stale_revision`；`expectedRevision` 与该工作区该 locale 当前 revision 不符 → 409 `revision_conflict`；成功写入返回新 `revision`。

**R20 sync 只补缺失** `[tr.sync]` — 只为该 locale 尚无条目的源键创建 `untranslated` 条目（空文本）；不覆盖已有译文或改其状态；响应给出每 locale 的 `added`、`skipped`。

**R21 clear 重置为未翻译** `[tr.clear]` — 把 (locale,key) 重置为 `untranslated`（空文本）；此后取词回退到源文本并 `fallback=true`；key 不存在 → 404 `unknown_key`。

**R22 重复写入幂等** `[tr.apply]` — 同一 (locale,key,text) 连写两次都 200；该键仍只有一条条目，覆盖率计数不变。

**R23 一次性导出链接** `[tr.export, tr.download]` — 导出返回含不可猜测令牌的一次性链接：首次取回 200；再次 → 410 `link_used`；超 TTL（`params.bundleLinkTtlSeconds`，界限 60–86400 秒）→ 410 `link_expired`；未登录 → 401 `unauthenticated`。

**R24 一次性令牌只存哈希** `[tr.export]` — 令牌在持久化中只以哈希（摘要）存在，明文不得落库；只读数据库查询以明文令牌搜索应无命中。

### 3.4 偏好、工作区与权限

**R25 偏好写入校验且立即生效** `[user.locale, ws.locale]` — locale 语法非法 → 400 `invalid_locale`；合法但不支持 → 400 `unsupported_locale`；时区非法 → 400 `invalid_time_zone`；成功后 `locale.resolve` 的 `source` 变为 `user`/`workspace`，且 `msg.format` 未指定时区时用该偏好时区。

**R26 偏好读写权限** `[user.locale, ws.locale]` — `ws.locale` 读需成员身份、写需该工作区管理员；同工作区非管理员写 → 403 `forbidden`；未登录写 → 401 `unauthenticated`；工作区不存在或非成员 → 404 `not_found`。

### 3.5 安全与隔离

**R27 跨工作区隔离** `[tr.*, ws.locale]` — 译文、覆盖、覆盖率、导出包按工作区隔离：A 工作区数据不得出现在 B 工作区任何响应中；对调用者不可见的工作区（不存在或非成员）一律 404 `not_found`，不得用 403/404 的差异泄露工作区是否存在。

**R28 写操作要求同源 Origin** `[user.locale(PUT), ws.locale(PUT), tr.apply, tr.clear, tr.sync, tr.export]` — 必须校验 `Origin`：缺失或与宿主自身 origin（`APP_BASE_URL`）不一致 → 403 `invalid_origin`。验收脚本对每个写请求带 `Origin: $APP_BASE_URL`（HOST.md 提供）。

**R29 客户端 IP 取最右侧不受信跳** `[locale.resolve]` — 只使用 `X-Forwarded-For` 中**最右侧的不受信跳**（受信网段由 `params.trustedProxyCidrs` 声明，未声明即无受信代理），**绝不使用最左侧**；只看最后 `params.xffMaxHops`（≤32，默认 32）跳；`locale.resolve` 回显生效的 `clientIp`。

### 3.6 错误、上限与不变式

**R30 统一错误形状** `[全部概念]` — 错误体必须是 `{"error":{"code":"<枚举值>","message":"<人类可读>"}}`，`details` 可选；`message` 不参与断言；同一情形用同一状态码与 `code`。

**R31 用户可控输入不得产生 5xx** `[全部概念]` — locale、currency、timeZone、Accept-Language、请求体、字段长度等输入，无论合法性都不得 5xx；非法输入返回第 4 节表对应的 4xx。

**R32 数量上限** `[tr.sync, tr.export]` — `sync` 目标 locale 数 > `params.maxSyncLocales`（≤100）→ 400 `limit_exceeded`；`export` locale 数 > `params.maxExportLocales`（≤50）或条目数 > `params.maxBundleEntries`（≤20000）→ 400 `limit_exceeded`。

**不变式**（任何时刻、任何 locale 成立）
- I1 `translated + untranslated + missing == total`；`0 ≤ stale ≤ translated`；`0 ≤ needsReview ≤ translated`。
- I2 (工作区, locale, key) 至多一条译文条目。
- I3 `sync` 后 I1 仍成立（`missing`→0，`untranslated` 相应上升）。
- I4 回退链末端必为源 locale；`fallbackFrom` 必在该 locale 的 `fallbackChain` 内。
- I5 一次性链接至多成功取回一次。
- I6 错误响应符合第 4 节形状与状态码。

## 4. 错误形状与状态码表（一个情形一个码）

```json
{"error": {"code": "unsupported_locale", "message": "not supported", "details": {}}}
```

| code | 状态码 | 情形 |
|---|---|---|
| `invalid_request` | 400 | 请求结构非法 |
| `invalid_locale` | 400 | locale 语法非法（超长/结构错） |
| `unsupported_locale` | 400 | locale 合法但不支持（写入偏好时） |
| `invalid_time_zone` | 400 | 时区非可解析 IANA 名 |
| `invalid_currency` | 400 | 货币码非 ISO 4217 大写三字母 |
| `invalid_kind` | 400 | `kind` 不在枚举内 |
| `missing_field` | 400 | 必填字段缺失或为空 |
| `limit_exceeded` | 400 | 超数量上限 |
| `nonexistent_local_time` | 400 | DST 中不存在的本地时间 |
| `unauthenticated` | 401 | 需要登录 |
| `forbidden` | 403 | 同工作区权限不足 |
| `invalid_origin` | 403 | `Origin` 缺失或不匹配 |
| `not_found` | 404 | 资源不存在或不可见 |
| `unknown_key` | 404 | key 不在源字典 |
| `stale_revision` | 409 | `sourceRevision` 不符 |
| `revision_conflict` | 409 | `expectedRevision` 不符 |
| `link_used` | 410 | 一次性链接已用 |
| `link_expired` | 410 | 一次性链接已过期 |
| `invalid_translation` | 422 | 含标记或占位符不一致 |
| `rate_limited` | 429 | 被限流（rate-limiting 产生） |

## 5. 必须以哈希存储的数据

- **导出链接令牌**：只存哈希（摘要），明文不得落库（R24）。
- 其余数据（字典文本、译文、偏好、覆盖率统计）按明文存储；本模块不持久化其他凭据。

## 6. 建议，验收不测

- 抽取文案、构建期强制键对齐、分片打包。
- 复数/日期/货币规则的实现来源（CLDR 与时区库版本）与升级节奏。
- 译文质量评分、伪本地化、术语库巡检。
- 缓存层、索引、查询性能；漏译率与 fallback 率的采集与告警。

## 7. 规则 → 用例追溯表

R01→C01；R02→C02；R03→C03；R04→C04；R05→C05；R06→C06；R07→C07；R08→C08；
R09→C09；R10→C10, C12；R11→C11；R12→C13；R13→C14；R14→C15；R15→C16；R16→C17；
R17→C18；R18→C19；R19→C21；R20→C20；R21→C06；R22→C22；R23→C23；R24→C24；
R25→C30；R26→C27；R27→C27；R28→C26；R29→C25；R30→C17, C28；R31→C28；R32→C29；

（C01–C30 见 `acceptance-plan.md`。）
