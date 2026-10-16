# factory-impl — 长任务进度 Ledger

> **这是长任务的唯一状态来源。** 任何一轮恢复工作时，先读本文件再动手。
> 不要依赖对话记忆；对话会被压缩。

## 任务定义

- **目标**：实现 Template Factory 的可运行本体（CLI + 规则引擎 + 状态机 + 三仓 + API + Web UI）。
- **授权**：Owner 于 2026-10-16 批准 `ADR-Factory-001`（D1–D9）。批准记录：`factory-v1.2/ADR-Factory-001-APPROVAL.md`。
- **范围**：全套，含 Web UI。**不含**三个试点 A/B/C（另起一轮）。
- **技术栈**：Python 3.10.13。
- **依赖策略**：允许安装公开源包，锁定版本并记录依赖清单。

## 硬约束（继承自项目规范，不可违反）

1. **绝不修改 `Source/**`** —— 冻结基线只读。
2. **不降低任何硬门禁**：license / security / tenant-isolation / payment / release-approval / L0–L3。
3. **`UNKNOWN` 不得变成 `PASS`**；`NOT_RUN` 不得用作晋升依据。
4. **schema PASS 永远不是商业认证** —— 所有输出必须保留诚实边界。
5. **payload 冻结先于验证**；认证数据走 detached envelope，不得回写 payload。
6. **Builder 不得自评签发 PASS**；发布必须 `RELEASE_APPROVER` 且带非空 `approvalId`。

## 阶段状态

| 阶段 | 内容 | 状态 | 产物 |
|---|---|---|---|
| P0 | 批准记录 + 骨架 + ledger | ✅ DONE | `PROGRESS.md`, `factory-v1.2/ADR-Factory-001-APPROVAL.md` |
| P1 | 领域层：枚举 + 规范角色 + 状态机表 | ✅ DONE（R-B/R-C/R-D；第四次会话：暂停/阻断可嵌套、按 job 历史判定，V-3/V-4） | `src/factory/domain/`, `docs/SPEC_CONFLICTS.md` |
| P2 | 规则层：schema 校验 + 策略引擎 | ✅ DONE（与 v1.2 参考引擎一致 + R-R 风险门禁） | `src/factory/rules/` |
| P3 | 存储层：文件式三仓 | ✅ DONE（不可变性/原子性/幂等） | `src/factory/store/` |
| P4 | 引擎层：catalog/batch/job/evidence/freeze/attestation/registry | ✅ DONE（第四次会话：attest/register 绑定 job，转移 12/15/16 有门禁，V-1/V-2/V-6/V-7） | `src/factory/engine/` |
| P5 | CLI（typer） | ✅ DONE（exit code 契约正确；新增 `--cosigner`） | `src/factory/cli.py`, `pyproject.toml` |
| P6 | 测试：正负向 + v1.1/v1.2 回归 | ✅ DONE（210 passed / exit 0；`factory-v1.2` 41/41 OK） | `tests/` |
| P7 | API（FastAPI） | ✅ DONE（+ cosigners + lease/report 端点） | `src/factory/api/` |
| P8 | 编排：队列/worker/租约/超时恢复 | ✅ DONE（第四次会话：引擎强制租约；`BatchRunner` 持久化队列，带 DAG/并发/预算/尝试/超时/崩溃恢复，接入 CLI/API） | `src/factory/engine/orchestrator.py`, `src/factory/engine/batch.py`, `src/factory/cli.py`, `src/factory/api/app.py` |
| P9 | Web UI | ✅ DONE（只读控制台，vanilla JS，`/ui/`） | `web/index.html` |
| P10 | 端到端验证 + 依赖清单 + 文档 | ✅ DONE（E2E 测试 + `requirements.lock` + 两份文档） | `docs/SCHEMA_PROVENANCE.md`, `docs/API.md`, `requirements.lock`, `tests/test_e2e.py` |

## 独立复核（2026-10-16 第四次会话，Claude 主会话）

