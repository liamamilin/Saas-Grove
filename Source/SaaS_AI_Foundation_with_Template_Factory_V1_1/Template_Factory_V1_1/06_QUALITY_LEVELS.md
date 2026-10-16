# 06 — Template Quality Standard V1.1：分级质量规范

> **三个互相独立的轴**：质量 `L0–L3`、验证 `CATALOGED/VERIFIED/RELEASE_READY`、允许使用场景 `RESEARCH_ONLY/SANDBOX_ONLY/INTERNAL_ONLY/PRODUCTION_ELIGIBLE`。`L2` 并不自动意味着可部署到生产；发布适用 Foundation V1.0.1 `07_QUALITY_ACCEPTANCE.md` 的全部商业门禁。

## A. L0–L3（递进、限定范围）

| 级别 | 最小含义 | 正面证据 | 不能宣称 |
|---|---|---|---|
| **L0 Candidate** | 已登记候选，可能不可运行或许可未确认；非合格模板 | source/初筛/风险登记 | 可用、可部署、可销售 |
| **L1 Viable** | 在**限定、明示**的场景中安全可用；最小功能闭环 | 干净环境可复现构建；核心路径真实测试；所声明场景相关安全与版权审计通过；已知限制 | 其他未测场景可用、商用生产全就绪 |
| **L2 Standard** | 在声明业务范围内功能完整，安装配置、关键异常、权限和迁移可验证 | 集成/E2E、故障分支、文档、维护/恢复演练、正式接口契约 | 未测试的平台/环境支持 |
| **L3 Mature** | 经过强化的复用、升级维护、性能/可观测性与 UX 验证 | 多场景/真实项目复用、兼容/升级、长周期或故障演练、复审记录 | “完美、零漏洞、万能兼容” |

**证据与范围绑定**：认证应是一个 ScopedAttestation，键包含 `artifactSha256`、`scopeId`、`profileId@version`。不同 scope 不得共享已签发等级。一个模板可能 `L2` 适用于 Node 自托管单租户场景，但只 `L0` 适用于 K8s 多租户场景；Catalog 必须描述等级的适用范围，不能把单场景等级推广至全部场景。

## B. 所有级别的不可豁免安全与合规要求

`L0` 只能留在候选隔离区，不能正式发布。L0 可能已经在 Sandbox 中构建过，但仍缺许可、功能或安全证明；此时可以有真实制品 hash，却绝不可因此列为已认证或生产可用。入库成 L1 及以上至少需：可确认的合法使用与目标分发权限；无该范围内未缓解的关键安全/数据完整性风险；不包含密钥、盗用品牌或受限素材；真实构建/核心功能证据；来源和限制清楚。不能得出合法/安全结论时进入 `BLOCKED`，不是降低为 L1。

例如支付功能可以在 L1 完成模拟器与 Sandbox 闭环，但**只能标 `SANDBOX_ONLY`**；要在真实金额环境应用，需额外的真实支付通道、商户资质、回调验签、幂等、对账/回滚的强制专项验收，不以 L3 为替代。

## C. 与验证/环境/目录状态的区别

| 字段 | 负责回答 | 可取值 |
|---|---|---|
| `qualityLevel` | 达到何种质量成熟度 | L0 / L1 / L2 / L3 |
| `verificationStatus` | 做到了什么验收 | CATALOGED / VERIFIED / RELEASE_READY |
| `usePolicy` | 准许部署到哪里 | RESEARCH_ONLY / SANDBOX_ONLY / INTERNAL_ONLY / PRODUCTION_ELIGIBLE |
| `publicationStatus` | 是否对外展示/下载 | PRIVATE / LISTED / DEPRECATED / QUARANTINED / WITHDRAWN |

独立不意味着可任意组合：`L0` 只能为 `CATALOGED`、`RESEARCH_ONLY`、`PRIVATE`；L1–L3 至少为 `VERIFIED`，不得只有 `CATALOGED`；`PRODUCTION_ELIGIBLE` 需要发布专项门禁和人工签核；`WITHDRAWN` 禁止新安装，即使原来 L3。`INTERNAL_ONLY` 不自动允许接触公司真实生产数据，需环境审批。

## D. 门禁评估规则

单个 Gate 的记录只能为 `PASS/FAIL/BLOCKED/NOT_RUN/UNKNOWN`。必须列出对应验收 profile ID、环境、执行命令、commit、时间和产物 hash。所有 `mustPass` 项为 PASS 才能晋升，不允许平均分抵消 FAIL。

- L0→L1：来源与许可、干净构建、核心功能、明确限制、按支持范围安全检查。
- L1→L2：声明范围业务闭环、异常/权限、可用文档、关键 E2E/集成、安装及必要数据恢复。
- L2→L3：独立复用、长期升级、维护/迁移、负载或鲁棒性与 UX 证据；具体指标由对应类型 profile 锁定。

## E. 升降级与复审

- 质量晋升：固定 artifact SHA + 新证据 + Reviewer 确认后创建新 `ScopedAttestation`；旧制品不被无声改写。
- **降级/隔离**：发生严重漏洞、许可证撤销/争议、关键上游依赖失效时，立即 `QUARANTINED` 或限制 `usePolicy`；视需要撤销当前 attestation，不等于清除历史。
- 过期证据：超过某类 profile 的复审窗口时变为 `REVIEW_DUE`，对外可用状态按风险决定，不自动保持 `RELEASE_READY`。当前有效资格须按 `16_SCOPE_ATTESTATION_MODEL.md` 实时派生，不复制旧字符串。
- 无法到 L3：允许停在 L1/L2，但不得把它描述成完美商业模板。升级目标和实际级别分开记录。
