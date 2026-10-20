# S2 知识库与回答：资料、公开小窗接口、带引用的回答

**目标**：公司上传资料，访客通过公开接口提问，得到**只基于资料、带可核对出处**的流式回答；答不上来就老实说不知道。这个阶段也要把公开接口守住：key、Origin 允许名单、访客令牌、限流，因为从这一刻起，任何人都能替客户花钱。

## 范围

- 资料：粘贴文本；上传 `.txt` / `.md` / `.pdf` / `.docx` / `.html`（multipart 的 `file` 字段，上限 10 MB）；HTML 只保留可见文字（去掉 `script`、`style`）；后台解析、切块、向量化（本地向量化必须能处理中文：英文按词、汉字按 2-gram，§5）；状态 `processing` → `ready`，读不出内容的文件变成 `failed` 并带 `error.code`；`/text` 返回提取出的文本。
- 小窗设置：`GET/PATCH /widget`（每个成员可读，admin/owner 可改）：`enabled`、`allowedOrigins`、`botName`、`greeting`、`fallbackMessage`、`widgetKey`（`embedSnippet` 和 `/widget.js` 属于 S4）。
- 公开接口 `/api/widget/{key}/...`（`spec/api.yaml`、`spec/architecture.md` §4.4）：未知 key → 404；Origin 不在允许名单（或缺 Origin）→ 403；小窗关闭 → 403 `widget_disabled`；CORS 回显具体 Origin、带 `Vary: Origin`，绝不回 `*`；预检只对允许的 Origin 放行；访客令牌只存哈希；只收 JSON；每个对话每分钟 10 个问题、每个 (key, IP) 每小时 30 个新对话。
- 回答（§4.2）：工作区内检索最相关的块（最多 4 块、约 6000 字符），只把这些块放进提示词；SSE 流式返回（`delta`…`done`），增量拼起来等于最终的 `content`；引用的 `quote` 是原文逐字子串；答不上来、或回答里没有有效出处时，返回工作区的 `fallbackMessage`，不带引用；**知识库为空时不调用模型**；模型说"无法回答"的约定输出不能流给访客。
- 模型层：`MODEL_PROVIDER=fake|real`。假模型严格按 §5（关键词规则，包括汉字 2-gram；每个问题恰好一次 `answer` 调用，重试不算新调用；延迟；故障注入）；补全 `/api/__test__/fake-model`。可重试错误最多试 3 次、带退避，最终失败时访客拿到兜底文案（不是错误）。真实提供方也在这一阶段做：缺配置拒绝启动、每次调用带 `max_tokens`（不超过 1000）、流式调用带 `stream_options.include_usage` 并按返回的 `usage` 记账（§5.1）。
- 用量记录：每次调用**尝试**写一条（重试的每次失败各一条；`createdAt` 是这次尝试开始的时间；`kind`、`stage=answer`、`status`、`conversationId`、`messageId`），`GET usage/records` 可查。费用和预算在 S3。
- 界面：知识库页（粘贴资料、资料列表和状态）、试问框（团队自己试一下回答和出处）。

## 验收（`acceptance/tests/s2/`，共 24 条）

资料（6）：粘贴文本变成 ready；Markdown、PDF 能解析；Word 能解析、HTML 只留可见文字；不支持的类型 415、过大 413、空内容 400；读不出的文件 `failed` 且带原因；其他工作区看不到。

回答（7）：带逐字引用的流式回答，且增量不是攒齐了才发；对话只有自己的访客（令牌）能读；答不上来时给团队自己写的兜底文案、不带引用；知识库为空时一次模型调用都没有；**绝不用其他工作区的资料回答**；临时错误自动重试；同一次调用恰好试 3 次、带退避，最后给兜底文案而不是报错。

公开接口（7）：未知 key 404、非 JSON 415；只服务允许的 Origin，CORS 回显 Origin；预检只对允许的 Origin 放行；所有成员能读小窗设置，只有 admin/owner 能改；小窗关闭时拒绝访客；两种限流；访客令牌在库里只有哈希。

界面（1）：建知识库 → 资料变成 ready → 试问 → 看到回答和出处。

真实模式（`real-mode.test.ts`，3 条，见 `spec/architecture.md` §5.2；验收用假的模型服务，并把产品再启动一次）：配置完整时能启动、没有测试路由，缺任何一项配置都拒绝启动；一份长手册里埋的那一段确实进了发给模型的请求（而且提示词不是整篇手册），模型的回答到达了访客，金额等于模型返回的 `usage` 算出来的钱；一份中文长手册里埋了每次都不同的暗号的那一段，靠中文检索进了请求，模型的中文回答到达访客，引用是中文原文的逐字子串。

## 完成条件

`--stage S2` 全部通过（会连同 S1 一起跑），并经人工确认。