复核对象：第三次会话（opencode `factory-impl-dev`）的自报结果。方法：重跑测试 + 重跑第二次会话的原始探针 + 新探针（探针放在会话 scratchpad，未写入仓库）。

**确认属实**：`pytest` 164 passed / exit 0；`factory-v1.2` unittest 41/41 OK；15 个 schema 副本与 `factory-v1.2/schemas` 逐字节一致；`Source/**` 12:00 后无任何修改。R-A、R-B、R-C、R-D、R-R、R-X、R-G 的原始探针现在都按预期被拒或放行。

**更正**：第三次会话记录的起始失败（FIX-1，`UnsafeIdentifier`）是第二次会话（Claude）留下的——在 `resource_key` 加了 ID 校验后，会话中断前没有跑测试。

**新发现（探针复现）**：

| ID | 问题 | 性质 | 状态 |
|---|---|---|---|
| V-1 | `register()` 不需要任何 job，也不检查是否评估过 attestation：RELEASE_APPROVER 可以把从未验证的 payload 以 L1/`VERIFIED` 写进 Certified Registry（第二次会话的审计也漏了这条） | **门禁缺口** | ✅ FIXED |
| V-2 | 联签只是调用方声明的角色名（`cosigners=["SECURITY_LICENSE_REVIEWER"]`），没有联签人身份；Builder 能自己"代签"SLR，journal 也记不下是谁签的 | **门禁形同虚设** | ✅ FIXED |
| V-3 | 先 BLOCKED，再 PAUSED，再恢复到 BLOCKED 后，"记录的阶段"变成 PAUSED，VALIDATOR/SLR 再也无法解除阻断，job 永久卡死 | 功能（死锁） | ✅ FIXED |
| V-4 | VALIDATOR/SLR 无法阻断一个 PAUSED 的 job（第 19 行遮蔽第 20 行，R-D 修得不完整）；在 QUEUED 暂停的 job 无法恢复 | 功能 | ✅ FIXED |
| V-5 | 租约只是建议性的：`transition()` 不检查租约，非持有者也能推进被租约锁住的 job，任何人都能 release 别人的租约；没有队列/claim-next、预算和尝试次数也没有接进 CLI/API | P8 未完成 | ✅ FIXED |
| V-6 | `freeze(job_id=…)` 不检查 job 状态，`attempt_id` 可以由调用方随意指定（包括未来的 attempt） | 功能（宽松） | ✅ FIXED |
| V-7 | `transition()` 读改写 job 时没有加锁，两个进程并发会互相覆盖 | 功能（并发） | ✅ FIXED |
| V-8 | job/candidate ID 没有校验，`job_id="../../registry/x"` 能把文件写进 Certified Registry 目录（第二次会话发现，但当时漏记） | **信任边界穿越** | ✅ FIXED |
| V-9 | 环境里的 typer 0.16.0 + click 8.5.0 组合不强制 CLI 必填参数，漏写的参数静默变成 `None`（漏写 `--holder` 等于释放任何人的租约） | 依赖兼容性 | ✅ 代码层已绕开；依赖升级待决定 |
| V-10 | `docs/API.md` 写的 `FACTORY_ROOT` 环境变量没实现；`/transitions` 把第 24/26 行列出来的去向错写成"记录的阶段" | 文档/展示 | ✅ FIXED |

### 第四次会话的修复（2026-10-16）

验证命令（工作目录 `factory-impl/`）：

```
python -m pytest -q                          → 210 passed, exit 0
(cd ../factory-v1.2 && python -m unittest discover -s tests) → Ran 41 tests, OK
diff -rq schemas ../factory-v1.2/schemas     → 只有 README 不同（15 个 schema 逐字节一致）
requirements.lock 自检                        → OK
```

