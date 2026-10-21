# rate-limiting 黑盒契约

运行方式、路径映射、测试支撑、时钟与参数声明一律遵循 `HOST.md`。下面所有路径都是**概念名**，宿主在 `module-map.json` 里映射；未映射的概念记为"宿主未声明"。数值一律从 `params` 读取，未声明时用 §0.2 的缺省值。

## 0. 概念与参数

### 0.1 概念（探针）
探针必须走**与生产同类请求完全相同**的限流路径（同一个中间层、同一套策略与计数器）；旁路探针视为未实现。

| 概念 | 方法 | 认证 | 语义 |
|---|---|---|---|
| `ratelimit.probe.anon` | GET | 无 | 匿名可读，代表 `anon` 策略 |
| `ratelimit.probe.read` | GET | 需会话 | 已认证读，代表 `account_read` |
| `ratelimit.probe.write` | POST | 需会话 | 已认证写，代表 `account_write` |
| `ratelimit.probe.costly` | POST | 需会话 | 已认证昂贵操作，代表 `costly`，单次 cost 见 params |
| `ratelimit.probe.auth` | POST | 无 | 凭据校验类，代表 `auth`；任何输入都返回 401 `{"error":{"code":"invalid_credentials"}}`，正文恒定 |
| `ratelimit.clear` | DELETE | 无 | 仅 `TEST_MODE`：清空全部计数 |

放行时探针返回 `200`，JSON 正文 `{"ok":true}`（可附加字段）；唯一例外是 `probe.auth`，它放行时仍返回 401（正文恒定），只用于观察 `auth` 桶。探针的业务副作用必须为零。

需会话的探针在缺会话/会话无效时返回 401（这是认证失败，不是限流拒绝），仍按 R5 带头。`signup` 策略在黑盒上通过 `auth.signup` 观察；未映射 `auth.signup` 时该策略记"宿主未声明"。

### 0.2 参数（`module-map.json` 的 `params`）

| key | 缺省 | 允许范围 |
|---|---|---|
| `ratelimit.policy.anon` | `{limit:30, windowSeconds:60}` | limit 5–300，W 10–3600 |
| `ratelimit.policy.account_read` | `{limit:120, windowSeconds:60}` | limit 20–2000 |
| `ratelimit.policy.account_write` | `{limit:20, windowSeconds:60}` | limit 5–60，W 10–3600 |
| `ratelimit.policy.costly` | `{limit:60, windowSeconds:60, cost:5}` | cost 1–20，limit 20–300，且 ≥ 5×cost |
| `ratelimit.policy.auth` | `{limit:5, windowSeconds:900}` | limit 3–20，W 300–3600 |
| `ratelimit.policy.signup` | `{limit:5, windowSeconds:3600}` | limit 3–20 |
| `ratelimit.policy.ip_safety` | `{limit:120, windowSeconds:60}` | ≥ 3×`account_write.limit`，≤ 200 |
| `ratelimit.trustedProxyHops` | `1` | 0–5（受信代理层数，含直连对端；0 = 前面没有受信代理） |
| `ratelimit.counterTable` | 未声明 | 可选，只读校验用 |

表中未写 W 的策略，W ∈ 10–3600 秒（`auth`/`signup` 为 300–3600）。除 `costly` 外，各策略单次 cost = 1。

约束：`anon` 的等效每小时额度必须 ≥ 2×`auth` 与 `signup` 的等效额度（按 `limit/windowSeconds` 折算），否则更严的桶永远轮不到先拒，属宿主参数违约。

建议（不判失败）：`ip_safety.limit ≥ account_read.limit + account_write.limit`，否则读类实际由 IP 上限决定。

## 1. 客户端身份与键（R1–R3）

**R1 取 IP：** 客户端 IP = `X-Forwarded-For` 中**从右往左第一个不属于受信代理集合的地址**（受信集合由 `trustedProxyHops` 或受信 CIDR 声明；右端条目本身就是受信地址时继续向左）；**绝不取最左**。无 XFF 时用直连对端。`trustedProxyHops=0` 的生产环境必须忽略 XFF、只用直连对端。`TEST_MODE` 例外：直接取 XFF 最右值，验收以此声明来源。

