S1 独立审查的意见（已由人筛选）。请逐条处理：

1. 会话"滑动续期"只延长了数据库里的过期时间，没有刷新 Cookie（`server/auth/session.ts` 的 `authenticate` / `authenticateFromCookies`）。续期时要同时刷新响应里的 Cookie，页面请求也要参与续期，否则活跃用户到第 30 天仍会被登出，服务端还会留下不断延长的会话。

2. 非测试模式下，邀请令牌和重置令牌会以明文写进日志（`server/mail/sender.ts`）。日志里只保留令牌末尾几位，或者只记录"已发送给谁"；令牌本身不能落进日志。

3. 登出接口没有像其他写接口那样拒绝表单类型的请求（`app/api/auth/logout/route.ts`）。注意：登出请求本来就**没有请求体**，验收测试也是这样调用的，所以不要强制要求 `application/json`。正确的做法是：请求带了表单类型（`application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain`）时返回 415，没有请求体时照常登出。

4. 给已经是成员的用户发邀请时，接受邀请会静默作废令牌，而且不会改变角色（`server/workspaces/service.ts` 的 `ON CONFLICT ... DO UPDATE SET role = memberships.role`）。改成：邀请已是成员的邮箱时，直接返回 409 `conflict`，不发邀请；改角色请用修改角色的接口。

暂不处理：按邮箱限流可能被人恶意刷到锁号。这对应你在 QUESTIONS.md 里提的 Q3，需要先决定反向代理怎么传递客户端 IP，留到部署前再定。
