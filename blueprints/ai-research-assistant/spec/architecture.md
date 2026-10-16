# 架构决策：AI 研究/文档助手

> 这里给出**默认做法**和理由。验收只测外部行为（API 契约、界面上的 `data-testid`），所以实现可以偏离默认做法。但偏离时要在产品仓库的 `DECISIONS.md` 里写明原因。标记为 **必须** 的条目，验收会直接或间接检查。

## 1. 默认技术栈

| 层 | 默认选择 | 理由 |
|---|---|---|
| 语言 | TypeScript（全栈） | 一种语言贯穿前后端，coding agent 最熟 |
| Web 框架 | Next.js（App Router），**一个应用**，用 npm | v0 不拆 monorepo。本地 pnpm 目前不可用（见 `decisions.md`） |
| 数据库 | PostgreSQL 16，ORM 用 Drizzle（Apache-2.0） | 所有数据都放在一个库里：业务数据、队列、账本、向量 |
| 后台作业 | pg-boss（MIT），基于 Postgres 的持久队列 | 不需要 Redis；服务重启后任务还在 |
| 认证 | Better Auth（MIT）放在契约接口之后；如果和契约冲突，可以自己实现会话（argon2id + 随机令牌，服务端只存哈希） | 不依赖托管服务 |
| 模型调用 | Vercel AI SDK（Apache-2.0），走 OpenAI 兼容接口 | DeepSeek 这类模型可以直接接 |
| PDF 解析 | unpdf（MIT，底层是 pdf.js，Apache-2.0） | 纯 JS，不依赖系统库 |
| 向量 | 默认用 `real[]` 列存储，在 SQL 或应用层算余弦相似度；装了 pgvector 后再切换 | 本地 Postgres 没有 pgvector 扩展（见 `decisions.md`） |

**禁止**：依赖除 Postgres 以外的外部服务才能启动；在 `TEST_MODE=1` 下访问 localhost 以外的网络。

## 2. 代码组织（建议）

```
app/                    # Next.js 页面和 /api 路由（路由层只做参数校验和权限检查，然后调用 server/）
server/
  auth/                 # 注册、登录、会话、找回密码、限流
  workspaces/           # 工作区、成员、邀请、权限检查（must: 统一的 requireRole()）
  documents/            # 上传、解析、切块、向量化
  retrieval/            # 检索（must: 查询条件里带 workspace_id 和 document_id 白名单）
  jobs/                 # 研究任务状态机、三个阶段、队列 worker
  model/                # 模型提供方抽象：real / fake
  usage/                # 用量账本、预算预留与结算
  reports/  chat/  audit/  export/
  testing/              # 仅在 TEST_MODE=1 时挂载的测试接口
drizzle/                # 数据库迁移
scripts/acceptance-start.sh
```

worker 可以和 Web 跑在同一个进程里（启动时一起拉起 pg-boss），也可以是单独的进程。只要 `acceptance-start.sh` 把它们都启动起来就行。

## 3. 数据模型（核心表）

`users`、`sessions`（存令牌哈希和过期时间）、`password_reset_tokens`、`login_attempts`、`workspaces`、`memberships`（user, workspace, role）、`invitations`（存令牌哈希、邮箱、角色、过期时间、是否已使用）、`documents`（含 `deleted_at`）、`document_chunks`（workspace_id、document_id、序号、文本、向量）、`research_jobs`（状态、错误信息、进度、创建者）、`job_stages`（job、阶段名、状态、尝试次数、阶段输出）、`reports`、`report_citations`、`messages`、`usage_records`、`budgets`、`audit_events`。

**必须**：每一张业务表都带 `workspace_id`。所有查询都以 `workspace_id` 为条件，不能只按主键查。

## 4. 难点的设计要求

### 4.1 租户隔离（必须）
- 每个 `/api/workspaces/{ws}/…` 请求都先确认当前用户是 `ws` 的成员。不是成员、或者资源不在该工作区，一律返回 **404**。
- 检索的 SQL 必须同时以 `workspace_id = ws` 和 `document_id IN (任务指定的资料)` 为条件，并且排除已删除的资料。

