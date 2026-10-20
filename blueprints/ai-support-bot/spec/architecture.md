# 架构决策：AI 客服知识库助手

> 这里给出**默认做法**和理由。验收只测外部行为（API 契约、界面上的 `data-testid`），所以实现可以偏离默认做法。但偏离时要在产品仓库的 `DECISIONS.md` 里写明原因。标记为 **必须** 的条目，验收会直接或间接检查。

## 1. 默认技术栈

| 层 | 默认选择 | 理由 |
|---|---|---|
| 语言 | TypeScript（全栈） | 一种语言贯穿前后端，coding agent 最熟 |
| Web 框架 | Next.js（App Router），**一个应用**，用 npm | v0 不拆 monorepo。本地 pnpm 目前不可用（见 `decisions.md`） |
| 数据库 | PostgreSQL 16，ORM 用 Drizzle（Apache-2.0） | 所有数据都放在一个库里：业务数据、队列、账本、向量、限流计数 |
| 后台处理 | pg-boss（MIT），基于 Postgres 的持久队列，只用于资料的解析、切块、向量化 | 不需要 Redis；服务重启后处理中的资料还会被处理完 |
| 认证 | Better Auth（MIT）放在契约接口之后；如果和契约冲突，可以自己实现会话（argon2id + 随机令牌，服务端只存哈希） | 不依赖托管服务 |
| 模型调用 | Vercel AI SDK（Apache-2.0），走 OpenAI 兼容接口 | DeepSeek 这类模型可以直接接 |
| 文件解析 | PDF 用 unpdf（MIT，底层 pdf.js，Apache-2.0）；Word（.docx）用 mammoth（BSD-2-Clause）；HTML 用 node-html-parser 之类的纯 JS 库取可见文本 | 纯 JS，不依赖系统库 |
| 向量 | 默认用 `real[]` 列存储，在 SQL 或应用层算余弦相似度；装了 pgvector 后再切换 | 本地 Postgres 没有 pgvector 扩展（见 `decisions.md`） |
| 嵌入式小窗 | 一个不依赖框架的原生 JS 文件 `/widget.js`，渲染在宿主页面里（普通 DOM 或 **open** 的 Shadow DOM，**不用 iframe**，原因见 §4.5） | 访客网站可能是任何技术栈 |

**禁止**：依赖除 Postgres 以外的外部服务才能启动；在 `TEST_MODE=1` 下访问 localhost 以外的网络。

## 2. 代码组织（建议）

```
app/                    # Next.js 页面和 /api 路由（路由层只做参数校验和权限检查，然后调用 server/）
server/
  auth/                 # 注册、登录、会话、找回密码、限流
  workspaces/           # 工作区、成员、邀请、权限检查（must: 统一的 requireRole()）
  documents/            # 上传、解析（txt/md/pdf/docx/html）、切块、向量化
  retrieval/            # 检索（must: 查询条件里带 workspace_id，排除已删除的资料）
  widget/               # 小窗设置、公开接口的统一入口（key → 工作区、Origin、CORS、访客令牌、限流）
  answers/              # 回答：检索 → 预留 → 调用模型（流式）→ 引用回填 → 记账；答不上来的兜底
  model/                # 模型提供方抽象：real / fake
  usage/                # 用量账本、预算预留与结算、预算提醒
  handoffs/  conversations/  analytics/  audit/  export/  mail/
  testing/              # 仅在 TEST_MODE=1 时挂载的测试接口
public/widget.js        # 或者由路由生成；必须能在任何域名的页面里运行
drizzle/                # 数据库迁移
scripts/acceptance-start.sh
```

## 3. 数据模型（核心表）

