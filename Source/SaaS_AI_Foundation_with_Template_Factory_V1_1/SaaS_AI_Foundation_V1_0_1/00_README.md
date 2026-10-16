# SaaS & AI Foundation — 产品规划 V1.0.1

> V1.0.1 为 V1.0 规划修订：明确 Prototype Resource 属于应用模板的下属资源；不新增第五条产品线。完整变更见本文件末尾。

- 状态：**规划基线（Planning Baseline）**，供架构审查和 Agent 开发使用；**不是已通过源码/安全审计的实现**。
- 日期：2026-10-16
- 产品名：工作名称 **SaaS & AI Foundation**，正式品牌名和商标尚未确定。
- 战略：**成熟商业化软件为目标；自身长期开发复用作为收益兜底**。
- 候选 SaaS 底座：`vercel/next-forge`，**最终选型以 Phase 0 源码与许可证审计为准**。

## 一句话定义

面向开发者和 Coding Agent 的商业级 SaaS 与 AI 应用工程基础设施：通过可审计、可组合、可测试的模块和模板，加速新产品开发与现有 SaaS 的 AI 改造。

## 四条产品线

| ID | 产品线 | 交付物 | 核心边界 |
|---|---|---|---|
| L1 | SaaS Core | 认证/权限/计费/任务/文件等通用模块 | 不把第三方 SDK 包装当成完整业务模块 |
| L2 | Business SaaS | CRM、项目管理、知识库等完整模板 | 区分 Native / Fork / Integration；一个模板可有多个 Prototype Resources |
| L3 | AI Native | Chat、Generator、Workflow、Agent、Research 等完整模板 | 模型 API ≠ 完整 AI App；同样允许多个 Prototype Resources |
| L4 | SaaS + AI | Copilot、Search、Analytics、Automation、Agent 等可插拔模块 | 通用能力 + 业务 Adapter；不强制采用 next-forge |

## 文档导航（建议阅读顺序）

1. [`01_PRODUCT_CHARTER.md`](01_PRODUCT_CHARTER.md)：战略、客户、价值、目标与非目标。
2. [`02_PRODUCT_LINES_SCOPE.md`](02_PRODUCT_LINES_SCOPE.md)：四条产品线、产品体验、版本范围。
3. [`03_TECHNICAL_ARCHITECTURE.md`](03_TECHNICAL_ARCHITECTURE.md)：分层架构、依赖方向、权限及 Agent 集成。
4. [`04_MODULE_TEMPLATE_CONTRACT.md`](04_MODULE_TEMPLATE_CONTRACT.md)：模块与模板 manifest、接口、生命周期、兼容性。
5. [`05_BILLING_CHINA_PAYMENTS.md`](05_BILLING_CHINA_PAYMENTS.md)：统一账单/权益/账本 + Stripe、支付宝、微信支付方案。
6. [`06_OSS_IP_POLICY.md`](06_OSS_IP_POLICY.md)：二次开发、改名、商用、许可证和第三方资产审核策略。
7. [`07_QUALITY_ACCEPTANCE.md`](07_QUALITY_ACCEPTANCE.md)：可验收的商业级质量门禁。
8. [`08_ROADMAP.md`](08_ROADMAP.md)：从审计到 GA 的里程碑及退出标准。
9. [`09_AGENT_KICKOFF.md`](09_AGENT_KICKOFF.md)：第一条可直接交给开发 Agent 的只读审计指令。
10. [`10_COMMERCIAL_RELEASE.md`](10_COMMERCIAL_RELEASE.md)：发行、授权、升级、文档、支持。
11. [`11_RESEARCH_REGISTER.md`](11_RESEARCH_REGISTER.md)：初始证据、来源、待验证清单。
12. [`12_PROTOTYPE_RESOURCE_SPEC.md`](12_PROTOTYPE_RESOURCE_SPEC.md)：原型资源的 1:N 关系、资源分级、能力绑定、许可与切换验收。

## 项目原则（按优先级）

1. **不能破坏用户项目**：默认只读评估；写入必须有明确目标、隔离与回滚方案。
2. **商业级质量是发布门槛**：阶段性交付的功能必须完整、可测试、可支持。
3. **复用优先但不迷信复用**：选择成熟模块的总成本应小于自建与维护成本。
4. **平台与业务分离**：统一 AI Runtime，业务 SaaS 通过 adapters 接入。
5. **独立商业身份与合规**：可更名，但保留法定授权及第三方声明；不冒用上游商标。
6. **支持 Coding Agent**：每个模块有机器可读元数据、集成手册、可执行测试。
7. **不过度设计**：先用两个真实产品验证跨项目复用，再冻结抽象。
8. **原型属于应用模板的可复用资源**：同一 Business SaaS / AI Native 模板可挂载多个原型；更换原型不得迫使核心业务能力重写；UI Pattern 可跨模板复用。

## 当前已确定 / 尚未确定

**确定：** 四库结构（原型资源不是第五库）；一个应用模板可关联多个原型资源；商业优先自用兜底；Next.js/Turborepo 作为首个技术栈；SaaS + AI 优先采用模块+业务适配器；开源合规为硬门槛。

**待核查：** next-forge 锁定 commit、实测可用功能、第三方依赖/资产权限；中国支付商户资质；首批业务模板的目标用户；公开销售具体许可证和定价。

## 使用方法

- 人类/产品负责人：先审查 01–08，确认优先级与风险边界。
- Coding Agent：**先执行 09 的 Phase 0 只读审计，不要立即重构、安装、部署或创建支付订单**。
- 产品发布负责人：只按 07 和 10 的门禁决定能否对外发布。

> 说明：本包是产品与技术规划基线；未包含或复制 next-forge 的源码。原项目许可证应在真正引入代码时随源代码合规保留。

## V1.0.1 修订记录（2026-10-16）

- **新增** `12_PROTOTYPE_RESOURCE_SPEC.md`，明确 `Application Template → Prototype Resources [0..N]`、资源范围、成熟度与验收。
- **更新** 产品范围、架构、manifest/能力绑定、许可审计、测试、路线图、Agent Phase 0 审计以及商业发行内容。
- **不变** 四条产品线、next-forge 作为待审底座、Phase 0 先审计后编码的约束。
- **注意** 设计原型、交互原型与已集成原型的交付保证不同；仅已通过相应真实验收的资源可宣称可运行。
