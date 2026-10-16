# harness/

让 agent 照着模板把产品做出来，并独立验收和审查。同时也负责跑 A/B 对比实验。

## 用法

```bash
# 生成并冻结一份"普通用户"的需求（只生成一次，之后每次实验都用它）
node harness/user-sim.mjs --out experiments/<实验>/user-brief.md

# A 组：拿着模板，分阶段构建
node harness/build.mjs new  --blueprint ai-research-assistant --brief experiments/<实验>/user-brief.md
node harness/build.mjs step --run <run-id>                     # 跑到下一个人工确认点为止
node harness/build.mjs approve  --run <run-id>                 # 确认通过，进入下一阶段
node harness/build.mjs feedback --run <run-id> --review        # 或者把审查意见（或 --notes <文件>）交回去再改一轮
node harness/build.mjs status   --run <run-id>

# B 组：不给模板，只给用户需求和可测性契约
node harness/baseline.mjs new --blueprint ai-research-assistant --brief experiments/<实验>/user-brief.md
node harness/baseline.mjs go  --run <run-id>                   # 一直跑到 agent 说 DONE（最多 6 轮），然后用 S4 验收打分
```

记录都在 `runs/<run-id>/harness/` 下：`journal.jsonl`（每一次 agent 调用和验收的耗时、token、结果）、`STATUS.md`（汇总）、`logs/`（agent 的完整事件流和回复）、`verify/`（验收报告和应用日志）、`reviews/`（独立审查报告）。

## A 组每个阶段的流程

1. **构建**：builder agent（`open-design/deepseek-v4.1-flash`）在 `runs/<id>/app/` 里实现当前阶段，它可以自己跑验收。
2. **快照**：harness 把运行目录提交成一次 git commit。
3. **验收**：用主仓库里的**模板原件**跑本阶段（含之前所有阶段）的测试。
4. 没通过：把失败的测试和应用日志末尾交回 builder，重做（默认最多 6 次，之后停下来等人）。
5. 通过：reviewer agent（`open-design/deepseek-v4-pro`，只读，不能执行命令）对照 spec 审查代码，找测试漏掉的问题。
6. **人工确认点**：人看验收结果和审查报告，然后选择 `approve`（进入下一阶段）或 `feedback`（再改一轮）。

## B 组的输入为什么是这样

B 组拿到用户需求，外加模板的**可测性契约**（`api.yaml` 和 `architecture.md` 的 §5–§8：假模型、测试接口、启动约定、界面锚点）。没有这份契约，任何黑盒测试都没法给它打分。B 组拿不到的是：成熟产品定义、容易做错的地方、难点设计、分阶段计划、品类认知，以及验收测试本身。

契约里列出了全部接口，等于把功能清单透露给了 B 组，所以这样测出来的 A/B 差距是模板价值的**下限**。

## 隔离

- 每个运行目录都是一个独立的 git 仓库。agent 的权限配置（`.opencode/`、`opencode.jsonc`）由 harness 在每次调用前重新写入，agent 改了也不会生效。
- builder 只能用编辑工具改 `app/`；读不到 `.env`、`*.pem`、`*.key`；不能访问运行目录之外的路径；不能联网查资料（安装 npm 包除外）；不能 `git push`、`sudo`、`brew`。
- reviewer 不能编辑、不能执行任何命令。
- 验收永远用主仓库里的模板原件，agent 改动自己那份副本没有任何作用。

**已知局限**：builder 可以执行 shell 命令，而 shell 不受编辑权限的限制，理论上能写到 `app/` 以外的地方。这一点靠"验收用原件"兜底，没有沙箱隔离。

## 已经踩过的坑（都已在代码里处理）

- opencode 用 `$PWD` 而不是进程的工作目录来定位项目。用 Node 启动子进程时必须同时设置 `PWD`，否则它会去父目录找 agent，报 `Agent not found`。
- 共享的后台服务会缓存配置，而且由它创建的会话会一直绑在旧配置上。所以 harness 的所有 opencode 调用都用 `--standalone`，也不会在第一次调用之前先导出会话。
- 会话 ID 必须以 `ses` 开头。

## 验证过的事

2026-10-17 做过一次金丝雀测试，以 opencode 记录下来的工具调用结果为准，不看 agent 自己怎么说：builder 往 `app/` 写文件成功；用编辑工具改 `blueprint/` 被拒绝（`Permission denied: edit`）；读运行目录之外的 `.env` 被拒绝（`Permission denied: external_directory`）。reviewer 的生效权限是"禁止一切编辑和 shell"（用 `opencode debug agents` 核对）。验收管道能用模板原件跑空应用、得到报告，并把失败原因整理成修复提示。
