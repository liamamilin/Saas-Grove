# 10 — Resource Warehouse：三仓与发行生命周期（PROPOSED V1.2 文本，待合并回 Source）

> ADR-Factory-001 提案修订版。**[V1.2]** 标出改动（CF-4/CF-5 数据归属）。

## 三个隔离存储域

1. **Candidate Repository**：只读上游索引、候选元数据、风险/许可证报告、SHA；允许 L0/UNKNOWN，不开放正式产品安装。
2. **Production Workspace**：隔离的临时构建/测试仓，每 Job 专属分支、checkpoint、日志、工单、制品草稿；不能直接覆盖已发布内容。
3. **Certified Registry**：发布通过的 immutable 资源包、签名/hash、SBOM、notices、manifest、验收证据/限制、下载权限与维护记录。对外是否可下载取决于 `publicationStatus`、`usePolicy` 与分发许可。

三仓强调**信任/权限分界**，不必三个不同数据库。

## [V1.2 / CF-5] 三仓的数据归属

| 数据 | 存放位置 | 是否可回写 payload |
|---|---|---|
| payload（源码/二进制、manifest 内容视图、锁文件、NOTICE、SBOM、安装资料） | 冻结制品（payload 字节） | —（冻结后不可变） |
| `ArtifactFreeze` | detached envelope / Registry 索引 | 否 |
| `ScopedAttestation`、`Evidence`、`AcceptanceReport` | detached envelope / 证据仓 | 否 |
| `ResourceState`（索引项，缓存 `qualityLevel/verificationStatus/publicationStatus`） | Registry 索引 | 否 |
| `DeploymentEligibilityDecision`（`usePolicy` 唯一真源） | detached envelope / 审批记录 | 否 |

**任何认证/审批对象都不得写回 payload。** payload 改动必须产生新 digest 与新验收。

## [V1.2] 资源索引

主索引（`resource-state.schema.json`）：`resourceId, resourceVersion, artifactSha256, qualityLevel（展示快照）, verificationStatus, publicationStatus, attestationRefs[], evidenceIds[], deploymentEligibilityRef, defaultScopeId`。

- **[V1.2 / CF-4]** `usePolicy` **不在**索引项里，只通过 `deploymentEligibilityRef` 引用独立决策；索引不得自持 `usePolicy`（`factory_rules.check_use_policy` 强制）。
- L0 只能是 `CATALOGED + PRIVATE`；L1–L3 至少 `VERIFIED` 且有至少一个 `attestationRefs`（schema 条件约束）。
- `LISTED` 必须有 `RELEASE_READY` 与 `deploymentEligibilityRef`（schema 条件约束）。
- **[V1.2 / CF-9b]** `WITHDRAWN` / `QUARANTINED` 禁止新安装（`factory_rules.check_installable`；负例 `test_n12_...`）。

Prototype 通过 `ownerTemplate.id/versionRange` 与 Application Template 关联；业务模板最多 N 个原型，但仓库不得自动把 `design-only` 展示为可直接运行的产品 UI。UI Pattern 可跨应用引用，不成为新产品线。

## 发行操作

- 发布前先构建并冻结 immutable payload（含 SBOM、许可证/NOTICE、安装资料），在该 payload 上执行 Gate；审批后仅添加脱离 payload 的签名/证书/仓储索引。payload 改动必须产生新 digest 与新验收。
- Gate 与人类签核绑定制品 digest + 认证范围 + Gate Profile 版本；只有范围兼容且未过期的**相同 digest** 可复用对应认证。
- `STAGED → VERIFIED → RELEASE_APPROVED → PUBLISHED` 每步留审计记录。
- 安装记录必须锁定资源版本与依赖闭包；不能在用户项目上直接自动拉最新上游分支。
- 更新采用新版本 + 迁移计划 + 兼容性对照 + 测试；可回滚到已知安全制品，但旧版有安全问题时应明确禁用或提供修复版。

## 下架与事件响应

`DEPRECATED`：不再建议新项目采用，保留既有支持说明。
`QUARANTINED`：新安装禁用，旧用户获得影响范围、缓解/迁移说明；紧急缺陷可直接进入此状态，不等例行发布审批。
`WITHDRAWN`：已撤回分发，记录法律/安全/质量原因；旧 hash、历史证据保留在受控审计范围内，不公开分发受限品。

由 **RELEASE_APPROVER**（V1.1 称 Registry Controller，见 `07` 映射）强制阻止被隔离制品进入新生产批次；维护负责人负责上游漏洞、安全通报与定期重验。

## 商业交付

商品 SKU、授权价格与产品许可证与 Registry 技术状态分离。发布的源码/二进制/安装脚本必须含所需第三方 notice；即使产品对外只展示 Harness/CLI，也不能因此绕开开源许可与商标义务。
