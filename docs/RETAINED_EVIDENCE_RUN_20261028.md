# 252个留档类型补证续采（2026-10-28）

用户授权按目录顺序处理252个留档类型，复用草稿与来源、优先补证和完整开源SaaS案例，商业仅基本记录。使用OpenDesign / DeepSeek V4.1 Flash、并发4；原内容过滤5类不在输入中，不重试、不改写提示或转provider。

## 启动与正式基线

08:43:03启动scripts/continue_retained_directory.py，08:43:54确认首四路实际模型均为open-design/deepseek-v4.1-flash，完整输入与预期一致，已分别完成12/15/16/14次工具事件，无provider错误。启动证据不是已完成采集或入库的声明。

运行var/collection/retained-evidence-20261028/，状态status.json、进程process.json、首四路证明startup-verification.json。冻结输入data/collections/retained-evidence-20261028-inputs.json，冻结计划同前缀-plan.json；252个单叶按原目录顺序分派，159边界留档、93证据不足，原阻断5类排除。正式基线仍1211产品（404开源/807商业）、1443关系、主目录1389/1646有案例；采集阶段不改正式库/主进度，草稿不计覆盖。备份catalog.before-collection.sqlite，保留53待确认。

## 路由问题与修复

首次短测provider.no-route / Model unavailable，随后确认正常CLI列表含OpenDesign，私有OPENCODE_CONFIG_DIR列表却没有。原因是私有配置漏加载用户全局JSONC内的自定义provider，不能据此认定服务不可用。

只将指定provider的公开adapter、baseURL、env变量名及指定模型定义复制到本轮私有CLI配置；没有复制密钥/认证值、全局agent或权限配置，没有修改用户全局配置。原生沙箱、写入范围、禁读.env、stdin隔离、项目/Claude配置禁用及完整提示核对保留。修复后固定短回复成功，真实write/read文件工具成功且无shell，未切模型/provider。旧失败收据保持，详见preflight/provider-config-provenance.json、route-check.json、write-check.json、write-check-verification.json。

## 复用与验证

关联512层旧项目，绑定1223个历史文件，无缺失研究引用；按叶复用177条未批准候选草稿、770份相关快照。HISTORY保留旧研究及最终留档原因，REUSED_SOURCES保留真实原source记录/SHA；不补造缺失URL、抓取时间或通过结论。75项没有直接可用的旧候选条目，仍有真实历史研究/留档原因，需实际补证或找替代应用。

252项已离线核对目录顺序、唯一叶子/历史、原留档原因、候选关系范围、历史及快照SHA、指定模型配置和旧库不变，见preparation-verification.json。任务契约docs/RETAINED_EVIDENCE_CONTRACT_20261028.md：先回应原缺口，至多两组不同查询，核心满足即可，非关键措辞与可选功能不阻断。纯桌面/CLI/组件/设备控制不因联网成为SaaS，商业不深入架构/价格/部署。尽早保存研究，每项最多一次修正。

单项结构/初审/确认传输故障留档继续，一次确认传输故障最多有限重试一次；内容过滤不重试。认证/额度/未知全局错误或连续三项临时故障/空等保护性停，不自动换模型或重启。

## 最终复核与完成检查

必须directory-ended.json覆盖1..252且全体终态，不能只看进程退出。结束后主会话全量核对冻结输入/顺序、逐叶研究、复用/来源SHA、产品ID/track、完整许可、独立只读初审会话/协议/实际模型/完整提示与内容SHA绑定，处理全部初审问题；按领域及开源/商业核对正文核心，问题扩大对应单元，若抽查如实说明。初审同模型不同会话，不能代替主会话最终筛选。

先另备份和演练，仅通过项按目录顺序入本地正式库，验证幂等与历史保留。1211旧产品核心、1443旧关系、所有历史来源/研究、53待确认、旧阻断5项保留，只更新本轮252项。不改目录范围，不将队列结束等同全目录案例齐全。缺产物未完成、未过初审待复核、证据不足archived:false留档；不伪造搜索或部署实测。不能直接运行任何旧基线integrate.py，不重跑已发布15/44/274组。

