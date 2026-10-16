# 品类认知：AI 研究/文档助手

> 目的：让 agent 知道这类产品已经有什么、用户会拿什么来比较、哪些可以直接用、哪些只能参考。
> 开源项目的许可证、星标数、最近更新时间，于 **2026-10-17** 从 GitHub API 实时读取；凡是 GitHub 识别不出许可证的，都读了许可证原文开头。商业产品部分来自背景知识，**没有逐项核实**，只用来理解用户预期。

## 1. 用户会拿来比较的商业产品（背景知识，未核实）

NotebookLM、Perplexity、ChatGPT / Gemini 的 Deep Research、Elicit、Consensus、ChatPDF、Kimi 等。用户从这些产品里形成的预期是：

- **回答必须有出处**，点开就能看到原文。这是最重要的一条；没有出处的研究报告用户不会信。
- **能同时用多份资料**，并在报告里综合起来。
- **长任务在后台跑**，能看到进度，不用一直守着页面。
- **报告出来后还能接着问**。
- **团队可以共用**一个资料库。
- **能导出**（复制、下载）。

我们这一版的差异化不在"更聪明"，而在**团队、隔离、成本可控、可追溯**这些成熟 SaaS 的基本功。

## 2. 开源项目（2026-10-17 核实）

| 项目 | 许可证 | 星标 | 最近更新 | 对我们的用处 |
|---|---|---|---|---|
| [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | Apache-2.0 | 30.1k | 2026-10-10 | **参考**"规划 → 分头研究 → 汇总"的研究流水线。Python 实现，不直接复用代码 |
| [stanford-oval/storm](https://github.com/stanford-oval/storm) | MIT | 31.7k | 2025-09-30 | 参考"先列大纲、再按大纲写长报告"的思路。更新较少 |
| [Mintplex-Labs/anything-llm](https://github.com/Mintplex-Labs/anything-llm) | MIT | 67.2k | 2026-10-16 | 参考多用户工作区 + 文档对话的产品形态和权限设计 |
| [LibreChat-AI/LibreChat](https://github.com/LibreChat-AI/LibreChat) | MIT | 45.8k | 2026-10-16 | 参考流式对话界面和多模型接入 |
| [infiniflow/ragflow](https://github.com/infiniflow/ragflow) | Apache-2.0 | 92.3k | 2026-10-16 | 参考文档解析和切块策略。体量很大（Python），不引入 |
| [onyx-dot-app/onyx](https://github.com/onyx-dot-app/onyx) | MIT，但 `ee` 目录是商业许可 | 32.5k | 2026-10-16 | 可以参考企业知识检索；**不要碰 `ee` 目录** |
| [open-webui/open-webui](https://github.com/open-webui/open-webui) | 自定义 "Open WebUI License"（BSD 风格，附加品牌条款） | 155.9k | 2026-10-16 | 只看产品形态，**不复用代码**（品牌条款有约束） |
| [langgenius/dify](https://github.com/langgenius/dify) | 修改版 Apache-2.0，多租户服务需要商业许可 | 158.7k | 2026-10-16 | 只看产品形态，**不复用代码**；它也是我们明确不做的方向（通用低代码平台） |
| [khoj-ai/khoj](https://github.com/khoj-ai/khoj) | AGPL-3.0 | 37.7k | 2026-08-02 | **不复用代码**（AGPL 对网络服务有传染性） |

结论：**没有哪个项目能直接拿来当我们的产品**。它们要么是 Python 技术栈，要么许可证有限制，要么形态是个人工具或通用平台。我们只参考它们的产品形态和流程设计，自己用默认技术栈来实现。

## 3. 直接作为依赖使用的库（2026-10-17 核实）

| 库 | 许可证 | 用途 |
|---|---|---|
| [vercel/ai](https://github.com/vercel/ai)（AI SDK） | Apache-2.0（已读原文） | 模型调用、流式输出 |
| [better-auth/better-auth](https://github.com/better-auth/better-auth) | MIT | 认证（可选，见 T1） |
| [drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) | Apache-2.0 | ORM 和迁移 |
| [timgit/pg-boss](https://github.com/timgit/pg-boss) | MIT | 基于 Postgres 的持久队列 |
| [unjs/unpdf](https://github.com/unjs/unpdf) / [mozilla/pdf.js](https://github.com/mozilla/pdf.js) | MIT / Apache-2.0 | PDF 文本提取 |
| [pgvector/pgvector](https://github.com/pgvector/pgvector) | PostgreSQL License（已读原文） | 向量检索（需要装扩展，见 H4） |
| [dbos-inc/dbos-transact-ts](https://github.com/dbos-inc/dbos-transact-ts) | MIT | pg-boss 的备选：基于 Postgres 的持久化工作流 |

更早的调研（`research/ai-workflow-candidates-2026-10-16.md`）还列过 Temporal、Hatchet、Trigger.dev 等工作流引擎。对这一版来说它们都太重，没有采用。

## 4. 复用规则

- 只以**依赖包**的形式引用上面这些库，不复制它们的源码。
- 如果确实需要复制开源代码片段，在产品仓库的 `PROVENANCE.md` 里登记：来源 URL、许可证、commit、复制了哪些文件。**AGPL / SSPL / BSL / 自定义限制性许可证的代码一律不复制。**
