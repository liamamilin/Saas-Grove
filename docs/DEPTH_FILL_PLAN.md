# 常用类型深度补齐计划（草案，待确认）

日期：2026-10-31。背景见 [选型走查](SELECTION_WALKTHROUGH_20261031.md)：已覆盖的 1,593 个类型中，93% 只有 1 个产品；服务台只有 2 个开源产品、没有商业产品，主流的 Zammad、FreeScout、Zendesk、Freshdesk 都不在库里。目录是按“每类找到真实案例”的广度采集建起来的，不支持“在同类里挑一个”。本计划**只对少数常用类型补深度**，不改目录范围，也不对 1,646 个类型全面加深。

> 这会**扩大正式目录**（预计新增 100–150 个产品），与上一阶段“不扩大目录”的边界不同。开工前需要你确认下面“待你决定”的几项。

## 待你决定

| # | 问题 | 建议 |
|---|---|---|
| 1 | 首批补哪些类型 | 下表 10 个，按用户常见需求和已整理产品分布选出 |
| 2 | 每类补到多少 | 开源 6–8 个、商业 3–5 个；找不到就如实少收，不凑数 |
| 3 | “主流”的标准 | 开源：完整可自托管应用，GitHub 未归档，12 个月内有代码推送，许可证可核实；以 star 数（≥1,000）作为发现排序参考，但不作为收录依据。商业：官网可访问，有公开的产品页和价格或试用页 |
| 4 | 模型与并发 | 沿用最近一次指定的 OpenCode Go / `deepseek-v4.1-flash`，并发 4，不自动换模型 |
| 5 | 先试点还是直接全做 | 先用服务台一个类型完整跑通（采集 → 初审 → 主会话复核 → 入库 → 页面检查），通过后再跑剩余 9 个 |

### 建议的首批 10 个类型（当前产品数：开源 / 商业）

| 类型 | slug | 当前 | 发现线索（入库前须逐个核实；2026-10-31 已对照正式库） |
|---|---|---|---|
| 服务台 | `help-desk` | 2 / 0 | 新增：Zammad、FreeScout、UVdesk、Peppermint；Zendesk、Freshdesk、Help Scout。待核关联：Chatwoot |
| 项目管理应用 | `project-management-application` | 2 / 1 | 新增：Taiga、Leantime、Redmine、Kanboard；monday.com、Jira（库里已有 Asana） |
| 客户关系管理 / CRM | `customer-relationship-management-crm` | 2 / 1 | 新增：SuiteCRM、Krayin、vtiger；HubSpot CRM、Pipedrive（库里已有 Salesforce Sales Cloud） |
| 团队消息应用 | `team-messaging-application` | 1 / 1 | 新增：Mattermost、Rocket.Chat、Element；Microsoft Teams（库里已有 Slack、Zulip） |
| Wiki 应用 | `wiki-application` | 1 / 0 | 新增：BookStack、Wiki.js、Outline、XWiki；Confluence、Notion |
| 问卷调查平台 | `survey-platform` | 1 / 1 | 新增：OpnForm、HeyForm；SurveyMonkey（库里已有 Formbricks、Typeform）。待核关联：LimeSurvey（目前只在员工调查平台下） |
| 电子邮件营销平台 | `email-marketing-platform` | 1 / 0 | 新增：Keila；Mailchimp、Brevo（库里已有 phpList）。待核关联：Mautic（目前在营销自动化）、listmonk（目前在 Newsletter 营销） |
| 时间跟踪应用 | `time-tracking-application` | 1 / 0 | 新增：TimeTagger、solidtime；Toggl Track、Harvest、Clockify（库里已有 Kimai） |
| 无头 CMS | `headless-cms` | 1 / 0 | 新增：Directus、Payload；Contentful、Sanity（库里已有 Strapi）。待核关联：Ghost（目前在博客平台等） |
| 视频会议应用 | `video-conferencing-application` | 1 / 0 | 新增：Galène；Zoom、Google Meet（库里已有 Jitsi Meet）。待核关联：BigBlueButton（目前只在虚拟教室下） |

“待核关联”指产品已在正式库、但还没关联到这个类型。这类补的是**关系**，不是新产品，同样要有官方来源证明它满足该类型的定义性核心，证明不了就不关联。

## 与现有采集流程的区别

现有契约（[OPENCODE_GO_COLLECTION_WORKFLOW.md](OPENCODE_GO_COLLECTION_WORKFLOW.md)）是“找到一个核心匹配就停止该类型的存在性搜索”。深度补齐要改成**列举**，所以需要一份新的工作单元契约和一个新的控制脚本。其余原则不变：只用官方来源，许可证核实，商业只记基本信息，`runtime_tested:false`，草稿不计正式覆盖，独立初审，主会话统一复核入库。

新契约要多写清楚的几点：

1. **每个工作单元 = 一个类型**，输入包含：类型定义（dc/rules/overview）、该类型已关联的产品、正式库全部产品索引（防重复建 ID）、本计划的数量目标和主流标准。
2. **候选发现**：允许用 GitHub 搜索、类型定义里的别名、主流产品官网的对比页、公开的 awesome 列表来**发现**候选；但这些第三方页面只作线索，不作收录证据。每个候选都要回到它自己的官方站点和官方仓库取证。
3. **已在库的产品**：只补 `leaf_matches`（关系）和必要来源，不改名称、ID、track 和已有核心字段。
4. **候选记录**：入选和未入选的都要写进 `research.json`，并写明原因（例如“已归档”“2023 年后无推送”“是 SDK 不是应用”“许可证不明”“付费功能不能挂在社区版上”）。
5. **数量目标不是硬性要求**：确实找不到够格的产品时，按实际数量提交，并写明缺口。

