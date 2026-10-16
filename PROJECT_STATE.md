# 项目开发情况 — 会话交接摘要（2026-10-16）

> 本文件是**会话级总览**，供下次接手时快速定位。详细状态见各目录自己的 ledger。

## 1. 项目全景

| 目录 | 是什么 | 状态 |
|---|---|---|
| `Source/SaaS_AI_Foundation_with_Template_Factory_V1_1/` | **冻结规范基线**（Foundation V1.0.1 + Factory V1.1） | 🔒 只读，从未修改 |
| `Source/next-forge/` | 候选底座副本（MIT，SHA `f189de7…`） | 🔒 只读 |
| `factory-v1.2/` | V1.2 规范修复提案包（ADR-Factory-001 + 15 schema + 引擎 + 测试） | ✅ 已批准为试行规范 |
| `factory-impl/` | **工厂可运行本体**（Python：CLI + 引擎 + 三仓 + API） | 🟡 实现中，有门禁缺陷 |
| `reports/factory-readonly/` | Phase A 只读审计（7 份） | ✅ 完成 |
| `reports/phase-b-discovery/` | Phase B 联网候选发现（9 份） | ✅ 完成，待人工裁决 |
| `.opencode/` | harness：4 个专用 agent + 运行器脚本 | ✅ |

## 2. 已完成的三条主线

**① Phase A 只读审计** → 三试点全 BLOCKED（无合法可复用来源），发现 CF-1~CF-9 规范缺陷。

**② ADR-Factory-001 规范修复** → `factory-v1.2/`：41 测试全绿，CF-5 循环哈希已修
（payload/认证分离），Owner 已批准（`ADR-Factory-001-APPROVAL.md`）。

**③ Phase B 联网发现** → 三试点全部 `CATALOGED`：
- A 微信支付：3 官方 SDK（Apache-2.0），**无官方 Node SDK**，沙箱 V2-only
- B CRM：7 候选 + 2 拒绝，**仅 Krayin（MIT）可闭源 fork**
- C AI Workflow：14 模块，成本上限/产物 ACL **需自建**

## 3. 当前焦点：`factory-impl` 门禁缺陷

Owner 随后批准实现工厂本体，已建 P0–P8（部分），但**已标 DONE 的代码里有真实门禁绕过**。

### 我方独立复核结论（`factory-impl/docs/INDEPENDENT_REVIEW_2026-10-16.md`）

| 项 | 自述 | 实测 |
|---|---|---|
| 测试 | 133 passed | **132 passed / 1 failed** |
| R-B 暂停恢复绕门 | 存在 | **实测确认活跃** |
| R-R READ_ONLY 进 TRANSFORMING | 存在 | **实测确认活跃** |
| R-X 联签不强制 | 存在 | **实测确认活跃** |

修复队列已排（P1 正确性 → P2 功能 → P3 完成度），正由 `factory-impl-dev` agent 长任务执行。

## 4. harness（每个 agent 只有单一写入域）

| Agent | 写入域 | 网络 |
|---|---|---|
| `factory-auditor` | `reports/**` | 无 |
| `factory-spec-fixer` | `factory-v1.2/**` | 无 |
| `factory-discoverer` | `reports/phase-b-discovery/**` | 白名单 `webfetch` |
| `factory-impl-dev` | `factory-impl/**` | 无 |

公共策略：`opencode.jsonc` 硬 deny `edit:Source/**`。

**已知并已修的 harness 缺口**：code-mode `execute` 的 `fetch()` 不受 `webfetch` 白名单约束
→ 已加 `execute`/`code` deny + `tool.use: execute:*` 策略（见 `HARNESS_GAP_execute_bypass.md`）。

## 5. 未关闭的人工关口（不可自动绕过）

1. **License Reviewer**：AGPL/GPL/BSL/SSPL 候选裁决（Phase B 遗留）
2. **Product Owner**：三条 route 确认
3. 候选 re-pin 到 tag commit
4. 是否把 `factory-v1.2` 合并进冻结的 `Source/**`
5. 三试点是否启动（需联网 + 沙箱，另行批准）

## 6. 硬约束（全程不可违反）

- 绝不修改 `Source/**`
- 不降低 license / security / tenant / payment / release-approval / L0–L3 门禁
- `UNKNOWN` / `NOT_RUN` 不得变 `PASS`
- schema PASS ≠ 商业认证
- payload 冻结先于验证；认证走 detached envelope
- Builder 不得自评签发；发布需 `RELEASE_APPROVER` + `approvalId`