**R2 IP 归一：** 同一地址的不同写法必须落同一桶：IPv4-mapped IPv6（`::ffff:203.0.113.7`）与 IPv4 等价；IPv6 忽略大小写与零压缩差异；XFF 值先 trim。非法值按不可解析处理，归入固定桶（不得报错放行）。

**R3 标识符归一：** `auth`/`signup` 的 identifier = trim + 小写化后的邮箱（或用户名）。大小写与首尾空白变体共享同一桶；`+tag` 视为不同标识符。

## 2. 判定顺序（R4）

**R4：** 固定顺序 `解析 IP → 选策略 → 限流判定 → 认证/授权 → 业务`。因此匿名维度耗尽后，本应 401/403 的请求也返回 429。例外（不受限流）：`GET /api/health`、`ratelimit.clear`。

## 3. 放行（R5–R6）

**R5：** 所有经过限流层的响应（200、随后被 401/403 拒绝的、以及 429）都必须带 `RateLimit-Limit`、`RateLimit-Remaining`、`RateLimit-Reset`（整数秒，`0 ≤ Reset ≤ W`）与 `Cache-Control: no-store`。三个头缺失即不合规；响应体是否 200 由后续认证/业务决定。

**R6：** `Limit` = 每 W 秒的 **cost 配额**（不是"剩余请求数"）。`Remaining` 初值 = Limit，每次放行递减该次 cost，永不为负；同 key 连续请求递减量必须等于 cost。拒绝时可为 `0 ≤ remaining < cost`。

**`Reset` 语义（同属 R6）：** `RateLimit-Reset` = 再过多少秒该键至少能再放行一个 cost 单位（整数，向上取整），`0 ≤ Reset ≤ W`；429 时与 `Retry-After`、`retryAfterSeconds` 同值。

## 4. 拒绝（R7–R12）

**R7：** 超配额 → `429`，错误码唯一：`rate_limited`。限流拒绝不得使用 403、503 或 200。

**R8 响应形状：**
```
HTTP/1.1 429
Retry-After: <int>
RateLimit-Limit: <int>
RateLimit-Remaining: <int>
RateLimit-Reset: <int>
Cache-Control: no-store
Content-Type: application/json

{"error":{"code":"rate_limited","policy":"<anon|account_read|account_write|costly|auth|signup|ip_safety>",
          "retryAfterSeconds":<int>,"limit":<int>,"remaining":<int>,
          "resetSeconds":<int>,"requestId":"<非空>"}}
```
允许附加字段；**禁止**出现原始邮箱/用户名、完整或部分 IP、其他账号标识、堆栈、内部表名。`policy` 必须指出是哪一层拒绝。

**R9 `Retry-After`：** 整数秒，`1 ≤ 值 ≤ W`；`Retry-After == retryAfterSeconds == resetSeconds`。禁止 HTTP-date、毫秒、浮点。语义 = 到该时刻同一 key 至少可再放行一个 cost 单位。

**R10 恢复：** 从任一 429 起把时钟前进 `retryAfterSeconds + 1` 秒，同一 key 的下一次同类请求不得再是 429（即已放行；`probe.auth` 放行后仍返回 401）。

**R11 拒绝不计数：** 被拒绝的请求不改变计数、不延长窗口、不改变 `Retry-After`。连续 K 次 429 后 R10 仍成立；K 次期间的 `Retry-After` 不得增大。

**R12 枚举安全：** 在 identifier 不存在、已注册未验证、已注册已验证、已禁用四种状态下，同一尝试次数的 429 必须一致：status、`error.code`、`policy`、`limit` 相同，`retryAfterSeconds` 相差 ≤1 秒（`requestId` 除外）。计数照常累加，不因状态短路。

## 5. 维度与隔离（R13–R19）

**R13：** 无会话请求受 `anon`（按 IP）约束，`auth`/`signup` 另加 identifier 维度（R19），均不消耗任何账号额度。

**R14：** 有会话请求同时受 `account_<class>`（按 account id）与 `ip_safety`（按 IP）约束，两者都通过才放行；任一拒绝即 429，`policy` 指明该层。

**R15：** 账号 A 的耗尽不影响账号 B（B 使用不同 IP 时 B 必须 200）。

