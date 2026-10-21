# internationalization（国际化）认知模板

> 面向实现者：本文讲"成熟版是什么、怎样算做对了"，**不写代码**。黑盒规则见 `contract.md`，用例见 `acceptance-plan.md`，取舍见 `decisions.md`，宿主约定见 `HOST.md`（不重复）。

## 0. 必读摘要（一页）

**一句话**：国际化的成熟形态 = 一套**可协商、可回退、可观测**的渲染契约（语言、数字、货币、日期、时区），加上一条**翻译生产线**（源字典是唯一事实来源 → 目标语言登记 → 翻译 → 评审 → 发布 → 覆盖率可查）。只做"翻译 API"而不做回退与覆盖率，线上事故是另一个量级。

**10 条不破的规则**（每条在 `contract.md` 有对应 MUST 与验收用例）
1. 源 locale 是唯一事实来源：源里没有的 key 一律 `404 unknown_key`，绝不渲染空串。
2. 协商顺序固定且可观测：`显式参数 > 用户偏好 > 工作区偏好 > locale cookie > Accept-Language > 默认`，响应必须给出"来源"标记。
3. **读时宽容、写时严格**：读取路径遇到未知/畸形 locale 一律回退并标记、不报错；写入偏好时遇到不支持的 locale 或非法时区必须 `400`。
4. 回退必须**可见、且不得当成本地化内容缓存**：响应带 `fallback` 标记；回退内容不能以目标 locale 为键长期缓存，否则翻译上线后仍看旧文案。
5. 覆盖率四计数 `translated / untranslated / missing / stale` 必须满足 `translated + untranslated + missing == total` 且 `stale ≤ translated`——这是"漏没漏译"的唯一口径。
6. 翻译状态是**显式字段**，不能用"译文与源文本相同"反推未翻译（`Blog`、`SaaS` 会被永久误判）。
7. 数字/货币/百分比/日期一律按目标 locale 格式化；**货币只格式化不换算**（换算属 payments-billing）。
8. 时间以 UTC 瞬时为准，展示用 IANA 时区名；不存在的本地时间要拒绝，歧义时间要确定性处理并标记。
9. 写操作要求同源 `Origin`，并严格按工作区隔离：跨工作区读写一律拒绝。
10. 用户可控输入（locale、currency、timeZone、Accept-Language、超长串、畸形 JSON）**不得造成 5xx**。

**最容易出的 5 个事故**：回退响应被 CDN 按目标 locale 缓存（翻译上线仍显示旧语言）；写死 `count === 1` 判复数（法语/俄语语法错）；存本地时间或固定偏移（DST 后错一小时）；货币硬编码符号与小数位（日元多两位）；取 `X-Forwarded-For` 最左边当客户端 IP（IP 可伪造）。

**验收怎么跑**：宿主在 `module-map.json` 里把本文的概念名（`internationalization.*`）映射到真实路径，验收只读映射、不猜路径；数值（TTL、上限）在宿主 `params` 声明，契约只给上下界。详见 `HOST.md`。

## 1. 这个模块是什么

国际化的**产品面**只有三件事：

1. **决定这次请求用哪种表达**：语言、数字/货币/日期/时间的写法、时区。显式意图（用户设置、参数）优先于环境推断（cookie、Accept-Language、地区）。
2. **把这些表达渲染出来**：文案来自字典，数字与日期按 locale 格式化，时间来自 UTC 瞬时 + IANA 时区。结果要**按 locale 隔离缓存**、可回退、可统计。
3. **让文案可以被生产出来**：源字典 → 目标语言 → 评审 → 发布，并把"哪里还没翻"变成可查询的数字。

它**不是**"翻译 API 的封装"，也**不是**"把界面文字多存几份 JSON"。关键不在存了几种语言，而在**回退是否可见、覆盖率是否可信、时区与复数是否正确、写操作是否守规矩**。

边界：只管**产品界面文案**（字典、格式化、时区、翻译状态）；用户自己写的内容永远不进字典。

## 2. 成熟版应该有什么（MVP → 成熟，逐条）

**MVP：能上线，多语言不崩**
- M1 locale 清单 + 源 locale + 每 locale 元数据（方向、默认货币、默认时区、fallback 链）。
- M2 locale 协商与"来源"标记。
- M3 每 locale 字典 + **每 key 独立**回退到下一级 locale。
- M4 数字与百分比按 locale 格式化。
- M5 货币按 locale + ISO 4217 格式化（只格式化不换算）。
- M6 日期时间按 ISO 输入 + 显式时区格式化，内部一律 UTC。
- M7 统一错误形状与 4xx；畸形输入不 5xx。

