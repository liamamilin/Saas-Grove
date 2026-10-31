# 常用类型深度补齐：其余 9 个类型（2026-10-31）

用户看过[服务台试点报告](DEPTH_FILL_PILOT_REPORT_20261031.md)后确认“Run all 9”。本轮按同一契约（[DEPTH_FILL_CONTRACT_20261031.md](DEPTH_FILL_CONTRACT_20261031.md)）运行第 2–10 单元，统一复核后一次入库。计划见 [DEPTH_FILL_PLAN.md](DEPTH_FILL_PLAN.md)。

## 结果

| 类型 | 开源 前→后 | 商业 前→后 |
|---|---|---|
| 服务台（试点，已于前一批入库） | 2 → 9 | 0 → 5 |
| 项目管理 | 2 → 8 | 1 → 5 |
| 客户关系管理 / CRM | 2 → 7 | 1 → 5 |
| 团队消息 | 1 → 6 | 1 → 5 |
| Wiki | 1 → 6 | 0 → 4 |
| 问卷调查 | 1 → 4 | 1 → 5 |
| 邮件营销 | 1 → 5 | 0 → 4 |
| 时间记录 | 1 → 5 | 0 → 4 |
| 无头 CMS | 1 → 7 | 0 → 4 |
| 视频会议 | 1 → 7 | 0 → 4 |

本批导入后正式库 1,448 → 1,521 产品、1,736 → 1,817 关系（新增 73 个产品、7 个已有产品补关系，共 81 条新关系）；入库后独立审查发现 Wiki.js 绑错仓库，已撤回（见下），**当前正式库 1,520 产品（开源 590，商业 930）、1,816 关系**。主目录覆盖类型数不变（1,592/1,646，这 10 个类型原本就有案例）。`data/catalog.sql` 当前 SHA `1bc655cd…25e8`，与 `data/catalog-snapshot.json` 一致，还原行与正式库一致，`integrity_check` 为 ok。

| 类型 | 新增开源 | 新增商业 | 补关系 | 被拒 |
|---|---|---|---|---|
| 项目管理 | Leantime、Redmine、Vikunja、WeKan、Taiga | Jira、monday.com、ClickUp、Wrike | Kanboard | 4 |
| CRM | SuiteCRM、Krayin CRM、Frappe CRM、Django CRM、Fat Free CRM | HubSpot CRM、Zoho CRM、Microsoft Dynamics 365 Sales | Pipedrive | 11 |
| 团队消息 | Mattermost、Rocket.Chat、Buzz、Nextcloud Talk、Wire | Microsoft Teams、Google Chat、Zoho Cliq、Pumble | — | 5 |
| Wiki | BookStack、XWiki、MediaWiki、Gollum、WackoWiki（Wiki.js 入库后撤回） | Confluence、Slite、Nuclino | Notion | 6 |
| 问卷调查 | KoboToolbox、XIAOJUSURVEY | SurveyMonkey、Jotform、Google Forms | LimeSurvey、Qualtrics Research | 4（另 3 个暂缓，见下） |
| 邮件营销 | Keila、SendPortal、OpenEMM | Mailchimp、Brevo、Klaviyo、MailerLite | listmonk | 10 |
| 时间记录 | solidtime、TimeTagger、Traggo、TimeTracker（DRYTRIX） | Toggl Track、Harvest、Clockify、Everhour | — | 8（另 2 个暂缓） |
| 无头 CMS | Payload、Keystone、TinaCMS、Squidex、Gentics Mesh、Enonic XP | Sanity、Storyblok、Hygraph、DatoCMS | — | 7 |
| 视频会议 | Nextcloud Talk（与团队消息共用一条记录）、Galène、MiroTalk P2P、Element Call、OpenVidu Meet | Google Meet、Whereby、Zoho Meeting、TrueConf | BigBlueButton | 6（另 Zoom 关系暂缓） |

被拒候选和原因逐条记在研究记录 `candidate_dispositions`（`data/collections/depth-fill-20261031-u002-003-004-005-006-007-008-009-010-research.json`）。

## 主会话复核决定

决定写在 `data/collections/depth-fill-20261031-decisions.json`，导入脚本按它执行：

- **暂缓（不入库）**
  - Timewarrior（命令行）、TimeScribe（离线桌面）：不是 Web/SaaS 形态，按此前桌面/客户端候选暂缓惯例处理。
  - Zoom 补视频会议关系：正式库 Zoom 条目摘要限定“仅指 Webinars”，不改旧核心字段就补关系会误导；后续需先把条目扩展为产品族。
  - 问卷调查的 Nextcloud Forms、HeyForm、OpnForm：第三次独立初审仍有问题（官网与已有产品相同且缺活跃度快照；按题汇总证据是客户端渲染外壳；license API 为 NOASSERTION 且自托管免费版限 2 用户未写明）。
- **重复合并**：Nextcloud Talk 被团队消息和视频会议两个单元同时新建，入库为一条记录、两条关系，核心字段用团队消息单元（摘要同时覆盖聊天与音视频）。
- **许可证**：Redmine、MediaWiki、Fat Free CRM、Mattermost、Rocket.Chat 的 GitHub license API 为 NOASSERTION，但条目都有完整许可证正文和范围说明（Mattermost、Rocket.Chat 标为 community_core，企业目录另行许可），予以接受。注意同批也有因 NOASSERTION 被拒的候选（Vtiger、Odoo、MoinMoin 等），口径偏保守，只影响少收、不影响已收数据的真实性。

