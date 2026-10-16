# delegate-impl：强模型定契约 → Haiku 实现 → 强模型复核

这是一套**待安装的草稿**。我（Claude）没有权限也不应该自己改 `.claude/` 配置和 hooks，所以全部文件都放在这里，由你看过后执行安装。

## 为什么需要它

Claude Code 已经能把活派给 Haiku（子代理的 `model` 字段 / 派活时显式指定模型）。缺的是**纪律**：弱模型最常见的失败是"测试绿了、自报完成了，但意图落空"。本项目就发生过：flash 代理自报 P8 完成，实际租约不被强制；联签被做成"调用方自己填角色名"。这套工具把三条纪律固定下来：

1. 强模型把意图写成**契约测试**，并为每个"字面能过、意图落空"的做法写负向测试；
2. 弱模型**改不了**契约和受保护路径（hook 拦截 + 校验值兜底）；
3. 强模型**独立复核**，子代理的自报只是线索。

## 目录

```
delegate-impl/
├── install.sh                      安装脚本（你来执行）
├── skill/                          → ~/.claude/skills/delegate-impl/（全局）
│   ├── SKILL.md                    流程本身：前置检查 / 搭框架 / 派活 / 复核 / 裁决
│   ├── hooks/guard_paths.py        PreToolUse：子代理不得写受保护路径和契约测试
│   ├── hooks/verify_on_stop.py     SubagentStop：实现代理测试没绿不许收工（最多拦 2 次）
│   └── scripts/
│       ├── contract_lock.py        给受保护文件拍哈希快照，复核时比对
│       └── selftest.py             用模拟 hook 输入自测上面三个脚本
└── project/                        → 本项目的 .claude/（项目级）
    ├── agents/impl-haiku.md        实现代理：model: haiku，工具只有 Read/Edit/Write/Bash
    ├── delegate-impl.json          测试命令、受保护路径、契约路径、待办清单
    └── settings.hooks.json         两个 hook 的注册（写入 .claude/settings.json）
```

**为什么这样分**：流程是通用的，放全局；受保护路径、测试命令和硬约束是本项目特有的，放项目级。其他项目要用时，从 `~/.claude/skills/delegate-impl/templates/` 复制一份项目配置改路径即可。

## 安装会改动什么（逐项列出）

| 位置 | 动作 |
|---|---|
| `~/.claude/skills/delegate-impl/` | 新建（已存在则拒绝，除非 `--force`） |
| `.claude/agents/impl-haiku.md` | 新建 |
| `.claude/delegate-impl.json` | 新建 |
| `.claude/delegate-impl-canary.txt` | 新建（实测用的诱饵文件） |
| `.claude/settings.json` | 当前**不存在**，会新建，只含两个 hook；如果安装时已存在则**不动**，打印出来让你手动合并 |

不改：`~/.claude/settings.json`、`.claude/settings.local.json`、`factory-impl/`、`Source/`、`factory-v1.2/`。

安装（在项目根目录执行）：

```bash
bash harness-proposals/delegate-impl/install.sh
```

安装脚本最后会自动跑一遍 `selftest.py`（24 项）。

## 安装后的实测（第一次正式派活前做一次）

自测用的是模拟输入；下面这步验证真实环境里 hook 确实生效。

1. **新开一个会话**（新增的子代理定义可能要新会话才会加载；hooks 改动会被自动加载，不用重启）。
2. 让主会话派 `impl-haiku` 去做一件"违规"的小事：往 `.claude/delegate-impl-canary.txt` 追加一行。
3. 期望结果：子代理报告被 `delegate-impl guard` 拒绝；文件内容不变。
4. 如果它成功写入了：说明 hook 没生效（版本不支持或配置没加载），**不要开始正式派活**，先排查。

## 已知局限（如实说明）

- **Bash 拦截是启发式的**：靠"命令里出现受保护路径 + 有写操作"来判断，可以被绕过（比如用变量拼路径）。兜底是 `contract_lock.py verify`，它直接比对文件哈希，不依赖解析命令。
- **主会话不受 hook 限制**：hook 只在调用方带 `agent_type` 时生效。文档没有明确主会话调用一定不带这个字段；自测按"不带"处理。
- **子代理定义的加载时机未确认**：如果 `impl-haiku` 没出现在可用子代理列表里，新开会话。临时变通是用 general-purpose + 显式 haiku，但这时停止门控不会生效（路径拦截仍对所有子代理生效）。
- **全局默认子代理模型是 Sonnet**（`~/.claude/settings.json` 里的 `CLAUDE_CODE_SUBAGENT_MODEL`）。`impl-haiku` 在定义里写死了 haiku，skill 派活时也会显式传 `model: "haiku"`。
- **测试全绿只是收工的前提，不是验收结论**：验收结论来自主会话的复核（哈希比对 + 读改动 + 探针）。

## 卸载

```bash
rm -rf ~/.claude/skills/delegate-impl .claude/agents/impl-haiku.md .claude/delegate-impl.json .claude/delegate-impl-canary.txt
```

`.claude/settings.json` 如果只含这两个 hook，可以整个删掉；否则手动删掉那两段。
