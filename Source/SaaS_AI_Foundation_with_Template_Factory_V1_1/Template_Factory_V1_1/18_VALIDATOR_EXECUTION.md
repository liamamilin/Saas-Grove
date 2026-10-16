# 18 — Rule Engine 与 Schema：从“形状合法”到“结果可信”

## 验证器分层

| 层 | 处理对象 | 可以自动证明 | 无法自动证明 |
|---|---|---|---|
| 1 Schema | JSON 对象 | 必填/枚举/格式 | 实际可用性、安全、版权 |
| 2 Policy Rules | 多份 JSON 及状态 | L0 不可发布、哈希/范围匹配、必需 Gate PASS、证据过期 | Gate 证据是否真实 |
| 3 Evidence Verification | 原始 logs / test reports / sandbox | 已签名结果、命令/环境/digest/测试通过及负例 | 复杂商业许可的法律适用 |
| 4 Independent Review | 许可证、安全、业务验收 | 人类审阅结果有审批 ID、对象与范围 | 不能由 LLM 自动代签 |

正式 Builder 输出的自述不是证据。若某独立测试未执行，`NOT_RUN` 是正常状态，但不能用于晋升。不存在匹配 scope 的证据，必须 BLOCKED。

## V1.1 可运行参考

- `scripts/validate_examples.py`：示例 schema 与交叉字段检查（无真实构建）。
- `scripts/validate_attestation.py`：限定 Scope 下检查 Gate 结果、Evidence 的 digest、profile 版本、时间窗口和 actor 独立性；输出 METADATA_CONSISTENT / BLOCKED，代码可用作原型，不负责实际签名验证。
- `tests/test_factory_policy.py`：故意构造错误 digest、漏 Gate、过期、跨 scope、Builder 自评冒充验收等负例。

**重要限制：** 上述校验器目前只能对 JSON 字段做一致性判断，不能确认日志、代码、安全扫描或真人审批的真实性。正式产品需要证据签名、内容寻址存储、授权体系和实际测试执行器。在这些功能实现之前，不得将 JSON 的 ALLOW 宣称为已达到商业发布要求。

## 不变量

1. L0 不得 `RELEASE_READY / PRODUCTION_ELIGIBLE / LISTED`；L1–L3 必须至少 VERIFIED 且有对应有效认证。
2. `artifactSha256` 必须与所有用于强制 Gate 的 Evidence 一致；不可用占位哈希做真实 PASS。
3. `scopeId`, `profileId`, `profileVersion` 要完全匹配锁定的目标；不允许跨环境扩大声明。
4. 未列明的 Gate 不自动 PASS；FAIL/BLOCKED/NOT_RUN/UNKNOWN 都阻断强制 Gate。
5. 证据过期/来源不可信/验收人仅为 Builder/严重许可证安全事故都会阻断。
6. `qualityLevel` 不能大于 Profile 实际已经达到的最高级；`usePolicy` 不从等级推导。
7. 依赖必须已锁定并通过源/许可和版本要求，禁止无记录自动安装 latest。
8. 发布 id@version 的 digest 不可替换；修复必须新版本或受控新发行。
