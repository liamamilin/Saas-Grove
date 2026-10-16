# 09 — 证据、审计结果与质量判定

## 证据对象模型

`Evidence` 不等于测试日志摘要。每条证据至少需要：

- `id`, `subjectId`, `gateId`, `result`（PASS/FAIL/BLOCKED/NOT_RUN/UNKNOWN）, `kind`；
- `sourceCommit`, `artifactSha256`, `scopeId`, `profileId`, `profileVersion`, `environment`（系统/依赖/配置/模拟或真实）, `validatorVersion`；
- `command` 或确定的审计方法、`outputUri`, `outputSha256`, `collectedAt`, `actor`；
- `scope`（覆盖哪个能力/租户/环境）、`limitations`, `reviewer`（如需人工）；
- 对 Live 证据记录**确实 Live 的证明**，不得将 mock 标签改名冒充。

支持 `SPEC/CODE/UNIT/INTEGRATION/E2E/BLIND/LIVE/LICENSE/SECURITY/RELEASE`，但具体 Gate 应声明接受的证据种类。仅模型产生的解释文本不能作为独立 `SECURITY PASS`。验收通过不仅要检查证据类型，还必须核对 artifact digest、scope、profile 版本、测试环境及过期时间。

## Gate 模型

`GateProfile` 定义：`profileId`, `resourceType`, `scope`, `mustPass[]`, `conditional[]`, `validationMethod`, `expiryPolicy`, `owner`, `version`。

- `mustPass` 中任何一项不 PASS → 质量升级/发布阻断。
- `conditional` 按资源能力决定是否启用：例如无支付业务则不需真实支付，宣称支持真实支付则必须执行专项 Live/合规 Gate。
- `NOT_APPLICABLE` 不能作为测试结果，只能由验收 Profile 声明此 Gate 不适用并附理由；不能由 Agent 随意删除检查。
- 安全/法律未知 → BLOCKED 等待审查，不能由算术评分填补。

## 多层质量验收

**机器层**：Manifest Schema、锁定依赖、可重复构建、测试报告、合规证据链接、签名/hash。

**场景层**：独立操作者用干净环境完成声明业务流程，验证授权、数据、迁移、出错恢复。

**反证层**：越权、重复回调、重放、Prompt 注入、错误依赖升级等负向测试能够拦截。

**人工层**：合规、可用性、架构与发行审批；人工判断必须记录对象及理由，不得替代可复跑的核心测试。

## 认证输出

每个入库制品必须有一份**Machine & Human 可读**的 `AcceptanceReport`：

```text
resourceId / version / sha256
qualityLevelAttested / verificationStatus / usePolicy
claimScope / excludedScenarios
profileIds / gateResults[] / evidenceIds[]
upstreamOrigins / licenseDecision / riskExceptions
remainingKnownIssues / reviewer / approvedAt / reviewDueAt
```

重大修改、依赖升级、许可变化或对应时限届满后重新验收；以前的 PASS 不能自动继承。独立 Validator 应核查证据确实对应当前制品 hash 和声明环境。签发的等级应落在 scoped attestation 中；manifest 的质量字段仅为展示快照。

## 明确不能自动宣称

- `npm test` 通过不意味着生产安全；
- 静态扫描通过不意味着没有漏洞；
- API mock 成功不意味着 Live 第三方服务已验收；
- README 宣称“MIT”不意味着所有代码和设计素材均可重卖；
- L3 不能推导“完全可用、完美软件”。
