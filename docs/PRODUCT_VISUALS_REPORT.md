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


---

# 第二批官方资源整理（2026-10-31）

在首批 10 个产品之后，再为 31 个开源产品补充官方资源、Logo 和真实界面截图，共 41 个已整理产品。只写 `data/product-resources.json`；正式 1,440 产品／1,724 关系、`data/catalog.sql`、`data/catalog-snapshot.json`、`var/catalog.sqlite` 的 SHA 与整理前一致。

## 做法

- 名单来自本地 README 快照中带候选界面图的开源产品，偏重常见品类，仓库均未归档、近期有推送。
- 每个资源链接、Logo 和截图都在 2026-10-31 实际打开：网页 HTTP 200 且最终地址与写入一致，图片 `Content-Type` 为 `image/*`。每张截图下载后转成缩略图逐张看过，再决定 `ui_screenshot` 或 `ui_composite`。
- README 没有真实界面图的产品，改从官网、官方文档或帮助中心取图；仍找不到的写进 `missing` 并写明原因。Grist、Mautic、Strapi、Unleash 的截图来自官方文档页。
- Logo：优先官方文件（Linkwarden、Uptime Kuma、Etherpad、Postiz）；其余用官方 GitHub 组织头像，账号类型逐个用 API 确认为 Organization。Frappe Helpdesk、ERPNext、Frappe HR 共用 Frappe 组织头像。
- 31 个产品逐个执行 `python3 -B -m server.refresh <id>`，预览后 `--apply`，无告警（ERPNext 预览时出现过一次瞬时 SSL 错误，重试通过）。

## 31 个产品的资源表

（由脚本从 `data/product-resources.json` 生成。“—”表示未找到，原因见下一节。）

