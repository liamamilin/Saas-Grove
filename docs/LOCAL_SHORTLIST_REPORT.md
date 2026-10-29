# 本地收藏与候选清单 — 实际验收

2026-10-29，基于 `b155640` 开发。按用户最新决定仅本地使用，没有配置 GitHub Pages、账号或公开部署。

搜索卡片与产品详情可收藏/取消收藏；`/shortlist` 提供类型和分区筛选，以及2–4产品的共同类型比较、详情返回和比较返回。多类型产品按全部已选产品的类型交集判断，不将两两有交集误判为全部同类型。最多四项；不同类型提供明确提示。

浏览器仅保存产品统一ID、收藏时间；名称、许可及类型等始终读取正式目录。刷新和同浏览器标签页同步状态；网络失败、暂时缺失的产品保持原收藏，明确移除才删除。写入失败不显示成功；无法读取的旧记录不会被覆盖。收藏日期按浏览器本地时区显示。

## 实际执行

| 命令（仓库根目录） | 结果 |
|---|---|
| `python3 -B -m unittest discover -s server/tests` | 69 passed |
| `python3 -B -m unittest discover -s tests` | 28 passed |
| `npm --prefix web run test:e2e` | 25 passed；6个真实数据用例按模式跳过 |
| `SAAS_E2E_REAL=1 npm --prefix web run test:e2e -- e2e/real-shortlist.spec.ts` | 本轮2项真实数据验收 passed |
| `npm --prefix web run build` | TypeScript/Vite通过 |

常规回归包含此前14项目录/搜索/详情/比较与11项收藏测试。验证了存储失败、取消收藏写失败、不可读旧记录保留、缺失ID保留、网络/HTML错误提示、跨标签同步、真正的共同类型交集、四项上限，以及Asia/Shanghai午夜后的本地日期；日期修正后另单跑时区用例通过。

真实验收使用正式SQL快照的临时副本。桌面1440×1000：从搜索收藏Twenty/EspoCRM/Zulip，从详情收藏Salesforce；选择CRM时Zulip不可加入；CRM三项可比较、刷新返回并取消收藏。手机390×844：从搜索/详情收藏Twenty/EspoCRM，选择两项比较、横向浏览、返回与刷新；页面没有横向溢出。没有固定演示结果或虚构产品。

正式SQLite三表全量内容哈希与开发前一致：1,440产品、1,724关系；分类/采集文件没有改动，203项无关本地修改内容哈希一致。浏览器测试不写正式数据；原SQL快照及旧截图保留。运行日志与验证摘要保存在本地 `var/local-shortlist-20261029/`。

OpenCode Go/DeepSeek V4.1 Flash 独立只读静态审查提出的错误提示、无类型取消选择、取消收藏失败措辞、本地日期问题已修正并补实际用例。修正复查已返回，节选范围之外的上下文以完整实现与浏览器用例核实；审查员没有运行测试。首轮CLI在返回完整审查结论后的额外步骤超时，未将进程超时冒充测试通过。

## 真实截图

- [搜索收藏](local-shortlist/saved-search-desktop.png)、[详情收藏](local-shortlist/saved-detail-desktop.png)
- 候选清单：[桌面](local-shortlist/shortlist-desktop.png)、[手机](local-shortlist/shortlist-mobile.png)
- 从清单比较：[桌面](local-shortlist/comparison-desktop.png)、[手机](local-shortlist/comparison-mobile.png)

当前限制：收藏随浏览器和访问地址分别保存，不做账号或跨设备同步。建议固定访问 `http://127.0.0.1:5299`；切换localhost、端口或浏览器会使用另一份本地清单。清除站点存储会清除收藏，正式目录和历史资料不受影响。
