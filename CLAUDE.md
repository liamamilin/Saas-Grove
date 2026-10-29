# SaaS Grove — Claude 工作说明

产品正式名称是 **SaaS Grove**。当前主线是参考 Atlas 真实项目目录、面向 SaaS 应用的发现与调研平台（2026-10-23 确认）。组织方式为**多级分类 → 叶子类型 ↔ 应用／项目，不需要场景层**。开源与商业都收录但分开展示，开源优先深入调研，商业只记录基本信息，让使用者知道它存在。`README.md` 是唯一的当前方向文档；结论变了先改它。认知模板、构建和对比实验属于历史资产。

## 开工先读（按顺序）
1. `README.md` — 当前定位、收录范围、调研深度及实现状态；注意区分历史方向。
2. 新版架构见 `docs/SAAS_ARCHITECTURE_AND_PLAN.md`，当前 M0/M1 交付见 `docs/M0_M1_REPORT.md`；目录修订方法见 `data/taxonomy/README.md`。`docs/SAAS_DIRECTORY_DRAFT.json` 是历史候选起点，运行目录已按 SaaS 边界筛选，见 `docs/SAAS_SCOPE_REVIEW.md`；548项复核已经发布，真实案例采集与待处理状态见 `docs/CASE_COLLECTION_REPORT.md`；逐叶模型初判结果与续跑见 `docs/LEAF_REVIEW_REPORT.md`、`docs/LEAF_REVIEW_WORKFLOW.md`，不要把未验证建议当作已经发布的目录；`toolbox/research/` 是旧调研原型。
3. 维护历史模板或实验时，再读 `experiments/ab-01/results.md`、对应模板的 `TEMPLATE.md` 和 `harness/README.md`。历史 `backlog.md` 与 `template-learnings.md` 的编号接着往下排，不要重排旧编号。
4. 先 `git status`，保留用户未提交的修改。

## 硬规矩
- 用户确认的开发原则：保证质量，完成比完美重要。先交付可用闭环；非关键边界单列待确认后继续；主目录仅显示已纳入类型，不能把联网、platform 或行业属性直接当作 SaaS 依据。数据真实、结构完整和核心使用流程仍需检查。
- 应用直接关联叶子类型；不沿用 Atlas 的场景生成、场景存储或场景覆盖率前提。
- 开源与商业资料分开展示，商业条目只作基本索引；不把商业产品的深度拆解扩展为当前任务。
- 收录与概述保留公开来源；许可证未知或受限时如实标注，资料整理与实际运行验证分开记录。
- `.env` 的内容不要读、不要打印、不要提交；只有 `.env.example` 入库。
- 负责构建的和负责审查/验证的必须是相互独立的 agent 或会话；人只在关键节点批准。不要自己既写测试又审测试。
- 复用第三方代码时，当场记下来源、许可证和 commit。`references/` 只是参考副本，不是底座，里面有自己的 git 历史，别在里面改东西。
- 旧的 Foundation / Factory 规范已移除，只在 git tag `pre-pivot-2026-10-17` 里，不再作为规范。

## 维护历史模板与实验时的约束
- 一个模板只有在 agent 照它做出产品、并通过它自带的验收之后，才算合格；此标准只适用于历史模板，不是新版目录条目的收录条件。
- 实验进行中不改模板和验收，否则 A/B 失去可比性；发现的缺口记进 `template-learnings.md` / `backlog.md`，实验结束后统一处理，并经独立 agent 审查。不为了通过而改验收。
- 历史产品模板的验收永远用假模型。真实模型（`deepseek-v4.1-flash`）只在模板构建的产品自身运行时使用，配置在根目录 `.env`。
- 历史构建运行目录在仓库之外：`/Users/Shared/saas-template-runs/<run-id>/`（沙箱里运行）。`runs/` 不入库。

## 约定

