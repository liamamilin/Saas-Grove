# 08 — 开发路线图与阶段退出标准

> 本路线图按**退出产物与门禁**安排，不虚构具体开发天数。阶段可适度并行，但不得绕过前置许可和安全检查。

## Phase 0 — Upstream & Market Audit（只读）

**目标**：核对 next-forge 实际功能、版本依赖、许可证，建立四库候选资产库、原型资源候选清单和首个验证场景。

**产出**：`UPSTREAM_AUDIT.md`、`GAP_MATRIX.md`、`OSS_AUDIT.md`、`DEPENDENCY_MAP.md`、`PROTOTYPE_RESOURCE_AUDIT.md`、`ADR-001.md`、`P0_BACKLOG.md`。

**Exit**：每一项关键结论有来源或 `UNKNOWN`；无任何对生产或用户项目的修改；决定采用、有限采用或更换底座。

## Phase 1 — Independent SaaS Baseline

**目标**：从审核通过的 upstream 固定版本建立独立品牌 SaaS Core baseline，保留必要 notice。

**实现范围**：本地完整启动、认证/租户与数据隔离核查、基础 Dashboard、CI、审计/监控、插件位置、发行构建。

**Exit**：干净环境可重建；基线回归通过；许可证、品牌、部署文档到位。

## Phase 2 — Commercial Core & China Billing

**目标**：统一 Billing Domain，先实现一个端到端支付路径，再覆盖所选择的另外渠道及适用支付场景。

**实现范围**：订单、支付状态、渠道 adapter、查单、Webhook、退款、权益、用量/成本账本、管理员排查入口；任务系统最小服务端闭环。

**Exit**：支付/权益完整自动测试、回调与对账故障演练、渠道支持矩阵、sandbox/live 测试记录分离；缺少商户资质则该渠道标 BLOCKED，不能冒称 PASS。

## Phase 3 — AI Runtime & First AI Native Template

**目标**：提供模型调用、作业/队列、工具调用、安全边界、成本/额度、产物；落地一个 AI Workflow 模板。

**Exit**：真实或隔离模型完整跑通至少一条多步骤路径；可取消/重试/恢复；作业有租户隔离、审计与成本记录。

## Phase 4 — SaaS + AI Module & Business Reference

**目标**：一个 AI Copilot 通用模块 + 业务 adapter + 两个不同业务数据模型的验证场景。

**Exit**：第二个接入场景无需改核心 AI 模块；跨租户/越权/审批负向用例通过；能完整追踪动作。

## Phase 5 — Business SaaS Template Catalog

**目标**：至少一个完整可运行的 Business SaaS Template（优先项目管理或知识库），并为其提供两个兼容的已集成原型资源；增补业务模板、原型及其设计资产的许可证与技术选型资料。

**Exit**：安装、基本 CRUD/流程、角色隔离、部署、AI 接入示例具备端到端验证；两个已集成原型在共同覆盖范围内共享业务能力契约，切换无需重写领域模型，且绑定/权限/实际操作与数据不变性回归通过；Fork 或第三方设计资源另有合规评审。

## Phase 6 — Commercial GA Hardening

**目标**：独立品牌网站、Docs、CLI/初始化器、发布包、模板与原型资源版本兼容、升级和回滚说明、商业授权及支持政策。

**Exit**：按 07 完成独立安装、回归/安全/许可审计、客户视角验收、发行签核；不满足硬门槛不得使用 GA/production-ready 表述。

## P0 优先级原则

1. 优先降低最高风险：许可证、数据隔离、账本/支付、生产保护。
2. 优先做可验证纵切片：一个完整支付场景、一个 AI Workflow、一个 Copilot 接入。
3. 新增模块必须有真实复用场景，不追求空目录数量。

## Phase 0 后必须重新决策的事项

- next-forge vs 其他底座的技术适配与维护成本。
- 默认认证供应商以及国内可用性。
- 微信/支付宝的商户资质、实际可使用的接口场景。
- 首个业务模板究竟是项目管理还是知识库。
- 公开发行是源码授权、订阅支持，还是托管 SaaS；首版可聚焦其中一项。