`users`、`sessions`（存令牌哈希和过期时间）、`password_reset_tokens`、`login_attempts`、`workspaces`、`memberships`（user, workspace, role）、`invitations`（存令牌哈希、邮箱、角色、过期时间、是否已使用）、`documents`（含 `deleted_at`、失败原因）、`document_chunks`（workspace_id、document_id、序号、文本、向量）、`widget_settings`（workspace_id、widget_key、enabled、allowed_origins、文案）、`conversations`（workspace_id、visitor_token_hash、状态、`deleted_at`）、`messages`（conversation、角色、内容、outcome、reason、rating）、`citations`、`handoffs`（联系方式、状态）、`rate_limit_hits`、`usage_records`、`budgets`、`budget_reservations`、`budget_alerts`、`audit_events`。

**必须**：每一张业务表都带 `workspace_id`。所有查询都以 `workspace_id` 为条件，不能只按主键查。公开接口里，`workspace_id` 只能从 URL 里的 widget key 查出来，**不能**从请求体或访客传来的其他字段里取。

## 4. 难点的设计要求

### 4.1 租户隔离（必须）
- 每个 `/api/workspaces/{ws}/…` 请求都先确认当前用户是 `ws` 的成员。不是成员、或者资源不在该工作区，一律返回 **404**。
- 公开接口：widget key → 工作区；访客令牌 → 会话。会话必须同时属于这个工作区、并且令牌哈希匹配，否则 404。
- 检索的 SQL 必须以 `workspace_id = 当前工作区` 为条件，并且排除已删除的资料。一个用户同时属于多个工作区时，也只检索当前小窗所属的那一个。

### 4.2 回答流程（必须）
一个访客问题的处理顺序：
1. 存下访客的问题（`user` 消息）。
2. 知识库里没有任何 `ready` 的资料块 → **不调用模型**，直接回 `unanswered`（`reason: "no_answer"`）。
3. 检索：取相似度最高的 **4 个**资料块（T4）。**不要用相似度下限来判断能不能回答**：能不能回答由模型判断（真实模式靠提示词约定一个"无法回答"的哨兵输出，假模型的规则见 §5）。每次请求交给模型的资料最多 4 块、合计不超过约 6000 个字符；**不能把整篇文档或整个知识库塞进提示词**（验收会查，§5.2）。
4. **预留**本次调用的费用（§4.3）。付不起 → 不调用模型，回 `unanswered`（`reason: "budget_exceeded"`）。
5. 调用模型，流式把增量发给访客。可重试的错误（429、5xx、超时）同一次调用**最多尝试 3 次**，第 2 次前至少等 200 ms，之后每次加倍；仍然失败 → 回 `unanswered`（`reason: "model_error"`）。
6. 模型说无法回答 → 回 `unanswered`（`reason: "no_answer"`）。**哨兵本身不能流给访客**：在确认不是哨兵之前先别发增量，或者用别的办法保证访客看到的 `content` 恰好等于兜底文案。
7. 引用回填：系统把检索到的块编号后交给模型，模型在回答里写 `[n]`，系统据编号回填引用。`quote` 取自该块原文，是资料提取文本中**逐字存在**的子串（至少 20 个字符）。正文里每一个 `[n]` 都要有 `marker = n` 的引用；编号对不上任何块的 `[n]` 要从正文里去掉，不能留下没有出处的标记（边流边过滤，因为访客收到的增量拼起来必须恰好等于最终的 `content`）。**一个 `answered` 的回答至少带 1 条引用**；没有任何有效引用的回答按 `unanswered`（`no_answer`）处理——宁可说不知道，也不给没有出处的答案。
8. `unanswered` 时，访客看到的 `content` **恰好等于**小窗设置里的 `fallbackMessage`，`citations` 为空。访客永远看不到错误、原因或者编造的内容。
9. 结算用量、写助手消息、发 `done` 事件。

访客断开连接时，正在进行的调用要中止（`AbortController`），已经产生费用的按 §5.1 记账。

