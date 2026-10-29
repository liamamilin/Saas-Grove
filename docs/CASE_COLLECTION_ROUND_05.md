# SaaS Grove 第5轮：剩余97项核验与主目录采集衔接

2026-10-23。原来剩余的 **97 个未核验类型已全部处理**：76个有充分案例依据并发布为纳入，21个继续留档，没有直接归档。新增 **73 个案例（5开源、68商业基本索引）**。

原188个待确认固定池现为 **135个确认、53个已核验留档、0个未搜索**。这表示该待确认池的第一轮核验完成，不代表整个目录的案例采集完成。

正式库现有 **150个产品（37开源、113商业）**，164条应用与类型关系，覆盖154个类型，其中153个属于主目录、1个仍为待确认。目录为 **1,646纳入、53待确认、106排除**；主目录仍有 **1,493个没有案例**。此前口头按全部78个已覆盖类型计算1,492个，少计了1个待确认类型，现按scope与关系交叉统计。

## 本轮开源案例

| 项目 | 许可记录 | 叶子 |
|---|---|---|
| [RAGFlow](https://github.com/infiniflow/ragflow) | Apache-2.0 | RAG开发平台 |
| [Grafana Pyroscope](https://github.com/grafana/pyroscope) | AGPL-3.0 | 性能分析器(Profiler) |
| [Feast](https://github.com/feast-dev/feast) | Apache-2.0 | 特征存储 |
| [Harvester](https://github.com/harvester/harvester) | Apache-2.0 | 超融合基础设施管理（HCI Management） |
| [MOSIP](https://github.com/mosip/mosip) | MPL-2.0 | 政府数字身份 |

五个开源条目均有真实GitHub数值身份、完整许可证及功能、服务端部署和技术栈来源。RAGFlow、Pyroscope及Feast的资料核验不等于已部署它们；开源只说明核对的仓库许可，不将外部模型、商业托管或第三方组件自动等同该许可。

## 分目录结果

| 目录段 | 核验类型 | 确认 / 留档 | 新案例（开源 / 商业） |
|---|---:|---:|---:|
| 11—13：法律、开发、数据与AI | 31 | 27 / 4 | 25（3 / 22） |
| 14—19：基础设施、安全、工业与行业运营 | 40 | 30 / 10 | 28（1 / 27） |
| 20—29：公共服务、内容、运动与个人应用 | 26 | 19 / 7 | 20（1 / 19） |

商业仅保存名称、官网、简介、类型关联及来源。具体73条记录分别见[开发](../data/collections/round-05-developer.json)、[行业](../data/collections/round-05-industry.json)、[服务](../data/collections/round-05-services.json)。

## 重要纠偏与留档

不能把已找到产品名字、搜索摘要或成功HTTP响应当成核验完成。部分厂商帮助页返回Loading、CSS Error或Swagger壳；本轮补可读官方正文，仍不足的保留候选。BIM协调改用静态正文，Revit MEP限定实际Cloud Worksharing协作形态；Trainline消费售票市场改为Sqills运营者SaaS；Marad船员/维护邻叶改为ZeroNorth航次运营，保留Early Access和已运行船队的准确说明。Buildium、Jio和project44未闭合核心证据，未进入正式批次。

AI编程助手按人主导的Copilot Chat建议匹配，未把派工代理当助手；OpenAI Agents SDK是库，移出正式商业数据，n8n Cloud完整持久代理工作流另行核验。Replit补代码编辑与发布网址。Footprints行程规划不能替代目的地目录。家庭、宠物及个人应用不因非企业用途直接否定，仍按持久用户资料和实际在线软件流程核验。

本轮21个留档类型：调试器、单元/集成测试运行器、数据编织平台、OLAP/多维分析平台、计算机辅助制造(CAM)、PLC编程环境、建筑设计软件、楼宇门禁与访客管理、押金管理、冷链运输监控、客户能源管理、电信计费平台、电信开通平台、公用事业收入保障、气候情景分析、课堂管理、志愿者市场平台、目的地探索应用（Destination Discovery Application）、旅游套餐预订平台、可穿戴健身平台、车辆检测诊断应用。具体有效查询、结果、获取失败与缺口见[开发研究](../data/collections/round-05-developer-research.json)、[行业研究](../data/collections/round-05-industry-research.json)、[服务研究](../data/collections/round-05-services-research.json)。

相邻候选和未确认的完整条目保留在各组held文件，不把一次抓取失败或单个候选不符推广为整类不存在。现在仍有53项待确认，其中包含本轮21项与此前32项，全部保留。

## 证据与验证

- [冻结97项输入](../data/collections/round-05-plan.json)、[本轮统计](../data/collections/round-05-report.json)、[原188项进度](../data/collections/conditional-progress.json)。
- [独立内容复核](../data/collections/round-05-independent-review.json)：73条、142个来源引用SHA全部匹配；审查与整理为不同agent。
- [76项发布证据](../data/collections/case-confirmation-20261023-05-scope-publication.json)，沿用新run_id，不重写548项及旧轮发布。
- [数据验证](case-collection/round-05/data-validation.json)：86个受保护文件摘要、旧77条应用字节、84条关系、非目标叶及原进度池保持；确定性重建与重复发布幂等通过。
- [独立回归](case-collection/round-05/test-results.json)：57项后端、8条浏览器测试通过，使用隔离测试库。
- [正式API抽查](case-collection/round-05/live-api-validation.json)：预览已重启，核对新范围、8个案例及保留状态。
- [发布后独立复核](../data/collections/round-05-post-publication-review.json)。

本轮全部`runtime_tested:false`，未部署或执行第三方应用。目录与案例资料核对、本站回归测试、第三方实际部署是不同验证。

## 后续主目录队列

按照用户已授权顺序，已开始下一阶段：依[1,493项初始主目录空类型计划](../data/collections/included-coverage-plan.json)，从目录01顺序采集，首批75项见[第6轮输入](../data/collections/round-06-plan.json)。不足继续留档，不改变included范围或直接归档；已有案例与未搜索数量按实际关系核对。后续进度不再用原188池的完成数代表整个目录完成。