### 4.2 研究任务状态机（必须）
- 阶段固定为三个：`plan` → `analyze` → `synthesize`。每个阶段的输出都持久化在 `job_stages` 里。
- `analyze` 阶段**按顺序**逐个处理子问题（不并行）。这样费用、故障和恢复的行为都是确定的，验收依赖这一点。
- **取消**：先把状态改为 `canceled`；worker 每次调用模型之前都要检查状态；正在进行的调用用 `AbortController` 中止。取消生效后，不能再产生新的用量记录。
- **自动重试**：可重试的模型错误（429、5xx、超时），同一次调用**最多尝试 3 次**（不多不少）。第 2 次尝试前至少等 200 ms，之后每次等待时间加倍。仍然失败，或者遇到不可重试的错误，任务就进入 `failed`，`error.code = "model_error"`。
- **手动重试**：只允许对 `failed` 和 `budget_exceeded` 状态的任务重试。从第一个没有成功的阶段继续，已成功的阶段不重新执行。
- **步骤级幂等**：`analyze` 阶段里，每个子问题的分析结果完成后立即持久化。重试或重启后，只补做没完成的子问题，**同一个子问题不付两次钱**。
- **并发**：同一工作区最多同时运行 `WORKSPACE_MAX_CONCURRENT_JOBS` 个任务（默认 2），多出来的保持 `queued`。
- **重启恢复**：进程重启后，`running` 状态的任务要能继续，并最终进入终态。已成功的阶段、已完成的子步骤都不重做；最多重做重启那一刻正在进行的那一次调用。

### 4.3 预算（必须）
- 每次调用模型前先**预留**这次调用的预估费用：如果"已花 + 已预留 + 本次预估"超过预算，就不调用，任务进入 `budget_exceeded`。调用结束后按实际费用结算，释放预留。
- 不变式：在同一时刻只有一个任务运行的情况下，工作区当月已花费不超过预算。并发时，超出量不得超过"并发数 × 单次调用费用"。
- 预算为 `null` 表示不限。新建的工作区默认不限（见 `decisions.md` T10）。

### 4.4 引用（必须）
- 系统把检索到的文本块编号后交给模型，引用由系统根据编号回填。`quote` 取自文本块原文，是该资料提取文本中**逐字存在**的子串。
- 正文里每一个 `[n]`，在 `citations` 中都要有一条 `marker = n` 的记录。

## 5. 模型提供方与假模型

环境变量 `MODEL_PROVIDER=real|fake`。验收时一律用 `fake`。假模型**必须**按下面的方式工作，验收测试依赖这些行为：

| 行为 | 规定 |
|---|---|
| plan 阶段 | 1 次聊天调用，固定产出 **3 个**子问题 |
| analyze 阶段 | 每个子问题 1 次聊天调用，按顺序执行，共 **3 次** |
| synthesize 阶段 | **1 次**聊天调用，输出带 `[n]` 引用的 Markdown，至少包含 1 处引用 |
| 一个任务合计 | 无故障时正好 **5 次**聊天调用 |
| 追问 | 每条消息 **1 次**聊天调用，以**至少 2 段**增量流式返回，相邻两段之间间隔 `latencyMs`；回答中至少包含 1 处引用。服务端必须每产生一段就立刻发出，不能攒齐了再发 |
| 费用 | 每次成功的聊天调用费用为 `FAKE_CHAT_CALL_COST_USD`（默认 `0.01`）；失败的调用记录为 `status: "error"`、`costUsd: 0` |
| 向量化 | 确定性的本地算法（例如把词哈希到 256 维）；可以记为 `kind: "embedding"`，`costUsd: 0` |
| 延迟 | 每次聊天调用前等待 `latencyMs`（默认 20 ms），可以通过测试接口调整 |
| 故障注入 | 通过测试接口设置，按阶段计次：`transient` 是可重试错误，该阶段接下来的 `times` 次调用尝试失败，之后恢复；`permanent` 是不可重试错误，该阶段的每次调用都失败，直到重置 |

