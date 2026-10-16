# 20 — V1.0 → V1.1 审计与修订记录

## 本轮确认的主要结构问题

| 编号 | V1.0 风险 | V1.1 修订 | 目前验证程度 |
|---|---|---|---|
| A-01 | 先 VALIDATE 后 PACKAGE，验收对象与最终分发物可能不一致 | `STAGING_ARTIFACT→VALIDATING→APPROVE→PUBLISHING`，detached envelope | 文档一致性 + 元数据负例测试 |
| A-02 | 一个 manifest 的质量级别不能表达多个部署环境 | 引入 `ScopedAttestation`、ScopeDefinition、有效性规则 | 示例与交叉字段校验 |
| A-03 | schema PASS 可能被误以为商业认证 | 分离 schema、policy、独立测试与人工审查 | 明确限定参考校验器边界 |
| A-04 | 失败重试未定义版本竞争及严格幂等 | 统一 resourceId/version/digest、attemptId、状态锁和 release 冲突语义 | 规格定义，未接真实队列 |
| A-05 | 正式仓储缺少上游变化对认证的影响机制 | ChangeImpactRecord、过期/隔离/重验 | 规格定义，待试生产 |
| A-06 | Catalog 可能包含未解析的外部前置依赖 | internal/external dependencies 分离并锁定 | 示例与检查规则 |
| A-07 | 部分术语 L1–L4 同质量 L0–L3 混淆 | 明确一律 `resourceType` 表示四类资源 | 已有和新 schema 检查 |

## 不属于已完成的工作

- 未实际 Fork/改造/审核任何第三方源码；未验证法务授权或支付生产资质。
- 未运行真实隔离 CI、模型 API 或 SaaS 全链路测试。
- 未实现真正可上生产的 orchestrator、内容寻址仓储、证据签名或人工审批系统。
- 当前 reference validator 只是设计规约的可运行示例，不是安全审计工具。

## V1.1 退出标准

1. 规范相互引用可解析，质量与状态机不互相矛盾。
2. 对合法示例接受；错误 digest、错误 scope、漏 Gate、过期证据、仅 Builder 自评、质量滥报等故意负例被拒绝。
3. 旧 Foundation V1.0.1 不被直接改写，Factory 使用兼容附录进行接口映射。
4. Agent Kickoff 仍保持 Phase 0 只读边界。

这些条件是**规范包自身**的验收，不等于任何一个 SaaS/AI 模板已经商业级。