| 产品 | Logo | 截图 | 文档 | 演示/试用 | 部署 | 功能 | 更新记录 | 视频 | 最新发布（GitHub） |
|---|---|---|---|---|---|---|---|---|---|
| OpenProject | GitHub 组织头像 | 1 | [✓](https://www.openproject.org/docs/) | — | [✓](https://www.openproject.org/docs/installation-and-operations/installation/docker-compose/) | [✓](https://www.openproject.org/collaboration-software-features/) | [✓](https://www.openproject.org/docs/release-notes/) | — | v17.9.6 |
| Docmost | GitHub 组织头像 | 2 | [✓](https://docmost.com/docs/) | — | [✓](https://docmost.com/docs/installation) | — | [✓](https://github.com/docmost/docmost/releases) | — | v0.97.0 |
| Etherpad | 官方文件 | 2 | [✓](https://docs.etherpad.org/) | — | [✓](https://docs.etherpad.org/docker.html) | — | [✓](https://github.com/ether/etherpad/blob/develop/CHANGELOG.md) | — | v3.3.12 |
| Super Productivity | GitHub 组织头像 | 2 | [✓](https://github.com/super-productivity/super-productivity/wiki) | [✓](https://app.super-productivity.com) | [✓](https://super-productivity.com/download/) | — | [✓](https://github.com/super-productivity/super-productivity/releases) | — | v19.3.1 |
| Grist | GitHub 组织头像 | 2 | [✓](https://support.getgrist.com) | — | [✓](https://support.getgrist.com/self-managed/) | — | [✓](https://github.com/gristlabs/grist-core/releases) | — | v1.7.22 |
| Frappe Helpdesk | GitHub 组织头像 | 2（拼图 1） | [✓](https://docs.frappe.io/helpdesk/your-first-steps-with-frappe-helpdesk) | — | [✓](https://docs.frappe.io/helpdesk/installation) | — | [✓](https://github.com/frappe/helpdesk/releases) | — | v1.31.1 |
| osTicket | GitHub 组织头像 | 2 | [✓](https://docs.osticket.com/en/latest/) | — | [✓](https://docs.osticket.com/en/latest/Getting%20Started/Installation.html) | [✓](https://osticket.com/features/) | [✓](https://github.com/osTicket/osTicket/releases) | — | v1.18.4 |
| Snipe-IT | GitHub 组织头像 | 2 | [✓](https://snipe-it.readme.io/docs/introduction) | [✓](https://demo.snipeitapp.com/login) | [✓](https://snipe-it.readme.io/docs/docker) | [✓](https://snipeitapp.com/product) | [✓](https://github.com/grokability/snipe-it/releases) | — | v8.8.3 |
| GLPI | GitHub 组织头像 | 2 | [✓](https://glpi-user-documentation.readthedocs.io/fr/latest/) | — | [✓](https://glpi-install.readthedocs.io/en/latest/install/index.html) | [✓](https://www.glpi-project.org/en/features/) | [✓](https://github.com/glpi-project/glpi/releases) | — | 12.0.1 |
| Mautic | GitHub 组织头像 | 1 | [✓](https://docs.mautic.org/en/latest/) | [✓](https://mautic.org/start-using-mautic/try-mautic/) | [✓](https://docs.mautic.org/en/latest/getting_started/how_to_install_mautic.html) | [✓](https://mautic.org/features/) | [✓](https://mautic.org/releases/) | — | 7.2.2 |
| phpList | GitHub 组织头像 | 1 | [✓](https://www.phplist.org/documentation/) | [✓](https://demo.phplist.org/lists/admin/) | [✓](https://www.phplist.org/manual/books/phplist-manual/page/installing-phplist-manually) | [✓](https://www.phplist.org/features/) | [✓](https://github.com/phpList/phplist3/releases) | — | v3.6.17 |
| LimeSurvey | GitHub 组织头像 | 2（拼图 2） | [✓](https://www.limesurvey.org/manual/) | — | [✓](https://www.limesurvey.org/manual/Installation) | — | [✓](https://github.com/LimeSurvey/LimeSurvey/releases) | — | 无正式发布 |
| Postiz | 官方文件 | 1（拼图 1） | [✓](https://docs.postiz.com/general/introduction) | — | [✓](https://docs.postiz.com/self-host/installation/overview) | — | [✓](https://github.com/gitroomhq/postiz-app/releases) | — | v2.25.3 |
| Apache Answer | GitHub 组织头像 | 1（拼图 1） | [✓](https://answer.apache.org/docs/) | — | [✓](https://answer.apache.org/docs/installation/) | — | [✓](https://github.com/apache/answer/releases) | — | v2.0.3 |
| Actual Budget | GitHub 组织头像 | 1 | [✓](https://actualbudget.org/docs/) | [✓](https://demo.actualbudget.org/) | [✓](https://actualbudget.org/docs/install/docker/) | [✓](https://actualbudget.org/docs/tour/) | [✓](https://github.com/actualbudget/actual/releases) | — | v26.10.0 |
| Firefly III | GitHub 组织头像 | 2（拼图 2） | [✓](https://docs.firefly-iii.org/) | [✓](https://demo.firefly-iii.org/login) | [✓](https://docs.firefly-iii.org/how-to/firefly-iii/installation/docker/) | — | [✓](https://github.com/firefly-iii/firefly-iii/releases) | — | v6.7.9 |
| ERPNext | GitHub 组织头像 | 2 | [✓](https://docs.frappe.io/erpnext/introduction) | — | [✓](https://github.com/frappe/frappe_docker) | — | [✓](https://github.com/frappe/erpnext/releases) | — | v15.124.3 |
| Frappe HR | GitHub 组织头像 | 1（拼图 1） | [✓](https://docs.frappe.io/hr/introduction) | — | [✓](https://docs.frappe.io/framework/user/en/installation) | — | [✓](https://github.com/frappe/hrms/releases) | — | v16.53.0 |
| Ghost | GitHub 组织头像 | 1（拼图 1） | [✓](https://docs.ghost.org/) | — | [✓](https://docs.ghost.org/install) | — | [✓](https://ghost.org/changelog/) | — | v6.73.0 |
| Strapi | GitHub 组织头像 | 2 | [✓](https://docs.strapi.io/cms/intro) | [✓](https://strapi.io/demo) | [✓](https://docs.strapi.io/cms/installation/docker) | [✓](https://strapi.io/features) | [✓](https://feedback.strapi.io/changelog) | — | v5.60.0 |
| Saleor | GitHub 组织头像 | 1（拼图 1） | [✓](https://docs.saleor.io/) | [✓](https://demo.saleor.io/en/default) | [✓](https://docs.saleor.io/setup/docker-compose) | — | [✓](https://github.com/saleor/saleor/releases) | — | 3.23.45 |
| Linkwarden | 官方文件 | 1（拼图 1） | [✓](https://docs.linkwarden.app/) | [✓](https://demo.linkwarden.app/login) | [✓](https://docs.linkwarden.app/self-hosting/installation/) | — | [✓](https://github.com/linkwarden/linkwarden/releases) | — | v2.16.3 |
| Miniflux | GitHub 组织头像 | 1 | [✓](https://miniflux.app/docs/index.html) | — | [✓](https://miniflux.app/docs/installation.html) | [✓](https://miniflux.app/features.html) | [✓](https://github.com/miniflux/v2/releases) | — | 2.3.4 |
| wallabag | GitHub 组织头像 | 1 | [✓](https://doc.wallabag.org/) | — | [✓](https://doc.wallabag.org/admin/installation/installation/) | — | [✓](https://github.com/wallabag/wallabag/releases) | — | 2.6.15 |
| Uptime Kuma | 官方文件 | 2 | [✓](https://uptime.kuma.pet/docs/) | [✓](https://demo.kuma.pet/start-demo) | [✓](https://github.com/louislam/uptime-kuma/wiki/%F0%9F%94%A7-How-to-Install) | — | [✓](https://github.com/louislam/uptime-kuma/releases) | — | 2.5.8 |
| Gitea | GitHub 组织头像 | 2 | [✓](https://docs.gitea.com/) | [✓](https://demo.gitea.com/) | [✓](https://docs.gitea.com/installation/install-with-docker/) | [✓](https://about.gitea.com/products/gitea/) | [✓](https://github.com/go-gitea/gitea/releases) | — | v28.2.0 |
| Langfuse | GitHub 组织头像 | 1 | [✓](https://langfuse.com/docs) | [✓](https://langfuse.com/docs/demo) | [✓](https://langfuse.com/self-hosting/deployment/docker-compose) | — | [✓](https://langfuse.com/changelog) | — | v4.72.0 |
| Unleash | GitHub 组织头像 | 2 | [✓](https://docs.getunleash.io/) | [✓](https://app.unleash-hosted.com/demo/login) | [✓](https://docs.getunleash.io/deploy/getting-started) | — | [✓](https://docs.getunleash.io/release-notes) | — | v8.3.1 |
| Hoppscotch | GitHub 组织头像 | 1 | [✓](https://docs.hoppscotch.io/) | — | [✓](https://docs.hoppscotch.io/documentation/self-host/getting-started) | — | [✓](https://github.com/hoppscotch/hoppscotch/releases) | — | 2026.10.0 |
| Nextcloud Server | GitHub 组织头像 | 1（拼图 1） | [✓](https://docs.nextcloud.com/server/latest/admin_manual/) | [✓](https://nextcloud.com/instant-trial/) | [✓](https://docs.nextcloud.com/server/latest/admin_manual/installation/index.html) | [✓](https://nextcloud.com/features/) | [✓](https://nextcloud.com/changelog/) | — | v33.0.10 |
| Jitsi Meet | GitHub 组织头像 | 1（拼图 1） | [✓](https://jitsi.github.io/handbook/docs/intro/) | [✓](https://meet.jit.si/) | [✓](https://jitsi.github.io/handbook/docs/devops-guide/) | — | [✓](https://jitsi.github.io/handbook/docs/releases/) | — | stable/jitsi-meet_11248 |

## 缺失项（原因记录在各产品的 `missing` 中）

- **视频**：31 个产品都没有在 README 和官网首页找到具体产品演示视频（只有频道链接的不算）。
- **演示/试用缺失**：OpenProject、Docmost、Etherpad、Grist、Frappe Helpdesk、osTicket（演示站 SSL 握手失败）、GLPI、LimeSurvey（只有销售预约页）、Postiz、Apache Answer、ERPNext、Frappe HR（官网入口指向 Frappe CRM）、Ghost（试用需绑定付费计划）、Hoppscotch（官网首页本身就是在线应用，不重复收录）。
- **功能页缺失**：Docmost、Etherpad、Super Productivity、Grist、Frappe Helpdesk、LimeSurvey（404）、Postiz（跳到智能体页）、Apache Answer、Firefly III、ERPNext（软 404）、Frappe HR、Ghost（跳回首页）、Saleor、Linkwarden、wallabag、Uptime Kuma、Langfuse、Unleash、Hoppscotch、Jitsi Meet 等。
- **演示标注**：免登录演示站（Snipe-IT、Firefly III、phpList 登录页公布演示账号）、官方测试实例（Gitea，页面注明随时可能被清空）、限时演示（Uptime Kuma）、官方公共实例（Jitsi）、可浏览店面（Saleor）与需注册／申请的试用（Mautic、Nextcloud、Strapi 需提交表单）在 label 或 note 中分开写明；Linkwarden、Unleash、Langfuse 的演示入口是否需要注册未能确认，如实写在 note 里。
- 截图 `ui_composite`（官方营销排版或设备外框中的界面）：Frappe Helpdesk 1、LimeSurvey 2、Postiz 1、Apache Answer 1、Firefly III 2、Frappe HR 1、Ghost 1、Saleor 1、Linkwarden 1、Nextcloud 1、Jitsi Meet 1。

## 测试与浏览器验收

| 项目 | 结果 |
|---|---|
| 后端 `python3 -B -m unittest discover -s server/tests -t .` | 83 通过 |
| 队列 `python3 -B -m unittest discover -s tests` | 28 通过 |
| 隔离浏览器 `cd web && npx playwright test` | 38 通过（12 项真实数据测试跳过） |
| 真实数据浏览器 `cd web && SAAS_E2E_REAL=1 npx playwright test` | 12 通过（新增 1 项：31 个新产品的 Logo、截图实际加载，且含官网、仓库、文档、部署指南、无重复链接） |
| 构建 `cd web && npm run build` | 通过 |
| 内置浏览器 | 实际打开 OpenProject、Uptime Kuma、wallabag、Gitea 详情页，手机宽度（375px）无横向溢出，Logo 与截图可加载 |

对 `web/e2e/real-visuals.spec.ts` 只做了两处与新数据对应的数字调整，没有放宽断言：首页“已整理产品”展示上限为 12（原先只有 10 个产品）；搜索 “CRM” 且开启官方资源筛选后结果为 3 个（新增 Ghost，其内容提到 CRM）。没有改 `server/` 或 `web/src`。真实套件会覆盖历史验收截图，跑完已用 `git checkout` 恢复。审查后删除 Mautic 一张示意图并补两条 note，只改了资源文件，之后重跑了 `test_resources`（9 项通过）。

## 独立审查

独立的只读审查会话（不参与构建）实际检查了全部 197 个 URL（31 个 Logo、全部资源链接和截图）：状态码均为 200，图片类型均为 `image/*`；27 个组织头像账号逐个用 API 确认为 Organization；约 46 张截图和 29 个 Logo 逐张看过；同产品内无重复链接，资源也未与正式记录的官网或仓库重复；每个产品的各类资源要么有链接、要么有 `missing` 原因，抽查的“404／跳回首页／无法连接”断言属实；正式数据 SHA 未变；`test_resources` 9 项通过。结论：无高危问题。

- **中危（已处理）**：Mautic 的 `campaign_events.png` 是概念示意图（文字卡片），不是真实界面，已删除，Mautic 保留 1 张真实表单构建器截图。
- **低危（已处理）**：Strapi 的演示页实际要提交表单，Actual Budget 的演示缺说明，均已补 note。
- **低危（记录）**：Jitsi Meet、Frappe HR 的官方营销拼图里有真人头像，属官方产品展示，kind 标为 `ui_composite`；Etherpad 与 Postiz 的 SVG Logo 审查端无法渲染，构建端已用 `qlmanage` 看过。
