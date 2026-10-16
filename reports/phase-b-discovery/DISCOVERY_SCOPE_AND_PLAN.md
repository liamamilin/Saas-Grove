# Phase B — 只读联网 Discovery：范围与执行计划

> 状态：**待授权**（本文件只提交范围与计划，不执行任何联网动作）。
> 前置：ADR-Factory-001 规范修复通过人工复核。
> 依据：`12_PILOT_PLAN.md` §Pilot 0、`03_DISCOVERY_SELECTION.md`、`13_AGENT_KICKOFF.md` 只读边界、
> Phase A 审计 `reports/factory-readonly/{CANDIDATE_REGISTER,SELECTION_MATRIX,CONFLICT_AND_UNKNOWN}.md`。

## 1. 为什么需要这一步

Phase A 的三个试点全部 `BLOCKED`，根因**不是能力不足，而是没有可合法复用的来源**：

| 试点 | Phase A 结论 | 根因 |
|---|---|---|
| A 微信支付 | BLOCKED | 本地无 WeChat 源码（next-forge 仅 Stripe）；权威 API 离线不可核 |
| B CRM | BLOCKED/不足 | 唯一本地源是脚手架不是 CRM；≥2 候选规则无法满足 |
| C AI Workflow | PARTIAL | `packages/ai` 只有模型适配层，无持久化/队列引擎 |

Discovery 的唯一目标：**把"不存在可审来源"变成"有锁定 SHA、有许可证原文、可被 License Reviewer 裁决的真实候选"**。
它不生产、不安装、不选型定稿——只把候选摆到台面上。

## 2. 允许的联网范围（白名单）

只允许**读取**下列类别的公开信息，且只用于证据采集：

| 类别 | 允许 | 用途 |
|---|---|---|
| 公开代码托管 API | GitHub / GitLab / Codeberg 的 **read-only API**（仓库元数据、tag、commit SHA、`raw` 许可证文件） | 锁定 SHA、取 `LICENSE`/`NOTICE` 原文 |
| 公开包登记 | npm / PyPI / Maven / Go module proxy 的**只读元数据** | 依赖树、声明的 SPDX |
| 官方供应商文档 | 微信支付/支付宝开放平台文档、模型供应商文档 | API 能力矩阵、沙箱语义、服务条款 |
| 许可权威 | SPDX 许可清单、OSI | 许可证条款判定输入 |

**禁止**：下载并执行任何仓库代码；`npm/pip/curl` 之外的任意安装；克隆后运行 `postinstall`；注册任何账号；
提交表单；调用任何真实 API（支付/模型/短信）；购买任何服务。

## 3. 硬边界（与 Phase A 一致，不放松）

- 不修改 `Source/**`；不修改任何用户项目。
- 只写 `reports/discovery/`。
- 不把 `UNKNOWN` 写成 `PASS`；许可证争议只标 `REVIEW_REQUIRED`。
- 不因"README 说是 MIT"或"GitHub 顶部徽章"就判定许可证兼容——必须取**许可证全文 + 文件级 scope**。
- 不接触真实支付、真实模型 Key、真实用户数据。
- 不在 discovery 阶段做任何选型定稿（`SelectionDecision` 需 Product Owner + License Reviewer 联合签署）。

## 4. 分试点执行计划

### 4.1 Pilot A — 微信支付适配器（`saas-core-module`）

| 步骤 | 动作 | 证据产物 |
|---|---|---|
| A1 | 定位官方 WeChat Pay APIv3 服务端 SDK 的公开仓库（官方组织优先），锁定 tag+SHA | 仓库 URL、SHA、`LICENSE` 原文 |
| A2 | 记录 APIv3 能力矩阵：下单/查单/通知验签/退款/对账单 的官方文档出处 | 文档 URL + 摘要 + 抓取时间 |
| A3 | 判定沙箱语义：沙箱是否支持退款、回调签名与真实是否一致 | `UNKNOWN` 或文档证据 |
| A4 | 备选：第三方 Node 封装（仅登记，不推荐） | 许可证/维护活跃度 |

**注意**：商户资质无法在线获取 → 该渠道 `PRODUCTION_ELIGIBLE` 永远需要线下独立任务，Phase B 不解决。

