# 15 — 与 SaaS & AI Foundation V1.0.1 的集成说明

## 当前状态

本工厂文档以 **独立规范包** 发布，不直接修改此前冻结的 Foundation V1.0.1。正式合并到主项目时，应通过 Architecture Decision Record / 变更请求升级 Foundation 文档版本，并验证以下映射。

| 既有文档 | 应当补充 | 保持不变 |
|---|---|---|
| `00_README` | Template Factory 作为内部生产基础设施与阅读链接 | 四条产品线、商业目标 |
| `02_PRODUCT_LINES_SCOPE` | 四类资源使用同一个工厂生产；Prototype 是子资源 | L1–L4 产品线原有业务边界 |
| `03_TECHNICAL_ARCHITECTURE` | Catalog → Factory → Warehouse 的接口与隔离域 | SaaS Core/AI Runtime/Adapter 边界 |
| `04_MODULE_TEMPLATE_CONTRACT` | `qualityLevel/verificationStatus/usePolicy/publicationStatus` 及 Gate/Evidence/Provenance 关联 | 公开功能契约与 API |
| `06_OSS_IP_POLICY` | 多源合规矩阵、候选只读审计、发布前复审 | 开源/商标/素材法务硬门 |
| `07_QUALITY_ACCEPTANCE` | L0–L3 递进验收与环境准入分离 | 原商业发布硬门槛全部保留 |
| `08_ROADMAP` | 在正式批量生产前插入工厂规范与试生产验收 | Phase 0 先审计后开发 |
| `09_AGENT_KICKOFF` | 在 Phase 0 报告追加工厂资源可行性观察（不执行加工） | 现有只读权限限制 |
| `12_PROTOTYPE_RESOURCE_SPEC` | 原型子工作包、覆盖度与能力绑定验收 | 模板 1 → 0..N 原型及 mock/integrated 区分 |

## V1.1 新增的兼容条件

- 原 manifest 的 `qualityLevel` 视为指定默认 scope 的展示快照，而非跨环境有效认证；引入独立 ScopedAttestation。
- 原 Evidence 增加 `scopeId/profileId/profileVersion/validationRole`；旧记录必须明确迁移来源、覆盖范围及有效期，不能补字段就改为 PASS。
- 原批次 Candidate 允许 L0 在 Sandbox 已有制品 digest；在质量/安全/许可门槛之前仍不得发布。
- 原 Factory V1.0 的 `APPROVE→PACKAGE` 顺序由 V1.1 的冻结制品再验收流程取代，以 V1.1 为生产优先协议。

## 需要人工确认的术语变化

1. **旧版 `L1–L4` = 四条产品线。** 新版 `qualityLevel=L0–L3` = 质量等级。这两个编码不能混用；建议主项目未来改用语义型产品线名称。
2. Foundation 旧 `Cataloged / Verified / Release-ready` 对应 Factory 的 `CATALOGED / VERIFIED / RELEASE_READY`，不改变含义；Factory 额外引入 `usePolicy`。
3. 原型的 `implementationLevel`（design-only / interactive-mock / integrated）不等同 L0–L3 质量等级。
4. 如果已有 `GA` 发布要求比 Factory `L2` 更严格，执行原 GA 硬门，绝不弱化。
5. Learning Harness 与 Blueprint 的产品构想仍是 Idea Backlog，不在当前开发任务内。

## 第一阶段的审计输出

先产出一个 `ADR-Factory-001`：确认上述字段归属、错误处理语义、来源/版权范围、试点预算与唯一首发 Registry 形式。批准前不自动改写主项目规范和代码。
