All four files are revised, internally consistent, and within their hard size limits. Final state: `MODULE.md` 14300/14336 · `contract.md` 16344/16384 · `acceptance-plan.md` 11180/12288 · `decisions.md` 6080/6144 bytes.

## How each REVIEW.md finding was handled

**阻断**
- **B1 停用状态码矛盾** — contract §2 拆成两行：`account_disabled` 401（已有会话请求）/ 403（登录或注册尝试）；Z2、I6、MODULE B4、D-14、AUTH-24 全部对齐。
- **B2 re-auth 冲突** — 新增 G15 统一：未开 MFA 用 `current_password`，已开用 `current_password`+`code`，缺失/错误一律 401 `reauth_required` 且无副作用；P7 改写；补 AUTH-25/34/41/48（account.disable、email.change、mfa.enroll.start、mfa.disable）。
- **B3 事件不可观察** — 新增概念 `auth.events.list`（仅 TEST_MODE，宿主在 module-map.json 声明）+ AUTH-54；未声明时 I10 记"宿主未声明"；原 G5（5xx 收敛）移入 §14"建议，验收不测"。
- **B4 阈值/时长** — 契约给界限：空闲 ≤7 天、绝对 ≤24h（remember_me ≤30 天）、密码 12–128、challenge ≤5 分钟、重置 ≤15 分钟、验证 ≤24 小时、限流按 IP/账号/邮箱独立计数；宿主实际值走 `module-map.json` 的 `params`（HOST §2b）；用例 AUTH-04/13/16/17/18/27/30/46/47/50。
- **B5 页面/邮件** — 新增 `auth.page.password_reset`、`auth.page.verify_email`（R1–R3）；outbox template 固定 `auth.verify_email`/`auth.password_reset`/`auth.email_change_notice`，令牌在 `token`、链接在 `data.link`。
- **B6 密钥轮换** — T2/T3：令牌摘要 = HMAC-SHA-256（不加盐）+ `key_id`，密码哈希 = `key_id:salt:hash`，新旧 key 并存重算；D-13 同步改写。
- **B7 预占账号** — S7（再次注册覆盖密码、旧令牌失效、不新建账号）、S8（72h 清理）、P6（重置成功视为已验证）；AUTH-08/09/29。

**应修** — S1 §0 邮件条 + R3（域名只取 APP_BASE_URL、Referrer-Policy: no-referrer，AUTH-28）｜S2 L8 可观察代理 + §14（CSPRNG 熵不可观察）｜S3 M5/M2（≥50 bit、只存摘要、确认前不生效）｜S4 R2 + AUTH-52（解析后比对 origin）｜S5 R4（CSRF 归 web-security）+ AUTH-51｜S6 G11/G14/P2 + AUTH-27/50｜S7 M8 + AUTH-47｜S8 M1–M4（固定 TOTP 参数、删 403 分支、未确认不需第二步、再 enroll 409）+ AUTH-39/40/42/44/46｜S9 L7/C9 + AUTH-14｜S10 P6/P8 + AUTH-32/49｜S11 V4/V5 + AUTH-36/37｜S12 C8/G7 + AUTH-18（D-06、B2 同步）｜S13 T1/S4（argon2id 19MiB/2/1、bcrypt ≥12、≤128、邮箱 ≤254；耗时相近与假哈希入 §14）｜S14 G6/L3/S3/D-03｜S15 T5 + AUTH-55（information_schema 枚举全表排除 outbox、逐列搜明文、同密码哈希不同）。

**追溯与错位** — 补齐全部规则用例，并在 contract.md 末尾加 §15 规则→用例追溯表（79 条规则 ↔ 55 条用例，脚本校验双向无遗漏）；并发重放补 AUTH-06/31/45；AUTH-16 改为 AUTH-20/21；AUTH-27 与 M6 统一；AUTH-12 拆为 AUTH-16/17；AUTH-01 补 email_verified/user_id 忽略；计划注明 http 下手动回送 Secure Cookie、outbox 无正文用 `data.link`；MODULE 的 C1–C6 与 B6 强制策略标"L2，验收暂不测"，C5 边界归 `audit-and-data-export`。

**nice（便宜的都做了）** — 修"小小写"错字；术语补 pepper/AEAD/KDF/PKCE/nonce；no-store（R3 为 MUST，其余入 §14）；signup/verify.request 按目标邮箱限流；管理员停用路径；会话列表 id 不得为令牌或摘要；MODULE §7 实现顺序 + 数据模型草图 + 登录示例；AUTH-02 明确不发"已注册"通知。

DONE