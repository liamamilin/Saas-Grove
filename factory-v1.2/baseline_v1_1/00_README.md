# Template Factory V1.1 — 经一致性审计的规范基线

> 状态：**设计基线 / 待试生产验证**，不是已实现的软件；日期：2026-10-16。配套 SaaS & AI Foundation **V1.0.1** 使用。此包不含任何第三方源码，不代表完成许可证或安全审计。

## 核心定位

**Production Catalog（要生产什么） → Template Factory（如何受控生产） → Resource Warehouse（如何安全入库与分发）**。

一个生产内核面向四类资源，分别采用专项生产协议：

| `resourceType`（机器值） | 对应 Foundation 产品线 | 主要交付 |
|---|---|---|
| `saas-core-module` | SaaS Core | 通用功能模块 |
| `business-saas-template` | Business SaaS | 业务应用模板，含可选 0..N 原型资源 |
| `ai-native-template` | AI Native | AI 原生应用模板，含可选 0..N 原型资源 |
| `saas-ai-module` | SaaS + AI | 通用 AI 核心、适配器契约、真实集成样例 |

`prototype-resource` 是 `business-saas-template` / `ai-native-template` 的**下属资源**，不构成第五条产品线；可以独立版本化、生产和验证，但依靠所属模板建立关系。

## 最重要的概念区分

- `resourceType`：是什么资源；**不是**质量等级。
- `qualityLevel: L0|L1|L2|L3`：在明确范围与证据下达到什么品质；**不是**生产准入。
- `verificationStatus: CATALOGED|VERIFIED|RELEASE_READY`：资料/测试/正式发布验收处于哪个阶段；`CATALOGED` 仅可登记为 L0；L1–L3 必须有相应验收证据，至少为 `VERIFIED`。
- `usePolicy: RESEARCH_ONLY|SANDBOX_ONLY|INTERNAL_ONLY|PRODUCTION_ELIGIBLE`：通过独立门禁后允许怎样使用。L1 **绝不自动**意味着可上线收款或接触真实用户数据。
- `publicationStatus: PRIVATE|LISTED|DEPRECATED|QUARANTINED|WITHDRAWN`：仓储对外可见及退役状态，**不等于**许可合规。

**历史兼容提醒：** Foundation V1.0.1 用 `L1–L4` 作为产品线缩写；Factory 禁止这么写。产品线一律使用上表 `resourceType`，仅 `qualityLevel` 使用 `L0–L3`。

## 文档导航

1. `01_GOVERNANCE_SCOPE.md` — 职责、风险边界与权限；
2. `02_PRODUCTION_CATALOG.md` — 目录目标、批次、可执行生产任务；
3. `03_DISCOVERY_SELECTION.md` — 多候选发现、许可证与方案选型；
4. `04_RESOURCE_CONTRACT.md` — 四类资源及原型的共同交付契约；
5. `05_PRODUCTION_PROTOCOLS.md` — 四类资源的差异化加工方法；
6. `06_QUALITY_LEVELS.md` — L0–L3 质量与环境准入的正交分级；
7. `07_STATE_MACHINE.md` — 状态机、决策权、失败/返工路径；
8. `08_SANDBOX_SECURITY.md` — 隔离、危险动作、Checkpoint 与回滚；
9. `09_EVIDENCE_AND_ACCEPTANCE.md` — 可机验的证据模型和发布门禁；
10. `10_WAREHOUSE_LIFECYCLE.md` — 三仓、版本、溯源与退役；
11. `11_BATCH_ORCHESTRATION.md` — 批量调度、预算、限流、止损；
12. `12_PILOT_PLAN.md` — 三个真实差异型试生产及退出标准；
13. `13_AGENT_KICKOFF.md` — 第一条审计/试生产规划指令（只读）；
14. `14_GATE_PROFILES.md` — L1/L2/L3 与四类资源专项验收基线；
15. `15_COMPATIBILITY_NOTES.md` — 与原 Foundation V1.0.1 合并时的字段/规范映射；
16. `16_SCOPE_ATTESTATION_MODEL.md` — 多环境/版本的质量认证模型与有效性。
17. `17_IMMUTABLE_RELEASE_PROTOCOL.md` — 制品冻结、校验、审批、发布闭环。
18. `18_VALIDATOR_EXECUTION.md` — 真正可执行的规则引擎边界与负例。
19. `19_RISK_AND_CHANGE_CONTROL.md` — 生产前风险审核、变更影响和失效响应。
20. `20_V1_1_AUDIT_REPORT.md` — V1.0 缺口、修订矩阵及残留风险。

另含 `schemas/`、`examples/` 和 `scripts/`、`tests/`：**规划期可执行的元数据与不变量校验器（含故意失败的负例）**，不是生产 Orchestrator 的实现。示例数据是假设案例，不是生产验收报告。

## 与 Foundation V1.0.1 的接口

Factory **不修改**四条产品线、Prototype Resource 关系、原始模板契约、商业交付标准。它是对原规范的生产过程补充：

| Foundation | Factory 补充 |
|---|---|
| `04_MODULE_TEMPLATE_CONTRACT.md` | 资源元数据、加工来源、质量/仓储状态与交付证据 |
| `06_OSS_IP_POLICY.md` | 候选准入与每个产物发布前再次审计 |
| `07_QUALITY_ACCEPTANCE.md` | L0–L3 及每级可复现验收；原商业 GA 门禁**不降低** |
| `08_ROADMAP.md` / `09_AGENT_KICKOFF.md` | Phase 0 保持只读；工厂先试生产、后建设自动 Orchestrator |
| `12_PROTOTYPE_RESOURCE_SPEC.md` | 原型作为模板下属工作包处理，保持 1:N/能力绑定规则 |

冲突处理：已冻结的安全、许可、数据隔离和商用发布硬门槛优先；任何降低要求的例外需明确的人类批准且不得违反法律/安全底线。

## 第一阶段的真实交付

**不是**建工厂 UI，而是用以下标准操作三个试点：通用支付适配（沙箱）、CRM 模板（选多候选）、AI Workflow 模板（真实/隔离模型）。观察发现、选型、加工、证据、成本与维护是否真的可标准化。完成试点后再考虑调度系统的产品化。

## 本版可复现自检

```bash
python scripts/validate_examples.py
python -m unittest discover -s tests -v
```

成功只证明**规范示例与参考规则自洽**。不能将测试结果写成任何真实 SaaS/AI 模板的 L1–L3 商用认证。
