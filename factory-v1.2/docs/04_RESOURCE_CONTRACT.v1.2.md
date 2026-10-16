# 04 — Resource Contract（PROPOSED V1.2 文本，待合并回 Source）

> ADR-Factory-001 提案修订版。**[V1.2]** 标出改动。硬门未降低。

## 基本结构

四类资源都须有：payload `manifest`、来源追溯、功能边界、公开契约、兼容性、安装/配置、测试、风险与限制、许可证/版权声明、维护策略。**不能只有包装后的第三方 SDK 或截图。**

```text
resource-package/
  manifest.json              # 【payload 内容，V1.2：只含内容，不含认证字段】
  README.md
  LICENSE/
  THIRD_PARTY_NOTICES.md
  docs/{INSTALL,CONFIG,UPGRADE,ROLLBACK,ACCEPTANCE}.md
  tests/
  provenance/ORIGINS.json
  evidence/INDEX.json        # 与独立证据存储的索引
  src/
```

不同 `deliveryForm` (`NATIVE`, `FORK`, `INTEGRATION`) 可有不同目录结构。`INTEGRATION` 模板不得冒充独立交付了第三方 SaaS 的源码（由 `originStrategy` 强制，见下）。

## [V1.2 / CF-5] Payload 与认证彻底分离

**这是 V1.2 最重要的修复。** `manifest.json` 是**冻结的 payload 内容视图**，它与认证/注册数据在物理和哈希上都分离。

### Payload manifest 只能包含

身份（`id/name/resourceType/version/maintainer`）、能力（`capabilitiesProvided[]/dependencies[]`）、`deliveryForm`、`origins[]`、`originStrategy`、`prototypeResources[]`、`knownLimitations[]`、`licenseReport`、`installGuide`、`testPlan`。

### Payload manifest 明确禁止包含（`additionalProperties:false` 直接拒绝）

`qualityLevel`、`verificationStatus`、`usePolicy`、`publicationStatus`、`evidenceIds`、`attestationRefs`、`artifactSha256`、`deploymentEligibilityRef`、`defaultScopeId`。

理由：payload 在 VALIDATE **之前**冻结，而这些字段在 VALIDATE **期间或之后**才产生；把 `evidenceIds`/`attestationRefs` 放进 payload 会形成循环哈希依赖，即审计项 CF-5。payload 也**不可能**包含自己的 `artifactSha256`。

### 认证数据放在脱离 payload 的对象里（detached envelope）

| 对象 | 作用 | Schema |
|---|---|---|
| `ArtifactFreeze` | 冻结事件：绑定 payload 字节（`artifactSha256`）与 payload manifest 视图（`payloadManifestSha256`） | `artifact-freeze.schema.json` |
| `ScopedAttestation` | 范围化质量认证 | `scoped-attestation.schema.json` |
| `ResourceState` | 冻结后投影 / 仓储索引项（缓存 `qualityLevel/verificationStatus/publicationStatus`） | `resource-state.schema.json` |
| `DeploymentEligibilityDecision` | `usePolicy` 的唯一真源 | `deployment-eligibility-decision.schema.json` |
| `AcceptanceReport` | 机器+人类可读的验收报告 | `acceptance-report.schema.json` |

**不变式（由 `factory_rules.verify_digest_chain` 执行）**：
`evidence.artifactSha256 == freeze.artifactSha256 == state.artifactSha256 == attestation.artifactSha256`。
负例：`test_n2_state_digest_not_equal_freeze`；payload 纯度负例：`test_n1_payload_manifest_embedding_certification_refs`。

## 关键元数据

