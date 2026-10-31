# 下一批官方资源整理计划（交给执行会话）

日期：2026-10-31 制定。目标：在已有 10 个产品的基础上，再为 **20–30 个开源产品**补充官方资源、Logo 和真实界面截图。优先利用本地已有的采集快照，尽量少上网、少调用 API。

## 开工前必读

1. `CLAUDE.md`，特别是“约定”第一条（产品资源与可视化阶段）。
2. `docs/PRODUCT_VISUALS_REPORT.md`：上一批的做法、标准和缺失项写法。
3. `data/product-resources.json`：数据格式，以上一批 10 个产品为样例。
4. `server/resources.py`：校验规则。写入的数据必须通过它。
5. 先跑 `git status`。`templates/`、`harness/` 下约 200 个未提交修改与本任务无关，不要动，也不要提交。

## 硬性规则

- **不改正式数据**：不改 `var/catalog.sqlite`、`data/catalog.sql`、`data/catalog-snapshot.json`，不新增产品，不改产品 ID。只写 `data/product-resources.json`。
- **不读 `.env`**。需要 GitHub token 时，只用环境变量 `GITHUB_TOKEN`。没有 token 就按匿名额度（每小时 60 次）分批跑。
- **每个写入的链接和图片，必须本轮实际打开过**：网页 HTTP 200，图片 `Content-Type: image/*`。写入的是最终跳转后的地址。不得凭记忆或推测补链接。
- **每张截图必须实际打开看过**：下载到 scratchpad，转成小图后查看。
  - 真实单屏界面标为 `ui_screenshot`；
  - 官方营销排版里的界面组合标为 `ui_composite`；
  - 风格化示意图、模糊占位图、插画、AI 生成图一律不收；
  - 徽章（shields.io、CI）、赞助商图、贡献者墙、Logo 墙一律排除。
- **Logo**：优先用官网或 README 里的官方文件。宽幅文字标识在方形图标位里看不清时，可以改用官方 GitHub 组织头像，但要先用 API 确认 `owner.type == "Organization"`。个人账号头像绝不能用作 Logo。
- **不重复填充**：不要把官网填进文档、功能等其他类型。官网和仓库已在正式记录里，资源层不要重复写（除非正式记录的主页明显不是产品首页，此时写 note 说明，正式记录不改）。
- **demo 如实标注**：免登录演示站、可公开浏览的社区实例、需注册的云端试用要分开，在 `label` 或 `note` 里写明。
- **找不到的写进 `missing`**，并写明原因。每个产品都要说明视频、功能页、截图等是否找到。
- **构建与审查分开**：写完之后，由另一个独立的只读会话审查。执行会话不要自己审自己。

## 步骤

### 第 1 步：从本地快照提取候选（不联网）

写一个一次性脚本，放在 scratchpad，不入库。读取 `var/catalog.sqlite` 里 `track == "open_source"` 且不在 `data/product-resources.json` 中的产品，对每个产品：

- 从 `sources` 中 `kind == "readme"` 的快照（`data/collections/` + `snapshot_path`）提取：
  - 图片：`<img src>`、`![](...)`、`user-attachments`。相对路径用仓库默认分支拼成 `raw.githubusercontent.com` 地址。
  - 链接：文本或 URL 含 docs、documentation、demo、try、install、self-host、deploy、changelog、releases、features、youtube 的。
- 记录 `kind == "documentation"` 的来源 URL，作为“文档”的候选线索。注意它往往是某个具体子页面，不一定是文档首页。
- 排除徽章和赞助商域名：shields.io、badge、opencollective、contrib.rocks、star-history、trendshift、producthunt、heroku/railway/vercel 部署按钮等。

输出一份候选表，每个产品一行：候选图片数、候选链接，以及所属主要类型和该类型下的产品数。

### 第 2 步：选定名单（20–30 个）

优先级：

