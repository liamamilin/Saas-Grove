# SaaS Grove 第 2 轮案例采集与类型确认

后续状态见[第3轮报告](CASE_COLLECTION_ROUND_03.md)。本页保留第2轮的历史统计与证据。

日期：2026-10-23。本轮新增 **21 条真实应用资料：15 个开源、6 个商业基本索引**。正式库累计 **35 个产品（23 个开源、12 个商业）**、40 条应用与叶子关系，覆盖 34 个叶子。

原 188 个待确认类型中，本轮评估 23 个，15 个通过真实案例及独立审查确认纳入，8 个继续留档；165 个尚未开展该叶子的案例核验。因此当前目录为 **1,526 纳入、173 待确认、106 排除**。本轮冷归档数为 **0**，未删除源定义、候选或搜索记录。

## 新增开源案例

以下条目均有官方仓库身份、许可证原文、功能与部署依据，未安装或实测。企业目录的独立许可按项目分别保留；不会将 API 的 NOASSERTION 当成“闭源”或“没有案例”。

| 项目 | 许可证标识 | 叶子类型 |
|---|---|---|
| [Apache Answer](https://github.com/apache/answer) | Apache-2.0 | 问答社区 |
| [Nextcloud Server](https://github.com/nextcloud/server) | AGPL-3.0 | 文件同步应用 |
| [SearXNG](https://github.com/searxng/searxng) | AGPL-3.0 | 元搜索引擎 |
| [CommonPub](https://github.com/commonpub/commonpub) | AGPL-3.0-or-later | 兴趣社区平台 |
| [The Lounge](https://github.com/thelounge/thelounge) | MIT | 聊天室应用 |
| [Chatwoot](https://github.com/chatwoot/chatwoot) | MIT | 客户服务平台 |
| [Formbricks](https://github.com/formbricks/formbricks) | AGPL-3.0 | 问卷调查平台 |
| [Twenty](https://github.com/twentyhq/twenty) | AGPL-3.0 | 客户关系管理 / CRM |
| [Mautic](https://github.com/mautic/mautic) | GPL-3.0-or-later | 营销自动化平台 |
| [WSO2 API Manager](https://github.com/wso2/product-apim) | Apache-2.0 | API管理平台 |
| [Verdaccio](https://github.com/verdaccio/verdaccio) | MIT | 软件包注册表 |
| [Harbor](https://github.com/goharbor/harbor) | Apache-2.0 | 制品仓库（Artifact Repository） |
| [Infisical](https://github.com/Infisical/infisical) | MIT | 密钥管理 |
| [Langflow](https://github.com/langflow-ai/langflow) | MIT | LLM应用开发平台 |
| [OpenSEO](https://github.com/every-app/open-seo) | MIT | SEO优化平台 |

商业只记名称、官网、用途与叶子：Semrush、Qualtrics Research、QuestionPro Communities、Spectora、Kasm Workspaces、Proctorio。没有扩展为商业架构、技术栈、价格或功能对比调研。

## 15 个确认的类型

- 问答社区（`q-a-community`）。
- 文件同步应用（`file-sync-application`）。
- 兴趣社区平台（`interest-community-platform`）。
- 聊天室应用（`chat-room-application`）。
- API管理平台（`api-management-platform`）。
- 软件包注册表（`package-registry`）。
- 制品仓库（Artifact Repository）（`artifact-repository`）。
- 密钥管理（`secrets-management`）。
- LLM应用开发平台（`llm-application-development-platform`）。
- SEO优化平台（`seo-platform`）。
- 市场研究平台（`market-research-platform`）。
- 研究面板平台 (Research Panel Platform)（`research-panel-platform`）。
- 房屋检验应用 (Home Inspection Application)（`home-inspection-application`）。
- 浏览器（`web-browser`）。
- 在线监考平台（`online-proctoring-platform`）。

每条目录理由同时限定具体交付边界：完整客户工作台和可部署应用，不能从一个案例推导所有纯客户端、裸引擎、自营消费平台都适合 SaaS。已发布证据绑定已导入的 application ID、真实叶子关系、该关系引用的来源 URL 和快照 SHA。

## 8 个已评估但继续留档的类型

| 类型 | 本轮结论 |
|---|---|
| 文件传输应用 | Pingvin Share/Share X 的分享链接不足以证明指定接收者的交付追踪；原项目已停止维护，候选保留在研究档案。 |
| 网页存档查看器 | ArchiveBox 的归档工作台有证据，但按捕获时间选择和原URL重放的核心未核实，不强行确认。 |
| 元搜索引擎 | SearXNG 已收录在待确认叶子；公共搜索中继与客户研究工作台的收录边界继续核实。 |
| 专注计时器 | Pomofocus 的在线计时和报告未充分证明服务端会话记录；FocusSpace 的源路径404也不算有效零结果。 |
| 数据库模式设计工具 | DrawDB 资料只证明浏览器本地编辑；不能仅凭静态站点或Docker启动就确认服务端形态。 |
| 威胁狩猎平台 | Wazuh 资料未充分证明持久hunt对象和调查证据记录，不用通用告警查询替代完整定义。 |
| 机器学习平台 | MLflow 证明实验跟踪、模型注册和部署，未证明完整平台需要的托管训练计算；留档后续按更合适类型核对。 |
| 隐私浏览器 | Kasm 的远程隔离不足以单独证明默认反追踪和最小化浏览记录同时成立。 |

OpenInspection 的源码和授权声明、OpenSEO 搜索结果中的 fork、原项目迁移与失败请求也分别保留。已选择 OpenSEO 正式上游，未把 fork 重复建档。没有把资料不足的项目改成“已确认闭源”，也没有自动排除其所属叶子。

## 可续跑资料

- [188 个类型的完整进度账本](../data/collections/conditional-progress.json)：固定原始池，每项记录当前范围、确认/证据不足/尚未搜索、已有应用和研究记录。15 + 8 + 165 = 188。
- [本轮数据报告](../data/collections/round-02-report.json) 与五个 `round-02-*.json` 案例批次。
- [案例驱动的目录发布](../data/collections/case-confirmation-20261023-02-scope-publication.json)：15 项决策、前后数量、来源摘要和目录版本。
- [未正式入库的候选](../data/collections/round-02-held-candidates.json)；对应研究JSON保留实际查询与失败/匹配经过。
- 独立内容复核：[目录与开源业务](../data/collections/round-02-directory-review.json)、[开发/商业与工具](../data/collections/round-02-final-review.json)。根代理补存 Apache Answer声望、Nextcloud同步和 Kasm稳定文档后才发布。

```sh
# 新批次先验证，整批通过后事务合并，不删除已有关系
python3 -B scripts/collect_cases.py validate --batch data/collections/round-02-directory.json
python3 -B scripts/collect_cases.py import --batch data/collections/round-02-directory.json
# 只有证据充分、已入库且真实关联的案例，才能确认当前conditional类型
python3 -B scripts/confirm_case_scopes.py check --review data/collections/round-02-scope-decisions.json --database var/catalog.sqlite
python3 -B scripts/confirm_case_scopes.py publish --review data/collections/round-02-scope-decisions.json --database var/catalog.sqlite
```

发布前备份、恢复状态及receipt在 `var/case-scope/case-confirmation-20261023-02/`。重复同批发布幂等，其他文件改写会被拒绝；旧548项发布证据保持不变。今后确认新类型时使用新run_id，不重新运行旧548的publish覆盖当前目录。

## 验证

57项后端测试和8条浏览器回归通过。源码快照、类型总数、队列外范围、既有应用关系、来源匹配、许可证声明与发布中断恢复均有校验。正式案例仍是官方资料核对，`runtime_tested:false`，没有运行第三方软件。
