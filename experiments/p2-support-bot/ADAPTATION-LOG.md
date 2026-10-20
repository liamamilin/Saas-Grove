# 适配日志：ai-research-assistant → ai-support-bot

- 开始时间：1792506000（来自 `.adapt-start`）
- 结束时间：1792507776（`date +%s`），用时 1776 秒（约 30 分钟，墙钟时间；中间有一次上下文压缩）
- 做法：先把 `blueprints/ai-research-assistant/`（v0.3.0-draft）整个拷成 `blueprints/ai-support-bot/`（不含 `acceptance-results/`、`.DS_Store`；`node_modules/` 拷了，但被 `.gitignore` 忽略，不计入改动），再在拷贝上改。复用量用 `git diff --no-index --numstat` 在两个目录之间统计（见文末）。
- 执行者：一个 Claude 子代理（Opus 5.5）。没有调用构建 agent；中途咨询过内置的 advisor（一个更强的审查模型，能看到全部对话）。压缩前的次数见对话记录，压缩后 1 次（收尾前）。这 1 次之后补了一处契约：`api.yaml` 写明重试的次数和退避（3 次，≥200 ms、再翻倍），以及预算提醒的规则（80%、用完，各一次，只发 owner/admin）。原因是 B 组只能看到 `api.yaml` 和 §5 之后的部分，而测试依赖这两条。

## 过程记录

- 1792506460：拷贝完成，开始改。
- spec → acceptance/lib → S2–S4 测试 → `tsc` → `--self-check` → stages / TEMPLATE / template.json → 再跑一遍 `tsc` 和 `--self-check`。
- 1792507645：第一次收尾；advisor 审查后补了 `api.yaml` 两处契约。
- 1792507776：结束。

## 复用了什么、重写了什么

**原样复用（12 个文件，657 行，逐字节相同）**：S1 的 4 个测试文件（24 条）、`lib/db.ts`、`lib/instance.ts`、`lib/ui.ts`、`tsconfig.json`、`vitest.config.ts`、`fixtures/hello.pdf`、`fixtures/empty-app/`（2 个文件）。

**小改（只改名字或一两处）**：`run.mjs`（头注释、`blueprint` 名）、`package.json` / `package-lock.json`（包名）、`lib/client.ts`（`sse()` 加了可选的额外请求头）、`stages/S1-foundation.md`（加了一句"访客不是成员"）、`acceptance/README.md`、`reference/README.md`。

**大改但保留结构**：
- `spec/api.yaml`：健康检查、认证、工作区、成员、邀请这一段（约 150 行）照搬；资料接口改了文件类型和 `failed` 状态；作业 / 报告 / 追问的接口全部删掉，换成小窗设置、公开小窗接口、转人工、对话、分析、导出、`/widget.js`。
- `spec/architecture.md`：§1–§3 改栈和表；§4 的难点全部换掉（回答流程、硬预算、公开接口安全、小窗）；§5–§9 的可测性契约**保留编号和结构**（假模型、真实模式、测试路由、启动约定、testid、库里检查什么），内容按新产品改写。
- `spec/product.md`、`spec/decisions.md`（H1–H8 沿用人的答复，H5 因为产品名变了改回"待答复"；新增 H9–H12；T 节增加 T9–T12）、`spec/review-checklist.md`、`spec/landscape.md`（简版，没联网核实）。
- `lib/helpers.ts`：删掉作业相关的辅助函数，加资料、用量、预算、邮件的辅助函数；`lib/corpus.ts`：换成退货 / 运费 / 保修 / 机密四份资料和对应问题；`lib/mock-model.ts`：见下面"顺带落实的模板经验"。
- 测试：budget、usage、real-mode、real-budget、documents、governance、ui 这几个文件沿用了原文件的骨架和一部分断言，但内容大部分重写。

