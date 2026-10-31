# 产品资源与可视化探索验收（2026-10-31）

本轮让 SaaS Grove 从可搜索目录转向直观探索真实产品。只整理和展示官方资料；找不到的项目写明缺失，不推测。正式 1,440 产品／1,724 关系、`data/catalog.sql`（SHA 与 `data/catalog-snapshot.json` 一致）、分类和历史来源均未改动。

## 实现了什么

| 能力 | 位置 |
|---|---|
| 官方资源层：按产品 ID 关联，八类资源、Logo、截图、缺失原因、GitHub 仓库信息、待复核标记、更新历史；加载时整体校验 | `data/product-resources.json`、`server/resources.py` |
| API：卡片带 `logo_url`／`resources_curated`／`screenshot_count`；搜索 `curated=1` 筛选和 `exclude`；详情 `resource_profile` 与各类型产品数；类型页 `related` 同组相关类型；类型页列表带 Logo | `server/products.py`、`server/api.py` |
| Logo（卡片、类型页、详情、比较表头、候选清单、首页入口），失败或未整理时统一首字母占位 | `web/src/media.tsx` |
| 详情：截图画廊与灯箱（键盘切换、Esc 关闭后焦点回到缩略图、移动端横滑）、资源面板与缺失说明、Demo／视频按钮、最新发布与最近推送、同类型其他产品（可切换类型、收藏、进入比较）、所属类型入口 | `web/src/products.tsx`、`web/src/media.tsx` |
| 发现：首页“先看看真实界面”、搜索“官方资源”筛选、类型页“同一分组的相关类型”、精简后的产品卡片（Logo／名称／简介／开源或商业／主要类型／许可与截图标签／收藏） | `web/src/products.tsx`、`web/src/pages.tsx` |
| 单产品更新命令：默认预览，`--apply` 原子写入；网络失败或限流整次不写；正式字段差异只记待复核 | `server/refresh.py` |

## 10 个已补充资源的产品

官网与代码仓库均复用正式记录（Chatwoot 正式记录主页是帮助中心，资源层另补产品首页，正式记录未改）。每个链接和图片都在 2026-10-31 实际打开（HTTP 200，图片为 `image/*`）；截图逐张人工查看，确认为界面而非插画。