| ID | 修复 | 证据 |
|---|---|---|
| V-1 | `attest(job_id=)` 只能在 VALIDATING 执行，基于该 job 当前 attempt 的 freeze 评估，结果记入 journal 和 workspace。转移 12/15 必须有这条记录；`register()` 必须指定一个处于 PUBLISHING 的 job，freeze 必须是这个 job 的，state 声明的 attestation/evidence/等级不能超过实际评估过的，decision 必须是已记录的那份；转移 16 必须真的已登记 | `test_verification_fixes.py` V-1 组；`test_e2e.py::test_cli_full_pipeline_reaches_registered` |
| V-2 | 联签必须写成 `ROLE:actor`，联签人不能是发起人本人；journal 记下联签人身份（SC-04） | V-2 组 |
| V-3/V-4 | `recorded_stage()` 用栈回放 journal，暂停/阻断可以嵌套；判定时考虑所有覆盖该转移的行（第 20 行不再被遮蔽）；QUEUED 暂停后可以恢复；从审批/发布态暂停的 job 回到 VALIDATING（SC-03） | V-3/V-4 组 |
| V-5 | 租约由引擎强制：只有持有者能推进 job，控制类动作可以抢占并留记录；release 必须是持有者本人；lease 文件用 link 原子创建。新增 `engine/batch.py`：`batch start/claim/report/stop/status/list`（CLI 和 API 都有），dryRun 时只给预览、不写任何东西；编排器只会把 job 停到 STOPPED_FOR_REVIEW（SC-05、SC-06） | `test_batch.py`（19 个）；`test_e2e.py::test_cli_and_api_batch_round_trip` |
| V-6 | 绑定 job 的 freeze 只能在 STAGING_ARTIFACT 做，只能绑当前 attempt，每个 attempt 只能 freeze 一次；绑定记录不可覆盖；Gate 11 会核对它和 registry 里的 freeze 是否一致 | V-6 组 |
| V-7 | `transition`/`create_job` 都在 job 级文件锁内执行；journal 追加也加了锁 | — |
| V-8 | `check_id` 覆盖 job、candidate、resource、batch、attestation 的 ID | V-8 组 |
| V-9 | CLI 的 `_enforce_required` 在命令执行前检查必填参数（缺失时 exit 2）；`LeaseRegistry.release` 不再把 `None` 当成通配 | `test_cli_refuses_a_missing_required_option` |
| V-10 | `FACTORY_ROOT` 已实现；新增 `factory serve`，只允许绑定回环地址，默认端口 8780；`/transitions` 显示真实的去向 | 浏览器里看过只读 UI（合成数据） |

另外：Web UI 新增 Batches 区块，registry 表格加了 qualityLevel/verificationStatus 两列。`docs/API.md` 已按现状重写对应章节；`docs/SPEC_CONFLICTS.md` 新增 SC-03…SC-06。

**这些修复全部是收紧或补齐门禁，没有放松任何一道门。** `Source/**`、`factory-v1.2/**` 的内容没有改动。第二次会话曾在 `factory-v1.2/` 里留下 pytest 缓存（`.pytest_cache` 和 3 个 `*-pytest-9.0.2.pyc`），本次已删除。

## P3 完成记录（2026-10-16 第三次会话）

真实验证命令（工作目录 `factory-impl/`）：

```
python3 -m pytest -q
164 passed, 2 warnings in 0.85s
PYTEST_EXIT=0

python3 -m factory.cli --root <tmp> schema check
{ "status": "OK", "schemasChecked": 15 }   (exit 0)
```

端到端 CLI 实证（完整跑通至 `VALIDATING`，已固化为 `tests/test_e2e.py`）：

```
job create j1 (SANDBOX_CODE) → DISCOVERING → EVALUATING → AWAITING_SELECTION
→ PLAN_APPROVED (+SLR) → TRANSFORMING → CALIBRATING → STAGING_ARTIFACT (+SLR)
→ freeze --job-id j1 --attempt-id j1-a1 → VALIDATING     # 全部 exit 0
job show j1 → state=VALIDATING, attemptId=j1-a1
```

