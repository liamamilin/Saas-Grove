# 05 — 四条生产线的专项协议

## 共同流程（每个阶段必须有 exit artifact）

`SPECIFY → DISCOVER → ASSESS → SELECT → PLAN_TRANSFORM → BUILD → CALIBRATE → PACKAGE_CANDIDATE → VALIDATE → APPROVE → REGISTER`。

这些是**工作阶段**，不是资源质量等级；变更/驳回路径见 `07_STATE_MACHINE.md`。前段默认只读；不可信代码的执行只能在明确批准的沙箱中发生。阶段验收未满足不能继续。

| 阶段 | 输出证据 | 硬性退出条件 |
|---|---|---|
| SPECIFY | frozen target + acceptance profile | 目标具体可测、预算范围已批 |
| DISCOVER | candidate list + SHA | 候选可追踪，未查到则明确 NONE |
| ASSESS | license/risk/fit report | 法律、安全未知不视为通过 |
| SELECT | approved ADR | 方案明确、舍弃方案有理由 |
| PLAN_TRANSFORM | diff plan, checkpoint, sandbox config | 写路径、预算和回滚批准 |
| BUILD | patches + build report | 没有越权或污染；原项目不受损 |
| CALIBRATE | scenario review + remediation log | 目标业务行为与声明相符 |
| PACKAGE_CANDIDATE | payload digest、SBOM、Notices、安装资料及只读制品 | 必须先冻结待验制品；校验器针对该 digest 验收 |
| VALIDATE | evidence bundle、ScopedAttestation 草案 | 质量等级/环境门槛逐项有证据且绑定同一 digest |
| APPROVE | approver decision | 风险、许可、范围、等级均明示 |
| REGISTER | detached envelope + immutable payload + registry record | 批准后只添加元数据引用；签名、安装、回滚、撤回路径可用 |

## A — SaaS Core 模块

- 输入：目标功能契约、上游 SDK/模块/服务候选、目标运行时与支付/权限等专项约束。
- 产出：可独立安装模块 + Provider Adapter + API 示例 + 负向测试 + 配置/升级/运维文档。
- 必测：配置缺失、重复执行、权限/密钥隔离、并发/异常、模块卸载/升级影响；需要外部服务的应区分沙箱与真实环境。
- 支付专项：签名/验签、幂等、退款/乱序、订单与权益账本、对账、渠道能力矩阵；**无商户资质或 Live 证据，不得声称真实收款生产可用**。

## B — Business SaaS 模板

- 输入：业务目标、多个候选软件、领域对象与业务流程、许可限制、架构路线选择。
- 产出：Native / 合规 Fork / Integration 中的一种，包含业务模型、权限、部署与测试；0..N 下属原型。
- 必测：用户/组织/角色隔离、业务闭环、导入迁移与备份回滚、端到端操作、异常/并发场景。
- 原型生产：每个原型记录 coverage/implementationLevel/bindings；`integrated` 才可声称真实业务执行；切换同范围原型不得无声明变更领域核心。
- 多源拼合：需要数据权威边界与兼容性 ADR；禁止靠 UI 相似就认定是同一业务 SaaS。

## C — AI Native 模板

- 输入：应用执行模式（Chat/Workflow/Generator/Agent/Research/Knowledge）、模型供应商、工作流与安全边界。
- 产出：可运行前后端、模型 Provider Adapter、任务/执行/成本/产物记录、失败恢复和必要原型。
- 必测：Mock/Live 区分、超时/取消/重试、并发限额、预算耗尽、租户隔离、模型输出不可信、审计与安全审批。
- 如需真实模型验证：使用沙箱/受限测试 Key，预算上限与有限上下文，不将生产个人数据传至模型服务。

## D — SaaS + AI 模块

- 输入：通用 AI 功能需求、待集成 SaaS 的业务 API/数据/动作/授权模型。
- 产出：`core + adapter contract + reference integration`，将 SaaS 领域差异留给 adapter。
- 必测：越权否决、RAG/检索访问控制、Prompt 注入隔离、工具审批、审计、失败回滚；每个集成的权限由 SaaS 服务器裁决。
- 晋升 L3 前：至少两个**业务边界不同**的真实集成；证明第二个集成只新增 Adapter/配置、不改通用 AI 核心（若改动则重新审查抽象）。

## 停止和替代路径

任何生产线都允许：`改用其他候选`、`缩减声明范围`、`留在当前质量等级`、`转人工解决`、`归档`。不允许通过篡改验收标准、删掉失败测试或伪造 mock/live 标签来“完成批次”。
