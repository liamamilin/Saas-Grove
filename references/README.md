# references/

这里放第三方代码的本地副本，**只作参考**，既不是我们的底座，也不是规范。

| 目录 | 来源 | 版本 | 说明 |
|---|---|---|---|
| `next-forge/` | https://github.com/vercel/next-forge （MIT） | commit `f189de7`（2026-05-28） | 自带 git 历史，没有纳入本仓库（见 `.gitignore`）。需要时可以用上面的地址和 commit 重新获取。 |

**为什么只当参考**：next-forge 绑定了十几家托管服务（Clerk、Neon、Stripe、Vercel Blob、Upstash、Arcjet、Sentry、PostHog、Resend、Knock、Liveblocks、BaseHub、Svix），不符合"本地一个 Postgres 就能跑、国内也能部署"的默认技术栈。可以借鉴它的 monorepo 组织方式，但不要照搬它的供应商依赖。