| ID | 缺陷 | 修复 | 状态 |
|---|---|---|---|
| R-P8 | 租约仅内存、无 heartbeat、未接入 CLI/API | `LeaseRegistry` 改为**文件式**（`workspace/leases/<jobId>.json`，`O_CREAT\|O_EXCL` 原子抢占；跨实例/跨进程可见）；新增 `heartbeat()`；超时租约回收标注 `recoveredFromCrash`。CLI：`job claim/heartbeat/release/report`；API：`POST /jobs/{id}/lease`、`POST /jobs/{id}/heartbeat`、`DELETE /jobs/{id}/lease`、`GET /jobs/{id}/report`。 | ✅ FIXED |
| P9 | Web UI 为空 | `web/index.html`：只读控制台，渲染 `/health`、`/transitions`（含 cosigners）、`/jobs`、`/registry`、`/schemas`；无任何发布动词；`mount_ui()` 在 import 时挂载 `/ui/`。 | ✅ DONE |
| R-DOC / P10 | 缺失文档 + 依赖清单 + E2E | `docs/SCHEMA_PROVENANCE.md`（15/15 schema 逐字节一致 + 哈希）；`docs/API.md`（全端点 + 无认证边界）；`requirements.lock`（28 pins，脚本自校验通过）；`tests/test_e2e.py`。 | ✅ DONE |

P8 实现决策（D-E，重申）：doc 11 规定"至少完成三类试生产再决定是否建设持久任务调度"，
故**不建后台守护进程**；P8 = 任务文件 + 文件租约（O_EXCL）+ CLI/API 驱动的
claim / heartbeat / report，即 doc 11 第一版 Agent Harness 形态。
batch 永不自动发布（发布需 `RELEASE_APPROVER`，转移 15）。

### 本轮新增/修改文件

- 修改：`src/factory/domain/state_machine.py`（R-D + row19 语义）、
  `src/factory/rules/policy.py`（R-R）、`src/factory/engine/factory.py`
  （FIX-1/R-G/R-X/R-B/R-C/R-A/R-E）、`src/factory/engine/orchestrator.py`
  （R-F + 文件租约）、`src/factory/cli.py`、`src/factory/api/app.py`。
- 新增测试：`tests/test_defect_fixes.py`、`tests/test_leases.py`、`tests/test_e2e.py`；
  `tests/test_orchestrator.py` 增补 R-F；`tests/conftest.py` 增辅助函数。
- 新增产物：`web/index.html`、`docs/SCHEMA_PROVENANCE.md`、`docs/API.md`、
  `requirements.lock`。
- **未改动**：`Source/**`、`factory-v1.2/**`、`factory-impl/schemas/**`（逐字节不变）。

## P1/P2 修复记录（2026-10-16 第三次会话）

真实验证命令（每次修复后都跑，工作目录 `factory-impl/`）。下表是 **P1/P2 修复后的中间值**
（当时尚未做 P3；最终值见上方 P3 记录）：

```
python3 -m pytest -q
150 passed, 2 warnings in 0.62s
EXIT: 0
```