**新写**：`lib/widget.ts`（访客客户端、`hostPage` 起一个不同 Origin 的"客户网站"）、`fixtures/hours.docx`、`answering` / `widget-api` / `handoff` / `analytics` / `conversations` / `widget-embed` 六个测试文件、`stages/S2-knowledge-and-answers.md`、`stages/S3-cost-and-handoff.md`。

**删掉**：`jobs`、`reports`、`artifacts`、`chat` 四个测试文件，`stages/S2-ai-jobs.md`、`stages/S3-cost-and-artifacts.md`。

## 顺带落实的模板经验（属于"模板改进"，不是"适配"本身）

这几条是研究助手模板在 ab-01 里暴露、还没回写到原模板的缺口，新模板直接带上了。统计复用率时应该把它们单独算，否则会把"修模板"算成"适配成本"：
- template-learnings #35：假模型服务只有在请求带 `stream_options.include_usage` 时才在流里给 `usage`（`lib/mock-model.ts`），真实模式的计费测试因此能抓住"流式记账为 0"。
- #40 / #42：真实模式测试埋一个 canary 段落，检查它确实进了发给模型的请求、提示词小于 12000 字符（没有整篇塞进去）、模型的回答确实到了访客那里。
- #34：真实模式的钱测的是回答路径本身。

## 数字

- 新模板文件数（不含 `node_modules`、`acceptance-results`）：49。
- 和原模板的 `git diff --no-index --numstat`（不含 `node_modules`、`acceptance-results`，45 行记录，其中 2 条是没拷过来的 `.DS_Store`）：**新增 1966 行，删除 1217 行**。
- 测试：73 条 = S1 24（原样复用）+ S2 23 + S3 12 + S4 14。原模板是 70 条。
- `tsc -p . --noEmit` 通过；`node run.mjs --self-check`：`self-check: OK — 73 tests, 0 vacuous, 0 test bugs`，输出里没有 `Invalid Chai property` / `is not a function`。自检只能证明测试不空洞：S2–S4 的测试在空应用上都失败在第一步 `fakeModel.reset`，后面的逻辑要等真产品出来才检验得到。

## 发现的、范围之外的事（没有改）

- `harness/holdout.mjs` 第 24 行把 `BLUEPRINT` 写死成 `ai-research-assistant`；`harness/README.md` 的示例命令也是。用新模板跑 holdout 之前要改。
- `template.json` 加了一个 `adaptedFrom` 字段（记录从哪个模板改来），模板格式 v0 里没有这个字段：要么把它写进 README 的格式说明，要么删掉。
- 提交 `a3fa435`（"harness: quota fallback…"）顺带提交了一份做到一半的 `blueprints/ai-support-bot/`（31 个文件）。工作区里现在的版本才是完成的版本，提交前应该以工作区为准。

## Review fixes

