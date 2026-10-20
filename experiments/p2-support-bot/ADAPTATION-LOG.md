# 适配日志：ai-research-assistant → ai-support-bot

- 开始时间：1792506000（来自 `.adapt-start`）
- 做法：先把 `blueprints/ai-research-assistant/` 整个拷成 `blueprints/ai-support-bot/`（不含 `acceptance-results/`、`.DS_Store`；`node_modules/` 拷了，但被 `.gitignore` 忽略，不计入改动），再在拷贝上改。复用量用 `git diff --no-index --numstat` 在两个目录之间统计（见文末）。

## 过程记录

- 1792506460：拷贝完成，开始改。