| ID | 缺陷 | 修复 | 状态 |
|---|---|---|---|
| FIX-1 | Gate-11 空 resourceVersion 崩溃（`UnsafeIdentifier`） | `_registry_freeze()` 对空/非法 version 返回 `None`，干净返回 blocked | ✅ FIXED |
| R-G | freeze 不绑定 job/attempt | `freeze(job_id=, attempt_id=)` 在 workspace 记录绑定；Gate-11 只认当前 attempt 的 freeze；返工 `VALIDATING→TRANSFORMING` 递增 attempt | ✅ FIXED |
| R-B | PAUSED 恢复到非记录阶段 | 引擎按 row 19 强制 `resume == 记录来源阶段` | ✅ FIXED |
| R-C | PO PAUSE 洗掉 SLR 阻断 | 记录来源；PAUSED→X 只能是记录来源；BLOCKED 来源只能恢复回 BLOCKED | ✅ FIXED |
| R-X | 转移表 4/5/10 的联签不强制 | `transition(cosigners=...)` 缺联签即 blocked；CLI `--cosigner` / API `cosigners` | ✅ FIXED |
| R-R | READ_ONLY 进 TRANSFORMING+ | `policy.check_risk_class_transition` 硬阻断 doc 08 定义的非只读状态 | ✅ FIXED |
| R-D | 行 20 被具体行遮蔽 | `blocking_roles()` 让通用 BLOCK 行不被遮蔽；SLR 可从 VALIDATING 阻断 | ✅ FIXED |
| R-A | 默认幂等键第二轮碰撞 | 默认键加唯一 nonce；不再把新一轮当重放 | ✅ FIXED |
| R-E | 显式键复用于不同请求返回旧结果 | 复用键但请求不一致即 blocked | ✅ FIXED |
| R-F | 预算边界（maxUsd=0 / 最后 attempt） | 零成本不计耗尽；最后允许的 attempt 不因计费判耗尽 | ✅ FIXED |

新增回归测试：`tests/test_defect_fixes.py`（每项含负向"绕过被拒"+ 正向"合法路径仍通"），
`tests/test_orchestrator.py` 增补 R-F 三条。`is_legal` 静态表本身未放宽任何发布路径
（R-B/R-C 的判定发生在引擎层，静态表只是无法表达"记录的阶段"）。

## 对账记录（2026-10-16 第三次会话）— 真实基线

会话开始时的**真实**基线（不是自述）：`python3 -m pytest -q` →
**132 passed, 1 failed**（exit 1）。

```
FAILED tests/test_engine_pipeline.py::test_validating_without_freeze_blocked
factory.store.paths.UnsafeIdentifier: unsafe resourceVersion ''
```

失败根因：`engine/factory.py::transition()` 的 Gate-11 用
`job.get("resourceVersion", "")`（恒为空串，因为 production-job schema 没有该字段）
调用 `registry.get(...)` → `check_id("")` 抛 `UnsafeIdentifier`，
即"未冻结就 VALIDATING"这条门禁**崩溃而非干净返回 blocked**。属 R-G 同类。

上一会话 ledger 自述"133 passed"是过时/不准确的；本轮以真实测试结果为准。

## 对账记录（2026-10-16 第二次会话，历史）

上一会话在写 P8 时中断，ledger 停在 P5。复核时 `pytest` 133 passed / exit 0，但探针复现了以下缺陷（均在已标 DONE 的代码里）：

| ID | 缺陷 | 性质 | 状态 |
|---|---|---|---|
| R-B | PAUSED 恢复不校验"记录的先前阶段"：QUEUED 暂停后可直接恢复到 PLAN_APPROVED | **门禁绕过** | ✅ FIXED |
| R-C | PO 可 PAUSE 一个被 SLR 阻断的 job 再恢复，洗掉阻断 | **门禁绕过** | ✅ FIXED |
| R-X | 转移表 4/5/10 行的联签（"+"）只回显不强制 | **门禁未执行** | ✅ FIXED |
| R-R | READ_ONLY 风险等级的 job 可进入 TRANSFORMING 及以后 | **门禁未执行** | ✅ FIXED |
| R-A | 默认幂等键碰撞：CALIBRATING↔TRANSFORMING 第二轮被当重放，job 不动却返回 OK | 功能 | ✅ FIXED |
| R-E | 显式幂等键复用于不同请求时静默返回旧结果（OK） | 功能 | ✅ FIXED |
| R-G | freeze 不绑定 job/attempt，任何 job 都无法进入 VALIDATING；返工后旧 freeze 会被复用 | 功能 + 门禁 | ✅ FIXED |
| R-D | 第 20 行（任意非终态→BLOCKED）被具体行遮蔽，SLR 无法阻断 VALIDATING | 功能（阻断能力缺失） | ✅ FIXED |
| R-F | 预算：`maxUsd=0` 下零成本步骤也停；最后一次允许的 attempt 一计费即"次数耗尽" | 功能 | ✅ FIXED |
| R-P8 | 租约仅内存（崩溃即丢）、无 heartbeat、编排未接入 CLI/API | 未完成 | ✅ FIXED |
| R-DOC | `docs/SCHEMA_PROVENANCE.md`、`docs/API.md` 被代码引用但不存在 | 文档 | ✅ FIXED |

