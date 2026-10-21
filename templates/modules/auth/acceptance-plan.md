# auth 模块 · 黑盒验收计划

本表是**验收计划**，不是可执行脚本；实现阶段按此写测试。规则编号见 contract.md。

**执行约定**（见 HOST.md）
- 路径取自 `module-map.json` 映射；未声明者记"宿主未声明"。
- 隔离：每条用例用全新唯一邮箱与账号。
- 时效：用 `POST /api/__test__/clock {advanceSeconds}` 推进令牌/会话/限流。
- 取令牌：`GET /api/__test__/outbox?to=<email>` 读 `token`，链接在 `data.link`。
- 计数：`DELETE /api/__test__/rate-limits` 清空，或用独立来源隔离。
- 数值：界限见 contract.md，实际值读 `params`（键见 G8/G11、P3/V2/M6/M8），未声明按界限测。
- Cookie/Origin：自行保存回送 `Set-Cookie`（http 下浏览器不存 `Secure`），属性按响应头断言；写操作默认带同站 `Origin`，负例改跨站。
- 数据库只读：仅 AUTH-54 用只读查询核对存储形态。

|ID|前置（given）|动作（action）|期望（expected）|负例（是=负向用例）|
|---|---|---|---|---|
|AUTH-01|全新邮箱|POST `auth.signup` {email,password,role,user_id,email_verified}|200 `{"status":"accepted"}`；outbox 有 `auth.verify_email`+token；无 `Set-Cookie`；role/user_id/email_verified 忽略|否|
|AUTH-02|已注册邮箱|POST `auth.signup` 同邮箱|与 AUTH-01 码/体逐字节相同；不新增账号；outbox 无"已注册"邮件|是|
|AUTH-03|—|并发 5 次 POST `auth.signup` 同邮箱|只 1 个账号；响应均同 AUTH-01|是|
|AUTH-04|—|POST `auth.signup` 密码 11 位 / 邮箱 255 字符|分别 400 `weak_password`/`invalid_email`；不建号不发信|是|
|AUTH-05|已注册未验证|login → 取 token → `auth.email.verify.confirm` {token,password} → 再 login|未验证登录 403 `email_not_verified`；确认后 200；`auth.session.current` email_verified=true|否|
|AUTH-06|用过的验证令牌|串行再 POST `auth.email.verify.confirm`；并发两次同 token|串行第二次 400 `invalid_token`；并发只有一次成功；状态不变|是|
|AUTH-07|已申请验证|clock 推进 >TTL（≤24h）→ `auth.email.verify.confirm`|400 `token_expired`；email_verified 仍 false|是|
|AUTH-08|已注册未验证|同邮箱再 POST `auth.signup`（新密码 B）|不新增账号；密码不改写：B 登录 401 `invalid_credentials`，原密码有效；旧令牌 400 `invalid_token`|是|
|AUTH-09|已注册未验证|clock 推进 >72h → 再注册同邮箱 → 旧密码登录|注册 200 accepted（视为新账号）；旧密码登录 401 `invalid_credentials`|是|
|AUTH-10|已验证|POST `auth.login`|200+`Set-Cookie`（HttpOnly、Secure、SameSite=Lax、Path=/，无 Domain）；体含 user/session，无令牌明文|否|
|AUTH-11|已验证 + 不存在邮箱|错密码 / 不存在邮箱各 POST `auth.login`|两次 401 `invalid_credentials`，体逐字节相同（忽略 Date、request_id）；无 Cookie、不建会话|是|
|AUTH-12|任一 4xx 场景|取错误体|JSON `{"error":{"code","message"}}`；code 在 §2 内；message 无邮箱原文/密码/令牌/堆栈/SQL/路径|否|
|AUTH-13|独立来源 + 已验证|连续错密码至阈值（params `login_rate_limit`，未声明则 10）|第 N+1 次 429 `rate_limited`+`Retry-After`；清空 rate-limits 后可再试|是|
|AUTH-14|预置伪造 Cookie|带该 Cookie 登录|200 且下发新 Cookie（与预置值、旧令牌都不同）；旧 Cookie → 401 `unauthenticated`；令牌长 ≥22 字符|是|
|AUTH-15|已登录|GET `auth.session.current`；不带 Cookie；改 1 字节 Cookie|首次 200 含 id/email/email_verified/mfa_enabled，无哈希/令牌；后两次 401 `unauthenticated`|是|
|AUTH-16|已登录（remember_me=true）|clock 推进 >空闲上限（≤7 天）|401 `session_expired`（remember_me 不放宽空闲上限）|是|
|AUTH-17|已登录（普通会话）|clock 推进 >绝对上限（≤24 小时）|401 `session_expired`|是|
|AUTH-18|已验证账号|分别以 remember_me=false/true 登录，读 expires_at、Max-Age|默认绝对 ≤24h、remember_me ≤30 天；Max-Age 有限且 ≤30 天|否|
|AUTH-19|已登录|POST `auth.logout` 后重放旧 Cookie|200；旧 Cookie → 401 `unauthenticated`；下发清 Cookie 头|是|
|AUTH-20|同账号两个会话|GET `auth.sessions.list`|200 只含自己的会话；`id` ≠ 令牌或摘要；含 created_at/last_active_at/ip/user_agent/current|否|
|AUTH-21|账号 A、B|A 吊销 B 的 session_id；再吊销不存在 id|两次都 404 `not_found` 且响应一致；B 的会话仍可用|是|
|AUTH-22|同账号三个会话|POST `auth.sessions.revoke_all`|200；除当前会话外全部 401|是|
|AUTH-23|账号 A、B|用 A 的凭据请求 B 的会话/数据|401/403；响应不含 B 的任何数据|是|
|AUTH-24|已登录账号|`auth.account.disable` → 旧 Cookie 请求；再 login/forgot/signup|旧 Cookie → 401 `account_disabled`；login → 403 `account_disabled`；forgot 200 但不投邮件；signup 200 accepted（不泄漏状态）|是|
|AUTH-25|已登录|POST `auth.account.disable` 无凭据 / 错 current_password|401 `reauth_required`；账号未停用（会话仍可用）|是|
|AUTH-26|存在 + 不存在邮箱|分别 POST `auth.password.forgot`|两次 200 `{"status":"accepted"}` 且体相同；不存在的邮箱无邮件无账号|是|
|AUTH-27|独立来源|对同一不存在邮箱连续 `auth.password.forgot` 至阈值（≤5）|429 `rate_limited`（与存在邮箱同样被限）；清空计数后恢复|是|
|AUTH-28|已请求重置|POST `auth.password.forgot` 带 `Host`/`X-Forwarded-Host: evil.example`；读 outbox `data.link`；GET `auth.page.password_reset?token=…`|链接域名 = APP_BASE_URL；页面 200、状态不变；头含 `Referrer-Policy: no-referrer`、`Cache-Control: no-store`|是|
|AUTH-29|已请求重置|POST `auth.password.reset` {token,new_password}|200；旧密码登录 401；新密码登录 200；旧会话全 401 `unauthenticated`；email_verified=true|否|
|AUTH-30|两个已请求重置的账号|读 params `reset_token_ttl_seconds`（未声明则 15 分钟）：一个推进 TTL−1 分钟后 reset，一个 TTL+1 分钟后 reset|前者 200；后者 400 `token_expired`（界限 ≤15 分钟）|否|
|AUTH-31|已申请重置|重放同一 token；用弱密码 reset；并发两次同 token reset|重放 400 `invalid_token`；弱密码 400 `weak_password` 且 token 仍可用；并发只一次成功|是|
|AUTH-32|已申请重置 + 已发验证|重置 token 当验证 token 用，反之亦然|都 400 `invalid_token`；账号状态不变|是|
|AUTH-33|已登录两处会话|POST `auth.password.change`（先错 current_password 再正确）|错 → 401 `reauth_required`、密码不变；正确 → 200、当前 Cookie 轮换（旧 → 401）、另一会话 401、旧密码登录 401|是|
|AUTH-34|已登录|POST `auth.email.change` 不带凭据|401 `reauth_required`；邮箱不变、未投验证邮件|是|
|AUTH-35|已注册未验证|连续 POST `auth.email.verify.request`|每次 200 `{"status":"accepted"}`；超阈值（≤5）429 `rate_limited`|否|
|AUTH-36|账号 A、B|A POST `auth.email.change` 用 B 的邮箱|200 `{"status":"accepted"}`（非 409）；B 邮箱收到 `auth.email_change_notice`；A 邮箱未变、未投信|是|
|AUTH-37|已发起改邮箱|取验证 token → POST `auth.email.verify.confirm` {token,password}|新邮箱生效；旧邮箱收到 `auth.email_change_notice`；当前 Cookie 轮换（旧 → 401）；其余会话 401|否|
|AUTH-38|已登录|POST `auth.mfa.enroll.start`，再调一次|200 含 secret/otpauth_uri/recovery_codes（≥10 个、每个 ≥10 字符、互不相同）；二次不再返回密钥|否|
|AUTH-39|已 enroll.start 未确认|POST `auth.login`；再 POST `auth.mfa.challenge` {任意 challenge_id,备份码}|登录 200、不要第二步（mfa_enabled=false）；无有效 challenge_id → 400 `invalid_token`；备份码未确认即无效|是|
|AUTH-40|已 enroll.start|错码 confirm → 对码 confirm → login → 用同一步的码 challenge|错码 400 `invalid_code`；对码 200、mfa_enabled=true；login → 401 `mfa_required`+challenge_id；同一步再 challenge → 401 `invalid_mfa_code`|是|
|AUTH-41|已登录|POST `auth.mfa.enroll.start` 不带凭据|401 `reauth_required`；不返回 secret|是|
|AUTH-42|MFA 已启用|再 POST `auth.mfa.enroll.start`|409 `conflict`|是|
|AUTH-43|MFA 已启用|POST `auth.login` → POST `auth.mfa.challenge` {challenge_id,code}|首次 401 `mfa_required`+challenge_id、无 Cookie；第二次 200 并下发**新** Cookie|否|
|AUTH-44|MFA 已启用|同一时间步的码连续 challenge 两次；clock +30s 后用新步码|第二次 401 `invalid_mfa_code`；新步码 200|是|
|AUTH-45|MFA 已启用|用一个备份码 challenge 两次；并发用同一备份码|第二次 401 `invalid_mfa_code`；并发只一次成功|是|
|AUTH-46|MFA 已启用|用无效/他人 challenge_id challenge；同 challenge 连错 5 次后用对码|无效、他人 → 400 `invalid_token`；5 次失败后该 challenge 400 `invalid_token`，对码不放行|是|
|AUTH-47|MFA 已启用|错码累计到账号上限（≤10 次），中途重新登录取新 challenge|达限后新的 challenge → 429 `rate_limited`，直到计数窗口过期（≤24 小时）|是|
|AUTH-48|MFA 已启用|POST `auth.mfa.disable` 不带凭据 / 错密码|401 `reauth_required`；mfa_enabled 仍 true；登录仍需第二步|是|
|AUTH-49|MFA 已启用|请求重置并成功改密|改密 200；再登录仍 401 `mfa_required`+challenge_id（MFA 未绕过）|否|
|AUTH-50|两个不同邮箱|对邮箱 A 的 forgot 连打至 429；再请求 B|B 仍 200；清空计数后恢复|是|
|AUTH-51|已登录|POST `auth.password.change` 带 `Origin: https://evil.example`|403 `forbidden`；密码不变|是|
|AUTH-52|—|GET `auth.page.sign_in?next=//evil.example`、`?next=/\evil.example`、含控制字符；再登录看跳转|不跳到站外；仍 200 站内页；登录后 Location 仍在站内|是|
|AUTH-53|多次登录/改密后|GET `auth.events.list`|宿主声明该概念时：返回登录/登出/找回/改密/改邮箱/MFA/停用事件且无明文；未声明记"宿主未声明"|否|
|AUTH-54|账号、会话、令牌、备份码|只读查 information_schema 全表（排除 outbox），逐列搜已知明文|密码/令牌/备份码/TOTP 明文零命中；同密码两账号哈希不同；令牌与备份码为摘要|是|
|AUTH-55|—|GET `auth.page.sign_up`、`auth.page.verify_email`|200 且含表单或提示；状态不变|否|
|AUTH-56|MFA 已启用|login 取 challenge_id → clock 推进 >5 分钟 → challenge；再取新 challenge 并发两次|过期 → 400 `invalid_token`；并发只成功一次|是|
|AUTH-57|已 enroll+confirm MFA|记下 confirm 前后的 Cookie 值，再请求受保护接口|confirm 后下发**新** Cookie；旧 Cookie → 401 `unauthenticated`；新 Cookie 可用|否|
|AUTH-58|已申请重置 + 已发验证|分别再请求一次重置/验证（拿 token2），用 token1|token1 → 400 `invalid_token`；token2 可用|是|
|AUTH-59|全新邮箱|连续 POST `auth.signup` 同邮箱至阈值（≤5）；另一邮箱注册|超阈值 429 `rate_limited`；清空后恢复；另一邮箱仍 200|是|
|AUTH-60|停用且开 MFA|先取 challenge_id，再 `auth.account.disable`，再 challenge|停用后 login → 403 `account_disabled`；challenge → 400 `invalid_token`|是|
|AUTH-61|MFA 已启用|带正确 re-auth POST `auth.mfa.disable` → 再 login|disable 200、mfa_enabled=false；再 login 200（不要第二步）|否|
|AUTH-62|MFA 已启用|用 t±1 步的 TOTP 码各 challenge 一次；再用 t+2 步|t±1 → 200；t+2 → 401 `invalid_mfa_code`|是|
|AUTH-63|独立来源|登录带 `X-Forwarded-For: 203.0.113.7, 198.51.100.9`，读 `auth.sessions.list`|ip = 最右非受信地址（或对端地址），**≠** 203.0.113.7|是|
|AUTH-64|已登录|连续用错 current_password 调 `auth.password.change` 至阈值（≤10）|达阈值后 429 `rate_limited`；清空后恢复|是|
|AUTH-65|攻击者用他人邮箱注册|邮箱所有者点验证邮件 confirm（不带/带错密码）；再 `auth.password.forgot`→`auth.password.reset` 设自己的密码|confirm → 401 `invalid_credentials`、仍未验证；重置后自己的密码可登录、攻击者密码 401|是|