**可运营：文案能持续生产出来**
- M8 覆盖率视图（四计数 + 缺失键清单 + 版本号）。
- M9 翻译写入校验（key 存在、非空、无标记、占位符一致）。
- M10 显式状态机 `untranslated → translated → needs_review → approved`。
- M11 源字典版本号 + 写入乐观并发。
- M12 `sync` 只补缺失不覆盖；`clear` 把一条译文重置为未翻译。
- M13 导出包 + **一次性下载链接**（单次、TTL、令牌只存哈希）。
- M14 用户级与工作区级 locale/时区偏好。
- M15 复数按 locale 的复数规则选词。
- M16 缓存契约（`Content-Language`、`Vary`、回退内容不长期缓存）。

**可扩展：多团队、多区域并行**
- M17 源字典随代码发布（唯一事实来源），目标语言与状态存库。
- M18 机器翻译草稿与人工评审分离（草稿走 ai-model-gateway）。
- M19 术语表/禁用词/品牌词在写入时校验。
- M20 工作区级文案覆盖，只影响本工作区。
- M21 漏译与 fallback 遥测 + 审计。

**成熟：可长期运营**
- M22 伪本地化（`en-XA`）与长度膨胀检测。
- M23 RTL 元数据、日期格式偏好、货币显示名本地化。
- M24 新 locale 灰度开关 + 每 locale 独立缓存键。

## 3. 每项的正确行为

| 项 | 正确行为（可检查的一句话） |
|---|---|
| M1 | 返回源 locale 与每 locale 的 tag/direction/currency/timeZone/fallbackChain；tag 规范化（语言小写、脚本首字母大写、地区大写）。 |
| M2 | 按固定优先级取唯一来源，返回 source ∈ {explicit,user,workspace,cookie,header,default}。 |
| M3 | 取词按 zh-Hant-TW → zh-Hant → zh → 源 逐级回退，返回命中层级。 |
| M4 | 1234567.89 在 en-US 为 1,234,567.89、在 de-DE 为 1.234.567,89；负号用 locale 负号。 |
| M5 | 货币须 ISO 4217 大写三字母；小数位由货币决定（日元 0 位）；无汇率。 |
| M6 | 输入 ISO 8601，输出用请求指定（否则偏好、否则 UTC）的时区。 |
| M7 | 错误统一 {"error":{"code","message"}}；用户可控输入只得到 4xx。 |
| M8 | 四计数自洽（摘要规则 5）；缺失键清单超上限时另给总数。 |
| M9 | 四类校验分别对应 404 / 400 / 422，错误码固定。 |
| M10 | 状态是显式字段；译文与源文本相同仍算 translated。 |
| M11 | sourceRevision 不符 → 409 stale_revision；expectedRevision 不符 → 409 revision_conflict。 |
| M12 | sync 后已有译文逐字不变；clear 后该键回退到源文本并标记 fallback。 |
| M13 | 链接首次取回 200，再次 410 link_used，过期 410 link_expired；库中只有哈希。 |
| M14 | 工作区偏好可读；写需管理员；用户偏好覆盖工作区默认。 |
| M15 | 响应返回选中的 category；目标 locale 缺该形式 → 400 missing_field。 |
| M16 | 依赖 locale 的响应带 Content-Language；随 Accept-Language/Cookie 变化的带 Vary。 |
| M17 | 源字典缺 key → 404 unknown_key；写不存在的 key 同样 404。 |
| M18 | 草稿状态不等于最终译文；发布前须人工确认。 |
| M19 | 命中禁用词或术语不一致 → 422 invalid_translation。 |
| M20 | A 工作区的覆盖不出现在 B 工作区的字典响应里。 |
| M21 | 缺失率与 fallback 率可按 locale 聚合，指标名稳定。 |
| M22 | 伪本地化只用于测试，不进真实用户路径；RTL locale 的 direction 为 rtl。 |
| M23 | 日期格式偏好与货币显示名随 locale 变化。 |
| M24 | 关闭灰度开关后该 locale 协商回落到默认，其他 locale 不受影响。 |

## 4. 容易做错的地方（会出什么事故）

