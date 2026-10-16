# 16 — Scoped Attestation：版本、运行场景与分级判定

## 目的与防止的错误

同一 CRM 版本在本地单租户可能 L2，在生产级多租户可能仅 L0；不允许只保存一个 `qualityLevel` 再把 L2 推广到全部环境。独立持久认证对象是 **ScopedAttestation**，它不是打分，也不是 LLM 给出的赞誉。

## 不可混淆的键

`resourceId + resourceVersion + artifactSha256 + scopeId + profileId@profileVersion` 唯一标识一份质量声明。`scopeId` 必须包含/指向不可变 ScopeDefinition：部署模式、OS/runtime、数据库、租户模型、地域/法规环境、关键功能集合、第三方通道（Mock/Sandbox/Live）、排除项。不同 scope 不允许自动继承质量等级。

`qualityLevel` 是此 scope 下**已通过**的最高等级；`targetQualityLevel` 只是目录意图。`verificationStatus` 是审核状态，`usePolicy` 是独立的使用范围门禁，`publicationStatus` 是分发状态。manifest 可缓存一个 `defaultScopeId` 的 display projection；发生冲突时以有效签发记录和硬性风险覆盖为准。

## 认证记录必填

- `attestationId`, `resourceId`, `resourceVersion`, `artifactSha256`, `scopeId`, `profileId`, `profileVersion`；
- `qualityLevel`, `gateResults`（按 Gate ID 引用独立 Evidence ID）, `evidenceIds`, `reviewer`, `issuedAt`, `expiresAt`；
- `attestationStatus: ACTIVE|REVIEW_DUE|REVOKED|SUPERSEDED`、`limitations`, `reviewDecisionId`；
- `usePolicy` 必须由独立的 DeploymentEligibilityDecision 附 `approvalId` 决定，不从 `qualityLevel` 计算。

## 判定公式

```
attestation_is_effective =
  attestationStatus == ACTIVE
  AND now <= expiresAt
  AND payload_digest_matches
  AND scope_id_matches
  AND profile_version_accepted
  AND all_mandatory_gates_HAVE_current_PASS_evidence
  AND no_blocking_incident_or_license_change
```

未找到匹配则答复 **NOT_ATTESTED**，不是自称 L0；L0 仅候选状态。过期返回 `REVIEW_DUE` 并按风险限制下载/部署。上游漏洞出现可直接撤销 eligibility，即使质量认证暂未降级。

## 独立检查范围

开发、构建、L1/L2/L3 Gate、商业分发、生产部署是分开的决定。示例：微信支付 Sandbox 模板 L2，但生产商户资质/真实回调未验证，则只能 SANDBOX_ONLY。`PRODUCTION_ELIGIBLE` 只表示**适合进行指定生产部署**，不代表自动批准在任意组织的生产环境执行迁移/部署。

## 证据可信度与复用

证据绑定 `sourceCommit`, `artifactSha256`, `scopeId`, `profileId@version`, `validatorVersion`, `environment`, `collectedAt`；来源、制品或执行环境改变需影响分析，不能复制 PASS。非安全文档等无关变化也必须生成新 payload digest，能否通过验证器有限复用证据由锁定的 reuse policy 和 Reviewer 决定，不能无条件跳过。