### 4.3 预算：硬停止（必须）
- 每次调用模型前先**预留**这次调用可能花的最多的钱：已花 + 已预留 + 本次预留 > 预算，就不调用。检查和写入预留必须在**一条原子语句或一个加锁的事务里**完成，这样即使很多访客同时提问，**当月已花费也永远不超过预算**（不允许"并发时超一点"）。"最多的钱"在真实模式下怎么算（`max_tokens` 上限、输入按 1 个字符 1 个 token），见 §5.1。
- 调用结束后按实际费用结算、释放预留。失败的调用结算为 0。已经付费的调用，不管之后遇到断开、记账失败还是重启，都要留下一行用量或一个保留的预留。
- 预算为 `null` 表示不限。新建工作区的默认预算是 **10 美元/月**（H9）：小窗是公开的，任何人都能替你花钱，默认就要有上限。
- 金额用整数（百万分之一美元，micro-USD）存储和比较：美元金额 × 1,000,000 后取整。浮点数会出错（0.01 + 0.01 + 0.01 > 0.03），验收依赖整数比较（§5 末尾"金额"一条）。
- **预算提醒**（发给该工作区所有 owner 和 admin，测试模式写进 outbox）：
  - `budget_warning`：结算后当月已花费**第一次**达到预算的 80% 或以上时（整数比较：`spent × 5 ≥ budget × 4`），发一封；
  - `budget_exhausted`：当月**第一次**因为预算拒绝回答一个问题时，发一封。
  - 每个自然月（UTC）每种提醒**最多一封**，修改预算也不会让同一个月再发第二封。
- 被预算拒绝的问题照样存下来，在"没答上来的问题"里显示原因 `budget_exceeded`，方便管理员知道漏掉了什么。

### 4.4 公开接口的安全（必须）
- **widget key 是公开的**（写在客户网页源码里），它只用来定位工作区，不是密钥。真正的防线是：Origin 允许名单、访客令牌、限流、预算。
- **Origin 允许名单**：请求的 `Origin` 必须在 `allowedOrigins` 里，或者等于产品自己的 origin（`APP_BASE_URL`，给后台预览用）。不在名单里、或者**没有 `Origin` 头**，都拒绝（403 `origin_not_allowed`）。允许的响应回显 `Access-Control-Allow-Origin: <origin>` 和 `Vary: Origin`，**不能用 `*`**。预检（`OPTIONS`）同样按名单回答；key 在 URL 路径里，所以预检也知道是哪个工作区。
- **访客令牌**：创建会话时生成随机令牌，只返回一次，库里只存哈希（§9 会查）。会话相关的接口都要带 `Authorization: Bearer <令牌>`。猜会话 ID 没有用：令牌不匹配一律 404。
- **限流**（用库里的计数，多进程也成立）：每个会话每分钟最多 10 个问题；每个 widget key + 客户端 IP 每小时最多新建 30 个会话。超出返回 429 `rate_limited`。客户端 IP 默认取 TCP 连接的地址；只有配置了 `TRUST_PROXY=1` 才读 `X-Forwarded-For`（否则谁都能伪造）。
- 公开接口只接受 JSON（`Content-Type: application/json`），表单提交返回 415。这也保证浏览器一定先发预检。
- 访客输入（问题、联系方式、备注）有长度上限，后台页面显示时要转义，防止 XSS 打到管理员。

### 4.5 嵌入式小窗（必须）
- 客户在自己网站贴一段代码：`<script src="<APP_BASE_URL>/widget.js" data-widget-key="<key>" async></script>`（就是设置里的 `embedSnippet`）。`widget.js` 从自己的 `src` 推出接口地址，从 `data-widget-key` 读 key，然后**直接从宿主页面**跨域调用 `/api/widget/{key}/…`。
- **不要用 iframe 承载对话**：iframe 页面在产品自己的域名下，它发出的请求 `Origin` 永远是产品自己，Origin 允许名单就形同虚设（这时必须改用 `frame-ancestors` 来限制谁能嵌入，模板不走这条路）。
- 小窗渲染在宿主页面的普通 DOM 或 open Shadow DOM 里，样式要隔离（Shadow DOM 或带前缀的类名），不能污染宿主页面。访客令牌存在 `sessionStorage`（键名带 key），刷新页面后能接着聊。

## 5. 模型提供方与假模型

环境变量 `MODEL_PROVIDER=real|fake`。验收时一律用 `fake`。假模型**必须**按下面的方式工作，验收测试依赖这些行为：

