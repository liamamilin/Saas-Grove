# 04 — Resource Contract：交付物和元数据

## 基本结构

所有四类资源都须有：`manifest`、来源追溯、功能边界、公开契约、兼容性、安装/配置、测试、风险与限制、许可证/版权声明、维护策略、证据引用。**不能只有包装后的第三方 SDK 或截图。**

```text
resource-package/
  manifest.json              # 机器可读资源声明
  README.md                  # 能力与限制
  LICENSE/                  # 自有及适用的第三方许可
  THIRD_PARTY_NOTICES.md     # 如涉及第三方
  docs/INSTALL.md
  docs/CONFIG.md
  docs/UPGRADE.md
  docs/ROLLBACK.md
  docs/ACCEPTANCE.md
  tests/                    # 类型特定的真实检查
  provenance/ORIGINS.json    # 上游 URL、SHA、修改、素材来源
  evidence/INDEX.json        # 与独立证据存储的索引
  src/                       # 或服务接口/合法的外部引用
```

不同 `deliveryForm` (`NATIVE`, `FORK`, `INTEGRATION`) 可以有不同目录结构，前提是 manifest 清楚指出实际内容。`INTEGRATION` 模板不得冒充独立交付了第三方 SaaS 的源码。

## 关键元数据

- 身份：`schemaVersion`, `id`, `resourceType`, `name`, `version`, `maintainer`。
- 能力：`scope`, `capabilitiesProvided[]`, `dependencies[]`, `compatibility`, `configuration`。
- 来源：`origins[]`（可多）、上游 hash 和代码使用方式；第三方资产、商标、模型权重与服务条款独立登记。
- 原型：应用模板含 `prototypeResources[]`，原型各有独立 manifest/版本，声明 `ownerTemplate`, `coverage`, `implementationLevel`, `requiresCapabilities`, `bindings`，不得作为第五种公开产品线。
- 分级：`qualityLevel`, `verificationStatus`, `usePolicy`, `publicationStatus` 分开保存，并关联 `evidenceIds[]`, `approvalIds[]`；这些字段是**默认展示范围的派生快照**，真正的认证是按 `resourceId@version + artifactSha256 + scopeId + profileId@version` 锁定的独立 `ScopedAttestation`。禁止只改 manifest 等级就宣称晋升。参见 `16_SCOPE_ATTESTATION_MODEL.md`。
- 维护：`supportWindow`, `upstreamUpdateStrategy`, `knownLimitations`, `deprecationPolicy`。

## 类别专项包内容

| 类别 | 最少额外内容 |
|---|---|
| SaaS Core Module | 稳定 provider/功能接口、配置 Schema、独立集成样例、负向测试 |
| Business SaaS | 核心领域模型、业务 API、角色与权限、主要业务闭环、部署/升级说明；原型资源 0..N |
| AI Native | 模型/Provider 声明、任务/重试/预算/产物、日志/审计、模拟/真实测试标识；原型资源 0..N |
| SaaS + AI Module | AI 通用核心、数据/动作/权限 Adapter 契约、至少一个可真实运行的引用集成；正式成熟级需多场景验证 |

## 版本与发布

- 代码包版本、Prototype 版本、质量认证版本分开追踪；同一 `id@version` 制品内容必须不可变。Payload（包含源码/二进制、license notices、SBOM、安装资料）应在 VALIDATING 前已冻结；验收记录和仓储索引通过 detached envelope 引用该 hash，不得回写 payload。
- 修复安全漏洞或改变内容必须生成新版本、重新签发证据，不能用原 hash 冒充原版本。
- 上游 SHA、依赖锁定、SBOM、发布 provenance、许可证通知是发行必需资料。
- 本包示例 JSON 与 V1.1 规则校验器覆盖**元数据骨架和部分不变量**；完整业务契约和静态字段交叉验证需要专门的 Validator，不可凭 Schema PASS 宣称模板合格。

## 与现有 Prototype Contract 的一致性

使用 Foundation `12_PROTOTYPE_RESOURCE_SPEC.md` 的 1:N、`design-only / interactive-mock / integrated`、能力绑定、权限和素材许可规则。一个应用模板的某个 UI 可仅覆盖 page/flow，不因此宣称全应用可替换。

## 原型子任务（不是第五条生产线）

允许应用模板的 ProductionJob 派生 `PrototypeSubJob`，其字段至少包含 `parentJobId`、`ownerTemplateId/version`、`coverage`、`implementationLevel`、`requiresCapabilities[]`、`bindings[]`、素材许可/验收 Profile 与独立版本。它沿用 Business SaaS / AI Native 主任务的沙箱和审批流程；即使完成并独立版本化，也不能被 `CatalogTarget.resourceType` 登记为第五种公开类型。`parentJob` 可以部分完成、没有原型或只完成部分原型；其商业发行承诺依产品规格另行决定。