| 产品 | Logo | 截图 | 文档 | 演示/试用 | 部署 | 功能 | 更新记录 | 视频 | 最新发布（GitHub） |
|---|---|---|---|---|---|---|---|---|---|
| Twenty | 官方文件 | 2（拼图 2） | [✓](https://docs.twenty.com/getting-started/introduction) | [✓](https://app.twenty.com/) | [✓](https://docs.twenty.com/developers/self-host/capabilities/docker-compose) | [✓](https://twenty.com/product) | [✓](https://twenty.com/releases) | — | twenty/v2.54.0 |
| EspoCRM | GitHub 组织头像 | 1 | [✓](https://docs.espocrm.com/) | [✓](https://www.espocrm.com/demo/) | [✓](https://docs.espocrm.com/administration/installation/) | [✓](https://www.espocrm.com/features/) | [✓](https://github.com/espocrm/espocrm/releases) | — | 10.0.11 |
| Zulip | 官方文件 | 1 | [✓](https://zulip.com/help/) | [✓](https://chat.zulip.org/?show_try_zulip_modal) | [✓](https://zulip.readthedocs.io/en/latest/production/install.html) | [✓](https://zulip.com/features/) | [✓](https://zulip.readthedocs.io/en/latest/overview/changelog.html) | — | 12.3 |
| Plane | GitHub 组织头像 | 2 | [✓](https://docs.plane.so/) | [✓](https://app.plane.so/) | [✓](https://developers.plane.so/self-hosting/overview) | — | [✓](https://plane.so/changelog) | — | v1.4.3 |
| Penpot | GitHub 组织头像 | 1（拼图 1） | [✓](https://help.penpot.app/user-guide/) | [✓](https://design.penpot.app/) | [✓](https://help.penpot.app/technical-guide/getting-started/) | [✓](https://penpot.app/features) | [✓](https://github.com/penpot/penpot/blob/develop/CHANGES.md) | [✓](https://github.com/user-attachments/assets/7c67fd7c-04d3-4c9b-88ec-b6f5e23f8332) | 2.18.5 |
| Chatwoot | GitHub 组织头像 | 2 | [✓](https://www.chatwoot.com/hc/user-guide/en) | — | [✓](https://developers.chatwoot.com/self-hosted) | [✓](https://www.chatwoot.com/features) | [✓](https://github.com/chatwoot/chatwoot/releases) | — | v4.19.1 |
| Formbricks | 官方文件 | 1 | [✓](https://formbricks.com/docs/platform/introduction) | [✓](https://app.formbricks.com/auth/signup) | [✓](https://formbricks.com/docs/self-hosting/overview) | — | [✓](https://github.com/formbricks/formbricks/releases) | — | 6.1.2 |
| listmonk | 官方文件 | 1 | [✓](https://listmonk.app/docs/) | [✓](https://demo.listmonk.app/) | [✓](https://listmonk.app/docs/installation/) | — | [✓](https://github.com/knadh/listmonk/releases) | — | v7.0.0-beta.1 |
| Discourse | GitHub 组织头像 | 1（拼图 1） | [✓](https://meta.discourse.org/c/documentation/10) | [✓](https://try.discourse.org/) | [✓](https://github.com/discourse/discourse/blob/main/docs/INSTALL-cloud.md) | [✓](https://www.discourse.org/features) | [✓](https://releases.discourse.org/) | — | 无正式发布 |
| Kimai | GitHub 组织头像 | 2 | [✓](https://www.kimai.org/documentation/) | [✓](https://www.kimai.org/en/demo.html) | [✓](https://www.kimai.org/documentation/installation.html) | [✓](https://www.kimai.org/en/features) | [✓](https://github.com/kimai/kimai/releases) | — | 2.71.0 |

说明：

- “演示/试用”区分了免登录演示站（EspoCRM、listmonk、Discourse、Kimai）、可公开浏览的真实社区实例（Zulip）和需注册的云端试用（Twenty、Plane、Penpot、Formbricks），页面按原标签显示。
- Logo 优先用官网或 README 中的官方文件；该文件是宽幅文字标识、在方形图标位里看不清时，改用官方 GitHub **组织**头像（已确认账号类型为 Organization，个人账号头像不使用）。其余 1,430 个产品不自动生成 Logo。
- “官方界面拼图”指官方营销排版中的界面组合，页面单独标注，不当作完整截图。

## 无法可靠获取的资料

- 视频：10 个产品中只有 Penpot 的 README 有产品视频；其他 9 个在 README 与官网首页未找到具体演示视频（Kimai 只有频道链接，Discourse 唯一的 YouTube 链接与产品无关）。
- 功能介绍页：Plane（`/features` 跳回首页）、Formbricks、listmonk 没有独立页面。
- Chatwoot：未找到公开演示或独立试用入口。
- 截图：Twenty 只找到营销排版拼图；Discourse README 主图是模糊占位的示意图，未收录。

## 测试与浏览器验收

| 项目 | 结果 |
|---|---|
| 后端 `python3 -B -m unittest discover -s server/tests -t .` | 83 通过（原 74 + 新 9：真实资源层校验与快照 SHA、API 合并、非法资源整体拒绝、更新命令的预览、写入、404 标记、限流和网络中止） |
| 队列 `python3 -B -m unittest discover -s tests` | 28 通过 |
| 隔离浏览器 `cd web && npx playwright test` | 38 通过（原 33 + 新 5：Logo 加载与失败占位、资源筛选、资源类型与缺失、灯箱键盘与焦点、未整理产品不虚构、同类产品→类型页→收藏→比较、375px 无横向溢出） |
| 真实数据浏览器 `cd web && SAAS_E2E_REAL=1 npx playwright test` | 11 通过（原 8 + 新 3：10 个产品的官方 Logo 和截图实际加载、资源类型齐全且不重复、首页→搜索筛选→类型页→详情、390px 手机端详情／灯箱／搜索） |
| 构建 `cd web && npm run build` | 通过（打包体积提示为既有依赖所致） |
| 真实更新命令 | 10 个产品逐个 `--apply`，均无告警，写入 GitHub 最新发布与最近推送 |

截图见 [docs/product-visuals/](product-visuals/)：首页、搜索卡片（桌面／手机）、Chatwoot 与 Penpot 详情、Kimai 手机详情、桌面／手机灯箱。

## 局限

- 图片直接链接官方原图，没有复制到本仓库。官方删除或改名后，页面会回退到占位，`server.refresh` 会把 404 标记为无法打开。
- GitHub 匿名接口每小时 60 次，每次更新一个产品约用 2 次。
- 第三方产品未部署实测；资源与截图只说明官方资料存在。

## 独立审查

独立的只读审查会话（不参与构建）的结论是：无高危问题，可以放行。它实际运行了后端测试、队列测试和 tsc，并用 curl 抽查了 8 个资源和图片链接；浏览器相关的结论来自静态阅读。

- **中危（已处理）**：重跑旧的真实数据浏览器套件，会把历史验收截图（`docs/local-decisions`、`docs/local-shortlist`、`docs/product-discovery`）写成新界面。已用 git 恢复。以后跑 `SAAS_E2E_REAL=1` 后需再执行一次 `git checkout -- docs/local-decisions docs/local-shortlist docs/product-discovery`。
- **已修复的低危项**：
  - `GITHUB_TOKEN` 改为只在主机名精确等于 api.github.com 时发送；
  - `latest_release.url` 补上协议校验；
  - 无法打开的截图不再显示，也不再计数；
  - 卡片上的拼图改称“官方界面图”；
  - Chatwoot 的正式主页与资源层主页同时显示；
  - 面板说明里注明“来自正式产品记录”的链接不在本轮打开范围内；
  - 相关类型的链接名称与跳转目标一致；
  - 灯箱大图加载失败时会回退；
  - 从同类产品连续点击时 `from` 不再层层嵌套；
  - 原子写入保留文件权限并执行 fsync。
- **记录、暂不处理**：
  - refresh 不能识别“重定向回首页”这类软 404；
  - 已解决的 review_flag 消失时不写入历史；
  - 资源层里有过期 ID 时，服务会整体拒绝启动；
  - 产品同时属于开源和商业两个分区时，计数会重复（目前没有这种产品）；
  - listmonk 的最新发布是预发布版本，页面没有标出；
  - 若干补充测试：图片 404、恢复可访问、429、发布接口 404，以及 Token 只发往 api.github.com 的范围。
