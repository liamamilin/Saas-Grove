# 14 — Gate Profiles V1.1：具体验收项

> 这是**验收基线草案**，需在实际试生产中把每项转成可执行验证器或人工审查表。自动检查仅负责能够客观验证的部分，不能代替专业安全、法律、生产发布审批。

## 通用准入 Gate（用于 L0→L1）

| Gate ID | 标准 | 有效证据 | 验收方式 |
|---|---|---|---|
| `G-ORIGIN` | 溯源清楚，来源 commit/tag、修改范围可追踪 | 锁定 SHA、provenance | 机器 + 人工 |
| `G-LICENSE` | 按发行方式证明代码、素材及依赖授权可接受 | SBOM、许可证全文、Notice、审查记录 | 人工主导 |
| `G-BUILD` | 声明环境中从干净工作区可重复构建/安装 | 命令、锁文件、构建日志、hash | 自动 + 复核 |
| `G-CORE` | 最小声明能力在独立环境通过测试 | 基于业务场景的 E2E/集成测试 | 自动 |
| `G-SECURITY` | 对声明场景无未缓解的关键风险；凭证/数据不泄漏 | 静态/依赖检查、权限负向测试、人工风险评估 | 混合 |
| `G-SCOPE` | 清楚列出已支持场景、未覆盖/仅 Mock 部分 | Manifest、README、Test Matrix | 审阅 |
| `G-ISOLATION` | 本次加工/测试没写入原业务/正式环境 | 四层隔离守卫报告 | 自动 + 复核 |

任何 `G-LICENSE`, `G-SECURITY`, `G-ISOLATION` 未明确 PASS 都阻断正式发布。L0 候选可以无此证据，但仅限候选隔离区。

## L1→L2 增量 Gate

| ID | 条件 |
|---|---|
| `G-DOMAIN-COMPLETE` | 声明的核心业务流程闭环（不强制覆盖未声明的行业全部功能） |
| `G-AUTHZ` | 多角色、对象级/租户级读写权限检查通过 |
| `G-FAILURES` | 关键异常、并发、重复/乱序、故障恢复场景测试通过 |
| `G-INSTALL` | 新用户可按文档独立安装和配置，缺失配置返回明确错误 |
| `G-MIGRATION` | 必要的升级/数据库迁移/回滚在测试环境复现 |
| `G-OPERATIONS` | 核心路径可排障（日志/追踪/标识）、维护责任与支持范围明确 |

## L2→L3 增量 Gate

| ID | 条件 |
|---|---|
| `G-REUSE` | 至少两个有区别的真实集成/使用场景验证复用（某些模块需要跨业务边界） |
| `G-UPGRADE` | 上游/依赖升级模拟和向后兼容/迁移回归被证明 |
| `G-RESILIENCE` | 负载、故障注入、数据恢复和运维可行性达到预先定义的阈值 |
| `G-UX` | 根据明确的目标用户任务，完成可用性与完整操作路径验收 |
| `G-MAINTENANCE` | 修复渠道、响应/支持策略、版本与弃用机制实际可执行 |

## 专项 Gate（按能力启用，不得人为省略）

| 类别 / 能力 | 必须追加的 Gate | 阻断示例 |
|---|---|---|
| 支付与账本 | `P-SIGN`, `P-IDEMPOTENCY`, `P-LEDGER`, `P-REFUND`, `P-CHANNEL-CAPABILITY` | 未验签、重复发权益、订单跨租户 |
| 真正收款上线 | `P-LIVE-QUALIFICATION`, `P-LIVE-TEST`, `P-RECONCILE` | 未具备商户资质、只跑了模拟器 |
| Business SaaS | `B-ROLE-ACL`, `B-DATA-INTEGRITY`, `B-DEPLOY` | 角色越权、业务迁移损坏数据 |
| 原型 integrated | `U-BINDING`, `U-LIVE-ACTION`, `U-PERMISSION`, `U-ASSET-LICENSE` | 拖拽成功动画不写真实数据、受限设计稿 |
| AI Native | `A-LIVE-MOCK-LABEL`, `A-JOB-RECOVERY`, `A-COST-LIMIT`, `A-ARTIFACT-ACL` | 把 Mock 写为 Live、越额消耗、产物泄漏 |
| SaaS + AI | `X-ADAPTER-AUTH`, `X-APPROVAL`, `X-PROMPT-INJECTION`, `X-TRACE` | Tool 用客户端权限、绕过审批 |

## 环境生产准入（不依赖 L 等级）

`PRODUCTION_ELIGIBLE` 必须通过 Foundation GA/安全/许可等全部相关 Gate，且有锁定制品 hash、部署范围、密钥/恢复方案、操作演练与人类发布审批。对于支付、AI 工具写操作、敏感客户信息和多租户，额外 Gate 按实际能力强制启动。即使 L3，若 `P-LIVE-TEST` 不通过，也只能是 `SANDBOX_ONLY`（支付业务场景）。

## Gate 锁定和版本化

- 每次生产从 `profileId@version` 固定门禁集，不得在测试失败时悄悄移除必需项。
- 新增范围会激活新的 conditional Gate；影响范围、产物 hash 和证据重验需要追踪。
- “完美模板”不是可衡量的认证级别；L3 仅代表符合特定 profile、范围和日期下的成熟门槛。
