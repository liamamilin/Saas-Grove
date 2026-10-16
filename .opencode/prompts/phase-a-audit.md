# Phase A — Template Factory 只读审计（Read-Only Factory Planning）

你担任 Template Factory 的 Production Architect / Auditor。本阶段**只做规范审计与三种试生产方案的只读演练**。不可实现产品功能、不可执行未知安装脚本、不可联网调用真实支付、不可修改用户现有业务项目。

工作目录：项目根 `/Users/milin/2026/软件开发/Saas_foundation_template`
- Factory 规范：`Source/SaaS_AI_Foundation_with_Template_Factory_V1_1/Template_Factory_V1_1/`
- Foundation 蓝图（只读，禁止修改）：`Source/SaaS_AI_Foundation_with_Template_Factory_V1_1/SaaS_AI_Foundation_V1_0_1/`
- 候选上游底座副本（只读）：`Source/next-forge/`

## 任务

1. **完整阅读** Factory 的 `00_README.md` 到 `20_V1_1_AUDIT_REPORT.md`，以及 `schemas/`、`examples/`、`scripts/`、`tests/`。再核对 Foundation 的 `04_MODULE_TEMPLATE_CONTRACT.md`、`06_OSS_IP_POLICY.md`、`07_QUALITY_ACCEPTANCE.md`、`08_ROADMAP.md`、`12_PROTOTYPE_RESOURCE_SPEC.md`。若某文件不可访问，标记 `BLOCKED`，不要猜测原文。

2. **严格区分** `resourceType`、`qualityLevel`、`verificationStatus`、`usePolicy`、`publicationStatus`、`implementationLevel`。禁止把旧的产品线 `L1-L4` 当作质量等级。

3. **对 `examples/production_catalog.json` 里的三条目录目标做 static validation**；执行：
   ```
   python3 scripts/validate_examples.py
   python3 -m unittest discover -s tests -v
   ```
   在 Factory 目录下执行并**记录真实输出与退出码**。不得把示例 PASS 当作业务资源 PASS。

4. **针对三个试点分别输出**：候选来源及版本（可获得则锁定 SHA）、许可证和代码/素材限制、缺失能力、选型建议、目标 L1/L2/L3 的必需证据、最小沙箱计划、估计成本、阻断项。
   - 试点 A：微信支付适配器模块（`saas-core-module`，Sandbox Only）
   - 试点 B：CRM 业务模板（`business-saas-template`）——**需要多候选方案**；若只有一个可审来源必须说明
   - 试点 C：AI Workflow 模板（`ai-native-template`）

5. **写出四类资源专项 Gate Profile 的草案**（第四类 `saas-ai-module` 可只做只读方案），标明哪些自动可验证、哪些必须人工审核。

6. **审核现有规范的冲突、悬空概念、不一致 Schema、制品冻结/验收 hash 关系、未定义状态转换**。不得擅自降低许可证、安全、租户和支付门禁。

7. 若找不到可合法复用的软件来源或权威 API 信息，结论为 `UNKNOWN/BLOCKED`，**不要捏造可用性**。

## 强制禁止

- 不写业务源码；不执行 `Docker build` / `npm install` / 数据库迁移；不读取或打印生产 Key；不接触真实订单；不改真实系统 `launchd`/`cron`。
- 不把 README 宣称的功能当成"跑通"；不把模拟调用写成 Live；不把未审许可证标为兼容闭源商业分发。
- 只允许在 `reports/factory-readonly/` 下创建文件；不得覆盖已有文件。记录 git 状态与目标 SHA。
- 审计结束后**立即停止**，等待人工批准，绝不自动进入 Sandbox Production。

## 关于 next-forge 副本的可核查事实（供你验证，不要直接采信）

- 路径 `Source/next-forge`，`git` HEAD 由你自行用只读命令确认（`git log -1`、`git rev-parse HEAD`、`git status`）。
- 如需核查其许可证，读取 `license.md`，并列出需要逐项复查的子目录/资产风险。
- 你可以做**只读**统计：`ls`、`find`、`cat`、`grep`、`wc`、`git log`、`git status`、`git ls-files`。禁止任何写操作。

## 必须输出

```text
reports/factory-readonly/
  CATALOG_VALIDATION.md
  CANDIDATE_REGISTER.md
  SELECTION_MATRIX.md
  QUALITY_GATE_PROFILES.md
  PILOT_READINESS.md
  CONFLICT_AND_UNKNOWN.md
  PHASE_A_SUMMARY.md
```

每份报告须含：来源/证据、执行环境、`PASS/FAIL/BLOCKED/NOT_RUN/UNKNOWN`、主要风险、最小下一步、批准请求。
`PHASE_A_SUMMARY.md` 不超过两页。

## 验收退出

全程只读、可追溯；三个试点的风险/目标范围和独立发布门禁清楚；未调用真实生产系统；停在只读审计末尾并给出人工批准请求。

开始执行。完成后输出一份简短总结（不超过 30 行），列出每个报告的路径、关键结论与所有 BLOCKED/UNKNOWN 项。
