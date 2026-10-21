# auth 审查（独立 Claude 子代理，只读，2026-10-21）结论：改后可用

## 阻断
B1 账号停用状态码矛盾（§2 表 403 vs Z2/AUTH-17/I6/B4 的 401）：登录时 403，已有会话请求 401，两行写清。
B2 re-auth 与 P7/AUTH-24 冲突：统一 401 reauth_required；无 MFA 用密码，有 MFA 用密码加 code；补 account.disable、email.change、mfa.enroll.start 的 re-auth 用例。
B3 事件 I10/A10 在 HOST 下不可观察：加概念 auth.events.list（仅 TEST_MODE）并配用例，或降为"建议，验收不测"；G5（5xx 收敛）同理删或标建议。
B4 阈值/时长未入契约：限流次数下限（如同账号 10 次内必须 429）、空闲 ≤7 天/绝对 ≤30 天、密码长度 <12 拒绝、challenge TTL 5 分钟；或由宿主在 module-map.json 的 params 声明；补 weak_password、challenge 过期、令牌边界（14 分钟可用/16 分钟失效）用例。
B5 重置页/验证页无概念：加 auth.page.password_reset、auth.page.verify_email；规定 outbox template 取值（auth.verify_email、auth.password_reset、auth.email_change_notice）与 data.link。
B6 密钥轮换建议做不到：令牌摘要用 HMAC-SHA-256 无 salt 加 key_id，新旧 key 并存验证；key_id:salt:hash 仅用于密码哈希；D-13 同步。
B7 缺预占账号处理：对未验证账号再次注册用新密码覆盖并使旧令牌失效；超时（72h）清理；重置成功等同验证邮箱；加用例。

## 应修
S1 重置链接域名只能来自 APP_BASE_URL，不信 Host/X-Forwarded-Host；重置页 Referrer-Policy: no-referrer。
S2 令牌 ≥128 bit CSPRNG。
S3 备份码摘要用 HMAC 或慢哈希，每码 ≥50 bit；enroll 确认前生成的码不生效。
S4 开放重定向：URL 解析后比对 origin，拒绝反斜杠和控制字符；契约补 next 参数规则与用例。
S5 CSRF 归属：定在 auth 或 web-security，契约与用例对应。
S6 限流对不存在账号一视同仁；来源 IP 识别规则；auth 规定限流键，rate-limiting 实现。
S7 MFA 失败按账号累计限流，不随 challenge 重置。
S8 TOTP 参数固定（SHA1、6 位、30 秒、±1 步）；确认码与登录码要隔一个时间步；删 M3 的 challenge 归属 403；enroll 未确认时登录不要求第二步；已启用 MFA 再 enroll 返回 409。
S9 会话轮换：带预置 Cookie 登录必须下发新 Cookie，旧值失效；提权和加 MFA 后轮换。
S10 重置不绕过 MFA；令牌用途绑定；新令牌使旧令牌失效。
S11 邮箱变更不泄露占用（统一 200 并通知被占用方）；旧地址通知；其他会话处理要规定。
S12 记住我：默认会话绝对上限短（24h），remember_me 才 30 天；Cookie 无无限期 Max-Age。
S13 密码哈希给具体参数（argon2id 19MiB/2/1；bcrypt cost ≥12，72 字节限制），最大长度 128，邮箱最大 254；耗时相近、假哈希标"建议，验收不测"。
S14 措辞：令牌"不持久化、不回显、不进日志"；L3 比较排除 request_id；D-03 与契约统一为未验证不给会话。
S15 存储检查写明做法：information_schema 枚举全表（排除 outbox），搜索测试已知明文；同密码两账号哈希不同；AEAD 完整性标人工审。

## 追溯与错位
契约有规则无用例：S4、L8、C5、C7、V1、V2 过期、V4、M3 无效 challenge、M5、M7、Z2 停用 forgot 不发邮件、G3/G4、G12/I9、X1、P3 边界、P6。
并发重放缺：同一重置令牌/验证令牌/备份码并发只成功一次。
计划问题：AUTH-16 属于 workspaces-and-permissions，改为会话列表不含他人会话、吊销他人 id 与不存在 id 响应一致；AUTH-27 与 M6 一致；AUTH-12 拆成两个会话分别测空闲和绝对超时；G1 补 email_verified、user_id 被忽略；AUTH-06 在 http 下需手动处理 Secure Cookie；HOST outbox 无正文，用 data.link。
MODULE 中无契约的条目（B6 强制 MFA、C1–C6 外部身份/魔法链接/passkey/风险/导出/条款）标"L2，验收暂不测"；C5 导出删除与 audit-and-data-export 的边界统一。
nice：错字"小小写"；术语表补 pepper、AEAD、KDF、PKCE、nonce；Cache-Control: no-store；signup/verify.request 按目标邮箱限流；管理员停用路径；会话列表 id 不得是令牌或其摘要；实现顺序、最小数据模型草图、示例；AUTH-02 明确是"已注册"通知。
