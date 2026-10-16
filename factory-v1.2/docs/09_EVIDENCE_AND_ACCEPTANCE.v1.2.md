# 09 — 证据、审计结果与质量判定（PROPOSED V1.2 文本，待合并回 Source）

> ADR-Factory-001 提案修订版。**[V1.2]** 标出改动（CF-3 条件门、CF-5 冻结链）。

## 证据对象模型

`Evidence` 不等于测试日志摘要。每条证据至少需要：

- `id`, `subjectId`, `gateId`, `result`（`PASS/FAIL/BLOCKED/NOT_RUN/UNKNOWN`）, `kind`；
- `sourceCommit`, `artifactSha256`, `scopeId`, `profileId`, `profileVersion`, `environment`, `validatorVersion`；
- `command` 或确定的审计方法、`outputUri`, `outputSha256`, `collectedAt`, `actor`；
- `scope`、`limitations`、`reviewer`（如需人工）；
- **[V1.2]** `freezeId`、`payloadManifestSha256`（当证据对应已冻结 payload 时，用于 CF-5 汇总链）；
- **[V1.2]** `actorRole`（规范 6 角色之一，见 `07`；与 `validationRole` 是**不同轴**，后者是证据校验角色）。

`ValidationRole`（证据轴）保持 V1.1：`BUILDER | INDEPENDENT_VALIDATOR | LICENSE_REVIEWER | SECURITY_REVIEWER | RELEASE_APPROVER`。对 Live 证据记录**确实 Live 的证明**，不得把 mock 改名冒充。仅模型产生的解释文本不能作为独立 `SECURITY PASS`。

## [V1.2 / CF-3] Gate 模型

`GateProfile`（`gate-profile.schema.json`）定义：

| 字段 | 说明 |
|---|---|
| `profileId`, `profileVersion`, `resourceType`, `scopeId` | 身份与范围绑定 |
| `owner` | **V1.2 新增**：该 profile 的负责人 |
| `validationMethod` | **V1.2 新增**：`{type: MACHINE|HUMAN|MIXED, procedureRef?}` |
| `expiryPolicy` | **V1.2 新增**：`{maxAgeDays, reviewWindowDays?, reusePolicy?}` |
| `levels{L1,L2,L3}` | 保留 V1.1：各级必须的最少 Gate ID 列表 |
| `conditional[]` | **V1.2 新增**：`{gateId, trigger, description, requiredWhenActivated}` |
| `reviewPolicy` | 保留 V1.1：`{independentValidatorRequired}` |
| `maxAttestableLevel` | **V1.2 新增（可选）**：该 profile 允许的最高认证等级上限 |

- `conditional[].trigger ∈ {PAYMENTS, AI_LIVE, PROTOTYPE_INTEGRATED, TENANT_MULTI, PII, EXTERNAL_API}`。当某 scope/声明**激活**该 trigger 时（见下），对应 `gateId` 成为**必须 PASS 的条件门**。
- 激活来源：`ScopedAttestation.activeConditionalTriggers[]`（声明并受 schema 约束）与 `scope-definition` 的第三方通道/租户模型。
- **不变式**：条件门被激活但未 PASS → **BLOCKED**。由 `validate_attestation.check_attestation` 执行；负例 `test_n4_activated_conditional_gate_without_pass`。
- `mustPass` 语义由 `levels` 表达（任何一项不 PASS → 阻断）。
- `NOT_APPLICABLE` 不能作为测试结果；只能由验收 Profile 声明此 Gate 不适用并附理由，不能由 Agent 随意删除检查。
- 安全/法律未知 → BLOCKED 等待审查，不能由算术评分填补。
- **[V1.2]** `attestedLevel` 不得超过 `maxAttestableLevel`；由 `check_attestation` 执行；负例 `test_n3_attested_level_exceeds_profile_max`。

## [V1.2 / CF-5] 冻结链（payload ≠ certification）

V1.2 明确：**payload 在 VALIDATE 之前冻结**，认证在冻结**之后**产生，二者以 digest 关联，绝不互相回写。

```
ArtifactFreeze.artifactSha256
  == Evidence.artifactSha256
  == ResourceState.artifactSha256
  == ScopedAttestation.artifactSha256
ArtifactFreeze.payloadManifestSha256 == Attestation/Evidence 的 payload manifest digest
```

由 `factory_rules.verify_digest_chain` 执行；正例 `test_cf5_frozen_payload_and_digest_chain`，负例 `test_n2_state_digest_not_equal_freeze`。payload manifest 本身不得含认证字段（`factory_rules.verify_payload_purity`；负例 `test_n1_...`）。

## 多层质量验收

**机器层**：Manifest Schema、锁定依赖、可重复构建、测试报告、合规证据链接、签名/hash。
**场景层**：独立操作者用干净环境完成声明业务流程，验证授权、数据、迁移、出错恢复。
**反证层**：越权、重复回调、重放、Prompt 注入、错误依赖升级等负向测试能够拦截。
**人工层**：合规、可用性、架构与发行审批；人工判断必须记录对象及理由，不得替代可复跑的核心测试。

## 认证输出

每个入库制品必须有一份**Machine & Human 可读**的 `AcceptanceReport`（`acceptance-report.schema.json`，**V1.2 新增，CF-8**）：

```text
resourceId / resourceVersion / artifactSha256
qualityLevelAttested / verificationStatus
deploymentEligibilityRef        # 【V1.2/CF-4】usePolicy 的唯一真源引用
claimScope / excludedScenarios
profileIds / gateResults[] / evidenceIds[]
upstreamOrigins / licenseDecision / riskExceptions
remainingKnownIssues / reviewer / reviewerRole / approvedAt / reviewDueAt
```

**[V1.2 / CF-4]** 报告**不含** `usePolicy` 字段；它通过 `deploymentEligibilityRef` 指向唯一真源 `DeploymentEligibilityDecision`（含 `approvalId`）。`usePolicy` 不从 `qualityLevel` 推导。

重大修改、依赖升级、许可变化或时限届满后重新验收；以前 PASS 不自动继承。独立 Validator 应核查证据确实对应当前制品 hash 与声明环境。签发等级落在 scoped attestation 中；`resource-state` 的质量字段仅为展示快照。

## 明确不能自动宣称

- `npm test` 通过不意味生产安全；
- 静态扫描通过不意味没有漏洞；
- API mock 成功不意味 Live 第三方服务已验收；
- README 宣称“MIT”不意味所有代码和设计素材均可重卖；
- L3 不能推导“完全可用、完美软件”；
- **schema PASS 不是商业认证**，本包示例是合成数据。