| 行为 | 规定 |
|---|---|
| 调用次数 | 知识库里有 `ready` 的资料块时，每个访客问题正好 **1 次**聊天调用（`stage: "answer"`，重试不算新的调用），不管最后答没答上来；没有故障注入时，就是正好 1 次成功的尝试。知识库为空、或者预算付不起时，**0 次**。每一次**尝试**各记一条用量（见"用量记录"） |
| 关键词 | 把访客问题转成小写（Unicode NFKC 规范化后）。两种关键词：① 连续的英文字母 `a`–`z` 组成的词，长度 ≥ 5 且不在英文停用词表里；② 连续的汉字（Unicode `Script=Han`）里，每两个相邻汉字组成的 2 字片段（只有一个汉字的段落就是这个字本身），不在中文停用表里。英文停用词表：`about after again before being could every other should their there these those under where which while would`；中文停用表：`什么 怎么 如何 可以 是否 多少 哪里 哪些 我们 你们 请问 没有 这个 那个 一个` |
| 能回答 | 按交给它的顺序，找第一个**包含任一关键词**的资料块（同样规范化、小写后做子串比较），设它的编号是 `n`：回答是一段非空文字，里面带 `[n]`，以**至少 2 段**增量流式返回，相邻两段之间间隔 `latencyMs` |
| 不能回答 | 交给它的资料块里没有一块包含任何关键词：返回"无法回答"（产品自己约定的信号），产品据此给出兜底回答。这一次调用照样计费 |
| 费用 | 每次成功的聊天调用费用为 `FAKE_CHAT_CALL_COST_USD`（默认 `0.01`）；失败的尝试记录为 `status: "error"`、`costUsd: 0`。预留也按这个数 |
| 金额 | 所有金额（费用、预留、已花费、预算）都换算成整数 micro-USD（美元 × 1,000,000，四舍五入到整数）再相加和比较。预算允许一次调用的条件是 `已花费 + 已预留 + 本次预留 ≤ 预算`；80% 提醒的条件是 `已花费 × 5 ≥ 预算 × 4`。接口里返回的美元数由整数换算回来 |
| 用量记录 | **每次尝试一条**（访客断开时被中止的等待除外，见"延迟"）：重试时，每一次失败的尝试各记一条 `status: "error"`、`costUsd: 0` 的记录，成功的那次记一条 `status: "ok"`。每条记录的 `createdAt` 是**这一次尝试开始的时间**（不是问题开始或结算的时间），验收用它检查退避间隔 |
| 向量化 | 确定性的本地算法，**必须能处理中文**（客户和访客大多是中文用户）。默认做法：文本 NFKC 规范化、转小写；连续的英文字母/数字按词取特征，连续的汉字按相邻两字的 2-gram 取特征（单独一个汉字取它本身）；每个特征用稳定哈希（如 FNV-1a）映射到 256 维计数，再做 L2 归一化。**不能只按空格或英文字母切词**：那样中文问题的向量是零，检索结果是随机的（§5.2 第 3 项用中文资料检查）。可以记为 `kind: "embedding"`，`costUsd: 0` |
| 延迟 | 每次聊天调用前等待 `latencyMs`（默认 20 ms），可以通过测试接口调整。这个等待必须能被中止：访客断开时正在等待的调用立即结束，并且**不产生任何用量记录** |
| 故障注入 | 通过测试接口设置，按阶段计次（阶段只有 `answer`）：`transient` 是可重试错误，接下来的 `times` 次调用尝试失败，之后恢复；`permanent` 是不可重试错误，每次调用都失败，直到重置 |

每条 `kind: "chat"` 的用量记录（包括失败的尝试）都必须带 `stage: "answer"`、`conversationId` 和 `messageId`（它回答的那条助手消息）。

验收用的资料都很短（每份几百个字符，一份资料就是一个块），一个工作区最多四五份，所以"取前 4 块"在验收里通常就是全部的块。

### 5.1 真实模式（`MODEL_PROVIDER=real`）

