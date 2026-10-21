All four files are revised, verified, and within budget. Final state:

| 文件 | 字节 | 上限(15/17/13/7 KB) | 余量 |
|---|---|---|---|
| MODULE.md | 14,235 | 15,360 | 1,125 |
| contract.md | 16,161 | 17,408 | 1,247 |
| acceptance-plan.md | 12,280 | 13,312 | 1,032 |
| decisions.md | 6,114 | 7,168 | 1,054 |

## 每条审查发现的处理方式

1. **G14 取最左 XFF 错** → 契约 G11（原 G14）：直连取对端地址；有 XFF 时**从右向左跳过受信代理取第一个非受信地址**（最左可伪造，绝不采用）；受信代理名单由 `params` 声明，否则忽略该头。新增 **AUTH-63**（登录带 `203.0.113.7, 198.51.100.9` → `sessions.list.ip` 必须是右值、≠ 左伪造值）。
2. **删"轮换后重算存量摘要"** → 契约 T3（新 key 发新令牌、旧 key **只校验存量摘要不重算**、留到存量令牌自然过期；密码哈希不用 `key_id:salt:hash`，改用**标准 PHC 串**见 T1）。MODULE B10、decisions D-12/D-13 同步改写（D-13 中"重算"只作为被否方案列出）。
3. **R4 缺失 Origin 一律 403** → R4 改为"**携带跨站 origin** 才 403、**缺失不因此拒绝**、同站放行"；§2 的 403/404 总则补 **C6 例外**（他人资源 ID 一律 404、不泄漏存在性）；计划前言规定写操作默认带同站 `Origin`，负例才改跨站。
4. **停用账号注册 403 泄漏** → §2 的 403 行改为"`account_disabled`（**登录**；注册仍统一 200，见 S3）"；S3/Z2 明确含停用账号在内响应一致；MODULE B4、decisions D-04 同步；AUTH-24 断言停用账号注册仍 200 accepted。
5. **数值与用例** → G8 给出**数值下限**（登录 ≤10、找回/验证申请/注册按邮箱 ≤5、re-auth ≤10，params 键 `<动作>_rate_limit`）；P3/V2/M6/M8 点名参数键；**AUTH-30 改读 params**（TTL−1→200、TTL+1→`token_expired`）；AUTH-13/27/35/59/64 用声明阈值；**AUTH-16 用 remember_me 会话**测空闲超时（remember_me 只放宽绝对上限）；challenge 过期拆成 **AUTH-56**（推进时钟+并发），AUTH-46 只留无效/他人 ID 与 5 次失败作废。
6. **AUTH-39/备份码熵/M8** → AUTH-39 重写（未确认时无 `challenge_id`，登录不要第二步，`auth.mfa.challenge`→400 `invalid_token`，备份码不可用）；备份码统一为"**≥10 个、每个长 ≥10 字符（熵 ≥50 bit）**"（M5/MODULE B6/D-09/AUTH-38）；M8 删掉"直到成功 MFA"，改为"直到计数窗口过期（≤24 小时）"（AUTH-47 同步）。
7. **补用例** → 新增 11 条：AUTH-55 sign_up+verify_email 页面、56 challenge 过期/并发、57 启用 MFA 后轮换、58 重发使旧令牌失效、59 注册按邮箱限流、60 停用后 challenge 400、61 关闭 MFA 成功路径、62 TOTP ±1 步，另加 63/64/65（源 IP、re-auth 限流、预占劫持）。用例号连续 01–65。
8. **AUTH-28/08/52** → AUTH-28 把恶意 `Host`/`X-Forwarded-Host` 放到**触发邮件的 forgot POST** 上；AUTH-08 按新 S7/S6 重写（密码不被改写、新密码不生效、原密码有效、未验证登录 403）；AUTH-52 增加"登录后 Location 仍在站内"断言。
9. **追溯表/编号缺口/D-17 错字** → §14 追溯表重建并机器校验：76 条规则每条 ≥1 用例、65 条用例每条可追溯、无重复规则行；缺口补齐（G1–G12 连续，旧 G2/G5 取消、旧 G14→G11、旧 G15→G12；I1–I6 连续，旧 I4 合并），修正了源 IP、并发、C9 轮换、P7、R2、re-auth 的错配；D-17 "只用品验证"→"只用验证码"。
10. **预占劫持/re-auth 限流/字节余量** → 新 **S9 验证须证明密码**（`token`+当前密码或有效会话，否则 401 `invalid_credentials` 且令牌不消费）+ S7 不再覆盖密码（认领只能走 forgot→reset），受害者点验证邮件不再替攻击者激活账号；MODULE A8、§4 表新增"验证不证明密码"行、D-03 记录代价；**G12 要求 re-auth 尝试限流**（新增 AUTH-64）；四文件均留 ≥1 KB。

**另按 HOST.md 校准**：outbox 模板名 `auth.verify_email`/`auth.password_reset`/`auth.email_change_notice`（token 在 `token`、链接在 `data.link`）、clock/rate-limits 只读测试支撑、只读库检查仅 AUTH-54；不可观察项全部归入 §13「建议，验收不测」；**取舍说明**：为腾出字节给审查要求的用例，删除了 L2 外部身份规则 X1 及其用例（MODULE §3.7 本就标 L2"不测"），保留 `auth.events.list`（I6 事件项）；contract §14 与计划表改为紧凑管道格式以满足硬上限。

DONE