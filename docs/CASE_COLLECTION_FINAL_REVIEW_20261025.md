# 全目录采集尝试后的统一复核与入库

2026-10-25。本轮60批采集尝试已结束，**不代表1,493个类型均已完成有效采集**。最终筛选76个产品入库，其中73个新增、3个补充既有关系/来源，新增91条关系、覆盖90个类型。当前正式库223个产品：60开源、163商业基本索引；覆盖244个类型，其中主目录243个。主目录仍有1,403类没有正式案例。

## 真实进度

以下针对本轮最初1,493个空类型，彼此不重叠：

| 状态 | 类型数 | 含义 |
|---|---:|---|
| 已入库覆盖 | 90 | 最终筛选通过并已导入正式库 |
| 证据不足留档 | 21 | 最终复核后仍缺正文或核心证据 |
| 边界待确认留档 | 14 | 服务形态、版本许可或核心匹配仍有缺口 |
| 待复核 | 525 | 有结构有效草稿，初审问题未关闭，尚未导入 |
| 未完成 | 843 | 批次产物缺失或结构不完整，不能声称核验完成 |

60批中34批保存了完整batch/research，26批通过结构校验，只有第15、16、17、20、22批通过绑定完整的独立初审。本次从这5批筛选，125个类型中90覆盖、35留档。其他55批没有通过本次最终入库门槛，原始草稿、候选、失败和95项初审问题全部保留；没有把未完成工作写成“找不到产品”。

## 检查范围与限制

程序全量核对60批、1,493个稳定slug及目录顺序、输入摘要、研究记录与case_ids、产品ID/track、许可证证据和来源快照。1,385份引用快照的SHA均匹配；这证明保存的字节一致，不能替代正文与能力匹配判断。独立初审核对原始输出、实际模型元数据、逐叶检查键、batch/research/input摘要；没有将旧审查结论改写为新内容已获批准。

正文检查采用金融/会计、人力资源、供应链/寻源、法律/合规、开发工具等领域和开源/商业分层抽查，共31个样本（18开源、13商业），发现问题后扩大对应批次检查。**这是全量程序校验加内容抽查，不是1,493项逐条人工精读。** 采集和初审使用同模型的独立会话，独立性弱于不同模型；商业仅核对基本真实性与类型匹配。全部第三方条目仍为`runtime_tested:false`，没有部署实测。

实际模型历史保留：先前为Open Design / DeepSeek V4.1 Flash，额度耗尽后停止；LongCat 2.5 Preview Free短调不可用，用户确认后用OpenCode Go / Beam Free并发4续跑。没有启动Codex批量代理，也没有新增其他模型采集调用。

## 本次筛选处理

- 将Semgrep命令行扫描引擎、Godot桌面引擎、Docusaurus生成框架、Redoc渲染组件等保留为候选，未据“开源/可联网”认定完整SaaS应用；目录本身的scope未改。
- Kong网关不直接等于开源管理控制台；Cloudcraft当前正文以实时观测为主，系统设计创作匹配未证；相关关系留档。
- Baserow许可证对premium/enterprise目录另行许可，原`repository`范围的MIT断言过宽；Moodle开源LMS与商业Workplace边界未核定。本次均未导入这些候选。
- 第20批存在仓库简介代替工作流正文、厂商首页代替子产品证据等问题，只保留Caseware、DocketTrak、AppColl、AltLegal、Icertis五项商业基本索引，其余留档。
- HumHub按已存README收窄为用户、空间、内容和模块，删除未证明属于社区核心的Wiki、文件、搜索断言。既有正式应用的字段保持，补充关系与来源。

## 入库、保留与验证

正式导入前已用SQLite backup保存完整库与原覆盖进度，在数据库副本完成导入及重复导入检查。正式导入后`integrity_check=ok`；旧150个应用的既有字段、全部旧关系和历史来源保留。目录源、scope/overrides、conditional-progress的SHA均不变，原53项待确认记录保留。全量进度记录均`archived:false`，没有冷归档。

本地5299目录服务已启动并作只读API核对：统计为60开源/163商业；新入库的预算、审计、内网案例可读取，留档的Semgrep和hledger未被发布；`/browse`返回200。这是本应用的接口检查，不是第三方软件部署实测。

- [正式筛选批次](../data/collections/included-go-final-20261025.json)、[最终研究记录](../data/collections/included-go-final-20261025-research.json)、[最终决策与原初审绑定](../data/collections/included-go-final-20261025-review.json)。
- [全量审计](../data/collections/included-go-final-20261025-audit.json)、[31项正文抽查](../data/collections/included-go-final-20261025-sampling.json)、[95项未关闭初审问题](../data/collections/included-go-final-20261025-initial-review-issues.json)。
- [导入报告](../data/collections/included-go-final-20261025-report.json)、[待复核/未完成清单](../data/collections/included-go-final-20261025-pending.json)、[最新主目录进度](../data/collections/included-coverage-progress.json)。
- 原始产物保存在`data/collections/retained-go-20261025/part-NNN/`，引用来源保存在共享`sources/<sha256>.txt`；原运行日志、草稿和过程笔记仍保留在`var/collection/opencode-go/`。
- 导入前后数据库备份、演练回执保存在`var/collection/final-review-20261025/`，其中`catalog.before-import.sqlite`可用于恢复。

本轮完成检查已停止，不会重复导入或自动重跑。后续宜先修复525类已有有效草稿的具体问题，再以小批处理843类未完成项；必须复用已有候选/快照并更新共享产品索引，不应重新跑全目录搜索。
