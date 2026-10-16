# 09 — 交给 Coding Agent 的首条指令（Phase 0）

> **复制以下“任务说明”至开发 Agent 即可。第一阶段只读，不允许提交代码修改。**

## 任务说明

你是本项目的 Lead Engineer / Architecture Auditor。任务是对 **SaaS & AI Foundation V1.0** 进行 **Phase 0 — Upstream & Market Audit**。请先完整阅读 `00_README.md` 至 `12_PROTOTYPE_RESOURCE_SPEC.md`，尤其是 `06_OSS_IP_POLICY.md`、`07_QUALITY_ACCEPTANCE.md`。

### 目标

我们希望基于成熟开源 SaaS 底座建设独立商业软件，初选 `https://github.com/vercel/next-forge`。四条产品线：SaaS Core、Business SaaS、AI Native、SaaS + AI 模块。原型是 Business SaaS / AI Native 应用模板的 0..N 下属资源，**不是第五条产品线**。最终产品允许改名及商业销售，但必须符合许可证、依赖与商标条款。

**此次仅调研和审计，禁止编写生产功能。** 不要为了输出好看的结论而臆测功能完成度。

### 范围

1. **锁定上游事实**：获取官方仓库、最近稳定 tag 与 commit SHA、实际 workspace、依赖管理器、测试/构建命令、默认外部服务。列出开发环境要求，特别核查 docs 与代码不一致之处。
2. **真实功能清单**：逐项核查认证、租户、权限、支付与 Webhook、队列、文件、邮件、后台、AI、日志、CI。状态只可为 `WORKING / PARTIAL / SCAFFOLD / ABSENT / UNKNOWN`，附文件路径与证明方法。
3. **许可证/第三方审计**：主仓库 MIT 条款、copyright/notice、第三方包和素材、商业服务的限制；对 AGPL/GPL/自定义授权列出风险与替代方案，不出无依据的法律结论。
4. **Gap Matrix**：按四条产品线列出 `现成可用 / 需适配 / 需新建 / 待确认`，加优先级、预计复杂度和维护风险。没有证据不得评估“已完成”。
5. **候选对比**：next-forge 与至少两个备选底座比较（推荐 Next.js SaaS Starter 与 Open SaaS），明确为什么继续/放弃 next-forge。不要仅按 GitHub Stars 做判断。
6. **第一批纵切片**：给出具体、最小、可真实验收的 `Billing + AI Workflow + SaaS AI Copilot` 方案；禁止在 Phase 0 实施。
7. **原型资源审计**：盘点项目管理/CRM/AI Workflow 等已有原型资产，记录 `design-only / interactive-mock / integrated`、资源范围、来源许可、绑定到真实业务能力的可能性；评估同一业务模板接两种原型的改造成本。只形成报告，不复制第三方受限素材。
8. **安全隔离**：识别本地生产数据、真实配置、系统调度、支付凭证所在位置；只形成风险记录，不读取私密凭证正文、不执行写操作。

### 约束（非常重要）

- 默认 READ-ONLY：不得修改任何目标应用的文件、真实数据库、支付配置、计划任务、launchd、密钥、生产环境。
- 不得擅自 `npm install` 运行未知 postinstall 脚本、运行数据库迁移或启动可能写入真实系统的命令。
- 如果没有仓库副本，只在独立临时目录克隆公开仓库用于只读分析；记录被审计的 SHA。不要假设我当前项目就是 next-forge。
- 不许使用 mock 假称真实 API 已跑通；不可把官方 README 当成代码实测。
- 许可证不明确的项目状态写 `UNKNOWN` 并阻断自动复用。
- 每条关键结论给出确切证据：路径、commit、文件片段、命令与结果或官网来源。
- **Phase 0 完成后停止**，等待产品负责人审查，禁止自动进入开发。

### 必须输出的文件

```text
reports/phase0/
  UPSTREAM_AUDIT.md
  DEPENDENCY_MAP.md
  OSS_AUDIT.md
  GAP_MATRIX.md
  PROTOTYPE_RESOURCE_AUDIT.md
  BASELINE_COMPARISON.md
  RISK_REGISTER.md
  ADR-001-base-selection.md
  P0_BACKLOG.md
  PHASE0_SUMMARY.md
```

### 验收

- [ ] 明确上游 SHA/版本，提供可复现方法。
- [ ] 所有关键表格都能追溯来源，空白写 UNKNOWN。
- [ ] 包含“改名、闭源、商业发布”的许可证与第三方资源判断。
- [ ] 区分基础设施包、完整业务模板、AI API 样例、生产级 AI App、设计稿/交互原型/已集成原型。
- [ ] 核对一个应用模板→多个原型资源的可行性、资产许可证与业务绑定依赖；不把视觉相似当成业务兼容。
- [ ] 明确支付宝/微信的商户资质和 API 场景问题。
- [ ] 输出不超过两页的 `PHASE0_SUMMARY`，包含建议、风险、阻断项和下一阶段候选计划。
- [ ] 无目标项目修改；提供 `git status` 和审计工作区记录证明。

## 本文与开发任务的关系

完成 Phase 0 后才能根据事实修订 P0 Backlog、ADR 与下一阶段实施指令。本阶段**不要求也不允许**建立正式产品代码。