## 过程

| 步骤 | 结果 |
|---|---|
| 启动前 | 共享产品索引按当前正式库重建（1,448，含试点新增），旧索引留作 `common-1440-pilot/`；运行前核对 9 个类型的 existing_products 与冻结输入一致；当天短测通过 |
| 第一次运行（并发 4） | 项目管理、CRM、Wiki 通过初审；团队消息、问卷两轮修订后仍有问题；时间记录、无头 CMS、视频会议、邮件营销停住——4 个会话共用 GitHub 匿名 API（每小时 60 次），额度用完后会话用 sleep 循环等待，5 分钟无输出触发保护性停机（草稿保留） |
| 续跑（并发 2） | 给采集提示加“在已有草稿上继续、限流时不要 sleep 等待”；4 个类型全部通过初审 |
| 额外一轮修订 | 新增 `--extra-correction`（仅对两轮用尽的单元再给一轮）：团队消息补了 Rocket.Chat、Wire 证据并更正 Huly 理由后通过；问卷因主会话去重检查误判（官网相同即判重复）未进入初审 |
| 修正去重 | 两边都有不同仓库地址时官网相同不再算重复（Nextcloud Server/Calendar/Forms 共用 nextcloud.com）；新增 `--review-only` 对问卷当前草稿重新独立初审，仍有 3 个条目问题，按上面决定暂缓 |
| 主会话复核 | 逐类看候选处置和初审建议；用 GitHub API 独立核对 41 个新开源仓库：全部未归档、12 个月内有推送、仓库地址一致；许可证除上述 5 个 NOASSERTION 外与条目一致 |
| 演练与正式导入 | 副本演练：只新增 73 产品、81 关系，7 个补关系产品只改关系与来源，其余旧产品逐字节不变，重复导入无变化；正式导入前备份 `catalog.before-import-depth-fill-20261031-u002-…-010.sqlite`，结果与演练一致 |
| 页面修复 | 真实数据手机端测试发现 CRM 类型页宽 397px（超出 390px）：卡片网格单列写成 `1fr`，新数据里的长英文串撑宽了列。改为 `minmax(0,1fr)` 并允许卡片正文断行 |
| 入库后独立审查 | 只读会话核对 8 项：旧产品逐字节不变（7 个补关系产品只改关系与来源，原关系逐条保留）、数量与排除项、Nextcloud Talk 合并、全库无重复、catalog.sql 还原、第 6 单元发布条件均通过；无高危。中危 2 项：① Wiki.js 绑在 2.x 维护仓库 `requarks/wiki-v2`（2026-08 创建、20 星），证据却来自主版本文档 docs.js.wiki——已用 `publish_depth_fill.py --withdraw` 撤回（先备份，报告 `data/collections/depth-fill-20261031-u-withdraw-github_1350990006-report.json`），主仓库 `requarks/wiki`（github:65848095）留待按正确 ID 重新取证；② `--review-only` 会把额外修订标记重置——改为以 build3 会话日志为准。低危已修：放宽去重时还要求名称不同；发布前断言正式库是上次发布状态；跨单元去重规范化 scheme/www/.git；报告新增 `published_by_track`（排除后实际计数） |
| 测试 | 撤回后后端 90、队列 28、隔离浏览器 39、真实数据浏览器 12 全部通过，生产构建通过；历史截图已恢复 |

34 个模型会话（采集、初审、修订、停住的会话都算）的回执全部核对为 `opencode-go/deepseek-v4.1-flash`、提示已验证；CLI 报告合计约 $3.80（不等同账单），会话累计约 5.8 小时（并发运行，实际约 2 小时）。

## 限制

- 采集者和初审者是同一模型的不同会话，独立性弱于不同模型。
- 主会话没有逐字精读每份来源快照；复核以条目、匹配理由、初审意见和 GitHub API 核对为主。不少商业官网和文档是客户端渲染页面，快照里只有外壳，初审已据此要求收窄或暂缓相关细节，但商业条目仍主要靠产品页的基本描述。
- 第三方软件均未部署实测（`runtime_tested:false`）；新产品还没有整理 Logo 和截图。
- 问卷调查（4 开源）、邮件营销与时间记录（各 5 开源）低于开源 6–8 的目标，研究记录写明了原因，没有凑数。Contentful（429）、Constant Contact、Webex、GoTo Meeting（403）因官方页抓不到而未收。

## 后续可选

1. 给本轮新开源产品整理官方资源与截图（沿用 `docs/NEXT_RESOURCE_CURATION_PLAN.md`）。
1. 用主仓库 `requarks/wiki` 重新收录 Wiki.js。
1. 独立审查的其余低危建议：Buzz 主界面是 Tauri 桌面端，与本轮“桌面形态暂缓”口径需统一；Zoho CRM、HubSpot CRM 与旧功能模块条目粒度重叠，可按产品族整理；Microsoft Teams 的官网字段是管理文档页。
2. 把 Zoom 条目扩展为产品族后补视频会议关系；对暂缓的 Nextcloud Forms、HeyForm、OpnForm 补证。
3. 统一许可证口径：NOASSERTION 但有完整 OSI 正文的候选（Vtiger、Odoo 等）是否重新核实。