1. README 里有候选界面图；
2. 所属类型的同类产品较多，能让“同类型的其他选择”区域出现多张有图的卡片。优先 CRM、项目管理、客服、表单问卷、团队沟通、知识库、时间追踪、邮件营销等常见类型；
3. 仓库未归档、近期仍在维护。

**把名单交给用户确认后再继续。**

### 第 3 步：逐个核对与补充（需要联网）

对每个产品：

1. 用 curl 打开第 1 步的候选链接和图片，记录状态码、最终 URL、Content-Type 和页面标题。注意识别“跳回首页”的伪页面：最终 URL 是首页，或标题与预期不符的，都不算。
2. 下载候选截图，转成小图后逐张查看，选 1–3 张真实界面图，写一句简短的中文说明（caption）。
3. 本地快照里缺的类型（比如功能页、部署指南），到官网首页、文档首页找。同样要实际打开。
4. 按 `data/product-resources.json` 现有格式写入：
   - `curated_at`、`logo`、`resources`、`screenshots`、`missing`；
   - 每项带上 `found_on`（在哪个官方页面找到）和 `checked_at`；
   - 截图尽量带上 `width`、`height`。
5. 每写完 5 个产品，执行一次：

   ```bash
   python3 -B -m unittest server.tests.test_resources
   ```

   确认能通过校验。

### 第 4 步：用更新命令复核

对每个新整理的产品执行：

```bash
python3 -B -m server.refresh <产品ID>
```

先预览，确认无告警后加 `--apply`。它会再次检查所有链接和图片，并写入 GitHub 最新发布信息。

- 返回 403 或 429：说明匿名额度用完，停下等待，不要换别的办法绕过。
- 有告警的产品：回到第 3 步修正。

### 第 5 步：验证

```bash
python3 -B -m unittest discover -s server/tests -t .
python3 -B -m unittest discover -s tests
cd web && npx playwright test
cd web && SAAS_E2E_REAL=1 npx playwright test
cd web && npm run build
```

- 真实数据浏览器套件会覆盖历史验收截图，跑完必须恢复：

  ```bash
  git checkout -- docs/local-decisions docs/local-shortlist docs/product-discovery
  ```

- `web/e2e/real-visuals.spec.ts` 里的 `CURATED` 列表只含上一批 10 个，可以保持不变。如果要加入新产品，只追加，不放宽断言。
- 在内置浏览器里实际打开 3–5 个新产品的详情页，桌面和手机宽度各看一次：Logo、截图、灯箱、资源卡片都要正常。

### 第 6 步：独立审查

另开一个只读会话审查：

- 抽查至少 10 个新链接和图片是否真实可访问；
- 检查截图 kind 标注是否合理、有没有重复填充、`missing` 是否写了原因；
- 确认正式数据 SHA 没变。

中危以上的问题修完再交付。

### 第 7 步：交付

- 在 `docs/PRODUCT_VISUALS_REPORT.md` 末尾追加“第二批”一节，内容包括：产品清单与资源表（用脚本从 JSON 生成，不手写）、缺失项、测试结果、审查结论。
- 更新 `README.md` 对应段落里的数字，以及 `CLAUDE.md` 约定第一条里的数字。
- **只提交本任务的文件**。提交前先问用户。提交信息格式：`products: curate second batch of official resources`。

## 停止条件（停下来问用户）

- 候选不足：符合条件的开源产品少于 20 个。
- 需要改正式数据，或者需要改 `server/`、`web/` 的代码才能完成。
- GitHub 持续限流，又没有 token。
- 发现上一批数据有错（例如链接失效、截图不实）：先报告，不要擅自修改。

## 完成标准

- 新增 20–30 个已整理产品：每个都有 Logo、至少 1 张真实界面图（或在 `missing` 里写明为什么没有）、至少包含文档和部署两类资源，缺失项都写了原因。
- 所有测试和构建通过，历史截图已恢复，独立审查无中高危问题。
- 正式 1,440 产品／1,724 关系和 `data/catalog.sql` 的 SHA 不变。