真实模式给人手动试用；主要的验收一律用 `fake`，只有 §5.2 那几项会用假的模型服务检查真实模式。配置全部来自环境变量，产品的 `README.md` 和 `.env.example` 要列出这些变量：

| 变量 | 含义 |
|---|---|
| `MODEL_BASE_URL` | OpenAI 兼容接口地址 |
| `MODEL_API_KEY` | 密钥。**不得**写进代码、日志、错误信息或提交到仓库 |
| `MODEL_NAME` | 默认 `deepseek-v4.1-flash` |
| `MODEL_INPUT_USD_PER_MTOK` / `MODEL_OUTPUT_USD_PER_MTOK` | 每百万 token 的单价，用于计费和预算；没有配置时启动失败，而不是按 0 计费 |
| `EMBEDDING_PROVIDER` | 默认 `local`：与假模型相同的本地确定性算法（§5 "向量化"：英文按词、汉字按 2-gram），不联网。以后有了向量接口，再改成 `openai-compatible`，并设置 `EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL` |

真实模式有这些**必须**做到的规则，验收会检查（§5.2）：

- **缺配置就拒绝启动。** 没有设置 `MODEL_PROVIDER`，或者它是 `real` 却缺少 `MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_INPUT_USD_PER_MTOK`、`MODEL_OUTPUT_USD_PER_MTOK` 中的任何一个，产品都要启动失败（进程退出），不能默认成假模型，也不能按 0 计费。
- **每次聊天调用都带 `max_tokens`**（正整数，**不超过 1000**，默认 800；用 `max_completion_tokens` 也可以），并且预留费用时按最坏情况算：`max_tokens` × 输出单价，加上输入估算 × 输入单价。余额不够，就不发这次调用（回兜底答案），或者先调低 `max_tokens` 再发。
- **输入估算按最坏情况**：输入 token 数按**发给模型的全部消息文本的字符数**估算，1 个字符算 1 个 token（每条消息的字符串内容、或内容数组里各个 `text` 部分的长度之和；按 JS 字符串长度或 Unicode 码点数都可以）。估算要按**这一次请求**实际要发的消息来算（每条消息加一点固定开销也可以），不能一律按一个固定的最大提示词长度预留，否则付得起的问题也会被拒绝（§5.2 第 4 项会查：预算还够 1.5 次调用时，下一个问题必须照常调用）。也不能用"4 个字符约 1 个 token"之类的平均值：结算按模型报的实际 `usage`，预留少于实际就会超支。验收的假服务报告的输入 token 最多等于这个字符数（§5.2 第 4 项）。
- **按模型返回的 `usage` 记账**：输入 token × 输入单价 + 输出 token × 输出单价。流式调用**必须**在请求里带 `stream_options: {"include_usage": true}`（OpenAI 协议：不带就不会返回 `usage`），并取最后带 `usage` 的那一块。只要模型回了 HTTP 200，就记一条 `status: "ok"` 的用量记录并收费，不管产品之后能不能解析这份回复。网络错误、非 2xx 回复记为 `error`、`costUsd: 0`。和假模型一样，**每次尝试一条记录**，`createdAt` 是这次尝试开始的时间。
- **资料真的交给了模型**：检索到的资料块原文要出现在发给模型的请求里，模型的回答要出现在访客看到的回答里（引用标记之外的文字不得被替换成别的内容）。

### 5.2 验收怎样检查真实模式

验收不连真实模型。它在本机起一个假的 OpenAI 兼容服务（`POST <MODEL_BASE_URL>/chat/completions`，一次性 JSON 和 `stream: true` 的流式都支持；一次性回复总带 `usage`，**流式回复只在请求带了 `stream_options.include_usage: true` 时才在最后一块带 `usage`**，和真实服务一样），再让 runner 用**另一组环境变量、另一个全新的库**把产品再启动一次，**不设 `TEST_MODE`**。在那个实例上，小窗请求的 `Origin` 用的是它自己的 `APP_BASE_URL`。会做的事：

