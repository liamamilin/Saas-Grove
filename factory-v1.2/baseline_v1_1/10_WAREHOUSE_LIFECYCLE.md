# 10 — Resource Warehouse：三仓与发行生命周期

## 三个隔离存储域

1. **Candidate Repository**：保存只读上游索引、候选元数据、风险/许可证报告、SHA；允许 L0/UNKNOWN，不开放给正式产品安装。
2. **Production Workspace**：隔离的临时构建/测试仓，每 Job 专属分支、checkpoint、日志、工单和制品草稿；不能直接覆盖已发布内容。
3. **Certified Registry**：保存发布通过的 immutable 资源包、签名/hash、SBOM、notices、manifest、验收证据/限制、下载权限及维护记录。对外是否可下载取决于 `publicationStatus`、`usePolicy` 和分发许可。

物理实现可以是 Git + 对象存储 + 索引数据库，不强制第一版部署复杂工厂专用服务器。三仓强调**信任/权限分界**，不必三个不同数据库。

## 资源索引

主索引：`resourceId`, `version`, `resourceType`, `qualityLevel`（展示快照）, `verificationStatus`, `usePolicy`, `publicationStatus`, `attestationRefs`, `compatibility`, `dependencies`, `origin`, `evidenceBundleId`, `artifactDigest`, `license`, `maintainer`。

Prototype 通过 `ownerTemplate.id/versionRange` 与 Application Template 关联；业务模板最多可有 N 个原型，但仓库不得自动把 `design-only` 展示为可直接运行的产品 UI。UI Pattern 可跨应用引用，不成为新产品线。

## 发行操作

- 发布前先构建并冻结 immutable payload（包括 SBOM、许可证和 Notice、安装资料），然后在该 payload 上执行 Gate；审批后仅添加脱离 payload 的签名/证书/仓储索引。payload 改动必须产生新 digest 和新的验收。
- Gate 与人类签核绑定制品 digest + 认证范围 + Gate Profile 版本；只有范围兼容且未过期的相同 digest 可以复用对应认证。
- `STAGED → VERIFIED → RELEASE_APPROVED → PUBLISHED` 每步留审计记录。
- 安装记录必须锁定资源版本和依赖闭包；不能在用户项目上直接自动拉最新上游分支。
- 更新采用新版本 + 迁移计划 + 兼容性对照 + 测试；可回滚到已知安全制品，但若旧版有安全问题，应明确禁用或提供修复版。

## 下架与事件响应

`DEPRECATED`：不再建议新项目采用，保留既有支持说明。

`QUARANTINED`：新安装禁用，旧用户获得影响范围、缓解/迁移说明；紧急缺陷可直接进入此状态，不等待例行发布审批。

`WITHDRAWN`：已撤回分发，记录法律/安全/质量原因；旧 hash、历史证据保留在受控审计范围内，不公开分发受限制品。

由 Registry Controller 强制阻止被隔离制品进入新生产批次；维护负责人负责上游漏洞、安全通报和定期重验。

## 商业交付

商品 SKU、授权价格和产品许可证与 Registry 技术状态分离。发布的源码/二进制/安装脚本必须含所需第三方 notice；即使产品对外只展示 Harness/CLI，也不能因此绕开开源许可和商标义务。
