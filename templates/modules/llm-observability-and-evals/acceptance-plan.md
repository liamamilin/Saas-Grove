# acceptance-plan.md — llm-observability-and-evals 验收用例计划

> 本文件是**用例计划**（尚不可执行）：先由人确认，再由另一代理按 HOST.md 的启动方式写出可执行测试。规则的唯一权威在 `contract.md`，规则 → 用例的对应见 `contract.md` §7。

## 1. 前置与执行约定

- **启动**：按 HOST.md §1（`TEST_MODE=1`、`npm install && npm run build && npm start`、`GET /api/health` 就绪）。
- **路径**：全部走 `module-map.json` 的概念映射；未映射的概念记"宿主未声明"，不算通过也不算失败。
- **数值**：上限/超时/TTL 一律从 `params` 读取（如 `pageSizeMax`、`maxBodyBytes`、`maxStoredBodyBytes`、`maxDatasetCases`、`retainDays`、`evalRunTimeoutSeconds`、`replayTokenTtlSeconds`、`ingestRateLimitPerMinute`、`modelPrices`、`trustedProxyCidrs`）；`params` 未声明时才用 contract 的界限，**不得写死**。
- **夹具**：每条用例用全新邮箱的账号 + 全新工作区（经 `auth`、`workspaces-and-permissions` 的公开接口创建，不绕过）。需要"另一个租户"时再建一套账号与工作区。
- **测试支撑**：`POST /api/__test__/clock {advanceSeconds}` 推进时钟；`DELETE /api/__test__/rate-limits` 清限流计数；`PUT /api/__test__/fake-model` 配置假模型（延迟、故障、固定 usage）。`MODEL_PROVIDER=fake` 时模型调用一律走假模型。
- **只读库查询**：仅允许三类——①正文明文是否落库；②重放令牌明文是否落库；③幂等与保留期删除后的行数。不得读源码、不得写库。
- **执行顺序**：A14、A28 需要推进时钟（时钟是全局的），必须放在最后；A30 之前先清限流计数。
- **negative 列**：yes = 该用例针对错误路径或攻击面（越权、注入、枚举、重放、限流）；no = 正常路径或一致性检查。
- **判据**：状态码、`error.code`、字段与不变量逐条对照 contract.md；本文件只给断言要点。

## 2. 用例表