沿用用户此前已授权的每小时只读完成检查，automation_id=saas-grove。运行正常安静，不读全量历史日志、不调模型或重启；全部结束后在本聊天统一复核；全局故障只通知一次并删除跟进。完成复核入库后删除检查，防止重复导入。CLI费用仅作元数据，不冒称实际账单，第三方应用不部署运行。

## 10:48额度停机与13:03恢复检查

第31项返回HTTP402 / insufficient_balance：套餐额度耗尽且钱包不足；供应方给出的套餐重置时间为2026-10-28 13:02:15（Asia/Shanghai），不会补充钱包余额。队列保护性停止，25项已有绑定初审，1/4两项单项问题留档，28–30中断、31额度失败，其余尚未分派。旧完成检查已在故障通知时删除。

用户随后明确授权：额度重置后检查，恢复则自动续跑原模型/并发4。现安排同日13:03在本聊天执行一次检查（automation_id=saas-grove），没有在重置前再次调用模型。scripts/check_retained_provider.py有13:02:15时间门槛和队列互斥锁，仅做一次固定短回复与真实收据核对，不自动启动采集；当前时间门槛已离线验证，未发起模型请求。短测失败只报告真实原因并删除跟进，不自动换provider或反复试。

短测恢复后启动scripts/continue_retained_directory.py --resume-after-quota；新参数将旧状态/运行元数据另存resume-history，保留25项有效初审不重采，1/4原单项batch失败不重新调用；28–31及尚未执行项继续，原阻断5项不动。此分派行为及25项原初审内容SHA绑定已离线核对，旧状态不变，见quota-resume-preparation.json。成功恢复后将本跟进转为每小时只读完成检查；全部结束仍按原最终复核/备份演练/入库要求执行，不把队列结束当作全部类型有案例。

## 13:03额度短测成功，13:04断点恢复

2026-10-28 13:03:39额度短测成功，实际模型open-design/deepseek-v4.1-flash，outcome=succeeded，stdin隔离与完整提示核对通过，见latest-quota-check.json和quota-reset-checks/1793163812862420000。没有改模型/provider。

13:04:12以scripts/continue_retained_directory.py --resume-after-quota恢复并发4，13:05:12核对28/29/30/31四路实际模型、完整任务输入和真实已完成工具事件，无provider错误；28/30复用已校验的旧草稿，仅补新的独立只读初审，29/31恢复采集。25项原初审状态及1/4原单项batch失败状态的SHA均与恢复前一致，1/4没有重调；状态和运行元数据已备份resume-history/1793163852606734000，旧日志与来源未覆盖。详见quota-resume-verification.json。

本轮自动检查saas-grove已转回每小时只读完成检查，移除一次性COUNT和每日13:03条件；健康运行安静，全部结束再统一复核入库，后续新的全局故障只通知一次并关闭，不因本次恢复授权而自动反复重启。正式库仍1211产品/1443关系，原内容过滤5类、53待确认保持不动。

## 16:35第二次额度停机与20:40恢复

第70项在16:35收到HTTP402 / insufficient_balance，套餐额度耗尽且钱包余额不足，供应方重置时间18:02:15。故障检查通知后原跟进已删除，没有自动等下次额度或切换模型。至停机有58项有效初审、8项单项batch失败，66/68/69中断，70额度失败，正式库尚未更新。

20:38用户要求再次验证，20:38:27固定短测成功（actual model为open-design/deepseek-v4.1-flash，outcome=succeeded、完整提示/隔离通过），原收据保存在quota-reset-checks/1793191099906646000，latest-quota-check.json指向该次结果。随后按此前已授权的采集安排，20:40:05以原模型/并发4、--resume-after-quota继续，未增加采集范围或改变provider。20:41:24核对66/68/69/70四路实际模型、完整提示及28/22/20/20次已完成工具事件，无provider错误；58项原初审及1/4/35/44/51/53/54/67八项留档状态SHA保持，旧状态/日志/来源完整保留。证明为resume-verification-20261028-204124.json，latest-resume-verification.json保留其路径与SHA，旧13:05恢复证明没有覆盖。

