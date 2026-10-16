# 02 — Production Catalog：目录驱动批量生产

## 目标

目录负责回答**我们希望生产什么**，不代表已有源代码或产品可交付。目录至少按 `resourceType`、业务能力、目标适用场景、目标等级、优先级、合规约束及预算描述需求，不提前指定唯一仓库。

## CatalogTarget 必填字段

| 字段 | 描述 |
|---|---|
| `id`, `name`, `resourceType` | 全局稳定 ID / 名称 / 四类资源之一 |
| `capabilitiesRequired[]` | 最小可验证能力 ID；禁止空泛的“完整 CRM” |
| `scope` | 目标用户、业务流程、部署、语言/地域、已知排除 |
| `targetQualityLevel` | L1 / L2 / L3；非必须一次达到 |
| `priority` | P0 / P1 / P2 / P3 |
| `licensePolicy` | 例如 `permissive-preferred`、`manual-legal-review`；不替代审计 |
| `acceptanceProfileId` | 对应类型和业务场景的可机验验收集 |
| `sourceStrategy` | `discover`, `preferred-source`, `first-party` |
| `constraints` | 技术栈、商业分发、生产环境、期限、预算约束 |
| `prototypeRequirements` | 仅应用模板可用，可为 0 个；原型是下属资源 |

可选：`preferredSources[]`（仅候选）、`maxCandidates`, `selectionPolicy`, `owner`, `budget`, `dependencies[]`, `batchTags[]`。不要设置“找到 N 个才能通过”的盲目数量指标。

## 目录、批次、工单的三个层级

1. **CatalogTarget**：长期稳定的目标，例如 `business.crm`；版本化更新需求。
2. **BatchPlan**：从目录中挑出本批条目，设定依赖、并发、预算、停止条件、有效审计范围。
3. **ProductionJob**：某个目标在特定时间的一次具体加工（可从候选评估启动或继续某个质量等级升级），记录输入 SHA、工作空间和 checkpoint。

同一 Target 的两个 Job 不得自动覆盖同一版本；同一依赖的升级先通过影响分析。目录依赖分为内部 `dependencies[]`（指向本 Catalog 已定义的 Target）与外部依赖 `externalDependencies[]`（必须保存来源、锁定版本/哈希、许可与审计状态）。未解决依赖可进入只读发现，但阻断代码生产及发布。

## 最小端到端示例

`business.crm` 要求：客户、联系人、商机、活动和权限基础路径；目标 L2；允许多候选；交付形式可能是 Native/Fork/Integration。发现阶段必须保留多个来源及各自许可证；如果没有合法可复用候选，允许 first-party 或不生产，并记录决策。不允许只因目录声明「L2」就向仓储标注「L2」。

## 动态目标变更

生产目录变更采用有版本的变更申请。修改核心能力/许可/地域时，应重新评估已产生的候选及证据；只调整 P 级优先级不自动修改已冻结的生产工作。所有拒绝、延期、取消应可追溯。

## 目录完成条件

至少：schema 可解析，目标清楚且可测试，有范围与排除项，有负责人，有显式目标等级，有生产预算/配额或待批状态。无法测试的模糊目标进入 `NEEDS_SPEC` 而非自动进入批量生产。
