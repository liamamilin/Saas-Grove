# 17 — Immutable Release：修复“验收后打包”的证据缺口（PROPOSED V1.2 文本，待合并回 Source）

> ADR-Factory-001 提案修订版。**[V1.2]** 标出改动（CF-5 的 schema 化）。

## V1.0 的冲突

旧流程 `VALIDATE → APPROVE → PACKAGE`，但 Evidence 必须含 `artifactSha256`。若打包后修改 README、Notices、依赖或源码，最终摘要与测试对象不同，已通过 Gate 无法证明新制品质量。

## V1.1 的不可违反顺序（V1.2 保留并 schema 化）

1. `BUILD/CALIBRATE`：隔离改造、测试前期调试；可多次迭代，每次保留 attempt。
2. `STAGING_ARTIFACT`（= `PACKAGE_CANDIDATE`）：产生完整安装/分发 payload（源码或二进制、manifest **payload 视图**、锁文件、许可证/NOTICE、SBOM、安装说明），计算内容 digest，置为只读。
3. `VALIDATE`：Validator 在隔离环境中从**相同 digest 的 payload** 安装测试；每条 Evidence 引用该 digest 与 scope。
4. `APPROVE`：Validator 汇总 Gate；独立 Reviewer 检查许可证、安全与残余风险；Release Approver 按 digest+scope+profile 批准。
5. `PUBLISH`：仓储只上传相同 payload 字节，使用**独立 release envelope** 附签名、认证、SKU、权限与 registry 索引。不得回写已通过验收的 payload。
6. `RECHECK`：下载后重新哈希、必要时重装，证明交付仍是经验证的 payload。

## [V1.2 / CF-5] 冻结事件的对象化

V1.1 只描述了 freeze，没有 schema；`resource-manifest.schema.json` 反而要求 `evidenceIds`/`attestationRefs` 在 payload 内，形成循环。V1.2 明确：

- **`ArtifactFreeze`**（`artifact-freeze.schema.json`）记录：
  `freezeId, resourceId, resourceVersion, artifactSha256, payloadManifestSha256, frozenAt, frozenBy, fileList[], immutable=true`。
- **Payload manifest 只含内容**，禁含 `artifactSha256/qualityLevel/verificationStatus/usePolicy/publicationStatus/evidenceIds/attestationRefs/deploymentEligibilityRef/defaultScopeId`。
- `payloadManifestSha256` 是冻结时 manifest 内容视图的摘要；`artifactSha256` 是整个 payload 字节的摘要。
- **没有 `ArtifactFreeze` 记录，不得从 `STAGING_ARTIFACT` 进入 `VALIDATING`**（`07` 转移 11）。

## [V1.2] 汇总链

```
artifactSha256:  Evidence == ArtifactFreeze == ResourceState == ScopedAttestation
payloadManifestSha256: ArtifactFreeze == Evidence == ScopedAttestation
```

由 `factory_rules.verify_digest_chain` 与 `validate_attestation.check_attestation(freeze=..., state=...)` 执行。
- payload 内嵌认证字段 → 拒绝（`test_n1_...`）。
- `resource-state.artifactSha256 ≠ freeze.artifactSha256` → 拒绝（`test_n2_...`）。
- 正例见 `test_cf5_frozen_payload_and_digest_chain`。

## 验收失败如何返工

从 `VALIDATING` 发现错误后回到独立修复 attempt；老 payload、老测试与失败日志保留供审计，新改动创建新 digest。与老 digest 绑定的 PASS 不允许自动证明新 digest 合格。重新进入 `STAGING_ARTIFACT` 再测试；不得简单修改日志状态。

## 幂等与重试

`registryKey = resourceId@resourceVersion + artifactSha256`；相同 key 重试允许返回同一结果；同一 `resourceId@version` 但不同 digest 是**版本冲突**，不得静默覆盖。事故响应可隔离特定 digest，不擦除既有历史签发记录。

## 数据边界

认证与商品许可元数据放 **detached envelope**；用户下载时可附带单独的证书/NOTICE 索引，但不能让这一步修改待测试的原 payload。若发行方要求分发物本身包含签名文件，则应在 `STAGING_ARTIFACT` 时完成签名，并对最终字节整体重复校验。