| id | given | action | expected | negative |
|---|---|---|---|---|
| A01 | 新账号+新工作区；一条合法 span（feature、tokens、UTC `startedAt`） | POST `span.ingest`，再 `span.list`、`span.get`、`trace.get` | 201；响应含 spanId/traceId/stored/sampled/contentMode；span 字段齐全（R-33）；`trace.get` 返回该 trace 的 span；列表按 createdAt 倒序 | no |
| A02 | A01 的 spanId | 再次 POST 同一 spanId | 200 + `duplicate:true`、spanId 不变；该 trace 只有 1 条 span；`cost.summary` 的 calls=1（不重复计费） | no |
| A03 | 新工作区 | 并发 10 次 POST 同一 spanId | 全部 2xx 且 spanId 相同；只读库该 spanId 行数 = 1 | yes |
| A04 | A 的 spanId/traceId；B 的账号 | A 请求不存在的 id；B 请求 A 的 id | 两者都 404 `not_found`，状态码/`error.code`/`error.message` 完全一致且不回显 id；B 的 `span.list` 为 0 条 | yes |
| A05 | A 的评测集与运行；B 的账号 | B 取 dataset / run / baseline | 全部 404 `not_found`，与未知 id 同形 | yes |
| A06 | A 工作区；B 账号以最低权限成员加入 | B PUT `policy.update` | 403 `forbidden`；A 的策略未变化 | yes |
| A07 | 无会话 | GET `span.list`；POST `span.ingest`；GET `policy.get` | 全部 401 `unauthenticated`；体为 `{"error":{"code","message"}}`，无堆栈/SQL | yes |
| A08 | 合法工作区 | 依次发：缺 spanId；负 tokens；未知 `source`；feature 含大写/空格/CR-LF；metadata 33 键；非 UTC 时间戳；请求体超 `maxBodyBytes` | 依次 400 / 422 / 422 / 422 / 422 / 422 / 413；错误体只有 code+message；无记录落库 | yes |
| A09 | 新工作区（默认策略）；prompt 含标记 M | POST `span.ingest`；GET `span.get` 两次；只读库查询 | `policy.get` 的 bodyMode=hash；响应只含 ≥32 位十六进制摘要、两次读取相同、不含 M；库中无 M | yes |
| A10 | PUT policy `bodyMode=full` | 摄入含 email / api_key / JWT / 卡号 / 手机号 / 口令 的 span；GET `span.get`；只读库查询 | 响应与库中均无上述标记明文；`redactPatterns` 仍含全部内置项；尝试删内置项 → 422 | yes |
| A11 | 已有 full 模式、正文含标记 M 的 span | PUT policy `bodyMode=none`；再 GET `span.get` 与只读库查询 | 不返回正文；库中无 M；无"恢复明文"入口 | yes |
| A12 | 新工作区 | PUT policy `sampleRate=0` 后摄入 → PUT `sampleRate=1` 后摄入 → PUT `sampleRate=0.5` 后连做 5 个 trace、每个 2 条 span | 0 时列表为空；1 时两条都在；0.5 时同一 trace 的两条 span 采样决策一致（同 trace 要么都在要么都不在） | no |
| A13 | `bodyMode=full`；`maxStoredBodyBytes` 取 params | 摄入超长 prompt | 201；`span.get` 正文长度 ≤ 上限且 `truncated=true`；全文未完整出现 | no |
| A14 | `retainDays` 取 params；已存 span + 评测集 + 一次运行 | 推进时钟 > retainDays（`POST /api/__test__/clock`） | `span.list` 为空、`span.get` 404；只读库中无该 span 与评测资产行；运行结果也不再可读 | yes |
| A15 | A、B 两个工作区；A 的管理员 | A PUT policy（`bodyMode=redact`）；重复提交同一 PUT；读 B 的 `policy.get` | A 为 redact；B 仍为默认 hash；重复 PUT 结果相同 | yes |
| A16 | 同工作区多条 span（不同 feature/model/时间） | `span.list?feature=…&model=…&since=…`；`span.list?limit=1000`；`span.list?limit=0` | 过滤只含匹配项且按 createdAt 倒序稳定；limit=1000 收敛到 `pageSizeMax`（契约上界 200）并回显生效值；limit=0 → 400 `bad_request` | yes |
| A17 | `trustedProxyCidrs` 已声明 | 带 `X-Forwarded-For: 203.0.113.7, 198.51.100.9`（其中一段受信）摄入，再 GET `span.get` | `clientIp` = XFF 中**最右侧非受信跳**；`params` 未声明时本用例记"宿主未声明" | yes |
| A18 | 已知 token 数的多条 span；`modelPrices` 已声明 | 对 `span.list` 的 `costMicros` 求和；`cost.summary` 取同窗口 totals | 两者相等（误差 0）；`modelPrices` 已声明时每条 span 的 costMicros = 单价×token（向上取整） | no |
| A19 | 一条无 feature 的 span + 一条 `feature=support.answer` 的 span | `cost.summary?groupBy=feature`；`?groupBy=bogus`；`?from=…&to=…`（from>to） | feature 分组同时含 `support.answer` 与 `unattributed`；bogus → 422；from>to → 422 | yes |
| A20 | 新工作区 | 建缺 `name` 的数据集；含重复 caseId 的；含未知 criterion kind 的；case 数超 `maxDatasetCases` 的；`regex` 模式 > 512 的 | 依次 400 / 422 / 422 / 422 / 422；无数据集落库 | yes |
| A21 | 数据集 2 个 case（判据 `regex ".*"` 与 `regex "^$"`）；`bodyMode=none` | `eval.run.start` 并轮询到终态；再跑一次同样配置 | 202 + runId；终态 `succeeded`；每个 case 恰好一条 `source=eval` 的 span；两次运行 `output` 与 `passed` 完全一致；结果 `output` 仍可读（评测资产不受 bodyMode 影响） | no |
| A22 | A21 的运行结果 | 按 contract R-44 独立复算每个 case 的判定 | `summary.total` = case 数；`passRate = passed/total` ∈ [0,1]；`passed+failed+errorCount = total`；逐 case `passed` 与复算一致 | no |
| A23 | 数据集含 c1、c2（判据均 `regex ".*"`） | 跑 run1（全过）→ `eval.baseline.set`=run1 → `eval.dataset.update` 把 c1 判据改成 `regex "^$"` → 跑 run2 | run2 的 `comparison.baselineRunId`=run1；passRate=0.5；delta=-0.5；`regressedCaseIds`=[c1]；run2 `status=succeeded`；run1 结果未被改写；run2 的 eval span 出现在 `cost.summary` | no |
| A24 | 宿主文档给出假模型故障注入的载荷键 | 注入故障后启动运行 | 该 case `status=error`、`passed=false`、`errorCode` 非空；`summary.errorCount ≥ 1`；run `status=succeeded`；未声明注入方式时记"宿主未声明" | yes |
| A25 | 已有数据集与一次运行 | `eval.dataset.delete`；再 GET dataset 与 run | delete 204；GET dataset 404；GET run 仍 200 且结果与删除前一致 | yes |
| A26 | `bodyMode=full` 的 span；同工作区 | `span.replay.prepare` → `span.replay.execute` → 用同一 token 再 execute；只读库查询 | prepare 201 + token + expiresAt；首次 execute 201 且新增恰好 1 条 span（`replayedFromSpanId` 指向原 span）与 1 次模型调用；第二次 409 `replay_token_used` 且无新增 span/调用；库中无明文 token | yes |
| A27 | 新的 replay token | 并发两次 execute 同一 token | 恰好一次 201、一次 409；新增 span 恰好 1 条；模型调用恰好 +1 | yes |
| A28 | replay token（TTL 取 params，契约默认 300s） | 推进时钟超过 TTL 后 execute | 410 `replay_token_expired`；无新 span、无模型调用 | yes |
| A29 | `bodyMode=none` 的 span；B 的账号 | A 对无正文 span `span.replay.prepare`；B 对 A 的 span `span.replay.prepare` | 无正文 → 409 `replay_unavailable`（不发放令牌、不调用模型）；跨租户 → 404；A26 重放成功的新 span 计入 `cost.summary` | yes |
| A30 | 新账号+新工作区；先 `DELETE /api/__test__/rate-limits` | 连续摄入超过 `ingestRateLimitPerMinute`（未声明时按契约界限 60/分钟） | 第 N+1 次 429 `rate_limited` 且带 `Retry-After`；其他工作区不受影响 | yes |

## 3. 覆盖说明

- 30 条用例覆盖 contract.md 的 58 条 MUST 规则（逐条对应见 contract.md §7），无孤立规则、无孤立用例。
- 攻击面覆盖：越权读写（A04~A06）、未认证（A07）、输入与注入（A08、A10、A20）、枚举（A04、A05）、幂等与并发（A02、A03、A27）、重放与令牌重放（A26~A29）、限流与体积（A08、A30）、来源 IP 伪造（A17）、保留期与删除（A11、A14、A25）。
- 未覆盖且写进 contract 的数值一律从 `params` 读取；`params` 缺失时按契约界限执行并在报告中标注。