P8 实现决策（D-E）：doc 11 规定"至少完成三类试生产，再决定是否建设持久任务调度"，故**不做后台调度守护进程**；P8 = 任务文件 + 文件租约（O_EXCL）+ CLI/API 驱动的 claim / heartbeat / report，即 doc 11 第一版的 Agent Harness 形态。batch 永不自动发布（发布需 RELEASE_APPROVER，转移 15）。

## 设计决策（实现期追加）

- **D-A**：`factory-impl/` 自带 `schemas/` 副本（源自 `factory-v1.2/schemas`），保证独立可运行；规范真源仍在 `factory-v1.2/`，副本哈希记录在 `docs/SCHEMA_PROVENANCE.md`。
- **D-B**：规则引擎**移植并扩展** `factory-v1.2/scripts/factory_rules.py`，不重写语义，只补强制点。
- **D-C**：三仓 = 三个目录（candidate / workspace / registry），用路径分界表达信任边界，不引入数据库做首版。
- **D-D**：不引入 ORM；首版持久化 = JSON 文件 + 原子写（tmp + rename）。
- **D-E**：P8 不做后台调度守护进程；租约 = `workspace/leases/<jobId>.json`，`O_CREAT|O_EXCL` 原子抢占，CLI/API 驱动 claim/heartbeat/report。
- **D-F**："记录的先前阶段"和 freeze 的 job/attempt 绑定都落在**现有 schema 之外**（journal / workspace 工件），保证 15 个 schema 逐字节不变。

## 当前状态（2026-10-16 第四次会话结束）

- P0–P10 全部完成；`pytest` 210 passed / exit 0。
- 仍需人工决定的事：
  1. SPEC_CONFLICTS 里的 SC-02…SC-06 是否认可（都选了最保守的解释）；
  2. 依赖版本：升级 typer，或把 click 固定到 typer 支持的版本（V-9）；
  3. 是否给 API 加认证层（没有认证时联签人身份只能是自报，SC-04）；
  4. `../PROJECT_STATE.md` 第 5 节列的人工关口（License 裁决、route 确认、候选 re-pin、是否合并 v1.2 进 Source、是否启动三试点）。

## 本轮结束状态（2026-10-16 第三次会话）

- `python3 -m pytest -q` → **164 passed, exit 0**（起始 132 passed / 1 failed）。
- P1 全部门禁缺陷（FIX-1, R-G, R-B, R-C, R-X, R-R, R-D）**已修复**，均有负向+正向回归测试。
- P2 功能缺陷（R-A, R-E, R-F）**已修复**。
- P3 完成项（R-P8 文件租约、P9 Web UI、P10 文档+依赖清单+E2E）**已完成**。
- **未降低任何硬门禁**：license / security / tenant-isolation / payment /
  release-approval / L0–L3 全部保持；`UNKNOWN`/`NOT_RUN` 仍不得变 `PASS`；
  `Source/**` 与 `factory-v1.2/**` 零修改。
- 仍未关闭的**人工关口**（不是代码缺陷，属 Owner 决策）：见
  `../PROJECT_STATE.md` 第 5 节（License Reviewer 裁决、route 确认、候选
  re-pin、是否合并 v1.2 进 Source、是否启动三试点）。这些**不可由本 Agent 自动绕过**。

## 恢复指引

中断后从「阶段状态」表中第一个 ⬜ 继续。每阶段完成必须：
1. 跑真实验证命令并记录 exit code；
2. 更新本文件的状态列；
3. 把产物路径写进对应行。