## 步骤

### 第 0 步：准备（主会话，不调用模型）

- `git status`，保留未提交修改；备份 `var/catalog.sqlite`。
- 记下基线：产品数、关系数、`data/catalog.sql` 的 SHA（以当时实际查询为准；写这份计划时为 1,440 产品）。
- 从正式库重建共享产品索引（`application-index.json` 加详细条目），**不能沿用旧运行目录里的冻结索引**。
- 新建运行目录 `var/collection/depth-fill-<日期>/`、冻结输入 `data/collections/depth-fill-<日期>-inputs.json` 和计划 `-plan.json`。旧的 15/44/252/274 组冻结输入一律不重跑，旧基线的 `integrate.py` 不复用。
- 写新契约 `docs/DEPTH_FILL_CONTRACT_<日期>.md`。控制脚本参照 `scripts/continue_retained_directory.py` 的结构写一个新的（例如 `scripts/fill_type_depth.py`），复用其中已验证的部分：显式 `--model`、无自动降级、单项失败留档继续、全局认证/额度/未知错误保护性停止、限定次数的临时故障重试、每个会话记录实际模型/完整提示/SHA。
- 控制脚本自身的回归测试要由**另一个会话**审查。

### 第 1 步：短测（需要联网，少量调用）

- 固定短回复，加一次沙箱内读写，确认实际 provider/model 是 `opencode-go/deepseek-v4.1-flash`。失败就停下来报告，不换 provider。

### 第 2 步：试点：服务台

- 只跑 `help-desk` 一个工作单元：采集 → 独立初审 → 采集会话最多修复一次。
- 主会话复核：逐个产品核对官方来源、许可证、是否完整应用、类型匹配是否成立、有没有重复 ID。
- **先备份、在副本上演练导入**，确认幂等、旧产品字段和来源不变，再正式导入。
- 打开 `/types/help-desk`、`/search?q=工单`、比较页实际看一遍。
- **把试点结果交给你看**：新增了哪些产品、没收哪些候选及原因、页面截图。你确认后再继续。

### 第 3 步：剩余 9 个类型

- 并发 4，按上表顺序分派。单项失败留档继续；连续 3 项临时故障，或出现认证、额度、未知错误时，全队列停止，不自动重启、不换模型。
- 全部结束后由主会话统一复核，再演练导入、正式导入。中途不分批入库。

### 第 4 步：发布与验证

- 用和上次发布相同的方式重新生成 `data/catalog.sql` 和 `data/catalog-snapshot.json`，写发布标记和报告（参照 `data/collections/included-retained-final-20261029-report.json` 的格式）。
- 全量测试：

  ```bash
  python3 -B -m unittest discover -s server/tests -t .
  python3 -B -m unittest discover -s tests
  cd web && npx playwright test
  cd web && SAAS_E2E_REAL=1 npx playwright test
  cd web && npm run build
  ```

  真实数据测试会覆盖历史截图，跑完执行 `git checkout -- docs/local-decisions docs/local-shortlist docs/product-discovery docs/product-visuals`。部分真实测试断言了具体数量（例如搜索“CRM”并开启官方资源筛选后结果为 3 个），如果确实因为新数据而变化，只更新数字，不放宽断言，并在报告里逐条说明。
- 重新走一遍选型走查，至少服务台和 CRM，对比补齐前后。

### 第 5 步：独立审查与交付

- 独立的只读会话抽查：每个类型至少 3 个新产品的官方来源和许可证、未入选候选的理由、重复 ID、正式旧产品字段是否被改动。
- 报告 `docs/DEPTH_FILL_REPORT_<日期>.md`：每个类型补齐前后的数量、新增产品清单、未收候选及原因、模型实际调用和收据、测试结果、审查结论与限制（采集者和初审者同模型，独立性较弱）。
- 更新 `README.md` 的数字和 `CLAUDE.md` 约定第一条。提交前先问你。

### 之后（不在本计划内）

- 给新开源产品整理官方资源和截图，按 [NEXT_RESOURCE_CURATION_PLAN.md](NEXT_RESOURCE_CURATION_PLAN.md) 再做一批。
- 走查里的其余问题：相近类型合并或在比较中允许同一分组（问题 2）、核心能力对比维度（问题 5）、主要类型显示（问题 6）、手机筛选折叠（问题 7）。

## 停止条件（停下来问你）

- 短测失败，或者实际模型与指定不符。
- 试点里超过一半的候选因为证据不足被拒，说明契约或标准需要调整。
- 需要修改目录范围、类型定义，或者改旧产品的核心字段。
- 出现认证或额度错误。

## 完成标准

- 10 个类型中，每个达到开源 ≥5、商业 ≥3；没达到的类型写明原因。
- 新产品都有官方来源和核实过的许可证；已有产品只增加了关系。
- 旧产品核心字段、旧关系和历史来源不变；全部测试和构建通过；独立审查无中高危问题。
- 重新走查时，服务台选型可以在 3–5 个以上的真实候选中比较。

## 预估

- 试点：1 个工作单元，加主会话复核，约半天。
- 剩余 9 个类型：模型运行约 2–4 小时（并发 4），统一复核和入库约半天到一天。
- 模型费用：以 CLI 收据为准。按以往每个工作单元的量级，预计远低于上一轮 274 组的总量。
