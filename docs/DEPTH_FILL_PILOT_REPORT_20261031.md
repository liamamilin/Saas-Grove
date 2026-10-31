# 深度补齐试点报告：服务台（2026-10-31）

按 [DEPTH_FILL_PLAN.md](DEPTH_FILL_PLAN.md) 第 2 步，用户批准后先补“服务台（help-desk）”一个类型，完整走通采集、独立初审、主会话复核、演练导入、正式导入和页面检查。**其余 9 个类型尚未运行**，等用户看过本报告后再决定。

## 结果

服务台从 **2 个开源、0 个商业** 增加到 **9 个开源、5 个商业**。

| 变化 | 产品 |
|---|---|
| 新增开源（5） | Zammad（AGPL-3.0）、FreeScout（AGPL-3.0）、UVdesk Community（OSL-3.0）、Faveo Helpdesk（OSL-3.0）、Znuny（GPL-3.0，OTRS 社区版延续） |
| 新增商业（3） | Zendesk、Freshdesk、Help Scout |
| 已在库、补服务台关系（4） | GLPI、Chatwoot（开源）；Jira Service Management、Freshservice（商业） |
| 原有 | osTicket、Frappe Helpdesk |
| 被拒（4） | Peppermint（仓库已归档）、OpenSupports（2024-04 后无推送）、Helpy（2023-03 后无推送）、Trudesk（GitHub 许可证为 NOASSERTION，无法核实完整许可证） |

正式库：1,440 → **1,448** 产品（开源 546 → 551，商业 894 → 897），关系 1,724 → **1,736**；主目录覆盖类型数不变（1,592/1,646，服务台原本就有案例）。`data/catalog.sql` 新 SHA `cb9a5521…61db`，与 `data/catalog-snapshot.json` 一致，还原行与正式库一致，`integrity_check` 为 ok。

## 过程

| 步骤 | 结果 |
|---|---|
| 准备 | 备份正式库（`var/collection/depth-fill-20261031/catalog.before-collection.sqlite`）；从当前正式库重建共享产品索引（1,440）；冻结 10 个类型的输入与计划（`data/collections/depth-fill-20261031-inputs.json`、`-plan.json`）。新契约 `docs/DEPTH_FILL_CONTRACT_20261031.md`、初审附加核对 `docs/DEPTH_FILL_REVIEW_ADDENDUM_20261031.md`、控制脚本 `scripts/fill_type_depth.py` |
| 启动前独立审查 | 只读会话审查控制脚本与契约，提出 2 项高危：已有产品补关系时核心字段可能被覆盖、商业产品没有去重。已修复：补关系条目除 leaf_matches/sources 外须与正式记录逐键一致；新产品按仓库 URL、完整官网地址和名称去重。另修复单次会话超时（1200 → 7200 秒）、重复处置项、按本地日期判断当天短测、运行前核对 `catalog.sql` SHA。离线用假条目验证 5 种情况均按预期通过或拒绝 |
| 短测 | 实际 `opencode-go/deepseek-v4.1-flash`，沙箱 write/read 通过，CLI 报告 $0.0004 |
| 采集 | 1 个采集会话约 17 分钟，CLI 报告 $0.081；结构、去重和候选处置检查一次通过 |
| 独立初审 | 同模型、独立只读会话约 8 分钟，CLI 报告 $0.082；结论 content_review_passed，无必须修复项，7 条非阻断建议（见下） |
| 主会话复核 | 逐个查看新产品的摘要、类型匹配理由和来源种类；用 GitHub API 独立核对 5 个新开源仓库：ID 一致、未归档、近 30 天内有推送、许可证与条目一致 |
| 演练导入 | 在正式库副本上导入：只新增 8 个产品和 12 条关系；4 个补关系产品除 leaf_matches/sources 外逐键不变；其他旧产品逐字节不变；重复导入无变化。导入工具 `scripts/publish_depth_fill.py` 会在导入前用正式记录重建补关系条目，避免 `_merge_entry` 覆盖核心字段 |
| 正式导入 | 先再备份（`catalog.before-import-depth-fill-20261031-u001.sqlite`），结果与演练逐行一致；生成批次、研究记录、回执和报告（`data/collections/depth-fill-20261031-u001*.json`） |
| 入库后独立审查 | 只读会话核对：旧产品逐字节不变、补关系产品只改关系与来源、catalog.sql 还原一致。提出 1 项中危：入库后单元状态仍为待复核，误重跑 `--apply` 会覆盖真正的导入前备份。已修复：发布后单元状态改为 published，回执或备份已存在时拒绝再次导入；另补多单元同一产品核心字段冲突检查、来源按 (url, sha256) 去重、旧关系逐项比较、catalog.sql 与快照原子写入。重跑第 1 单元已被拒绝 |
| 测试 | 后端 90、队列 28、隔离浏览器 39、真实数据浏览器 12 全部通过；历史截图已恢复 |
| 页面 | `/types/help-desk` 显示 9 开源 / 5 商业；搜索“工单”的类型建议显示“服务台 9 开源 · 5 商业”；Zammad、FreeScout、osTicket、Zendesk 四方比较正常 |

模型费用合计约 $0.16（CLI 报告值，不等同账单）。第三方软件均未部署实测（`runtime_tested:false`）。

## 初审的非阻断建议（记录，未阻断入库）

- 研究记录的服务边界写了“企业级服务管理平台不纳入”，却收了 Jira Service Management 和 Freshservice；两者的关系理由已给出请求者—队列—客服回复—状态的证据，措辞需要统一。
- FreeScout 的状态与回复证据来自 API 模块文档（需安装该模块），建议补一份核心界面文档。
- UVdesk 的仓库名是 community-skeleton；它是官方社区版发行包（官方安装方式即从此仓库创建项目），不是代码模板。
- Chatwoot、Help Scout 以“会话”承担工单，GLPI、Jira Service Management、Freshservice 偏 ITSM；当前来源能支撑核心流程，但类型边界偏宽，后续可考虑在比较页提示。
- 部分商业官网写成会跳转到 www 的地址；Freshdesk 的状态列表快照未逐字列全。

## 限制

- 采集者和初审者是同一模型的不同会话，独立性弱于不同模型审查。
- 主会话没有逐字精读每份来源快照，复核以条目摘要、匹配理由、来源种类和 GitHub API 独立核对为主。
- 新产品还没有整理官方资源和截图（Logo、界面图），在页面上显示为“官方资源尚未整理”。

## 下一步（需用户确认）

1. 按同样流程运行其余 9 个类型（并发 4），全部结束后统一复核、演练、导入。
2. 给新开源产品整理官方资源和截图（复用 `docs/NEXT_RESOURCE_CURATION_PLAN.md`）。