1. 配置完整 → 必须能启动（`GET /api/health` 返回 200），并且 `/api/__test__/*` 都是 404（§6）。
2. 逐个去掉必需的配置（上面五项）→ 必须启动失败。进程退出，或者在远超正常启动的时间内（完整配置启动用时的 3 倍，最少 30 秒，最多 90 秒）一直不健康，都算拒绝。
3. 注册、放入资料（其中一份约 2 万字符的长文档，某一段里埋了一个暗号）、通过小窗提问。检查：发给模型的请求带 `Authorization: Bearer <MODEL_API_KEY>`、`model` 等于 `MODEL_NAME`、带 `max_tokens`；**埋了暗号的那段原文出现在请求里**；**请求的消息文本合计少于 12000 个字符**（没有把整篇文档塞进去）；假服务回答里的一个独特短语出现在访客收到的回答里；每条用量记录的金额等于对应回复的 `usage` 按单价算出的钱。另有一份约 2 万字的**中文**长手册（某一段里埋了一个每次都不同的暗号）和一个中文问题：埋了暗号的那段必须出现在请求里（检索要能处理中文，§5 "向量化"），模型的中文回答要原样到达访客，引用的 `quote` 是中文原文的逐字子串。
4. 预算和输出上限：设一个很小的预算，让假服务对每次调用都用满 `max_tokens`（这时它报告的输入 token 极少，只考输出上限），连续提几个问题：产品不能发出"余额付不起输出上限"的请求，花的钱也不能超过预算。预算和输入估算：让假服务报告的输入 token **等于请求消息文本的字符数**（输入单价远高于输出单价），先按默认预算问一次，再把预算设成"已花费 + 1.5 次调用的钱"，接着再问几次：产品不能发出"余额付不起（字符数 × 输入单价 + `max_tokens` × 输出单价）"的请求，花的钱也不能超过预算。

假服务不知道你的提示词。它保证的只有：回复是普通文字，里面带 `[1]`。产品解析不了时可以给兜底回答，但上面几项照样要成立，回了 200 的调用照样要收费。

## 6. 测试模式接口（仅 `TEST_MODE=1`）

| 接口 | 作用 |
|---|---|
| `GET /api/__test__/outbox?to=<email>` | 查看发给某个邮箱的邮件：`{ messages: [{ to, template, token?, data?, createdAt }] }`。`template` 是 `invitation`、`password_reset`（这两种带 `token`）、`handoff`（`data` 带 `handoffId`、`conversationId`）、`budget_warning`、`budget_exhausted`（`data` 带 `spentUsd`、`budgetUsd`） |
| `PUT /api/__test__/fake-model` | 请求体 `{ latencyMs?, faults?: [{ stage: "answer", mode: "transient" \| "permanent", times? }] }`，返回 204 |
| `DELETE /api/__test__/fake-model` | 把延迟和全部故障恢复为默认值，返回 204（验收会在每条测试前后调用它） |

非测试模式下，这些路由**必须**返回 404。

如果测试邮件存在数据库里，存放它的表的名字必须包含 `outbox`，并且只在 `TEST_MODE=1` 时写入。邀请令牌和重置令牌的明文只允许出现在这张表里（见 §9）；访客令牌和会话令牌在任何表里都不能是明文，outbox 里也不行。

## 7. 启动约定（必须）

产品根目录提供可执行的 `scripts/acceptance-start.sh`。验收工具会注入下列环境变量来启动它：

| 变量 | 含义 |
|---|---|
| `PORT` | 监听端口，绑定 `127.0.0.1` |
| `DATABASE_URL` | 一个**全新的空库**。脚本负责执行迁移 |
| `TEST_MODE=1`、`MODEL_PROVIDER=fake` | 测试模式 |
| `APP_SECRET` | 随机密钥 |
| `APP_BASE_URL` | `http://127.0.0.1:$PORT`。它的 origin 就是产品自己的 origin（§4.4） |

