# 13 — 可交给 Agent 的第一条指令（Read-Only Factory Planning）

## 任务指令（复制给 Coding Agent）

你担任 Template Factory 的 Production Architect / Auditor。本阶段只做 **Template Factory 规范审计与三种试生产方案的只读演练**，不可实现产品功能、执行未知安装脚本、联网调用真实支付或修改用户现有业务项目。

1. 完整阅读本文件夹 `00_README` 至 `20_V1_1_AUDIT_REPORT`、schemas、examples、scripts 与 tests；如果能访问 Foundation V1.0.1，则重点核对其 `04_MODULE_TEMPLATE_CONTRACT`、`06_OSS_IP_POLICY`、`07_QUALITY_ACCEPTANCE`、`08_ROADMAP`、`12_PROTOTYPE_RESOURCE_SPEC`。不能访问就标记 `BLOCKED`，不猜测原文。
2. 严格区分 `resourceType`、`qualityLevel`、`verificationStatus`、`usePolicy`、`publicationStatus`。禁止使用旧的产品线 `L1-L4` 作为质量等级。
3. 对 `examples/production_catalog.json` 里的三条目录目标进行 static validation；执行 `python scripts/validate_examples.py` 与 `python -m unittest discover -s tests -v`，记录实际结果。不将示例 PASS 当作业务资源 PASS。
4. 针对微信支付模块、CRM SaaS、AI Workflow App 分别输出：候选来源及版本（可获得则锁定 SHA）、许可证和代码/素材限制、缺失能力、选型建议、目标 L1/L2/L3 的必需证据、最小沙箱计划、估计成本和阻断项。CRM 需要多候选方案，若只有一个可审来源必须说明。
5. 写出四类资源专项 Gate Profile 的草案（第四类 SaaS + AI 可只做只读方案），标明自动可验证的内容与必须人工审核的事项。
6. 审核现有规范的冲突、悬空概念、不一致 Schema、制品冻结/验收 hash 关系或未定义的状态转换，不得擅自降低许可证、安全、租户和支付门禁。
7. 本阶段若找不到可合法复用的软件来源或权威 API 信息，结论为 `UNKNOWN/BLOCKED`，不要捏造可用性。

## 强制禁止

- 不写业务源码、不执行 Docker build/npm install/迁移，不读取或打印生产 Key，不接触真实订单、不改真实系统 launchd/cron。
- 不将 README 宣称的功能当成“跑通”；不将模拟调用写为 Live；不将未审许可证标为兼容闭源商业分发。
- 如需报告写文件，只可创建在单独的 `reports/factory-readonly/` 工作目录；不得覆盖已有文件，记录 git 状态和目标 SHA。
- 审计结束立即停止，等待人工批准，绝不自动进入 Sandbox Production。

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

每一份报告应含来源/证据、执行环境、PASS/FAIL/BLOCKED/NOT_RUN/UNKNOWN、主要风险、最小下一步及批准请求。`PHASE_A_SUMMARY` 不超过两页。

## 验收退出

全程只读、可追溯，三种试点的风险/目标范围和独立发布门禁清楚，未调用真实生产系统，且停止在只读审计末尾。
