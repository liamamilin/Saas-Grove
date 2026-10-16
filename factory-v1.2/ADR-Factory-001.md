# ADR-Factory-001 — 分离冻结 payload 与脱离式认证，并修正 V1.1 规范缺陷

- **状态**：**APPROVED**（2026-10-16 由项目 Owner 批准 D1–D9；批准记录见 `ADR-Factory-001-APPROVAL.md`）
- **日期**：2026-10-16
- **范围**：`factory-v1.2/` 提案补丁包；不修改 `Source/**`（V1.1 冻结基线原样保留）。
- **依据**：`reports/factory-readonly/` Phase A 审计（`CONFLICT_AND_UNKNOWN.md`、`PHASE_A_SUMMARY.md`）、`15_COMPATIBILITY_NOTES.md` §“第一阶段审计输出”。

## 1. 背景

Phase A 只读审计在 V1.1 中发现 9 个冲突/漂移项与一批悬空对象。其中 **CF-5 最严重**：`resource-manifest.schema.json` 的 `required` 含 `evidenceIds`，且承载 `attestationRefs`，但 `04/10/17` 要求 payload 在 VALIDATE **之前**冻结、认证数据通过**不得回写**的 detached envelope 添加。于是 payload 必须预先包含 VALIDATE 之后才产生的字段 —— 循环哈希依赖，恰好破坏了 V1.1 想要保护的性质。

## 2. 决策

### D1（CF-5）把“内容”与“认证”在 schema 与哈希层彻底分离

- `resource-manifest` 改为**纯 payload 内容**。禁止：`qualityLevel, verificationStatus, usePolicy, publicationStatus, evidenceIds, attestationRefs, artifactSha256, deploymentEligibilityRef, defaultScopeId`（`additionalProperties:false` 直接拒绝）。
- 新增 `artifact-freeze`（冻结事件）、`resource-state`（冻结后投影/索引）、`deployment-eligibility-decision`（`usePolicy` 真源）。
- 新增汇总链不变式：`evidence.artifactSha256 == freeze.artifactSha256 == state.artifactSha256 == attestation.artifactSha256`；`payloadManifestSha256` 同理绑定。
- 参考引擎新增 `verify_payload_purity` / `verify_digest_chain`，并在 `check_attestation(..., freeze, state)` 中校验。

### D2（CF-1）按文档补齐 CatalogTarget 字段，不放开 schema

新增 `constraints`（required）、`maxCandidates`、`selectionPolicy`、`batchTags[]`，**保留 `additionalProperties:false`**。

### D3（CF-2）BatchPlan 补齐风险/重试/超时/审批/审计字段

新增 `riskClass`（`READ_ONLY|SANDBOX_CODE|EXTERNAL_SANDBOX_API|PRODUCTION_SENSITIVE`）、`retryPolicy`、`timeout`、`approvalStrategy`、`auditScope`、`dedicatedRiskExecution`；**`PRODUCTION_SENSITIVE` 只能出现在专用批次**（schema `const` + 规则引擎双保险）。

### D4（CF-3）GateProfile 补齐条件门模型

保留 `levels/reviewPolicy`，新增 `conditional[]`、`validationMethod`、`expiryPolicy`、`owner`、`maxAttestableLevel`；条件门被激活但未 PASS → BLOCKED；`attestedLevel` 不得超过 `maxAttestableLevel`。

### D5（CF-4）`usePolicy` 唯一真源

`usePolicy` 只在 `DeploymentEligibilityDecision`；`resource-state` 用 `deploymentEligibilityRef` 引用；`acceptance-report` 用 `deploymentEligibilityRef`。`PRODUCTION_ELIGIBLE` 必须有非空 `approvalId` 且 `decidedByRole=RELEASE_APPROVER`。`qualityLevel` 不推导 `usePolicy`。

### D6（CF-6）术语与大小写

`resourceType` 保持四值枚举并**拒绝** `L1–L4`；`verificationStatus` 统一为 `CATALOGED|VERIFIED|RELEASE_READY`；在 `docs/` 与 `schemas/README` 显式写明大小写约定。

### D7（CF-7）规范角色与转移表

唯一角色枚举：`PRODUCT_OWNER|DISCOVERY_AGENT|BUILDER_AGENT|VALIDATOR|SECURITY_LICENSE_REVIEWER|RELEASE_APPROVER`。新增 `state-transition.schema.json`；`docs/07` 给出**完整转移表**；旧称 `Builder/Build/Registry Controller` 映射到规范角色；Builder 不得自批发布。

### D8（CF-8）悬空对象 schema 化

新增 `production-job`、`scope-definition`、`change-impact-record`、`acceptance-report` 四个 schema；另附 `file-manifest` 统一文件清单约定（`path` 键）。其余对象仍为散文（见 §6）。

### D9（任务 6）Origin strategy

`resource-manifest.originStrategy ∈ {REUSE, INTEGRATE, BUILD_FROM_SPEC}`，每类有强制字段与验收要求；`REUSE` 许可证不允许预期分发时 **BLOCKED，绝不 auto-PASS**；`INTEGRATE` 必须保持外部系统独立且不得冒充交付第三方源码；`BUILD_FROM_SPEC` 必须第一方且禁止复用声明。

## 3. 未降低的硬门（显式承诺）