**R16：** 各策略独立计数：`account_write` 耗尽不影响 `account_read`；`auth` 与 `signup` 互不影响；已认证请求不消耗 `anon`。

**R17：** 计数键是 account id，不是会话/令牌：重新登录、换设备、换 Cookie 后的新请求仍看到同一剩余额度。（会话失效导致的 401 不是限流拒绝，与额度无关。）

**R18：** 同一 IP 上多个账号的合计请求超过 `ip_safety.limit` 后，后续请求 429，`policy: "ip_safety"`；此时换账号仍被拒，换 IP 则放行。

**R19：** `ratelimit.probe.auth` 同时受 `anon`（IP）与 `auth`（归一化 identifier）约束；两者都计数，任一耗尽即 429。

## 6. 正确性（R20–R23）

**R20 窗口语义：** 任意长度 ≤ W 的区间内，同一 key 被放行的 cost 总和 ≤ Limit（等价滑动窗口；固定窗口在边界可放行 2×Limit，不合规）。

**R21 原子性：** 并发下 R20 仍成立，不得因读-改-写竞态超额放行；并发请求不得产生 5xx。

**R22 计数存活：** 窗口未结束时计数不得失效或被清零（进程重启/部署除外）；窗口结束后可保留，但不超过 W + 300s（R24）。

**R23 清空：** `DELETE ratelimit.clear` → `204`，清空全部计数；随后同一 key 立即恢复满额。

## 7. 存储与测试面（R24–R25）

**R24 哈希存储：** 计数记录中的 identifier 与 IP 只以不可逆摘要（如带密钥的 hash）出现，不存明文；摘要记录的存活时间 ≤ W + 300s。`params.counterTable` 声明时，只读 SQL 查询该表必须无法检索到测试用的明文邮箱或完整 IP。

**R25 测试面：** `ratelimit.clear` 及一切 `__test__` 路径在非 `TEST_MODE` 下返回 `404`；`TEST_MODE` 下 `ratelimit.clear` 不要求认证。

## 8. 不变量汇总（可外部断言）

1. `0 ≤ Remaining ≤ Limit`；`0 ≤ Reset ≤ W`；`Retry-After ≥ 1`。
2. 同一 key 任意 ≤ W 区间内放行 cost 总和 ≤ Limit。
3. 一次拒绝的代价为零：不计数、不延长窗口、不改变恢复时刻。
4. 429 正文不含 PII、不含账号存在性线索、不含其他 key 数据。
5. 键 = (策略, 服务端解析的身份 | 归一化 IP)，绝不来自请求头里的账号标识。
6. 计数记录只含摘要，且随窗口过期。

## 9. 建议，验收不测

- 计数存储不可用时：`auth`/`account_write` 类 fail-closed，`account_read`/`anon` 类可 fail-open；降级必须在响应头标注（如 `RateLimit-Policy: degraded`）。此时 503 表示依赖故障，不是限流拒绝，正文不得含 `rate_limited`。无故障注入钩子，故不列入 MUST。
- 文本日志中不出现明文 IP/邮箱；429 事件的埋点与告警。
- 多实例下计数一致性（单实例黑盒无法证伪）。
- 拒绝路径的耗时与放行路径同阶（时序侧信道）。
- `Retry-After` 的客户端抖动建议（±20%），属客户端责任。

## 10. 追溯表（规则 → 用例）

| 规则 | 用例 |
|---|---|
| R1 | RL-07 |
| R2 | RL-08 |
| R3 | RL-13 |
| R4 | RL-21 |
| R5 | RL-01 |
| R6 | RL-01, RL-03, RL-12 |
| R7 | RL-02 |
| R8 | RL-03 |
| R9 | RL-03, RL-23 |
| R10 | RL-04, RL-23 |
| R11 | RL-05 |
| R12 | RL-14 |
| R13 | RL-21 |
| R14 | RL-09, RL-11, RL-15 |
| R15 | RL-09 |
| R16 | RL-11, RL-22 |
| R17 | RL-10, RL-15 |
| R18 | RL-16 |
| R19 | RL-13 |
| R20 | RL-02, RL-12, RL-17 |
| R21 | RL-17 |
| R22 | RL-06 |
| R23 | RL-18 |
| R24 | RL-20 |
| R25 | RL-19 |
