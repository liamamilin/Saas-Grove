# Phase B 授权记录

- 日期：2026-10-16
- 决策来源：产品负责人（用户）显式授权

## 1. ADR-Factory-001 —— 条件批准

| 项 | 决定 |
|---|---|
| D1 payload/认证分离 | **接受**（架构决策） |
| D5 单一权限真相源 | **接受方向**；已进一步确认权限决策对象与验证链（见 §3） |
| CF-9 | 保持 **PARTIAL**，不得自动关闭 |
| U-1～U-7 | 保持实际状态，不得自动转为 PASS |
| `factory-v1.2/` | 作为 **Phase B 试行规范** |
| 合并至 `Source/` | **暂不合并** |
| V1.1 基线 / Checkpoint | 保留 |

### 批准的架构决策

`payload（内容）→ artifact-freeze（冻结摘要）→ resource-state（投影）→ scoped-attestation（范围认证）`
四者通过 `artifactSha256` / `payloadManifestSha256` 链式绑定；`usePolicy` 唯一真源为
`DeploymentEligibilityDecision`，由 `resource-state.deploymentEligibilityRef` 引用。

## 2. Phase B —— Discovery-only 授权

对 Pilot A/B/C 开展**真实联网候选发现**。仅做发现与推荐；**不自行批准后续源码改造**。

### 执行边界（硬）

- 允许：GitHub、项目官网、官方 API 文档、许可证原文。
- 写入：**仅** `reports/phase-b-discovery/`。
- 禁止修改：`Source/**`、`factory-v1.2/**`、既有基线。
- 禁止：执行/安装/构建第三方代码；使用真实支付凭据、模型密钥、生产数据。
- 禁止进入：Transformation、Calibration、Certification。
- **立即暂停条件**：来源超出批准范围 / 许可证重大不确定 / 需执行第三方代码 / 产生非预期写入。

## 3. D5 权限决策验证链（本次复核确认）

`deployment-eligibility-decision` schema：

- `required` 含 `usePolicy`、`approvalId`、`decidedBy`、`decidedByRole`、`artifactSha256`、`scopeId`。
- 条件约束：`usePolicy == PRODUCTION_ELIGIBLE` → `approvalId` 非空 **且** `decidedByRole == RELEASE_APPROVER`。

引擎 `check_use_policy()` 强制：

1. `resource-state` **不得**含 `usePolicy`（否则拒绝）。
2. `deploymentEligibilityRef` 指向的决策必须存在，且 `decisionId`/`artifactSha256`/`resourceId`/`resourceVersion` 全部匹配。
3. `PRODUCTION_ELIGIBLE` 需 `approvalId` + `RELEASE_APPROVER`；且 `qualityLevel ∈ {L1,L2,L3}`（未构建的制品不得生产就绪）。

已由 `test_cf4_use_policy_only_in_decision`、`test_n6_production_eligible_without_decision_or_approval`、
`test_production_eligible_with_decision_is_accepted` 覆盖。

## 4. 执行 harness（实际生效的强制层）

| 层 | 内容 |
|---|---|
| Agent | `.opencode/agents/factory-discoverer.md` |
| 网络 | `webfetch` 默认 **deny**，按域名白名单 allow（约 40 个 host） |
| Shell | 默认 **deny**；仅只读命令（`ls/cat/find/grep/head/tail/wc/sed/python3`）+ 只读 git（`status/log/rev-parse/ls-files/ls-remote/show`）+ `shasum/date` |
| 写入 | `edit` 默认 deny，仅 `reports/phase-b-discovery/**` allow |
| 密钥 | `.env`/`*.key`/`*.pem`/`id_rsa` deny |
| 策略 | `opencode.jsonc` 硬 deny `edit:Source/**` |

**注**：`websearch` 为独立工具，无 URL 级域名白名单；其返回内容仅作线索，任何候选仍必须通过
`webfetch` 在批准域名内取到许可证原文方可作为证据。已在该约束下记录此边界。

## 5. 交付要求

每个试点 7 项：候选清单+真实链接 / 版本+SHA+许可证+证据 / 功能与架构与维护分析 /
`REUSE`·`INTEGRATE`·`BUILD_FROM_SPEC` 适用性比较 / 拒绝原因与 UNKNOWN / 推荐方案+成本+风险 /
是否具备进入试生产条件。

输出：`reports/phase-b-discovery/{A_WECHAT_CANDIDATES,B_CRM_CANDIDATES,C_WORKFLOW_CANDIDATES,
LICENSE_EVIDENCE_INDEX,CAPABILITY_MATRIX,SELECTION_INPUTS,DISCOVERY_SUMMARY}.md`

## 6. 本轮完成即停止

Discovery 完成后提交报告供审查；**不自动进入源码改造**。