- 开始：1792508065；结束：1792515962（中途因 API 限流中断过一次，续做时确认之前没有落盘的改动）。
- 依据：独立审查对 `blueprints/ai-support-bot/` 的发现 1–9、11，以及 H5/H9/H10/H11/H12 的评测默认值。原则：对照组构建者只看 `api.yaml` + `architecture.md` §5–§9 + brief，所以测试依赖的每条规则都要写在那里，并和其他 spec 文件一致。
- 1（阻塞）：`api.yaml` 开头的金额约定和 `PUT /budget` 写明金额按整数 micro-USD 比较（80% = `spent × 5 ≥ budget × 4`）；§4.3、§5 新增"金额"一行；`budget.test.ts` 第 1 条预算 0.03→0.035，提醒那条 0.05→0.045（3 次 67%、4 次 89%、第 5 次付不起），都离开了精确边界。
- 2（阻塞）：§5.1 写明 `max_tokens` ≤ 1000（默认 800，T12 同步）；`real-budget` 第 1 条改为 in=1、out=20、预算 0.035：第一次调用在最坏情况下（cap 1000 + 1.2 万字符输入 = 0.032）也付得起，第二次满 cap 付不起；问 9 次，不做预留、cap ≥ 200 的产品一定超支。
- 3：`api.yaml` UsageRecord、消息接口和 §5（调用次数、费用、新增"用量记录"一行）、§5.1 都写明"每次尝试一条，`createdAt` 是这次尝试开始的时间"。
- 4：`s4/ui.test.ts` 取第一个 `/\d+(\.\d+)?/`；§8 `usage-spent` 写明"第一个数字就是本月已花费"。
- 5：统一为"每个自然月（UTC）每种最多一封，改预算也不再发"（§4.3、`api.yaml`、S3 阶段文档、review-checklist）；提醒测试在拒答之后把预算提到 0.055、再越过 80%，断言仍然各只有 1 封。
- 6：§5.1 写明输入按"全部消息文本的字符数，1 字符 = 1 token"预留；`lib/mock-model.ts` 新增 `promptChars()`（各条消息按码点计数后相加，不含分隔符）；`real-budget` 新增第 2 条：in=20、out=1，假服务报告的输入 token = 字符数，先按默认预算问一次量出单价，再把预算设成"已花费 + 1.5 次"，用新访客再问 3 次：不得发出付不起的请求、至少再有一次调用、至少一次拒答、不超支。
- 7：§5"关键词"加汉字 2-gram（含中文停用表），"向量化"默认改为英文按词 + 汉字 2-gram 哈希到 256 维（§5.1 `EMBEDDING_PROVIDER` 同步）；decisions 新增 H13（中文、GBK/GB18030 文本的默认处理，无验收）；`lib/corpus.ts` 加中文长手册（约 1.9 万字，每次运行随机暗号）；`real-mode.test.ts` 新增第 3 条中文测试（暗号进请求、问题进请求、提示词 < 12000 字符、中文回答原样到访客、引用是中文原文逐字子串）。在 scratchpad 里按默认算法 + T3 切块模拟过：中英文两份长手册的暗号块都排进前 4（中文 23 块，最高分 0.087 对 0.071）。
- 8：S2 阶段文档的小窗设置字段加 `botName`，`embedSnippet` 标为 S4。
- 9：`real-mode.test.ts` 的 `MOCK_PHRASE` 注释改正（只有 `MOCK-ANSWER-7Q` 是任何资料里都没有的）。
- 11：product.md §7 改为"日志里永远不记录访客令牌和访客联系方式"等。
- 点踩→转人工：不改契约，记进 product.md §8 非目标（小窗的转人工按钮一直显示）。
- 人工决策点：H5（占位名 SupportBot）、H9（10 美元）、H10（无 Origin 不放行）、H11（保留 90 天、导出里带）、H12（不做网址/Notion 导入，写进 QUESTIONS.md）在 decisions.md 里写成"未答复。评测用默认值（人可更改）"；新增 H13；`template.json` 和 TEMPLATE.md 同步。
- 测试数：73 → **75**（S2 23→24，S3 12→13）；`template.json`、阶段文档同步。
- 验证：`tsc -p . --noEmit` 通过；`node run.mjs --self-check --out <scratchpad>`：`self-check: OK — 75 tests, 0 vacuous, 0 test bugs`，输出里没有 `Invalid Chai property` / `is not a function`。新测试在空应用上都在第一步就失败（404），后面的逻辑要等真产品才检验得到。
- 改过和新增的测试**还没有经过独立复审**（acceptance/README 的规矩），用之前要再审一次。
- advisor 复核后补了两处 spec：§5"调用次数"改为"每个问题 1 次调用、重试不算新调用"（之前写成"1 次成功调用"，和 3 次全失败的测试矛盾）；§5.1 输入估算写明"按这一次请求的消息算，不能按固定的最大提示词长度预留"（`real-budget` 第 2 条依赖它）；"用量记录"一行注明断开时被中止的等待不记录。只改了 spec 文字，没有改测试。