### 4.2 Pilot B — CRM 业务模板（`business-saas-template`，**必须 ≥2 候选**）

| 步骤 | 动作 | 证据产物 |
|---|---|---|
| B1 | 发现 ≥2 个**真实 CRM 领域**候选（含 domain model，不是脚手架） | 仓库 URL、SHA、许可证 |
| B2 | 每个候选判定交付形态适配：`NATIVE`/`FORK`/`INTEGRATION` | 选型输入表 |
| B3 | 对标 Foundation 能力最小集：`customer.*`/`contact.*`/`opportunity.*` | 能力覆盖矩阵 |
| B4 | 许可证分类：MIT/Apache 直通；AGPL/GPL/SSPL/BSL 标 `REVIEW_REQUIRED` 并记录影响 | 分类结论 |
| B5 | 记录至少一次"候选被拒绝"的原因（满足 `12_PILOT_PLAN.md` 跨试点验收第 5 条） | 拒绝记录 |

### 4.3 Pilot C — AI Workflow（`ai-native-template`）

| 步骤 | 动作 | 证据产物 |
|---|---|---|
| C1 | 确认 `packages/ai` 适配层的真实能力边界（读代码，不运行） | 能力说明 + 文件路径 |
| C2 | 发现候选**持久化工作流/队列引擎**（durable execution 类） | 仓库 URL、SHA、许可证 |
| C3 | 对 copyleft/BSL 类做**使用方式**评估（非一概拒绝） | 分类结论 |
| C4 | 记录模型供应商的服务条款/数据政策边界 | 条款 URL + 摘要 |

### 4.4 第四线 `saas-ai-module`

Phase B **保持 scheme-only**。按 `12_PILOT_PLAN.md` 跨试点第 7 条：前三类未跑通前，
不得宣称"四库统一工厂"已完成。Phase B 只做**只读候选登记**，不产生任何集成。

## 5. 方法论（每条结论必须可追溯）

每个候选必须完成 `06_OSS_IP_POLICY.md` §4 的资产登记行：

```
name | upstream URL | commit/tag | SPDX/license text | author/copyright |
usage type (vendored/dependency/API/reference) | files reused | modification notes |
redistribution obligation | trademark/assets | security status | reviewer | date
```

每条关键结论附：**URL + SHA + 抓取时间 + 证据片段**。
取不到 → `UNKNOWN`；矛盾 → `REVIEW_REQUIRED`；两者都不许写成 `PASS`。

## 6. 输出物

```text
reports/discovery/
  DISCOVERY_SCOPE_AND_PLAN.md      (本文件)
  A_WECHAT_CANDIDATES.md
  B_CRM_CANDIDATES.md
  C_WORKFLOW_CANDIDATES.md
  LICENSE_EVIDENCE_INDEX.md
  CAPABILITY_MATRIX.md
  SELECTION_INPUTS.md              (供 Product Owner 决策，非定稿)
  DISCOVERY_SUMMARY.md
```

每份报告含：来源/证据、执行环境、`PASS/FAIL/BLOCKED/NOT_RUN/UNKNOWN`、主要风险、最小下一步、批准请求。

## 7. 停止条件（任一触发即停）

- 需要下载/执行任何候选代码。
- 需要注册账号、接受条款或提供任何凭据。
- 候选仅能找到闭源/无许可证来源且无替代。
- 触发任何真实支付/模型调用。
- 预算或时间超过本计划批准范围。

## 8. 执行 harness

- `opencode run --agent factory-auditor`（只读 agent，已存在）。
- 新增策略：为 Phase B 单独开 `webfetch`/`websearch` allow，且**仅限白名单域名**；
  其余写权限保持 deny（仅 `reports/discovery/**`）。
- 日志：`reports/discovery/_run.log`。

## 9. 授权请求

请明确批准或修改：

1. **联网白名单**（§2）是否足够，是否需要增删域名类别？
2. **Pilot B 的 ≥2 候选**：是否接受"官方 CRM 开源项目"作为候选类别？
3. **模型供应商文档**的读取是否授权（只读条款/能力，不调用 API）？
4. 是否授权在发现阶段记录**拒绝原因**（不产生选型定稿）？
5. 是否确认 Phase B 全程**只读、不安装、不执行候选代码**？

**未经上述批准，不启动任何联网动作。**