许可（`G-LICENSE`、licensePolicy、REUSE 分发许可）、安全（`G-SECURITY`）、租户隔离（`G-ISOLATION`、scope 绑定）、支付（`P-LIVE-*` 条件门）、发布审批（`RELEASE_APPROVER` + `approvalId`）、L0–L3 规则、以及“`UNKNOWN` 不得变 `PASS`”全部**保留或加强**。本 ADR 没有为“关闭”任何缺陷而降低门禁；若某缺陷只能靠降门关闭，则保持 OPEN（见 `REVISION_MANIFEST.md`）。

## 4. 理论一致性

- `resourceType`（是什么）与 `qualityLevel`（L0–L3 成熟度）、`verificationStatus`、`usePolicy`、`publicationStatus`、`implementationLevel` 保持正交。
- 遗留 `L1–L4` 是**产品线**，永远不是资源类型或质量等级。
- **schema PASS 永远不是商业认证**；示例与测试皆为合成数据。

## 5. CF 关闭表（详见 `REVISION_MANIFEST.md` 与 `TEST_REPORT.md`）

| CF | 主题 | 状态 | 证据测试 |
|---|---|---|---|
| CF-1 | CatalogTarget 字段缺口 | **CLOSED** | `test_cf1_...`, `test_n7_...` |
| CF-2 | BatchPlan 缺口 / 风险分类 | **CLOSED** | `test_cf2_...`, `test_n5_...` |
| CF-3 | GateProfile 漂移 | **CLOSED** | `test_cf3_...`, `test_n3_...`, `test_n4_...` |
| CF-4 | usePolicy 真源 | **CLOSED** | `test_cf4_...`, `test_n6_...`, `test_production_eligible_...` |
| CF-5 | 冻结/认证循环（最高优先） | **CLOSED** | `test_cf5_...`, `test_n1_...`, `test_n2_...` |
| CF-6 | 术语/大小写 | **CLOSED** | `test_n8_...` + 文档约定 |
| CF-7 | 角色漂移 + 转移表 | **CLOSED** | `test_cf7_...`, `test_n9_...` |
| CF-8 | 悬空对象 + 清单格式 | **CLOSED** | `test_cf8_...`, `test_cf8_file_manifest_convention` |
| CF-9 | 未强制的不变量（审计附加项） | **PARTIAL** | `test_n11_...`, `test_n12_...`, `test_n3_...` |

**PARTIAL 说明（CF-9）**：已用规则引擎强制三条例外不变量的可机验部分——(a) 未 `VERIFIED` 外部依赖阻断非只读批次；(b) `WITHDRAWN/QUARANTINED` 禁止新安装；(c) 等级不得超过 profile 上限。仍**未**强制：真实 Registry 的下载权限、引擎实际部署拒绝、以及所有散文级业务契约——这些需要真实执行环境，不在本提案（离线、无安装、无网络）范围内。**不宣称 CF-9 完全关闭。**

## 6. 有意保留为散文的对象（CF-8 说明）

以下对象**暂不做 schema**，理由是其形态高度依赖尚未实现的运行时，过早 schema 会冻结错误形状：

- `Batch Preview`（`11`）：是启动前的一次性展示视图，不是持久记录，可由 CatalogTarget+BatchPlan 派生。
- `DiscoveryRun` / `Candidate` / `SelectionDecision`：发现阶段记录，字段随来源类型差异极大；其**持久效力**已由 `evidence` + `selectionPolicy` 覆盖。
- `Artifact`（字节对象）与 `EvidenceBundle`：由 `artifact-freeze.fileList` + `resource-state.evidenceIds` 覆盖。
- `RegistryRelease`：由 `resource-state` + `publicationStatus` 覆盖。
- `PrototypeSubJob`：由 `production-job.parentJobId` + manifest `prototypeResources[]` 覆盖。

**判断**：这些对象不是“机器关键”的跨对象校验锚点；其关键字段已被上述 schema 表达。若后续试点证明需要独立生命周期，应另开 ADR，而不是现在猜。

## 7. 后果

- **正面**：payload 冻结与认证分离，循环哈希消除；文档字段可被 schema 接受；条件门、风险分级、角色、usePolicy 真源均可机验；V1.1 全部 19 个测试经适配后仍通过。
- **成本**：`resource-manifest` 的 `schemaVersion` 升到 `1.2`，V1.1 含认证字段的 manifest 会被拒绝——需要迁移（见 `COMPATIBILITY_IMPACT.md`）。
- **不可省略**：本 ADR 只修规范与参考规则；真实签名、内容寻址存储、隔离沙箱与人工审批仍**必须**在实现阶段建立。

## 8. 残留风险与 UNKNOWN（不因本 ADR 消失）

- U-1..U-7（Phase A）：远程候选 SHA/许可/安全、`bun.lock` 传递许可、微信支付沙箱语义、next-forge 逐包 SPDX、字体/商标分发、模型条款与成本、打包冻结范围意图 —— **仍然 UNKNOWN**，需真实来源与网络（本任务禁止）。
- 本包所有“PASS”仅为**元数据自洽**；对真实模板可用性、安全性、合法性的结论仍 **NOT_RUN**。
- CF-9 仍 PARTIAL（见 §5）。
- `Source/**`（V1.1 与 Foundation）保留遗留 `L1–L4` 产品线写法；未来合并时需人工决定是否改用语义型产品线名。

## 9. 请求的批准

1. 确认 D1–D9，特别是 D1（payload/认证分离）与 D5（usePolicy 真源）。
2. 确认 §3 未降低任何硬门，且 §8 的 UNKNOWN/残留风险被接受为“合并前仍需人工与真实环境验证”。
3. 批准后方可进行迁移与任何实现；**在批准前不得开始试点或产品实现**。