每条 `kind: "chat"` 的用量记录都必须带 `stage`，取值为 `plan` / `analyze` / `synthesize` / `chat`，还要带 `jobId`（任务里的调用）或 `reportId`（追问的调用）。

### 5.1 真实模式（`MODEL_PROVIDER=real`）

真实模式只在人手动试用时使用；验收永远是 `fake`。配置全部来自环境变量，产品的 `README.md` 和 `.env.example` 要列出这些变量：

| 变量 | 含义 |
|---|---|
| `MODEL_BASE_URL` | OpenAI 兼容接口地址 |
| `MODEL_API_KEY` | 密钥。**不得**写进代码、日志、错误信息或提交到仓库 |
| `MODEL_NAME` | 默认 `deepseek-v4.1-flash` |
| `MODEL_INPUT_USD_PER_MTOK` / `MODEL_OUTPUT_USD_PER_MTOK` | 每百万 token 的单价，用于计费和预算；没有配置时启动失败，而不是按 0 计费 |
| `EMBEDDING_PROVIDER` | 默认 `local`：与假模型相同的本地确定性算法，不联网。以后有了向量接口，再改成 `openai-compatible`，并设置 `EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL` |

## 6. 测试模式接口（仅 `TEST_MODE=1`）

| 接口 | 作用 |
|---|---|
| `GET /api/__test__/outbox?to=<email>` | 查看发给某个邮箱的邮件：`{ messages: [{ to, template: "invitation" \| "password_reset", token, createdAt }] }` |
| `PUT /api/__test__/fake-model` | 请求体 `{ latencyMs?, faults?: [{ stage, mode: "transient" \| "permanent", times? }] }`，返回 204 |
| `DELETE /api/__test__/fake-model` | 把延迟和全部故障恢复为默认值，返回 204（验收会在每条测试前后调用它） |

非测试模式下，这些路由**必须**返回 404。

## 7. 启动约定（必须）

产品根目录提供可执行的 `scripts/acceptance-start.sh`。验收工具会注入下列环境变量来启动它：

| 变量 | 含义 |
|---|---|
| `PORT` | 监听端口，绑定 `127.0.0.1` |
| `DATABASE_URL` | 一个**全新的空库**。脚本负责执行迁移 |
| `TEST_MODE=1`、`MODEL_PROVIDER=fake` | 测试模式 |
| `APP_SECRET` | 随机密钥 |
| `APP_BASE_URL` | `http://127.0.0.1:$PORT` |

要求：
- 当 `GET /api/health` 返回 200、且 worker 已经开始消费队列时，才算启动完成。启动时限为 300 秒。
- 收到 SIGTERM 时退出。
- 依赖安装和构建要在验收之前完成。脚本可以包含构建步骤，但不能联网安装依赖。
- 验收会在测试中途重启应用，并保留数据库，用来检验重启恢复。

## 8. 界面约定

页面路径由实现决定，只有两个固定：`/signup` 和 `/login`。验收测试通过下面这些 `data-testid` 操作界面：

| 位置 | `data-testid` |
|---|---|
| 注册页 | `signup-name`、`signup-email`、`signup-password`、`signup-submit` |
| 登录页 | `login-email`、`login-password`、`login-submit` |
| 没有工作区时的引导页 | `workspace-create-name`、`workspace-create-submit` |
| 工作区首页 | `workspace-name`（显示名称）、`nav-research`、`nav-usage`、`report-link`（每份报告一个链接，指向报告页） |
| 发起研究 | `document-text-title`、`document-text-body`、`document-text-submit`（粘贴文本作为资料）；`document-item`（每份资料一个，文本中包含它的状态，例如 `ready`）；`research-question`、`research-submit` |
| 任务页 | `job-status`（文本为状态值）、`job-progress`；成功后直接显示 `report-content`，或者提供 `open-report` 链接跳到报告页 |
| 报告页 | `report-content`、`chat-input`、`chat-submit`、`chat-message-assistant` |
| 用量页 | `usage-spent` |

发起研究时，界面默认选中当前工作区里所有 `ready` 状态的资料。
