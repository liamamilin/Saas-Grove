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
node harness/baseline.mjs go  --run <run-id>                   # 一直跑到 agent 说 DONE（最多 6 轮），然后用 S4 验收打分，再由同一个审查员审一遍最终代码
node harness/baseline.mjs review --run <run-id>                # 单独重跑最终审查（`go` 里已包含）
```

运行目录默认在 `/Users/Shared/saas-template-runs/<run-id>/`（可以用 `HARNESS_RUNS_DIR` 改）。之所以放在家目录之外，见下面的"隔离"一节。每个运行目录下有两部分：

- `project/`：agent 的工作范围，本身是一个 git 仓库，用来存快照；里面有 `app/`（产品）、`blueprint/`（模板副本，A 组才有）、`brief/`（用户需求，B 组还有测试接口约定）；
- `records/`：harness 自己的记录，agent 看不到。包括 `state.json`、`journal.jsonl`（每次 agent 调用和验收的耗时、token、结果）、`STATUS.md`（汇总）、`logs/`（agent 的完整事件流和回复）、`verify/`（验收报告和应用日志）、`reviews/`（独立审查报告）、`sandbox.sb`（这次用的沙箱配置）。

## A 组每个阶段的流程

1. **构建**：builder agent（`open-design/deepseek-v4.1-flash`）在 `runs/<id>/app/` 里实现当前阶段，它可以自己跑验收。
2. **快照**：harness 把运行目录提交成一次 git commit。
3. **验收**：用主仓库里的**模板原件**跑本阶段（含之前所有阶段）的测试。
4. 没通过：把失败的测试和应用日志末尾交回 builder，重做（默认最多 6 次，之后停下来等人）。
5. 通过：reviewer agent（`open-design/deepseek-v4-pro`，只读，不能执行命令）对照 spec 审查代码，找测试漏掉的问题。
6. **人工确认点**：人看验收结果和审查报告，然后选择 `approve`（进入下一阶段）或 `feedback`（再改一轮）。

## B 组的输入为什么是这样

B 组拿到用户需求，外加模板的**可测性契约**（`api.yaml` 和 `architecture.md` 的 §5–§8：假模型、测试接口、启动约定、界面锚点）。没有这份契约，任何黑盒测试都没法给它打分。B 组拿不到的是：成熟产品定义、容易做错的地方、难点设计、分阶段计划、品类认知，以及验收测试本身。

B 组做完并验收之后，harness 才把 `spec/` 和 `stages/` 拷进它的 `blueprint/` 目录，让审查员对照审查；审查员和提示与 A 组相同（只改一句话，说明产品不是照模板做的）。这样“审查发现数”可以直接比较。注意 A 组每个阶段审一次、共 5 次，B 组只审最终代码一次。

契约里列出了全部接口，等于把功能清单透露给了 B 组，所以这样测出来的 A/B 差距是模板价值的**下限**。

## 隔离

opencode 的工具权限只管它自己的文件工具，管不住 shell，而 agent 必须能执行 shell（装依赖、跑验收）。所以真正的隔离靠 **macOS 沙箱（`sandbox-exec`）**：每一次 agent 调用，包括它启动的所有 shell 命令，都在沙箱里运行（配置见 `lib/sandbox.mjs`）。

- **家目录里的内容一律不可读写**，只有工具链需要的目录例外：nvm、npm 缓存、opencode 自己的目录、`~/.cache`、`~/Library/Caches`、`~/.gitconfig`、`~/.pyenv`；其中可写的只有缓存和 opencode 的数据目录。主仓库在家目录里，所以模板原件、验收测试、`.env` 都读不到，也写不进。
- **运行目录根下的内容一律不可读写**，只有本次运行的 `project/` 例外。因此 harness 的记录读不到，**其他运行**也读不到。比如 B 组读不到 A 组的模板副本。
- 验收用的测试依赖是**真实拷贝**，不链接回原件，所以 agent 怎么折腾自己那份都碰不到原件。
- 在此之上，opencode 的工具权限再加一层：builder 只能用编辑工具改 `app/`，不能联网查资料，不能 `git push`、`sudo`、`brew`；reviewer 不能编辑、不能执行任何命令。agent 的配置在每次调用前都由 harness 重新写入。

**沙箱挡不住的**（已知，暂时接受）：
- 网络是通的（`npm install` 需要联网），agent 可以用 `curl` 访问外网。
- opencode 运行时必须读取自己的配置和凭证（`~/.config/opencode`、`~/.local/share/opencode/auth.json`），所以 agent 能读到它正在使用的那个 provider 的 key。
- opencode 启动时要解析家目录、`~/.claude`、`~/.agents` 和运行目录根，所以 agent 能看到这几个目录里有哪些文件和文件夹的**名字**，但读不到内容。
- 这只是防止"越界看到、越界写坏"，不是用来关押恶意代码的沙箱。

## 已经踩过的坑（都已在代码里处理）

- opencode 用 `$PWD` 而不是进程的工作目录来定位项目。用 Node 启动子进程时必须同时设置 `PWD`，否则它会去父目录找 agent，报 `Agent not found`。
- 共享的后台服务会缓存配置，而且由它创建的会话会一直绑在旧配置上。所以 harness 的所有 opencode 调用都用 `--standalone`。
- 会话 ID 必须以 `ses` 开头。
- opencode 启动时会对项目目录的**每一级上层目录**都做 realpath。放在家目录里的运行目录，进了沙箱后会因此启动失败（报 `UnexpectedStatus: 500`），这就是运行目录要放到家目录之外的原因。

## 验证过的事（2026-10-17）

以下结果都以系统和 opencode 自己的记录为准，不看 agent 自己怎么说：

- **固定检查（不调用模型）**：在沙箱里，读模板原件、读验收测试、读主仓库 `.env`、读 harness 记录、写记录、写家目录、读 `~/.claude` 的内容、列 `~/.ssh`，全部被拒绝；读自己的模板副本、写 `app/`、运行 node/npm/git/psql/opencode、`npm install`、**在沙箱里完整跑一次验收**（建库、启动应用、vitest、Playwright），全部正常。
- **带模型的测试**：builder 在沙箱里用 shell 写 `app/` 成功；用 shell 读模板原件、`.env` 和 harness 记录，都得到 `Operation not permitted`；token 用量正常记录。
- 第一轮测试（还没加沙箱时）：builder 用编辑工具改模板副本被拒绝，读运行目录之外的文件被拒绝。reviewer 的生效权限是"禁止一切编辑和 shell"。

## 独立审查

harness v0 交给一个独立 agent 只读审查过。它指出的问题都已修复：
- 加沙箱之前，shell 可以绕过所有读取限制，B 组能读到模板和测试，`.env` 也会泄露；
- 测试依赖用软链接指回原件，有被写坏的风险；
- token 导出失败时会悄悄漏算：现在会重试，仍然失败就记一条 `usage.missing`，并在 `STATUS.md` 里标出"总数是下限"；
- 最大重试次数没有保存进运行状态：现在在 `new` 时固定，后面的命令不能再改。