每小时安静只读完成检查saas-grove已恢复。全体252项实际结束后再统一复核入库，仍使用1211产品/1443关系正式基线，原阻断5类和53待确认保持。后续新的全局额度故障仍只通知一次关闭跟进，不自行循环短测或切provider。

## 2026-10-29 切换OpenCode Go并恢复

00:02第119项返回OpenDesign HTTP402 / insufficient_balance，供应方提示套餐耗尽、钱包余额不足，下次重置为11月3日20:02:15（Asia/Shanghai）。保护性停机后完成检查已删除，没有自动重启或切provider。

用户随后明确要求换OpenCode Go。10:34短回复及原生沙箱write/read验证通过，实际模型为opencode-go/deepseek-v4.1-flash、完整输入与stdin隔离均通过；CLI有费用记录，不能称免费。收据保存在provider-checks/opencode-go/，latest.json为当前入口短测，不改写原OpenDesign额度检测历史。

10:35:15以python3 -B scripts/continue_retained_directory.py --model opencode-go/deepseek-v4.1-flash --resume-after-quota恢复并发4。10:36:24确认115/117/118/119四路实际Go模型、完整提示，分别已有18/17/10/13次完成工具事件，无provider错误。115/117复用已校验的旧草稿只补新独立初审，118/119及后续继续。98项原OpenDesign初审内容绑定均通过，状态SHA原样保留；17项原单项失败状态同样不变、不重调，包括108的有限传输重试耗尽。恢复所需137项包含中断、全局额度失败和尚未执行项，不把98项初审说成98项已有正式案例。

入口改为显式--model二选一且无自动fallback；冻结plan.model仍保留最初OpenDesign，历史收据/模型不改，当前选择写入runtime-selection与model-selections。原始状态与元数据已自动备份resume-history。原有22项队列回归通过，原98项内容SHA绑定和17项留档分派行为已离线验证，见provider-switch-20261029/preparation.json与startup-verification.json。新Go预检只访问隔离探针项目，不向模型暴露内部控制器、测试或凭据；原生沙箱、私有配置隔离不变。

saas-grove每小时安静只读完成检查已恢复，正常不调模型/测试/写数据/重启。新的全局故障仅通知一次并删除，单项失败留档继续。仍为1211产品/1443关系正式基线，未入库；原阻断5类和53待确认不动。只有全部252项实际结束后才统一复核、另备份演练、按原目录顺序仅通过项入库。

## 2026-10-29 11:53 按最新决定继续Go / DeepSeek

10:35的Go进程退出现已定位：第118项明确HTTP429 / provider.rate-limit，消息为ttft_admission_refused、cell is at capacity、8秒后重试。原分类将所有429视为全局保护停；清理时os.killpg又遇PermissionError，最终状态写入被异常遮蔽，故11:32只读检查仍看到10:35旧状态。现对这一精确typed容量消息增加一次8秒有限重试；其他429、认证/额度和混合错误仍保护停。组信号权限失败回退至本Popen直接子进程信号，无法清理则记录cleanup-errors.jsonl，不遮蔽原故障与finally状态。22项既有回归通过，并核对真实118日志及普通429/认证/额度/混合负例，不伪造重试成功。

用户中途提出Luna，曾短暂使用应用内固定gpt-6-luna角色：两路采集加一路独立初审（实际3路，不冒称4路），交接helper和6项隔离测试完成，主会话独立审查。115/117复用旧构建的新初审通过，119无正式候选、实际DNS抓取缺口作为研究留档通过；这3项保留应用内来源、任务/唯一叶子assignment SHA、独立角色canonical_task及不可变报告，不将其称为CLI或外部API结果。用户随后澄清要用已提供密钥的Luna API，3代理已中断；只准备了公开OpenDesign/gpt-6-luna路由定义，未读取/复制密钥，也未对该API发起调用。luna-handoff/STOP.json保留原阶段，不再驱动队列。