- 当前正式结果（2026-10-29 18:27，252留档续采已发布）：新增229产品、补充31旧产品、新增280关系/203类型覆盖；正式1440产品（546开源/894商业）、1723关系，主目录1592/1646，54类无案例。252输入另29已复核留档（19边界/10证据不足）、7待复核/13未完成；原5内容过滤不动，全部当前待处理25，清单included-retained-final-20261029-pending-all.json；研究留档清单同前缀-retained.json。3105来源SHA、588成功会话实际模型/完整提示、322问题去向全量程序核对，77候选分层正文片段+风险扩展，非252逐字精读。14条桌面/移动端候选与3条许可缺失/冲突共17关系暂缓；完整自托管Web应用不额外要求多租户/部署实测。1211旧产品核心、1443旧关系/全历史来源、1241非本轮进度行、53待确认和目录范围保持；Gibbon当前or-later观察仅加研究不覆写旧固定版本，Massing关系依直接GitHub正文保持旧主页。备份/副本重复导入/完整性与10项本地API检查通过，第三方未部署实测。var/collection/retained-final-review-20261029/publication.json及正式data/collections/included-retained-final-20261029-report.json为发布标记；本轮及旧15/44/274冻结输入不重跑，旧基线integrate.py不可复用。最新模型曾Go/OpenDesign混合且有3个app-Luna历史，均保留实际来源，Luna API未调用；后续新工作默认用户最新指定Go DeepSeek，不能自动换模型。完成检查随发布关闭，防重复导入。
- 当前252续采（2026-10-29 11:53:28，最新用户决定）：继续OpenCode Go/DeepSeek V4.1 Flash、并发4，不用Luna API或应用内Luna。11:52短测/沙箱读写通过，11:54:19核对118/120/121/122四路真实模型、完整输入和完成工具。保留101旧初审（98旧v2+115/117/119三项app-luna-v1）与17原单项失败，剩134项继续；118复用app绑定构建补Go只读初审，app-build-reuse.json追溯，不冒称Go构建。3个app代理已中断，luna-handoff/STOP.json阶段停用；外部Luna API仅做公开配置准备，未调用。当前proof为go-resume-20261029/startup-verification.json。旧Go停机确认为118精确typed容量429+killpg PermissionError，已有限8秒重试/单项留档及直接子进程信号回退，22旧回归和真实429负面对照通过，未知429/认证额度仍保护停。saas-grove小时安静只读检查已恢复，只看当前CLI status/process，不拿停用app队列未结束当故障。正式1211/1443、旧阻断5类和53待确认不动；252全结束再统一复核、备份演练，仅通过项入库。历史模型/报告保持，禁止把app3项冒充API/Go。
- 252项当前入口（2026-10-29 10:35:15）：用户指定切回OpenCode Go，实际opencode-go/deepseek-v4.1-flash、并发4；10:34短回复与沙箱write/read通过，10:36:24确认115/117/118/119四路实际模型、完整提示、真实工具。98项原OpenDesign初审与17项单项失败状态SHA保持，17项不重调；115/117复用旧草稿补新初审，剩137项从断点继续。--model显式选择，无自动fallback；冻结plan仍OpenDesign，历史模型不改，当前看runtime-selection/model-selections及真实会话。证明provider-switch-20261029/startup-verification.json，Go预检provider-checks/opencode-go/latest.json；22项回归通过。saas-grove小时安静检查已恢复，健康只读，新的全局故障通知一次删除，不自动重启/换入口。基线1211产品/1443关系、旧阻断5类及53待确认不变，全部252实际结束后统一复核入库；勿因旧OpenDesign402重复停机/短测。
- 252项最新恢复（2026-10-28 20:40:05）：16:35第70项再次HTTP402后停机并删除检查；20:38用户要求验证，20:38:27原OpenDesign/DeepSeek V4.1 Flash短测成功，随后按此前采集安排以--resume-after-quota、并发4继续。20:41:24验证66/68/69/70四路实际模型/完整提示/工具；58项原有效初审和8项batch失败状态SHA保持，8项不重调。最新证明latest-resume-verification.json指向resume-verification-20261028-204124.json，未覆盖旧13:05证明；latest-quota-check.json为20:38真实短测，旧错误不当当前故障。saas-grove每小时安静检查已恢复，正常不调模型/测试/写数据/重启；新全局故障通知一次删除，不自行等下次额度或切provider。仍1211产品/1443关系基线，旧阻断5类与53待确认保持，252全部实际结束再主会话统一复核、另备份演练后仅通过项入库。
- 252项已恢复（2026-10-28 13:04:12）：用户授权的额度重置后短测13:03:39成功，实际OpenDesign/deepseek-v4.1-flash、完整输入/隔离通过；已以scripts/continue_retained_directory.py --resume-after-quota按并发4续跑，13:05:12核对28/29/30/31四路实际模型/完整提示/完成工具。25项原初审和1/4原单项失败状态SHA保持，1/4未重调，28/30复用旧草稿只补新独立初审，29/31采集。恢复前状态/元数据备份resume-history/1793163852606734000，见quota-resume-verification.json；旧日志/证据不变。正式1211/1443、原阻断5类/53待确认不动。saas-grove已从一次性13:03调度改每小时安静只读完成检查，正常不调模型/测试/重启，后续新全局故障仍只通知一次关闭；本次条件续跑授权已消费，不因旧402/旧no-route再重试。全部252实际结束后统一复核、备份演练、仅通过项入库，不重跑旧冻结队列。
- 252项续采额度恢复计划（2026-10-28）：10:48第31项HTTP402 insufficient_balance后全局保护性停，25项有效初审、1/4单项失败保留，28–30中断。用户已明确授权今日13:02重置后检查并在恢复时自动按OpenDesign/DeepSeek V4.1 Flash、并发4续跑；安排13:03一次性heartbeat saas-grove。先运行scripts/check_retained_provider.py（13:02:15时间门槛，真实短测，不直接启动队列）；成功核对实际模型/完整提示/收据后，后台启动scripts/continue_retained_directory.py --resume-after-quota，核对四路并转每小时安静完成检查。原25项初审内容绑定已验证复用，1/4失败不重调，旧状态/元数据保留到resume-history，原阻断5项不动。检查失败通知一次删除，不自动切provider。现仍停机，未在重置前实际调用模型或续跑；正式1211/1443基线不变。详见docs/RETAINED_EVIDENCE_RUN_20261028.md。
- 当前252留档类型续采：2026-10-28用户指定OpenDesign / DeepSeek V4.1 Flash、并发4，08:43:03启动scripts/continue_retained_directory.py；08:43:54已确认四路实际模型、完整提示和完成工具事件。最初no-route是私有CLI配置漏自定义provider，已仅补公开路由定义，未复制密钥/改变原生沙箱或全局配置；短回复和真实write/read通过，旧失败日志保留，勿当当前不可用。运行var/collection/retained-evidence-20261028/，输入data/collections/retained-evidence-20261028-inputs.json、计划同前缀-plan.json；252单叶按目录顺序（159边界/93证据不足），复用512层旧项目、177候选/770快照，全部离线准备检查通过。正式基线仍1211产品/1443关系，53待确认与旧阻断5类保持，旧5类不在输入、不重试/转provider。单项失败留档继续，全局认证额度/未知错误或连续3项临时故障保护性停，不自动重启或切模型。全部252实际结束后统一复核、另备份演练，仅通过项入库，不直接用旧基线integrate.py、不重跑已发布旧队列。沿用已授权每小时只读完成检查saas-grove，正常安静，完成统一复核后删除。见docs/RETAINED_EVIDENCE_RUN_20261028.md。
- 上一轮15叶已统一复核入库：2026-10-27 17:14:19全部尝试结束，17:54:48按1201产品/1429关系基线完成本地导入，17:55:35八项5299接口检查通过。新增10产品（7开源/3商业）、补充2个旧产品、新增14关系/13类型覆盖；正式1211产品（404开源/807商业）、1443关系，主目录1389/1646、257无案例。当前15叶另2留档，累计252已复核留档；全部可处理待复核/未完成为0，只剩旧274组第44组内容过滤5类在review_pending，不重试/转provider。53待确认与1201旧产品核心、1429旧关系、完整历史来源、1478非本轮进度原样保留。全量核对466来源路径SHA、29实际会话、17初审问题；15叶逐一对照核心，选择性读正文并扩展桌面/许可/版本/排期风险，不称466份逐字精读。Open2DMeasure/PolyWorks桌面或服务形态缺口留档，Carbon仅暂缓新增QMS关系，旧记录保持；Rightsline收窄为基本商业用途。5个最终草稿复用旧构建并有新独立初审，未冒充本轮构建。备份、演练、重复导入及历史保留检查通过。报告docs/PENDING_LEAVES_RUN_20261027.md、data/collections/included-pending-leaves-final-20261027-report.json，当前pending-all同前缀仅5个旧阻断项。冻结15/44/274组都不得重跑，任何下轮须用1211新基线另建计划；CLI本轮收据$0.7569不等同账单，未部署实测第三方软件。 本轮每小时完成检查已删除，发布标记已写入，不重复导入。
- 上一轮44组入库历史（已被最新1211基线取代）：2026-10-27 15:16:56全部44组尝试结束，15:50:28主会话复核入库，15:51:56七项5299接口检查通过。新增144产品、补充19、新增173关系/166类型覆盖；正式1201产品（397开源/804商业）、1429关系，主目录1376/1646、270无案例。220类型另39留档/10待复核/5未完成，旧274组第44组阻断5类未变，当前全部20待处理（15待复核+5未完成）；累计250边界/证据不足留档。最新完整清单data/collections/included-go-followup-final-20261027-pending-all.json含source_run，不能混淆新旧第44组；主进度included-coverage-progress.json。全量核对44输入/863来源/105已有会话/350问题去向，89正文分层样本（53开源36商业，35领域/track）及风险扩展，不称逐项精读。21候选关系留档；NetBox/CiviCRM只采用直接官方正文闭合关系，LibreClinica新许可绑定存疑关系留档，旧产品字段不改。1057旧产品核心/1256关系/完整来源及1273非本轮进度、53待确认保留；SQLite备份/重复导入演练通过。报告docs/GO_FOLLOWUP_RUN_20261027.md和data/collections/included-go-followup-final-20261027-report.json。该轮入库后完成检查已删除；不重跑已发布冻结44组或任何旧150/223/1057基线导入脚本。CLI收据合计$4.6306非实际账单，未部署实测第三方应用。
- 2026-10-27 14:25:34修复后恢复：新队列第37组初审HTTP200无finish_reason，随后socket关闭，原all-errors分类漏识首个流截断，误停全局并中断33组。现只精确认定typed provider.invalid-output/200/完整原文为临时传输异常，一次有限重试，仍失败单组留档继续；内容过滤/认证/额度和未知全局错误不误判，22项回归通过。36组已有草稿绑定已核对，剩33/37/39–44共8组；33/37复用完成采集，只重做只读独立初审。14:27两路真实Go/DeepSeek及完成工具事件已确认。新运行目录与44组冻结计划不变，仍并发上限4、修复阶段结束后再跑6组未完成；已有1028文件恢复快照，原日志/失败状态保留。全部结束后按1057/1256基线统一复核入库，现尚未入库，不重跑36已通过初审组。详见docs/GO_FOLLOWUP_RUN_20261027.md。
- 本轮启动历史：2026-10-27用户选择改回Go / DeepSeek V4.1 Flash，短回复和沙箱读写通过，11:55:40以`python3 -B scripts/continue_pending_directory.py`启动并发4；已核对首四路真实模型和完成工具事件。新运行`var/collection/go-followup-20261027/`，冻结计划`data/collections/go-followup-20261027-plan.json`；先190待复核/38组，再30未完成/6组，共44组220类型，复用旧草稿/来源/笔记。原第44组5类明确内容过滤保持留档，不重试或转provider绕过。正式基线1057产品/1256关系及已有留档/53待确认不改，当前草稿未入库。全部44组结束再主会话统一复核、备份演练、按目录顺序导入；不能重跑旧223/150基线导入脚本。OpenDesign同名模型短测no-route的历史收据保留，未在该provider跑采集。详见docs/GO_FOLLOWUP_RUN_20261027.md；正常只读完成检查安静，不自动重启/换模型。
- 上一轮已结束并复核入库：2026-10-27 03:21全部274组尝试结束，03:58主会话筛选851产品记录（834新增、17补充），新增1001关系和967类型覆盖。正式库现1057产品（337开源/720商业）、1256关系，主目录覆盖1210/1646、仍436无案例。本轮1368类型另有121边界留档、55证据不足、195待复核、30未完成，均不冷归档。原90覆盖/35留档/53待确认、旧223产品核心字段/关系/来源保留；目录范围未改。全量核对274组/3402引用快照/588实际会话/376初审问题去向，92项正文分层抽查+风险扩展，不称逐项人工精读；92条客户端/组件/消费社交等存疑候选留档。SQLite先备份演练、幂等及历史保留检查通过，再本地入库；5299接口检查通过，未部署第三方应用。该轮入库后原采集进程与完成检查已关闭。后续先读docs/BEAM_CONTINUATION_RUN_20261025.md及data/collections/included-continuation-final-20261027-report.json，按最新1057基线和pending清单另建输入，绝不能重跑冻结274组或旧150基线integrate.py。原var/collection/beam-continuation-20261025/是历史草稿/证据，原模型历史和第4组编码侧证、第44组阻断收据不改。当前进度见included-coverage-progress.json，原始待处理副本见data/collections/retained-continuation-20261027/。
- Iceman阶段（历史，20:00:17连续三组503后停止）：2026-10-25用户要求修复Iceman停机后继续。已修复第8组503未有限重试、第1组继承stdin导致提示附加启动脚本并拒答，以及快照相对路径和报告校验；13项回归通过，第8组真实重试后完整JSON有效。19:55:40已恢复`opencode-go/iceman-contributor-free`、并发4（PID84568），四路实际读取；第1组复测仍有模型空等，保留待处理、不宣称通过。原3组报告原样留存，补做干净输入的只读初审；协议标记`stdin-isolated-report-v2`，逐会话记录prompt_verified、actual model及SHA。单组空等留档继续，连续3组临时故障/空等停止，认证额度等立即停止；不自动切模型。先修复525类，再补齐843类，共274组，每组最多5类。命令`python3 -B scripts/continue_directory_beam.py --model opencode-go/iceman-contributor-free`，状态在`var/collection/beam-continuation-20261025/`。原plan model仍为首次Beam，当前选择及历史模型分别保留。共享索引和正式基线仍223产品/255关系，旧35项复核留档与原53待确认不在本轮输入中。见`docs/ICEMAN_RECOVERY_20261025.md`和`docs/BEAM_CONTINUATION_RUN_20261025.md`。不启动旧60批脚本，不把草稿算正式覆盖。
- 2026-10-25 全目录60批采集尝试结束，已统一复核筛选入库：当前223产品（60开源、163商业），覆盖主目录243类；原1,493空类型本轮新增覆盖90、复核留档35、待复核525、未完成843。原53待确认记录不变，未冷归档。见 `docs/CASE_COLLECTION_FINAL_REVIEW_20261025.md`。本轮完成检查已停止，不自动重跑；下次续采要从最新正式库建立共享索引。
- 新版目录批量采集、补证与初审使用本地 OpenCode CLI。2026-10-23 用户指定便宜模型执行，2026-10-24 Open Design 额度耗尽、LongCat 2.5 Preview Free 无法路由后，用户确认改试 `opencode-go/beam-free`，短调用及沙箱读写已通过。并发4，按目录顺序分派；不用 Codex Sol/Luna 做批量工作。独立会话初审，跑完后主会话统一复核入库。见 `docs/OPENCODE_GO_COLLECTION_WORKFLOW.md`；历史模型记录不变。
- 用中文回复和写文档；提交信息用英文，格式 `<范围>: <摘要>`（如 `ab-01: ...`、`harness: ...`）。
- 历史实验数字以 harness 的记录为准（`records/journal.jsonl`、`STATUS.md`），不以 agent 自己的说法为准。
- 历史模板批量构建走本地 opencode CLI，模型 `opencode-go/deepseek-v4.1-flash`；审查同样用 `opencode-go/deepseek-v4.1-flash`（2026-10-20 起：pro 额度用完，构建者与审查员同模型但不同会话，独立性比之前弱，报告里要注明）。（2026-10-19 起从 `open-design` 改到 `opencode-go`：open-design 额度用完，到 10-24 才重置；同一个模型换 provider。之前的运行记录里的模型名保持原样。）这不是新版采集流程已确认的模型选择。
- 注意：`.claude/delegate-impl.json` 仍指向已删除的 `factory-impl/`（`testCommand`、`protectedGlobs`）。用 delegate-impl 流程前先更新它，否则 hook 会拿一个不存在的目录跑测试。

## 压缩说明 (Compact instructions)
压缩这段对话时，按优先级保留：
1. 用户当前的要求，以及他做过的每个决定（审批、方向取舍、否决的方案）。
2. 实验和运行的标识：run-id、A/B 组、当前阶段，以及已冻结、不能再改的东西。
3. 关键数字：验收通过数、agent 调用次数、用时、token、人工介入次数，和它们的出处文件。
4. `backlog.md` 和 `template-learnings.md` 已用到的最大编号，以及本次新加的条目内容。
5. 创建或修改的文件路径及原因；未提交的改动；做到一半的事和下一步。
6. 摆出来等用户选择的选项，和等待人工批准的节点。
省略：审查报告全文、日志长输出、`references/` 里的内容、`.env` 内容和任何密钥。