- 身份：`schemaVersion`, `id`, `resourceType`, `name`, `version`, `maintainer`。
- 能力：`capabilitiesProvided[]`, `dependencies[]`, `compatibility`, `configuration`。
- 来源：`origins[]`（可多）、上游 hash 与代码使用方式；第三方资产、商标、模型权重与服务条款独立登记。
- **[V1.2] `originStrategy`（任务 6）**：三选一，各有强制字段与验收要求：
  - `REUSE`：必须 `upstreamUrl` + `lockedRevision` + `licenseTextRef` + `licenseDistributionPermitted` + `acceptanceRequirementRef`；许可证若不允许预期分发，则 **BLOCKED，绝不 auto-PASS**（由 `factory_rules.check_origin_strategy` 强制）。
  - `INTEGRATE`：外部系统保持独立（`externalSystemSeparate: true`），且 **不得** 冒充交付第三方源码（`deliversThirdPartySource: false`，schema `const`）；必须审计 API/服务条款（`externalSystemTermsRef`）。
  - `BUILD_FROM_SPEC`：第一方（`firstParty: true`）；**禁止**复用声明（不得出现 `upstreamUrl/lockedRevision/licenseTextRef`）；spec/contract 即来源（`specRef`）。
- 原型：应用模板含 `prototypeResources[]`，原型各有独立 manifest/版本，声明 `ownerTemplate/coverage/implementationLevel/requiresCapabilities/bindings`，不得作为第五种公开产品线。
- 分级：`qualityLevel / verificationStatus / usePolicy / publicationStatus` **分开保存**，但 **[V1.2] 不在 payload 内**；它们只出现在 `resource-state`（展示快照）与签发对象中。真正的认证按 `resourceId@version + artifactSha256 + scopeId + profileId@version` 锁定。禁止只改投影等级就宣称晋升。
- 维护：`supportWindow`, `upstreamUpdateStrategy`, `knownLimitations`, `deprecationPolicy`。

## 类别专项包内容

| 类别 | 最少额外内容 |
|---|---|
| SaaS Core Module | 稳定 provider/功能接口、配置 Schema、独立集成样例、负向测试 |
| Business SaaS | 核心领域模型、业务 API、角色与权限、主要业务闭环、部署/升级说明；原型 0..N |
| AI Native | 模型/Provider 声明、任务/重试/预算/产物、日志/审计、模拟/真实测试标识；原型 0..N |
| SaaS + AI Module | AI 通用核心、数据/动作/权限 Adapter 契约、至少一个可真实运行的引用集成；正式成熟级需多场景验证 |

## 版本与发布

- 代码包版本、Prototype 版本、质量认证版本分开追踪；同一 `id@version` 制品内容不可变。
- **[V1.2]** payload（含源码/二进制、license notices、SBOM、安装资料）在 VALIDATING 前冻结并产生 `ArtifactFreeze`；验收记录与仓储索引通过 detached envelope 引用该 hash，**不得回写 payload**。
- 修复安全漏洞或改变内容必须生成新版本、重新签发证据，不能用原 hash 冒充原版本。
- 上游 SHA、依赖锁定、SBOM、发布 provenance、许可证通知是发行必需资料。
- 本包示例 JSON 与 V1.2 规则校验器覆盖**元数据骨架和部分不变量**；完整业务契约与静态字段交叉验证需要专门的 Validator，**不可凭 schema PASS 宣称模板合格**。

## 与 Prototype Contract 的一致性

沿用 Foundation `12_PROTOTYPE_RESOURCE_SPEC.md` 的 1:N、`design-only / interactive-mock / integrated`、能力绑定、权限与素材许可规则。某个 UI 只覆盖 page/flow，不因此宣称全应用可替换。

## 原型子任务（不是第五条生产线）

允许应用模板的 ProductionJob 派生 `PrototypeSubJob`（`parentJobId`、`ownerTemplateId/version`、`coverage`、`implementationLevel`、`requiresCapabilities[]`、`bindings[]`、素材许可/验收 Profile 与独立版本）。它沿用主任务沙箱与审批，完成后也**不得**被登记为第五种公开 `resourceType`。`parentJob` 可部分完成或无原型。