用户最新明确决定继续OpenCode Go / DeepSeek V4.1 Flash。11:52短回复与原生沙箱write/read验证成功，11:53:28以scripts/continue_retained_directory.py --model opencode-go/deepseek-v4.1-flash --resume-after-quota恢复并发4。11:54:19核对118/120/121/122四路实际Go模型、完整提示与13/18/22/16次完成工具事件，无provider错误。101项旧初审（98个v2+3个应用内Luna）和17项原单项留档的state SHA不变，剩134项继续；118复用应用内完成的绑定草稿，仅补Go独立初审，原构建来源保存在app-build-reuse.json，不能冒称Go构建。恢复前全状态/元数据另存resume-history，当前证明go-resume-20261029/startup-verification.json及preparation.json。

新的每小时安静只读完成检查saas-grove已恢复，按当前CLI status/process及所属进程判断，不再用停用的应用内代理作为存活依据。全局故障通知一次删除，不自动重启或换模型；单项失败留档继续。正式1211产品/1443关系、原阻断5类与53待确认不变，草稿尚未入库。全部252项实际结束后按混合历史协议统一复核、另备份演练后仅通过项入库，不重跑旧发布轮次。

## 2026-10-29 17:25结束、18:27最终复核入库

252单叶全部实际结束，directory-ended覆盖1..252，原状态232项awaiting_final_review、20项needs_attention。主会话完成备份后全量核对冻结输入/原目录顺序、逐叶研究、历史复用、3105份来源SHA、产品ID/track、完整许可与独立初审绑定。588个成功CLI历史会话只读导出核对实际模型与完整提示；两次导出JSON暂时截断的会话顺序只读重取后通过，未调用模型。3个应用内Luna历史审查按固定工具角色、独立canonical_task、任务/assignment SHA与不可变报告核对，未冒充CLI或Luna API。322项初审/原缺口finding逐项关联到最后报告、移除候选或待处理，不把未解决项标通过。

正文按51领域/track分层选77候选读取片段并作风险扩展，另核对薄弱页面对应的README/文档/源码核心；这不是252项逐条全文人工阅读，更不是3105份逐字精读。暂缓14条桌面/移动端或产品形态未闭合的关系（包括Natron、Autopsy、原生乐谱/演示/交易客户端、桌面作者工具与关联云服务混用），以及LedgerSMB许可缺条款、StrictDoc只有Apache通知、LibreClinica GPL/LGPL绑定冲突共3条许可关系。其余完整自托管Web应用不强加多租户、商业化或部署实测。7项许可证程序标记已分别核对，其中4项LGPL/EPL/EUPL为完整标准文本，另3项许可缺失/冲突继续留档；PhotoPrism商标条款不误认为软件商业使用禁令。Gibbon新or-later观察保留于研究，不覆写旧固定版本核心字段。Massing新关系收口到GitHub README直接证明，保持旧核心主页；SimpleRisk新记录采用已提供草稿的官方主域覆盖其www/support来源，未改校验器。

副本演练、重复导入零新增、旧核心/历史保留和SQLite完整性通过后，于18:27本地导入260产品记录（229新增、31补充）、新增280关系/203类型覆盖。正式现1440产品（546开源、894商业）、1723关系、全范围1593类型有案例，其中主目录1592/1646，54类仍无正式案例。本轮另29研究留档（19边界、10证据不足），20未过审（7结构完整待复核、13缺产物或结构未完成）；加原内容过滤5类共25待处理。全部archived:false，不推断不存在、不冷归档。未运行或部署任何第三方产品。Go本轮CLI收据合计约9.2549美元不等于实际账单；OpenDesign自定义/应用内成本无法由这些收据完整取得，不把其CLI 0值当免费。

1211旧产品所有核心字段、1443旧关系与完整历史来源、1241非本轮进度行、53待确认和原阻断5类保持，目录未改。10项5299接口检查确认目录新计数、开源/商业列表、叶子页和被暂缓候选不暴露。正式报告data/collections/included-retained-final-20261029-report.json；25项待处理同前缀-pending-all.json；29项已复核留档同前缀-retained.json。审计、筛选、正文样本、许可、问题去向、来源与复用证明在var/collection/retained-final-review-20261029及正式同前缀资料中。发布标记final-review-publication.json防止重复入库；本轮采集完成检查随发布删除，不重跑冻结252或旧15/44/274组。
