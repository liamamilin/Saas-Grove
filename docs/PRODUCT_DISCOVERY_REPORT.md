# 产品发现与比较 — 实际交付与验收

2026-10-29。基线 `4031d9e`，保留旧模板的未提交修改。代码：`server/products.py`、API/查询层、`web/src/products.tsx` 及现有页面、导航与样式；相关单元及浏览器用例同时提交。

## 可操作入口

- 首页 `/` 直接搜索真实产品，`/search` 跨分类搜索；URL 保留关键词、分区、许可、部署、排序和分页。旧类型搜索仍在 `/browse`。
- `/products/:id` 展示来源可追溯的产品资料；缺项保留未知。未单独记录复核日期时展示来源采集日期，资料核对与实际部署测试分开。
- 叶子页选择同类型 2–4 产品，`/compare?leaf=...&ids=...` 分享、刷新、替换、移除及返回；失效的对象链接可重新选择。手机在比较表内横向滚动，页面不横向溢出。

## 真实样板与数据保留

CRM 已用 Twenty、EspoCRM、Salesforce Sales Cloud 完成混合比较。EspoCRM 原本已是正式产品，依据[官方 README](https://raw.githubusercontent.com/espocrm/espocrm/master/README.md)只补 CRM 关系，保留其付费 Advanced Pack 限制说明。商业产品的能力缺项显示未核实，不据此判不支持。

产品仍 1,440（546 开源、894 商业），关系 1,723 → 1,724。与变更前 SQLite 备份全量比对：产品 ID、原核心字段、原关系、分区和所有历史来源保留；仅 EspoCRM 追加 CRM 归属。分类文件、53 待确认与采集进度文件逐字未改，原5阻断项保持。正式 SQL 快照恢复后三表全部行一致；每个产品的详情查询及核心字段/来源共1,440项核对通过。变更证据见[data/collections/product-discovery-crm-20261029.json](../data/collections/product-discovery-crm-20261029.json)。本地备份及全量核对结果保留在 `var/product-discovery-20261029/`。

## 执行过的测试

| 命令（仓库根目录） | 实际结果 |
|---|---|
| `python3 -B -m unittest discover -s server/tests` | 67 passed |
| `python3 -B -m unittest discover -s tests` | 28 passed |
| `npm --prefix web run build` | TypeScript 与 Vite 生产构建通过 |
| `npm --prefix web run test:e2e` | 14 passed；4个真实数据用例按模式跳过，在下一个命令单独运行 |
| `SAAS_E2E_REAL=1 npm --prefix web run test:e2e -- e2e/real-products.spec.ts` | 4 passed |

Playwright 使用隔离数据库：常规回归明确为合成替身；真实验收从正式 SQL 快照恢复临时副本，页面没有固定演示结果。桌面1440×1000、手机390×844。覆盖首页搜索、跨分类检索、分区/许可/部署筛选、分页、详情与官方链接、CRM三产品比较、替换/移除/恢复、分享刷新、原上下文返回，以及真实 IGA 类型的四产品比较。对本地5299更新后的构建另做6个HTTP路由检查，并在应用内浏览器手动走通搜索和详情/比较选择。

OpenCode Go / DeepSeek V4.1 Flash 独立只读静态审查已完成，实际会话模型经本地导出确认；最初读取超时后在同一会话收敛结论。审查指出的日期/核对状态混淆、部署否定句、失效比较恢复、定位、来源去重及上下文问题已处理并补相应用例。静态审查没有运行测试，不将其结论冒充运行结果。

## 真实浏览器截图

| 页面 | 桌面 | 手机 |
|---|---|---|
| 搜索 | [查看](product-discovery/search-desktop.png) | [查看](product-discovery/search-mobile.png) |
| Twenty详情 | [查看](product-discovery/product-desktop.png) | [查看](product-discovery/product-mobile.png) |
| CRM比较 | [查看](product-discovery/compare-desktop.png) | [查看](product-discovery/compare-mobile.png) |

## 当前边界与下一步

本轮必需功能已完成。现有资料缺项继续保留未知，商业产品保持基本索引；部署筛选是已有明确描述的确定性索引，不覆盖未记录的部署形式。比较呈现已有能力文本，不自动打分或将缺项判为否定。原54个无正式案例类型与待处理研究不属于本轮扩采目标。第三方产品未部署实测，本站仍为本地运行。

下一步最值得做：本地收藏与候选清单；围绕重点类型建立有来源依据的统一比较维度；来源更新与资料新鲜度维护。先提升决策质量，再考虑扩大数量。
