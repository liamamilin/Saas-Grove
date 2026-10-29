# SaaS Grove 第3轮案例采集与类型确认

后续状态：第4轮已发布，当前正式库77个产品，目录为1,570 / 129 / 106，未搜索97项。见 [第4轮报告](CASE_COLLECTION_ROUND_04.md)；下文数字为第3轮历史记录。

2026-10-23。本轮按目录顺序核验原先尚未搜索的 **36 个类型**，新增 **17 个案例：5 个开源、12 个商业基本索引**，据此确认 **18 个类型**；其余18个继续留档，未归档任何类型。

正式库累计 **52 个产品（28 开源、24 商业）**，58条应用与叶子关系，覆盖52个叶子。目录现为 **1,544 纳入、155 待确认、106 排除**。原188个待确认类型已核验59个，其中33个确认、26个保留，另129个尚未搜索。下一批从目录07的联络中心平台继续。

## 新增开源案例

| 项目 | 许可记录 | 叶子类型 |
|---|---|---|
| [WebODM](https://github.com/WebODM/WebODM) | AGPL-3.0 | 摄影测量应用 |
| [PhotoPrism](https://github.com/photoprism/photoprism) | AGPL-3.0，保留第18节商标及品牌资产条款 | 图像查看器 |
| [Osclass](https://github.com/osclass-classifieds/Osclass) | Apache-2.0，核心仓库 | 分类信息平台 |
| [Revive Adserver](https://github.com/revive-adserver/revive-adserver) | API标识GPL-2.0；README允许后续版本 | 广告投放平台、广告服务器 |
| [Gorse](https://github.com/gorse-io/gorse) | Apache-2.0 | 推荐与个性化引擎 |

开源条目包含官方仓库身份、完整许可依据、功能、技术栈与部署来源。PhotoPrism按当前官方文档记录SQLite或MariaDB，WebODM部署组件直接引用官方安装及Compose文件。第三方插件、品牌资产和外部模型服务按各自范围区分。

## 商业基本索引

| 产品 | 叶子类型 |
|---|---|
| Brilliant Directories | 目录应用 |
| RingCentral | 虚拟电话应用 |
| Boords | 预可视化应用 |
| Vectary | 3D渲染应用 |
| Stripe Checkout | 结算平台 |
| Mirakl Marketplace卖家门户 | 卖家门户 |
| Syncee | 供应商商业网络 |
| Attest | 消费者研究平台 |
| Twilio Segment | 客户数据平台 |
| Optimizely Personalization | 个性化营销平台 |
| AppsFlyer | 移动营销平台 |
| AdKernel RTB Suite | 程序化广告平台 |

商业仅保存名称、官网、简短用途、叶子和来源。核对类型所需的官方资料没有扩展为技术架构、部署、价格或产品对比调研。

## 确认与保留的边界

18项确认均限定具体软件交付形式。例如，Gorse的管理台可维护用户、物品和反馈，并查看推荐及运行任务；Syncee确认的是客户店铺和独立供应商间的订单协同软件；AdKernel确认的是客户自有品牌的供需及竞价运营工作台。裸算法、实物履约和供应商自营交易场所不据此整类纳入。

应用可以覆盖多个叶子。PhotoPrism同时管理照片，不影响其完整图像查看功能；Vectary同时支持3D及AR创作，也可按完整渲染子工作流收录。Vectary记录高分辨率PNG、相机画幅及分辨率控制，没有声称已核实独立的导出质量滑块。

| 本轮保留范围 | 数量 | 后续核验重点 |
|---|---:|---|
| 通讯社交 | 4 | 兴趣、邻里、职业网络的客户运营边界，以及软电话的完整服务形态。 |
| 知识信息 | 7 | 比较、数据探索、词典、搜索、门户和图谱浏览是否构成符合定义的客户工作台。 |
| 创作工具 | 5 | DJ、图像转换、现场演出、定格动画、联机拍摄的持续在线软件交付。 |
| 商务 | 2 | 移动购物前台与构建器的区别；按需印刷软件与制造履约的区别。 |

AWS Graph Explorer的图谱功能与Apache许可有依据，但官方架构说明连接、查询历史和偏好保存在浏览器IndexedDB，薄代理不存用户数据。本批保留完整候选及来源，没有直接将可部署网页认定为服务侧工作台。资料不足、单个候选不匹配、请求失败均不作为整叶无案例或归档依据。

## 进度与复核记录

- [36项冻结输入](../data/collections/round-03-plan.json)和[本轮统计](../data/collections/round-03-report.json)。
- 三个正式批次：[通讯与知识](../data/collections/round-03-knowledge.json)、[创作](../data/collections/round-03-creative.json)、[商务与营销](../data/collections/round-03-commerce.json)；对应research文件逐叶记录查询、候选、来源和判断。
- [188项完整进度](../data/collections/conditional-progress.json)：33确认 + 26保留 + 129未搜索 = 188。旧轮次的未决记录保持原样。
- [独立内容复核](../data/collections/round-03-independent-review.json)：Luna及主代理整理，独立Sol复核；17个条目的62个来源引用哈希一致。
- [18项目录发布记录](../data/collections/case-confirmation-20261023-03-scope-publication.json)。548项历史复核和第2轮发布证据保持不变。
- [留档候选](../data/collections/round-03-knowledge-held.json)。

新批次使用新的batch_id和run_id。案例先validate、再import；只有已入库并真实关联叶子的案例，才通过`confirm_case_scopes.py check / publish`更新目录。不要重新执行旧548项的发布覆盖当前状态。

## 验证

独立执行验证通过 **57项后端测试、8条浏览器回归**。正式库原35条应用及40条关系保持，未混入测试数据；源快照、范围策略、队列外类型和历史发布证据未改。目录确定性重建、来源哈希及重复发布幂等检查通过。

[测试结果](case-collection/round-03/test-results.json)、[数据校验](case-collection/round-03/data-validation.json)、[发布后独立复核](../data/collections/round-03-post-publication-review.json)和[正式预览API抽查](case-collection/round-03/live-api-validation.json)分别保存。当前案例均为官方资料核对，未部署或运行第三方应用，`runtime_tested:false`。
