# 16 — Scoped Attestation：版本、运行场景与分级判定（PROPOSED V1.2 文本，待合并回 Source）

> ADR-Factory-001 提案修订版。**[V1.2]** 标出改动（CF-4/CF-5）。

## 目的与防止的错误

同一 CRM 版本在本地单租户可能 L2，在生产级多租户可能仅 L0；不允许只保存一个 `qualityLevel` 再把 L2 推广到全部环境。独立持久认证对象是 **ScopedAttestation**，不是打分，也不是 LLM 的赞誉。

## 不可混淆的键

`resourceId + resourceVersion + artifactSha256 + scopeId + profileId@profileVersion` 唯一标识一份质量声明。

`scopeId` **必须**指向不可变 `ScopeDefinition`（`scope-definition.schema.json`，**V1.2 新增，CF-8**）：部署模式、OS/runtime、数据库、租户模型、地域/法规环境、关键功能集合、第三方通道（Mock/Sandbox/Live）、排除项。不同 scope 不允许自动继承质量等级。

`qualityLevel` 是此 scope 下**已通过**的最高等级；`targetQualityLevel` 只是目录意图。`verificationStatus` 是审核状态；`usePolicy` 是独立使用范围门禁；`publicationStatus` 是分发状态。**[V1.2]** 这些字段不再写在 payload manifest；`resource-state` 只作为 `defaultScopeId` 的展示投影，冲突时以有效签发记录与硬性风险覆盖为准。

## [V1.2 / CF-4] `usePolicy` 唯一真源

`usePolicy` **只**存在于 `DeploymentEligibilityDecision`（`deployment-eligibility-decision.schema.json`）：

```text
decisionId / resourceId / resourceVersion / artifactSha256 / scopeId
usePolicy / approvalId / decidedBy / decidedByRole / decidedAt / rationale
```

- `resource-state`、`acceptance-report` **不得**自持 `usePolicy`，只能通过 `deploymentEligibilityRef` 引用决策。
- `usePolicy=PRODUCTION_ELIGIBLE` 必须有非空 `approvalId` 且 `decidedByRole=RELEASE_APPROVER`；缺少决策或审批 → 拒绝（负例 `test_n6_production_eligible_without_decision_or_approval`）。
- `usePolicy` **绝不由 `qualityLevel` 推导**。L3 不自动等于可上线收款。

## 认证记录必填

- `attestationId`, `resourceId`, `resourceVersion`, `artifactSha256`, `scopeId`, `profileId`, `profileVersion`；
- **[V1.2]** `freezeId`, `payloadManifestSha256`（绑定冻结 payload）；
- `qualityLevel`（= `attestedLevel`）, `gateEvidenceIds`（按 Gate ID 引用独立 Evidence ID）, `evidenceIds`, `reviewerId`, `issuedAt`, `expiresAt`；
- `attestationStatus: DRAFT|ACTIVE|REVIEW_DUE|REVOKED|SUPERSEDED`、`limitations`, `reviewDecisionId`；
- **[V1.2]** `activeConditionalTriggers[]`（激活的专项门，驱动 CF-3 条件门强制）。

## 判定公式

```
attestation_is_effective =
  attestationStatus == ACTIVE
  AND now <= expiresAt
  AND payload_digest_matches              # artifactSha256 == freeze == state == evidence（CF-5）
  AND scope_id_matches
  AND profile_version_accepted
  AND attestedLevel <= profile.maxAttestableLevel
  AND all_mandatory_gates_HAVE_current_PASS_evidence
  AND all_ACTIVATED_conditional_gates_HAVE_PASS_evidence   # CF-3
  AND no_blocking_incident_or_license_change
```

未找到匹配则答复 **NOT_ATTESTED**，不是自称 L0；L0 仅候选状态。过期返回 `REVIEW_DUE` 并按风险限制下载/部署。上游漏洞出现可直接撤销 eligibility，即使质量认证暂未降级。

## [V1.2 / CF-5] 冻结先于认证

`17` 要求 payload 在 VALIDATE 前冻结。因此：

- `ScopedAttestation.artifactSha256` 必须等于 `ArtifactFreeze.artifactSha256`；
- 认证/审批对象通过 detached envelope 引用冻结 hash，**不得回写 payload**；
- 旧证据绑定旧 digest；非安全文档等无关变化也必须产生新 payload digest；证据复用受 `expiryPolicy.reusePolicy` 与 Reviewer 约束，不能无条件跳过。

（`factory_rules.verify_digest_chain`；正例 `test_cf5_...`，负例 `test_n2_...`。）

## 独立检查范围

开发、构建、L1/L2/L3 Gate、商业分发、生产部署是分开的决定。示例：微信支付 Sandbox 模板 L2，但生产商户资质/真实回调未验证，则只能 `SANDBOX_ONLY`。`PRODUCTION_ELIGIBLE` 只表示**适合进行指定生产部署**，不代表自动批准在任意组织的生产环境执行迁移/部署。

## 证据可信度与复用

证据绑定 `sourceCommit`, `artifactSha256`, `scopeId`, `profileId@version`, `validatorVersion`, `environment`, `collectedAt`；来源、制品或执行环境改变需影响分析，不能复制 PASS。
