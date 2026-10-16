---
name: delegate-impl
description: 强模型搭框架、Haiku 子代理实现、强模型独立复核的委派开发流程。当用户要求"用 haiku / 便宜模型写具体代码"、"你搭框架让弱模型实现"、"把这几项修复派给子代理做"，或要把一组已定义好的工作项交给弱模型实现时使用。Use when a strong model should write executable contracts (acceptance tests + signatures) and delegate implementation to a Haiku subagent, then verify independently.
---

# delegate-impl：强模型定契约，Haiku 实现，强模型复核

核心判断：弱模型最常见的失败不是"写不出来"，而是**满足字面、偏离意图**——测试绿了、自报完成了，但门禁被做成了摆设。所以这个流程的重心不在派活，而在两头：**契约要编码意图**，**复核不采信自报**。

本 skill 在主会话（强模型）里运行。Haiku 只出现在被派出去的子代理里。

## 0. 前置检查（每次开始前）

1. 项目里有 `.claude/delegate-impl.json` 和 `.claude/agents/impl-haiku.md`。没有就停下，告诉用户运行本 skill 目录下的安装说明（`README.md`）。**不要自己写 `.claude/` 下的配置或 hooks**——那是用户的决定。
2. 读 `.claude/delegate-impl.json`：测试命令、受保护路径、契约测试路径、待办清单文件（`pendingFile`）。
3. 确认没有别的写入者在改同一批文件：看目标目录最近几分钟的 mtime；查是否有其他代理进程在跑（例如 `ps aux | grep -E 'opencode run|claude'`）。有就停下问用户由谁接手。
4. 跑一次测试命令，记下基线（通过数、xfail 数、exit code）。基线不绿就先报告，不派活。

## 1. 搭框架（强模型亲手做，不委派）

把工作拆成**一项一派**的粒度，按依赖排序。默认串行：只要两项可能改同一个文件，就不能并行。

每一项写三样东西：

**a. WORKPLAN 条目**（项目的工作计划文档里）：
- 规则：行为的精确定义，包括边界情况；
- 签名：要新增或修改的函数/参数，写死名字和类型；
- 允许改的文件清单；明确禁止改的文件；
- **"字面 vs 意图"陷阱清单**：列出这项工作有哪些"测试能过但意图落空"的做法。例：联签要求 → 陷阱是"调用方自己填一个角色名就算签了"。每个陷阱都必须在 b 里有一条负向测试。

**b. 契约测试**（放在 `contractGlobs` 指定的目录）：
- 正向：合法路径能走通；
- 负向：每个陷阱一条，断言它被拒绝，并断言拒绝理由里有关键词；
- 用待办清单控制 xfail，而不是在测试文件里写死 xfail 标记——这样契约文件从头到尾一个字节都不用改：

```python
# conftest.py（框架阶段由强模型写好）
from pathlib import Path
import pytest
_PENDING = {l.strip() for l in (Path(__file__).parent / "PENDING_CONTRACTS").read_text().splitlines()
            if l.strip() and not l.startswith("#")}
def contract(item_id):
    """未完成的工作项按 strict xfail 处理：没实现时 xfail，实现后 XPASS 会让测试失败，逼着把 ID 从清单删掉。"""
    return pytest.mark.xfail(item_id in _PENDING, strict=True, reason=f"{item_id} pending")
```

**c. 必要的签名桩或辅助函数**（只在能帮弱模型对齐接口时写）。

框架写完后：
- 跑测试命令，必须是全绿（含 xfail），否则修到绿再继续——**绝不把红着的测试留给下一个人**；
- 锁定契约：`python3 <本 skill 目录>/scripts/contract_lock.py lock --out <scratchpad>/contract.lock.json`；
- 给要写入的目录拍快照（没有 git 时）：`rsync -a <目标目录>/ <scratchpad>/snap-<ID>/`；
- 在项目 ledger 里登记：每项状态 ⬜、派给谁、契约测试节点 ID。

## 2. 派活（一次一项）

用 Agent 工具：`subagent_type: "impl-haiku"`，**显式传 `model: "haiku"`**（用户全局可能配置了默认子代理模型，显式参数优先级最高），后台运行。

brief 模板（逐项填，不要省）：

```
工作项：<ID> — <一句话>
先读：<WORKPLAN 路径>#<ID 小节>；契约测试 <节点 ID 列表>
完成标准：
  1. 上述契约测试全部通过；
  2. 全量测试命令 `<testCommand>` exit 0；
  3. 从 <pendingFile> 里删掉且只删掉 <ID> 这一行。
允许修改：<文件清单>
禁止：修改契约测试文件；修改 <protectedGlobs>；删除或放宽任何已有断言；联网。
如果已有测试因接口变化需要改输入，只能改 WORKPLAN 明确列出的那几处调用参数。
契约测试看起来有错、或 WORKPLAN 有歧义：停下来报告，不要改测试来迁就实现。
交付报告：改了哪些文件；测试命令原文 + 输出最后 5 行 + exit code；哪些没做或有疑问。
```

## 3. 复核（强模型，必须独立）

子代理的报告是**线索，不是证据**。按顺序做，任何一步不过就进入 4：

1. `contract_lock.py verify --lock <scratchpad>/contract.lock.json`：受保护路径和契约测试零改动；待办清单只少了本项 ID。
2. 跑全量测试：契约测试从 xfail 变为 passed；总测试数不少于基线（没有删测试）。
3. 看改动：`diff -ru <scratchpad>/snap-<ID>/ <目标目录>/`。重点查：
   - 测试目录里被删的 `assert`、新增的 `skip`/`xfail`、被放宽的比较；
   - 实现里有没有针对测试数据的特判（硬编码测试里出现的 ID/字符串）；
   - 有没有静默吞异常、把 BLOCKED 改成 OK 的分支。
4. 写**测试之外的探针**（放 scratchpad，不进仓库），专门打陷阱清单里的每一条，以及契约没想到的组合。
5. 对照 WORKPLAN 的规则逐条确认，不只看测试。

## 4. 裁决

- **通过**：ledger 里把该项标 ✅，写上验证证据（测试输出原文、探针结果、"Haiku 自报 + 主会话复核通过"）。再派下一项。
- **不通过**：用 SendMessage 发回**同一个**子代理（保留它的上下文），给出具体失败（命令 + 输出 + 期望）。最多 2 轮。
- 2 轮后仍不过，或问题出在设计层面：强模型自己接手，或者重新拆分这一项。在 ledger 里如实记录"Haiku 未完成，由主会话完成"。

## 5. 何时停下来问用户

- 某项需要 WORKPLAN 里没有的设计决定；
- 实现某项必须放宽项目的硬约束或门禁（**绝不自行放宽**，标为 OPEN 并说明）；
- 发现别的会话或代理在同时写同一批文件；
- 需要修改 `.claude/` 配置、hooks 或权限。

## 诚实规则

- 报告里区分"子代理自报"和"主会话复核"，不要把前者写成后者。
- 测试数、exit code 一律贴命令原始输出。
- 没跑的验证写"未执行"，不写"应该没问题"。