要求：
- 当 `GET /api/health` 返回 200、且后台处理已经开始消费队列时，才算启动完成。启动时限为 300 秒。
- 收到 SIGTERM 时退出。
- 依赖要在验收之前装好；脚本不能联网安装依赖。
- 验收开始前，runner 会先在产品目录执行一次 `npm run build`（如果 `package.json` 里有 `build` 脚本），保证测的是当前源码。中途重启不会重新构建，所以启动脚本本身不需要再构建。
- 验收可能在测试中途重启应用，并保留数据库。
- **启动脚本不得替产品补默认值**：不要在脚本里给 `TEST_MODE`、`MODEL_PROVIDER`、`MODEL_*`、`EMBEDDING_*` 设置默认值或覆盖它们，收到什么就原样传给产品。验收会在没有这些变量的环境里再启动一次这个脚本（§5.2）。

## 8. 界面约定

页面路径由实现决定，只有两个固定：`/signup` 和 `/login`。验收测试通过下面这些 `data-testid` 操作界面：

| 位置 | `data-testid` |
|---|---|
| 注册页 | `signup-name`、`signup-email`、`signup-password`、`signup-submit` |
| 登录页 | `login-email`、`login-password`、`login-submit` |
| 没有工作区时的引导页 | `workspace-create-name`、`workspace-create-submit` |
| 工作区首页 | `workspace-name`（显示名称）、`nav-knowledge`、`nav-handoffs`、`nav-analytics` |
| 知识库页 | `document-text-title`、`document-text-body`、`document-text-submit`（粘贴文本作为资料）；`document-item`（每份资料一个，文本中包含它的状态值，原文就是 API 里的 `processing` / `ready` / `failed`）。状态要自动刷新，不需要手动刷新页面 |
| 后台预览（在知识库页上，用产品自己的 origin 走公开接口） | `preview-input`、`preview-submit`、`preview-answer`（最新一条回答的文字）、`preview-citation`（最新回答的每条引用一个，文本里包含资料标题） |
| 转人工页 | `handoff-item`（每个转人工一个，文本里包含访客留的邮箱） |
| 分析页 | `analytics-unanswered-item`（本月每个没答上来的问题一个，文本里包含问题原文）、`usage-spent`（本月已花费；文本里出现的**第一个数字**就是本月已花费的美元金额，不要把日期或预算写在它前面） |
| 嵌入式小窗（`/widget.js` 渲染在宿主页面里，普通 DOM 或 open Shadow DOM，不用 iframe） | `widget-launcher`（打开对话面板的按钮；面板默认可以是收起的）、`widget-input`、`widget-send`、`widget-message-assistant`（每条助手消息一个，流式时文字逐步出现）、`widget-citation`（每条引用一个，文本里包含资料标题）、`widget-handoff`（转人工按钮）、`widget-contact-email`、`widget-handoff-submit`、`widget-handoff-done`（提交成功后出现的确认） |

## 9. 验收会检查产品存了什么

验收会直接连到注入给产品的那个 `DATABASE_URL`，查看里面存了什么。下面这些规则都是**必须**：

- 产品的业务数据（用户、工作区、资料、会话、用量等）必须存在 `DATABASE_URL` 指向的 Postgres 里。验收会先确认新注册用户的邮箱出现在这个库里，找不到就判定失败，而不是跳过后面的检查。
- 会话令牌、邀请令牌、密码重置令牌、**访客令牌**，在库里只能以**哈希**保存。验收会用 Cookie、outbox 和创建会话时拿到的令牌明文，在库里**所有 schema 的所有表**里搜索（文本列、JSON、字节列都查），找到就失败。只有名字含 `outbox` 的表可以放邀请令牌和重置令牌（§6）；会话令牌和访客令牌在任何表里都不能是明文。
- 密码以 **argon2id，或 cost 至少 12 的 bcrypt** 保存，存成**文本列**，格式是标准的 `$argon2id$…` 或 `$2a$` / `$2b$` / `$2y$` 加两位 cost。注册和重置密码两条写入路径都要满足；库里任何地方出现 cost 低于 12 的 bcrypt 哈希就判失败。库里的任何地方（包括 outbox）都不得出现密码明文。
