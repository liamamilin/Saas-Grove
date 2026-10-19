# 分析探针（不属于模板，不用于打分）

三条探针测"产品是不是只让假模型的固定回复碰巧过了测试"。用法：复制一份 `blueprints/<名字>/acceptance`（跳过 `tests/`），把这三个文件放进 `tests/s4/`，对一个产品运行 `node run.mjs --app <产品目录> --stage S4`。

- `grounding.test.ts`：上传资料里的暗号有没有出现在发给模型的请求里。
- `output-used.test.ts`：模型的 synthesize 回答有没有进报告。
- `retrieval.test.ts`：检索是否有选择性（请求不是整篇文档）、相关段落有没有进请求、追问有没有带资料原文。只打印，不断言。

2026-10-19 的结果在 `results-2026-10-19.txt`。这三条是在看到 B5/B7 结果之后才写的（事后），正对照 A 和 B4 都通过；它们是 v0.4 候选测试（template-learnings 40），目前没有进验收。
