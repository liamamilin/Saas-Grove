# 独立复核报告 — factory-impl（2026-10-16，会话复核）

> 复核人：主 Agent（不是实现 Agent）。目的：**独立验证 `PROGRESS.md` 的自述**，不采信自报。
> 方法：直接跑 `pytest` + 写临时探针实测门禁行为（探针已删除）。

## 1. 与 ledger 自述的差异（重要）

| 项 | ledger 自述 | 实测结果 | 判定 |
|---|---|---|---|
| 测试 | "133 passed / exit 0" | **132 passed, 1 failed** | **自述过时/不准确** |
| 失败测试 | （未提及） | `test_engine_pipeline.py::test_validating_without_freeze_blocked` | 真实回归 |

失败根因（已定位）：
`engine/factory.py` `transition()` 的 Gate-11 校验里
```python
job.get("resourceVersion", "")   # 空串
```
被传入 `registry.get(...)` → `paths.check_id("")` 抛 **`UnsafeIdentifier`**。
即"未冻结就 VALIDATING"这条门禁**不是干净返回 blocked，而是崩溃（未捕获异常）**。
→ 属 **R-G 同类**（freeze 不绑定 job/attempt 导致查不到 freeze，进而走到空 version 分支）。

## 2. 门禁绕过——独立实测确认（不是转述 ledger）

用临时 pytest 探针直接驱动引擎，结果：

| ID | 探针动作 | 期望 | 实测 | 判定 |
|---|---|---|---|---|
| **R-B** | `DISCOVERING --PAUSE--> PLAN_APPROVED` | 必须拒绝（只可恢复到记录的先前阶段） | **`ok=True`，无 reasons** | **绕过确认** |
| **R-R** | `PLAN_APPROVED --BUILDER--> TRANSFORMING`（job `riskClass=READ_ONLY`） | 必须拒绝 | **`ok=True`，无 reasons** | **绕过确认** |
| **R-X** | 转移 5（`AWAITING_SELECTION -> PLAN_APPROVED`，doc 07 标注需 SLR 联签） | 必须要求联签存在 | **`ok=True`，`cosigners=None`（未回显亦未强制）** | **门禁未执行确认** |

**结论：ledger 对 R-B / R-R / R-X 的描述是真的，且绕过当前仍然活跃。**
这三条 + 失败测试属于"已标 DONE 的代码里的门禁缺陷"，优先级高于任何新功能（P9/P10）。

## 3. 未实测但 ledger 已列出的（应在实现中一并修）

R-C（PAUSE 洗掉 SLR 阻断）、R-D（行 20 被遮蔽）、R-A/R-E（幂等键）、R-F（预算边界）、
R-G（freeze 绑定）、R-P8（租约持久化）、R-DOC（缺失文档）。

## 4. 未改动声明

- 复核**未修改**任何实现或规范文件。
- `Source/**` 与 `factory-v1.2/**` 在本轮复核中**零修改**（只读）。
- 探针文件 `tests/test_zz_probe.py` 用后即删。

## 5. 修复优先级（建议，不得降门）

1. **P1 正确性/门禁**：失败测试 → R-G → R-B → R-C → R-X → R-R → R-D
2. **P2 功能**：R-A → R-E → R-F
3. **P3 完成度**：R-P8 → P9 Web UI → P10 文档 + 依赖清单
4. 每步必须：跑真实验证命令、记 exit code、更新 `PROGRESS.md` 状态列。

**不因"跑通"降低 license / security / tenant / payment / release-approval / L0–L3 任一门禁。**
