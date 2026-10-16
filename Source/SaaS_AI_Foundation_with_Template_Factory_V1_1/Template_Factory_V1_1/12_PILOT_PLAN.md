# 12 — 工厂 V1.0 试生产方案与决策门槛

> 先做规范验证，不做全自动化平台。与 Foundation V1.0.1 `Phase 0`（只读审计）保持一致：只有完成 Phase 0、锁定源码版本、经过显式人工批准，才能开展隔离改造试点。

## Pilot 0：只读演练（所有后续工作的前置）

输入三条 CatalogTarget，执行目录 schema/能力规格检查、候选来源调研、许可证风险登记、多候选比较、预估分工。验收：能在完全不改源码、不执行不可信脚本的条件下，得出 `SELECT/REVIEW_REQUIRED/ABANDON`，所有 UNKNOWN 都有阻断说明。

## Pilot A：微信支付适配器（高风险功能模块）

- `resourceType: saas-core-module`；先限定 **Sandbox** 的统一订单创建、渠道状态查询、通知签名验证、重复事件幂等、退款（若该商户/沙箱支持），`targetQualityLevel: L1` 初步验证，最终目标 L3。
- 输入：官方 API 文档与经审计的 SDK/自建 adapter、测试商户或模拟响应、统一 Billing Core 契约。
- 关键负向：伪造签名、重复通知、订单串租户、已退款仍发权益、回调乱序、异常网络重试。
- 首次产物：Sandbox 可复现测试、功能矩阵、限制声明、SDK 许可报告；未获商户资质/真实支付演练前 `usePolicy=SANDBOX_ONLY`。
- **不得在试点中接真实收款**；取得生产准入是独立未来任务，不以 L3 标签替代。

## Pilot B：CRM 业务 SaaS（多候选/多原型）

- `resourceType: business-saas-template`；能力最小集合：客户/联系人/商机/跟进、角色与资源权限、主要 CRUD + 追踪；目标 L2，先从 L1 小闭环晋升。
- 多候选发现至少两个实际可审候选（若不足则明确），对比 Native/Fork/Integration 及对应商业许可；不以 GitHub Stars 择优。
- 交付一种可部署业务产品和一份适配 ADR；若试点证明原型机制，先用一个 integrated 原型、再尝试第二个共同覆盖范围的 UI，并审查能力绑定/数据不变性。
- 验收：干净环境运行、授权负向和业务 E2E、独立部署/恢复说明；原型切换不能偷偷改写领域服务或租户边界。

## Pilot C：AI Workflow App（AI Native）

- `resourceType: ai-native-template`；明确 `input → multi-stage execution → output artifact`；目标 L2，已验证后评估 L3。
- 真实/模拟的模型适配要区分；支持队列持久化、进度、失败重试、取消、成本上限、产物访问权限、执行日志。
- 验收：隔离环境多阶段成功路径 + 网络中断、模型超时、并发取消、预算耗尽、跨租户访问、恢复重跑等负向场景。
- 留痕：调用成本与执行上下文完整，任何真实调用需测试 Key、预算审批且不上传真实私人信息。

## 跨试点的工厂验收

1. 同一套 Catalog/Job/Evidence/ScopedAttestation/Registry schema 能准确表达三类不同资源，且没有为单个场景引入无法复用的特殊字段。
2. 从发现到选型再到 L1（如法律/技术条件允许）有真实可复现证据；不能达 L1 的记录为 Blocked，**这也是有效试点结果**。
3. 验证级别不能被误标为生产准入；人工能理解已有证据和不足。
4. 试点中任一次负向隔离测试，都能够明确阻断访问生产路径/凭证；所有原仓库及用户项目未被改写。
5. 可计算生产费用、人工审核成本、累计返工与维护风险；至少记一次候选被拒绝/替代的原因。
6. 资源完成后能从 Registry 查到正确版本、许可声明、hash、来源、测试、安装和撤回信息。
7. 若四种资源的第四种 `saas-ai-module` 尚未跑通，**不能宣称四线工厂通用性已完成**；完成上述三类后，还必须增加 AI Copilot + 不同业务适配器的小型试生产作为第四线检验。

## MVP 决策

Pilot 0 结束：决定是否允许 Sandbox Pilot。Pilot A/B/C 结束：评审要不要建设持久化 Orchestrator 与 UI。第四线试生产完成：才能声明“四库统一工厂”已被真实验证。任何一个阶段都不自动触发下一阶段。

## 与主项目计划的衔接

- 不替代 Foundation Phase 0 与后续质量 GA 门禁；只是为未来批量资源生产建立可复用协议。
- 先采用文件+CLI+Agent Harness 的轻量方式，避免在尚未证明价值前建设复杂服务。
- 保持 Blueprint / Learning Harness 学习产品仅在 Idea Backlog，不纳入本工厂 V1 实施范围。
