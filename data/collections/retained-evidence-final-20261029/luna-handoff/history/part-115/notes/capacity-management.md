# capacity-management 本单元补证笔记（2026-10-28）

## 初审问题（issues.json / HISTORY）

- 旧候选 `github:617356410`（traas-stack/kapacity）被主会话最终复核拦下：所引仓库页、README 与 license API 只证明它是运行在 Kubernetes 内的控制器（Operator），不是“完整的持续应用服务”。上游仓库还已于 2025-10-20 归档只读。
- 本轮不重复原结论：先核对旧来源，再换成形态完整的开源 Web 应用服务候选。

## 旧证据核对（历史复用，非本轮新检索）

- 复用快照：`7ccf63...`（README）、`d03076...`（license API）、`ff931f...`（仓库页）、`1053f4...`（文档静态壳，无核心工作流）。
- README 正文确实只描述 IHPA 控制器模块（副本数计算、工作负载副本控制、扩缩容流程管理）及部署到集群的 Quick Start；没有独立的容量仪表盘、报表或平台级 UI。
- 结论：维持“形态不符”的判断，本轮**移除该关系**，改为 `withheld_candidates` 留档；不推断产品不存在，也不改类型范围。

## 本轮补证（实际动作）

1. GitHub `topic:capacity-management` 按 star 检索：前列多为语言/脚本/骨架类仓库，未见可与定义核心对齐的完整应用。
2. 共享 `application-index.json` 检索既有开源身份，命中 ManageIQ（`github:20789757`，已有 cloud-management-platform 关系，本轮不覆盖旧字段）。
3. 抓取 ManageIQ 官方资料：
   - 仓库页 `db7813...`（octolytics id 20789757，nwo ManageIQ/manageiq）
   - license API `d52c04...`（完整 Apache-2.0 正文，SPDX 确认）
   - README `71dded...`（Insight/Control/Automate，社区构建包）
   - 官方文档 `391226...`（User Reference – Monitoring, Alerts, and Reporting）
4. 商业基本记录：IBM Turbonomic 产品页 `e0871c...`（容量建模、right-sizing、回收闲置容量）。

## ManageIQ 与定义核心的对应（逐条落在正文）

- 容量承载资源：datastore、host CPU/内存、VM、集群（文档 Trending / 报表类别）。
- 消耗历史：“You must be capturing capacity and utilization data to get this information”；Normal Operating Range / 性能告警均要求开启 Capacity and Utilization。
- 容量状态：Tenants 配额报表列出 total quota、in use、allocated、available（可用与总量之分）。
- 容量风险：“Trending: projections of datastore capacity, along with host CPU and memory use”（前瞻预测）。
- 容量决策：Optimization 报表覆盖 CPU/内存/磁盘的可优化领域与潜在节省；VM Sprawl 报出使用情况与磁盘浪费（回收/right-size 建议）。

边界说明：文档把 Optimization 描述为报表（advisory），未证明自动执行优化动作；本轮不写“自动闭环执行”。ManageIQ 是自托管 Web 管理平台（appliance 或容器化 Kubernetes 安装），容量规划是其有文档的完整业务子模块，符合“完整应用/完整业务子模块”口径。

## 缺口与失败记录（不当作“不存在”）

- `GET https://api.github.com/repos/ManageIQ/manageiq-documentation/contents/guides` → 404（仓库路径不存在），未使用。
- `GET https://api.github.com/search/code?q=capacity+repo:ManageIQ/manageiq-documentation` → 401（代码搜索需认证），未绕过，改用官方文档站直接抓取并成功。
- 未部署、未运行 ManageIQ 或 Turbonomic；`runtime_tested:false`。
- 未核对 Turbonomic 的价格、架构与部署细节（商业仅基本记录）。
