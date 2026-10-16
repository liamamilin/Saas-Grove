# ADR-Factory-001 — 批准记录

- **日期**：2026-10-16
- **批准人**：项目 Owner（人类，本仓库所有者）
- **批准方式**：显式口头批准（会话内确认"批准"）
- **范围**：D1–D9 全部决策，无保留条件
- **授权解锁**：自本记录起，允许进入 `factory-v1.2/` 之外的最大实现阶段 —— 实现 Template Factory 可运行本体。

## 批准内容

| 决策 | 主题 | 状态 |
|---|---|---|
| D1 | CF-5 payload / 认证分离 | 批准 |
| D2 | CF-1 CatalogTarget 字段 | 批准 |
| D3 | CF-2 BatchPlan 风险分级 | 批准 |
| D4 | CF-3 GateProfile 条件门 | 批准 |
| D5 | CF-4 usePolicy 唯一真源 | 批准 |
| D6 | CF-6 术语与大小写 | 批准 |
| D7 | CF-7 规范角色 + 转移表 | 批准 |
| D8 | CF-8 悬空对象 schema 化 | 批准 |
| D9 | 任务6 originStrategy | 批准 |

## 批准**不**代表的事项（诚实边界）

本批准**仅**授权实现工厂机制。它**不**代表：

- 任何真实模板已通过安全、许可或商业验收；
- 任何第三方候选的来源/许可证/安全结论；
- 任何 `PRODUCTION_ELIGIBLE` 判定；
- 三个试点 A/B/C 的启动授权（需另行批准，且需联网与沙箱环境）。

`ADR-Factory-001.md` §3 的"未降低任何硬门"承诺在本批准后依然约束实现。实现不得为"跑通"而放松 license / security / tenant / payment / release-approval / L0–L3 任一门禁。

## 后续仍需人工决策（未因本批准消除）

1. License Reviewer 对 AGPL/GPL/BSL/SSPL 候选的裁定（Phase B 遗留）。
2. Product Owner 对三条 route 的确认。
3. 候选重新 pin 到 tag commit。
4. 是否把 v1.2 正式合并进冻结的 `Source/**`（本批准**不**包含此授权）。
