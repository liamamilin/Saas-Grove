# 02 — Production Catalog（PROPOSED V1.2 文本，待合并回 Source）

> 本文件是 ADR-Factory-001 的提案修订版。相对 V1.1 的改动都以 **[V1.2]** 标出。硬门（许可/安全/租户/支付/发布审批）一律未降低。

## 目标

目录回答**我们希望生产什么**，不代表已有源代码或产品可交付。目录至少按 `resourceType`、业务能力、目标适用场景、目标等级、优先级、合规约束及预算描述需求，不提前指定唯一仓库。

**[V1.2] 术语**：`resourceType` 只能是 `saas-core-module | business-saas-template | ai-native-template | saas-ai-module` 四值之一。产品线历史代号 `L1–L4` **禁止**出现在 `resourceType`（schema 枚举直接拒绝）。质量等级只用 `qualityLevel: L0–L3`。

## CatalogTarget 必填字段 [V1.2]

| 字段 | 描述 | Schema |
|---|---|---|
| `id`, `name`, `resourceType` | 全局稳定 ID / 名称 / 四类资源之一 | required |
| `capabilitiesRequired[]` | 最小可验证能力 ID；禁止空泛的“完整 CRM” | required |
| `scope` | 目标用户、业务流程、部署、语言/地域、已知排除 | required |
| `targetQualityLevel` | `L1 / L2 / L3`；非必须一次达到 | required |
| `priority` | `P0 / P1 / P2 / P3` | required |
| `licensePolicy` | 例如 `permissive-preferred`、`manual-legal-review`；不替代审计 | required |
| `acceptanceProfileId` | 对应类型和业务场景的可机验验收集 | required |
| `sourceStrategy` | `discover / preferred-source / first-party` | required |
| `constraints` | 技术栈、商业分发、生产环境、期限、预算约束 | **required（V1.2 新增，CF-1）** |
| `budget`, `owner` | 预算与负责人 | required |

可选：`preferredSources[]`（仅候选）、`maxCandidates`（上界，用于控制发现规模）、`selectionPolicy`（选择规则）、`dependencies[]`、`prototypeRequirements`、`externalDependencies[]`、`batchTags[]`。

### `constraints`（CF-1）

```json
"constraints": {
  "stack": ["typescript", "postgres"],
  "distribution": "internal-only | commercial-resale | oss-redistribution | not-decided",
  "environments": ["sandbox"],
  "deadline": "2027-03-31",
  "notes": "free text"
}
```

`stack`、`distribution` 必填。`distribution` 记录**意图**，不等于许可证结论；许可证结论仍由 `G-LICENSE` 与 dispatcher/envelope 决定。

### `selectionPolicy` 与 `maxCandidates`（CF-1）

- `selectionPolicy.mode ∈ {MULTI_SOURCE_COMPARISON_REQUIRED, SINGLE_SOURCE_PERMITTED, FIRST_PARTY_ONLY}`，可带 `ruleRef`。
- `maxCandidates` 是**发现规模上界**。本规范明确**不**使用“找到 N 个才能通过”的盲目数量门槛（保持 V1.1 的原则）；多来源比较是过程要求，不是通过条件。

### `batchTags[]`（CF-1）

自由标签数组（`uniqueItems`），供 BatchPlan 选择与审计分面使用；不参与质量判定。

### 为什么保留 `additionalProperties:false`（CF-1）

V1.1 的缺陷是**文档字段未进 schema**，不是 schema 太严。V1.2 把文档已要求的字段补进 schema（`constraints / maxCandidates / selectionPolicy / batchTags`），**不**放开 `additionalProperties`，因此未记录字段依旧被拒绝。负例：`test_n7_catalog_target_missing_constraints_or_extra_field`。

## 目录、批次、工单的三个层级

1. **CatalogTarget**：长期稳定的目标，例如 `business.crm`；版本化更新需求。
2. **BatchPlan**：从目录挑出本批条目，声明依赖、并发、预算、重试/超时、**风险分类**、审批策略、**有效审计范围**、停止条件（详见 `11`）。
3. **ProductionJob**：某个目标在特定时间的一次具体加工；记录输入 SHA、工作空间与 checkpoint（schema：`production-job.schema.json`，**V1.2 新增，CF-8**）。

同一 Target 的两个 Job 不得自动覆盖同一版本；同一依赖的升级先通过影响分析。目录依赖分内部 `dependencies[]` 与外部 `externalDependencies[]`（必须保存来源、锁定版本/哈希、许可与审计状态）。

**[V1.2] 不变量（CF-9a，已由 `factory_rules.check_catalog_dependency_gating` 执行）**：存在未 `VERIFIED` 外部依赖的 Target 允许进入**只读发现**批次，但阻断任何 `executionMode != READ_ONLY` 的代码生产批次。负例：`test_n11_unresolved_dependency_blocks_code_production`。

## 最小端到端示例

`business.crm` 要求客户/联系人/商机/活动与权限基础路径；目标 L2；允许多候选；交付形式可为 Native/Fork/Integration。发现阶段必须保留多个来源及各自许可证；若无合法可复用候选，允许 first-party 或不生产并记录决策。不允许只因目录声明 L2 就向仓储标注 L2。

## 动态目标变更

生产目录变更采用有版本的变更申请。修改核心能力/许可/地域时，应重新评估已产生候选及证据；只调整 P 级优先级不自动修改已冻结的生产工作。所有拒绝、延期、取消可追溯，并形成 `change-impact-record.schema.json`（**V1.2 新增，CF-8**）。

## 目录完成条件

至少：schema 可解析，目标清楚可测试，有范围与排除项，有负责人，有显式目标等级，有生产预算/配额或待批状态。无法测试的模糊目标进入 `NEEDS_SPEC` 而非自动进入批量生产。