- **只做翻译、不做"回退可见"**：页面一半中文一半英文，漏了哪些 key 无人知晓。
- **回退响应被缓存**：翻译补齐后老用户仍看英文，缓存里存的是回退内容。
- **把 locale 砍成语言码**：`de-DE` 与 `de-AT` 共用德语字典却用错货币与日期顺序；只按完整 tag 取词典又让 `de-AT` 全量丢翻译。
- **不规范化 locale**：`zh-hant-tw`、`EN-us` 取不到，静默变英文。
- **忽略 `Accept-Language` 的 q 值或 q=0**：把用户拒绝的语言选出来；把 `*` 当具体语言匹配。
- **写死 `count === 1`**：法语 0/1 同形、俄语 one/few/many，语法直接错。
- **货币硬编码符号与小数位**：日元显示成 `¥1,234.00`；欧元写成 `$1.234,00`。
- **存本地时间或用固定偏移**：DST 切换后错一小时；跨时区账单错位。
- **用"值相等"判断未翻译**：`Blog`、`iOS` 被永久标未翻译，覆盖率永远上不去。
- **允许译文带 HTML/脚本**：管理员账号一被拿下，全租户 UI 可被改写（存储型 XSS）。
- **译文丢占位符**：`{count}` 渲染成原文或报错，用户看到"你有 0 条消息"。
- **取 `X-Forwarded-For` 最左边**：客户端可伪造 IP，按 IP 的限流与地区策略全失效。
- **写接口不校验 `Origin`**：被诱导的页面可偷偷改语言、写翻译（CSRF）。
- **`sync` 覆盖已有译文 / 并发写没有版本**：人工译文被清成空值，或两人同改一个 key 后写覆盖先写。
- **一次性链接可重复使用或明文入库**：导出包长期泄漏。
- **协商结果不进缓存键**：CDN 把一种语言发给所有人（漏 `Vary`/`Content-Language`）。

## 5. 与其他模块的接口（只列模块名与接口含义）

| 模块 | 接口含义 |
|---|---|
| auth | 识别当前用户（未登录 → `401 unauthenticated`）；用户偏好挂在用户身份上。 |
| workspaces-and-permissions | 提供工作区、成员与角色；判定"管理翻译"权限；提供工作区 id 供隔离校验。 |
| usage-metering-and-budgets | 上报翻译相关计量；越限拒绝并返回 `429`。 |
| async-jobs | 批量同步与大批量机器翻译的任务执行与轮询。 |
| ai-model-gateway | 机器翻译草稿的唯一通道：模型选择、usage、成本记账。 |
| payments-billing | 提供结算币种与金额，本模块只格式化，不换算。 |
| audit-and-data-export | 翻译与偏好的变更事件；导出内容含翻译状态。 |
| prompt-injection-and-guardrails | 外部译者或模型文本进入字典前的安全检查。 |
| llm-observability-and-evals | 译文质量的离线评估输入（不在线拦）。 |
| email-transactional | 邮件按收件人 locale 渲染；字典由本模块提供。 |
| notifications | 翻译评审/分配通知的内容与目标 locale。 |
| rate-limiting | 翻译写入、导出接口的限流（`429 rate_limited`）。 |
| web-security | 输出转义、CSP、`Origin`/CORS 白名单。 |
| file-storage | 导入导出包的文件落盘与下载。 |
| observability | 缺失率、fallback 率、按 locale 的错误率与延迟。 |
| feature-flags | 新 locale 的灰度开关。 |
| analytics | 事件属性带 locale 与 timezone 维度。 |

## 6. 不做什么

- 不做登录、会话、令牌签发（属 auth）。
- 不做 RBAC 判定本身，只消费 workspaces-and-permissions 的结论。
- 不发邮件、不发通知（属 email-transactional / notifications）。
- 不实现限流计数（属 rate-limiting），只正确返回它给出的 `429`。
- 不直接调用模型（属 ai-model-gateway）；本模块只管理草稿状态。
- 不做汇率换算、不改结算金额（属 payments-billing）。
- 不做译文质量打分与在线拦截（属 llm-observability-and-evals / prompt-injection-and-guardrails）。
- 不翻译用户产生的内容，不做通用机器翻译服务。
- 不做对象存储、下载、CDN 刷新的实现（属 file-storage）。
- 不做界面美观与 RTL 视觉 QA。