# SaaS & AI 模板 — Claude 工作说明

这个仓库不是产品，而是「模板 + harness + 对比实验」。`README.md` 是唯一的当前方向文档；结论变了先改它。

## 开工先读（按顺序）
1. `README.md` — 目标、关键判断、模板格式 v0、阶段和人工节点。
2. `experiments/ab-01/results.md` — 最新实验结论；`backlog.md` 和 `template-learnings.md` 是待处理缺口（编号接着往下排，不要重排旧编号）。
3. 动模板先读 `blueprints/<名字>/TEMPLATE.md`；动 harness 先读 `harness/README.md`（含沙箱隔离和踩过的坑）。
4. 先 `git status`，保留用户未提交的修改。

## 硬规矩
- 一个模板只有在 agent 照它做出产品、并通过它自带的验收之后，才算合格。
- 实验进行中不改模板和验收，否则 A/B 失去可比性；发现的缺口记进 `template-learnings.md` / `backlog.md`，实验结束后统一处理，并经独立 agent 审查。不为了通过而改验收。
- 验收永远用假模型。真实模型（`deepseek-v4.1-flash`）只在产品自己的运行里用，配置在根目录 `.env`。
- `.env` 的内容不要读、不要打印、不要提交；只有 `.env.example` 入库。
- 负责构建的和负责审查/验证的必须是相互独立的 agent 或会话；人只在关键节点批准。不要自己既写测试又审测试。
- 运行目录在仓库之外：`/Users/Shared/saas-template-runs/<run-id>/`（沙箱里运行）。`runs/` 不入库。
- 复用第三方代码时，当场记下来源、许可证和 commit。`references/` 只是参考副本，不是底座，里面有自己的 git 历史，别在里面改东西。
- 旧的 Foundation / Factory 规范已移除，只在 git tag `pre-pivot-2026-10-17` 里，不再作为规范。

## 约定
- 用中文回复和写文档；提交信息用英文，格式 `<范围>: <摘要>`（如 `ab-01: ...`、`harness: ...`）。
- 数字以 harness 的记录为准（`records/journal.jsonl`、`STATUS.md`），不以 agent 自己的说法为准。
- 批量执行走本地 opencode CLI，模型 `open-design/deepseek-v4.1-flash`；审查用 `open-design/deepseek-v4-pro`。
- 注意：`.claude/delegate-impl.json` 仍指向已删除的 `factory-impl/`（`testCommand`、`protectedGlobs`）。用 delegate-impl 流程前先更新它，否则 hook 会拿一个不存在的目录跑测试。

## 压缩说明 (Compact instructions)
压缩这段对话时，按优先级保留：
1. 用户当前的要求，以及他做过的每个决定（审批、方向取舍、否决的方案）。
2. 实验和运行的标识：run-id、A/B 组、当前阶段，以及已冻结、不能再改的东西。
3. 关键数字：验收通过数、agent 调用次数、用时、token、人工介入次数，和它们的出处文件。
4. `backlog.md` 和 `template-learnings.md` 已用到的最大编号，以及本次新加的条目内容。
5. 创建或修改的文件路径及原因；未提交的改动；做到一半的事和下一步。
6. 摆出来等用户选择的选项，和等待人工批准的节点。
省略：审查报告全文、日志长输出、`references/` 里的内容、`.env` 内容和任何密钥。
