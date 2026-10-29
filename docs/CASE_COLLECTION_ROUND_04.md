# SaaS Grove 第4轮案例采集与类型确认

后续状态：第5轮已完成剩余97项核验，当前150个产品，目录1,646 / 53 / 106；见[第5轮报告](CASE_COLLECTION_ROUND_05.md)。下文保留第4轮历史状态。

2026-10-23。本轮按目录顺序处理剩余129个未搜索类型中的前 **32 个**，完成目录07—10本轮待查项。新增 **25 个真实案例：4 个开源、21 个商业基本索引**，据此确认 **26 个类型**；其余 **6 个继续留档**，未归档任何类型。

正式库累计 **77 个产品（32 开源、45 商业）**，84条应用与叶子关系，覆盖78个叶子。目录现为 **1,570 纳入、129 待确认、106 排除**。原188个待确认类型累计核验91个：59个确认、32个保留、97个尚未搜索。下一批从目录11的法律起草平台 `legal-drafting-platform` 继续。

## 新增开源案例

| 项目 | 许可记录 | 叶子类型 |
|---|---|---|
| [OpenBoxes](https://github.com/openboxes/openboxes) | EPL-1.0 | 仓库管理系统 |
| [OpenRPA + OpenCore](https://github.com/open-rpa/openrpa) | MPL-2.0 | 机器人流程自动化平台（RPA平台） |
| [BTCPay Server](https://github.com/btcpayserver/btcpayserver) | MIT | 加密钱包 |
| [Hasjob](https://github.com/hasgeek/hasjob) | AGPL-3.0 | 招聘网站 |

四个条目均核对官方仓库数值身份、完整许可证、功能与服务端部署资料。OpenBoxes技术栈按已核资料记录Groovy；OpenRPA及OpenCore按实际仓库和文档记录C#/.NET、TypeScript等组件。Hasjob的AGPL软件与品牌资产边界分开记录；官方不推荐复用该旧项目的提示保留，不把品牌排除误写成软件禁止再利用。BTCPay记录用户控制密钥、交易签名及恢复的完整钱包工作台，没有将它表述成第三方代托管服务。

OpenBB Workspace另存[待补证候选](../data/collections/round-04-finance-held.json)：当前仓库公开且已归档，不能继续引用早期private公告作为现状。根Apache许可与组件附加声明分别保留；TradingView Advanced Charts并未包含在开源快照的默认构建中。未实测部署，完整行情终端能力仍需对公开组件逐项核对，本轮不将该候选导入。

## 商业基本索引

| 产品 | 叶子类型 |
|---|---|
| [Quadient Inspire](https://www.quadient.com/en-us/customer-communications) | 客户沟通管理 (CCM) |
| [HubSpot Breeze Intelligence Data Enrichment](https://hubspot.com) | 销售数据富集平台（SDEP） |
| [Apollo Prospect](https://apollo.io) | 销售寻客平台 |
| [IBM Decision Intelligence](https://www.ibm.com/products/decision-intelligence) | 决策管理平台(DMP) |
| [Marqeta Dashboard](https://marqeta.com) | 卡片管理系统 (CMS) |
| [ACTICO Credit Risk Platform](https://actico.com) | 信用评分应用 (CSA) |
| [Fireblocks Wallets](https://fireblocks.com) | 数字资产托管平台 |
| [Koyfin](https://koyfin.com) | 金融市场数据终端 |
| [EZLynx Rating Engine](https://ezlynx.com) | 保险报价平台 |
| [SimCorp One](https://simcorp.com) | 投资管理平台 |
| [AlphaSense](https://alpha-sense.com) | 投资研究平台 |
| [Adyen Payments](https://adyen.com) | 商户支付平台、支付网关(Payment Gateway) |
| [Blend Mortgage Suite](https://blend.com) | 抵押贷款借款人门户 |
| [Equro Totalis](https://equro.com) | 转让代理平台 (TA Platform) |
| [Wellable Wellness Platform](https://www.wellable.co) | 员工健康平台 |
| [Deel Global Payroll](https://deel.com) | 全球薪酬平台 |
| [SHL TalentCentral](https://www.shl.co.jp) | 心理测评平台 |
| [HackerRank Screen](https://hackerrank.com) | 技术评估平台 |
| [Checkr Background Checks](https://checkr.com) | 背景调查平台 |
| [Truework](https://truework.com) | 就业验证平台 |
| [Deputy](https://www.deputy.com) | 劳动力管理平台 |

商业只保存名称、官网、简介、叶子归属及公开来源。为了核对类型边界读取的官方文档，不扩展为商业技术架构、部署或价格调研。Adyen同一产品覆盖商户支付平台和支付网关两个叶子，不重复创建身份。

## 确认与保留的边界

确认以客户可持续操作的软件工作流为依据。Checkr和Truework虽兼有调查或核验服务，但客户可以管理订单、授权、状态及结果，不能仅因供应商参与履约就否定其软件工作台。金融条目分别核对卡片生命周期、信用评级、钱包治理、行情与研究、报价、投资账簿及支付流程，不把资金通道、资产代管或人工服务本身泛化为应用。

| 保留类型 | 本轮候选与缺口 |
|---|---|
| 联络中心平台、联络中心路由平台 | VICIdial有官方功能证据；当前导入器要求的canonical GitHub身份和仓库许可链未齐。保留候选，不据此声称其不是SaaS或没有开源实现。 |
| 销售情报平台 | 6sense有客户仪表盘与评分、名单操作证据，外部情报来源和信号交付的直接依据尚不足；完整候选转存held。 |
| 任务挖掘平台 | 已查候选尚未直接证明从用户交互重建命名任务及可比较变体，继续保留。 |
| 堆场管理系统 | Oracle资料已证明完整YMS功能；尚未确认其E-Business Suite模块当前在线／SaaS交付与销售边界，继续保留。 |
| 数字钱包 | PayPal的钱包功能有依据，消费金融账户、支付通道和独立软件交付边界仍未厘清，继续保留。 |

具体查询、官方URL、候选和判断分别在三个research文件；[销售与运营候选留档](../data/collections/round-04-sales-operations-held.json)保留6sense完整条目。一个候选不足、抓取失败、未找到开源或当前导入器不支持其身份形式，均不作为整叶不存在案例或直接归档的依据。

## 进度与复核记录

- [32项冻结输入](../data/collections/round-04-plan.json)和[本轮统计](../data/collections/round-04-report.json)。
- 正式批次：[销售与运营](../data/collections/round-04-sales-operations.json)、[金融](../data/collections/round-04-finance.json)、[人力资源](../data/collections/round-04-workforce.json)。
- 逐叶研究：[销售与运营](../data/collections/round-04-sales-operations-research.json)、[金融](../data/collections/round-04-finance-research.json)、[人力资源](../data/collections/round-04-workforce-research.json)。
- [188项完整进度](../data/collections/conditional-progress.json)：59确认 + 32留档 + 97未搜索 = 188；之前156条进度对象保持原样。
- [独立内容复核](../data/collections/round-04-independent-review.json)：Luna及主代理整理，独立Sol只读复核；25条目的83个来源引用哈希一致。
- [26项目录发布记录](../data/collections/case-confirmation-20261023-04-scope-publication.json)。548项历史复核及第2、3轮发布证据不变。

案例先validate、再import，再用新run_id `case-confirmation-20261023-04` 更新指定conditional类型。批次及源快照已冻结，后续补充使用新批次，不重写已导入输入或旧548项发布。

## 验证

独立执行通过 **57项后端测试、8条浏览器回归**。原52条应用数据和58条关联保留，正式库无测试替身。85个源、策略及历史证据文件摘要未变；非目标叶子对象、原188进度池和旧轮次记录保持。确定性重建、三个批次与导入回执、来源哈希及重复发布幂等检查通过。

[测试结果](case-collection/round-04/test-results.json)、[数据校验](case-collection/round-04/data-validation.json)、[发布后独立复核](../data/collections/round-04-post-publication-review.json)及[正式预览API抽查](case-collection/round-04/live-api-validation.json)分别保存。预览已重启并验证新目录与7个案例可查询，6个保留类型仍为待确认。本轮均为官方资料核对，未部署或运行第三方应用，`runtime_tested:false`。
