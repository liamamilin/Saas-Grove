# Factory V1.2 · 机器可读规范的边界（PROPOSED，待合并回 `Source/.../schemas/README.md`）

提供 **15 份 JSON Schema**、示例与运行脚本。需要 Python 3.10+ 与 `jsonschema>=4`。

```bash
python3 scripts/validate_examples.py
python3 -m unittest discover -s tests -v
```

## Schema 清单

| Schema | 状态 | 作用 |
|---|---|---|
| `resource-manifest.schema.json` | **改（CF-5）** | **payload 内容视图**，禁含认证字段 |
| `artifact-freeze.schema.json` | **新（CF-5）** | 冻结事件：绑定 payload 字节与 manifest 摘要 |
| `resource-state.schema.json` | **新（CF-4/CF-5）** | 冻结后投影 / 仓储索引项 |
| `deployment-eligibility-decision.schema.json` | **新（CF-4）** | `usePolicy` 唯一真源 |
| `gate-profile.schema.json` | **改（CF-3）** | 保留 `levels/reviewPolicy`，新增 `conditional[]/validationMethod/expiryPolicy/owner/maxAttestableLevel` |
| `scoped-attestation.schema.json` | **改（CF-3/CF-5）** | 新增 `freezeId/payloadManifestSha256/activeConditionalTriggers` |
| `evidence.schema.json` | **改（CF-5/CF-7）** | 新增 `freezeId/payloadManifestSha256/actorRole` |
| `production-catalog.schema.json` | **改（CF-1/CF-6）** | 新增 `constraints/maxCandidates/selectionPolicy/batchTags` |
| `batch-plan.schema.json` | **改（CF-2）** | 新增 `riskClass/retryPolicy/timeout/approvalStrategy/auditScope` |
| `state-transition.schema.json` | **新（CF-7）** | 唯一角色枚举 + 完整转移记录 |
| `production-job.schema.json` | **新（CF-8）** | ProductionJob 追踪对象 |
| `scope-definition.schema.json` | **新（CF-8）** | `scopeId` 指向的不可变 ScopeDefinition |
| `change-impact-record.schema.json` | **新（CF-8）** | 变更影响记录 |
| `acceptance-report.schema.json` | **新（CF-8）** | 机器+人类可读验收报告 |
| `file-manifest.schema.json` | **新（CF-8）** | 统一 bundle 文件清单（`path` 键） |

参考引擎：`scripts/validate_attestation.py`（认证元数据一致性 + 冻结链）、`scripts/factory_rules.py`（跨对象不变量）、`scripts/validate_examples.py`（示例与交叉检查）、`scripts/generate_file_manifest.py`（清单生成）。

## 明确的能力边界

- 这些检查**只能发现形状与部分跨文档不变量错误**，无法证明签名真实、日志未被篡改、开源许可证允许分发、沙箱真正隔离、支付或 AI 调用真实成功。
- **schema PASS 不是商业认证。** 正式发行必须由真正独立的测试系统与人工审批完成。
- 示例中的 `example.invalid`、`UNBUILT`、`NOT_RUN`、以及所有 `SYNTHETIC DEMO` 记录都是刻意演示占位值，**不能**用作真实来源或认证材料。

## [V1.2] 术语与大小写约定（CF-6）

- `resourceType`：`saas-core-module | business-saas-template | ai-native-template | saas-ai-module`。历史产品线代号 `L1–L4` **禁止**作为 `resourceType`（schema 枚举拒绝）。
- `qualityLevel`：`L0 | L1 | L2 | L3`。
- `verificationStatus`：全大写下划线 —— **`CATALOGED | VERIFIED | RELEASE_READY`**（不以 CamelCase `Cataloged/Verified/Release-ready` 书写）。
- `usePolicy`：`RESEARCH_ONLY | SANDBOX_ONLY | INTERNAL_ONLY | PRODUCTION_ELIGIBLE`。
- `publicationStatus`：`PRIVATE | LISTED | DEPRECATED | QUARANTINED | WITHDRAWN`。
- 规范角色（`state-transition.role` 等）：`PRODUCT_OWNER | DISCOVERY_AGENT | BUILDER_AGENT | VALIDATOR | SECURITY_LICENSE_REVIEWER | RELEASE_APPROVER`。
