# rate-limiting 验收计划（黑盒，23 例）

运行、启动、路径映射、夹具、时钟与参数规则见 `HOST.md`。本表只引用概念名，不猜路径。

**通用设置**

- 每条用例用全新账号与唯一邮箱（HOST §3），不共享状态；需要"同 IP"时显式复用同一 XFF 值。
- 来源标识：`X-Forwarded-For: <ip>` 单值头；`TEST_MODE` 下最右值即客户端 IP（契约 R1）。
- 数值全部读 `params`；未声明才用契约 §0.2 缺省值。下文记号：`L_a/W_a`=anon，`L_r`=account_read，`L_w`=account_write，`L_c/c`=costly，`L_t/W_t`=auth，`L_s`=signup，`L_f/W_f`=ip_safety。
- 每条用例开始前 `DELETE /api/__test__/rate-limits`，或使用未用过的 IP；推进时间只用 `POST /api/__test__/clock`。
- 会话一律通过 `auth.signup`/`auth.login` 获取；若 auth 要求邮箱验证，先从 `outbox` 取 `token` 完成验证。不直接读库写库（RL-20 的只读校验除外）。

| id | given | action | expected | negative |
|---|---|---|---|---|
| RL-01 | 新 IP `.10`，计数已清空 | 1 次 `GET ratelimit.probe.anon` | 200 `{"ok":true}`；`RateLimit-Limit=L_a`、`Remaining=L_a-1`、`Reset∈[0,W_a]` 均为整数；`Cache-Control: no-store` | no |
| RL-02 | 新 IP `.11` | 顺序发 `L_a+1` 次 probe.anon | 前 `L_a` 次全 200，`Remaining` 依次 `L_a-1 … 0`；第 `L_a+1` 次 429，`policy=anon` | no |
| RL-03 | 承接 RL-02 的 429 | 检查该响应 | 429；`error.code=rate_limited`；`policy=anon`；`Retry-After` 为整数且 `1≤值≤W_a`，等于 body 的 `retryAfterSeconds` 与 `resetSeconds`；`requestId` 非空；含三个 `RateLimit-*` 头与 `no-store`；正文不含 `198.51.100.11`、不含邮箱、无堆栈 | no |
| RL-04 | 承接 RL-03，记 `R=retryAfterSeconds` | `clock advance R+1` 后 1 次 probe.anon | 200；`Remaining=0`（只释放了一个 cost 单位，不是整窗清零）；再发 1 次即 429 | no |
| RL-05 | 新 IP `.12`，先耗尽 | 再连发 20 次 429，记录首个与末个 `Retry-After`；`advance(首个值+1)` 后请求 | 20 次全 429；末个 `Retry-After` ≤ 首个；advance 后 200、`Remaining=0`（拒绝未延长窗口） | no |
| RL-06 | 新 IP `.13`，先耗尽 | `advance(W_a-2)` 后请求；再 `advance(4)` 后请求 | 第一次仍 429（未提前清零）；第二次 200 且 `Remaining=L_a-1`（窗口已过） | no |
| RL-07 | 新 IP 桶未用；右端固定 `203.0.113.20` | 发 `L_a+1` 次，XFF 依次 `192.0.2.<i>, 203.0.113.20`（`i` 每次不同） | 第 `L_a+1` 次 429：最左跳变化不产生新桶，只认最右 | yes |
| RL-08 | 用 `203.0.113.21` 耗尽 | 1 次请求，XFF `::ffff:203.0.113.21` | 429（IPv4-mapped 与 IPv4 同桶） | yes |
| RL-09 | 账号 A（IP `.31`）、B（IP `.32`），各自会话 | A 发 `L_w+1` 次 probe.write；B 发 1 次 probe.write；A 发 1 次 probe.read | A 的第 `L_w+1` 次 429；B 的 write 200；A 的 read 200 | no |
| RL-10 | 账号 C（IP `.33`）已耗尽 write | 用 `auth.login` 取得**新会话**后再发 probe.write | 仍 429，`policy` 为 `account_write` 或 `ip_safety`（键是 account id，不是会话） | yes |
| RL-11 | 账号 D（IP `.34`）已耗尽 write | 同会话发 1 次 probe.read；再发 1 次 probe.anon（同 IP） | 均 200；read 的 `Limit=L_r`、`Remaining=L_r-1`（读有独立配额）；probe.anon 的 `Limit=L_a`（已认证请求不消耗 `anon`） | no |
| RL-12 | 账号 E（IP `.35`），`n=floor(L_c/c)` | 发 `n+1` 次 probe.costly | 前 `n` 次 200，`Remaining` 每次减 `c`；第 `n+1` 次 429，`policy=costly`，`remaining=L_c-n*c`（可 >0），`Remaining` 头同值 | no |
| RL-13 | 新 IP `.36` | 用 `User@Example.com` 发 `L_t` 次 probe.auth，再用 `" user@example.com "` 发 1 次 | 后者 429（大小写/空白归一），`policy` 与前次 429 相同 | yes |
| RL-14 | 三个标识符：不存在；已注册未验证；已注册已验证（signup 后从 outbox 取 `token` 走 auth 验证）；IP `.41/.42/.43` 各自独立 | 每个 IP 对各自标识符发 `L_t+1` 次 probe.auth | 三处 429 的 status、`code`、`policy`、`limit` 相同，`retryAfterSeconds` 相差 ≤1s（`requestId` 除外）；若映射了 `auth.account.disable`，禁用态加入且仍一致 | yes |
| RL-15 | 账号 F（IP `.45`）已耗尽 write；用例内另建账号 B 并取其 id | 发 probe.write，附带 `X-Account-Id: <B>`、`X-User-Id: <B>`，并更换 XFF 值 | 仍 429（身份只来自会话）；响应不含 B 的任何标识 | yes |
| RL-16 | `n=ceil((L_f+1)/3)` 个新账号（各自从不同 IP 注册以避开 signup 桶），随后统一从 IP `.50` 发请求；每账号 ≤3 次（低于 `L_w`） | 交替发 probe.write 直到累计 `L_f+1` 次；再由其中一个账号从 IP `.51` 发 1 次 | 累计超过 `L_f` 后 429 且 `policy=ip_safety`；该账号自身额度未耗尽；换 IP 后 200 | yes |
| RL-17 | 账号 G（IP `.60`），会话有效 | 并发发 `L_w+10` 次 probe.write | 恰好 `L_w` 个 200、10 个 429、0 个 5xx；200 的 `Remaining` 互不相同且非负 | yes |
| RL-18 | IP `.70` 已耗尽 | `DELETE ratelimit.clear`；再 1 次 probe.anon | 先 204；再 200 且 `Remaining=L_a-1` | no |
| RL-19 | 重启一次应用且不设 `TEST_MODE`（HOST §1） | `DELETE /api/__test__/rate-limits`；`GET /api/__test__/outbox?to=x@y.z` | 两者均 404；`GET /api/health` 仍 200 | yes |
| RL-20 | 用 `probe+<rand>@example.test` 对 probe.auth 从 IP `198.51.100.80` 触发计数；`params.counterTable` 已声明 | 只读 SQL 查该表近 2 分钟的记录 | 无列值等于该邮箱或 `198.51.100.80`，也无 `@`；键列为 ≥16 位的摘要形态；若存在过期列，其 TTL ≤ W+300s | no |
| RL-21 | 新 IP `.90`，不带 Cookie | 连发 `L_a` 次 `GET ratelimit.probe.read`，再发 1 次 | 前 `L_a` 次 401 且带三个 `RateLimit-*` 头；第 `L_a+1` 次 429（限流先于认证） | yes |
| RL-22 | 新 IP `.95` | `auth.signup` 用 `L_s+1` 个不同邮箱；再用另一标识符 `auth.login` | signup 第 `L_s+1` 次 429 且 `policy=signup`（若为 anon 则记参数违约，见契约 §0.2）；login 不被该桶拒绝（200 或 401，非 429） | no |
| RL-23 | 账号 H（IP `.96`），costly 已耗尽（`c>1`，记拒绝时 `remaining=r`） | 记 `R=retryAfterSeconds`；`advance(R+1)` 后发 1 次 probe.costly | 200；`Remaining=r`（只释放一个 cost 单位）；再发 1 次即 429 | no |

**判定口径**

- 任一 MUST 规则没有对应用例，或有规则没有任何通过的用例，均判模块未通过。
- `宿主未声明` 的概念（未映射）单独统计，不计失败；RL-20 在 `counterTable` 未声明时按此处理。
- 并发用例（RL-17）若客户端无法真并发，改用一个进程内 20 路并发；仍未并发则记未测，不得记通过。
- 所有阈值来自 `params`；脚本不得内联 `30/60/20` 等缺省值，只在 params 缺失时读取契约缺省表。
