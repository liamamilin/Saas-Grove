# SPEC_CONFLICTS — 实现期发现的规范内部矛盾

> 实现过程中撞到的、规范自身说不通的地方。每条记录：现象 → 影响 → 处理方式 → 是否降门。
> 原则：**不得为了"跑通"而单方面改规范**；能做的是显式记录、选择最保守的解释、并在需要 Owner 裁决时标出。

---

## SC-01 — `REGISTERED` 既是终态、又有出边（CF-7 / doc 07 + 17）

**现象**：`docs/07_STATE_MACHINE.v1.2.md` 第 83 行声明：

> **终态**：`REJECTED`, `CANCELED`, `REGISTERED` 对单次 Job 为终态；后续修复另建 Job。

但同一份文档第 79 行定义转移 25：

> | 25 | `REGISTERED → RECHECK` | 下载后重新哈希/重装复核 | RELEASE_APPROVER |

`REGISTERED` 既是终态、又有出边，两者对"Job 级转移"不能同时成立。实现时的第一个单测就抓到（`REGISTERED → RECHECK` 被终态检查拦下）。

**影响**：中等。不涉及任何门禁，但决定 RECHECK 的语义归属。

**处理**（`domain/state_machine.py::POST_TERMINAL_VERIFICATION`）：
把 `REGISTERED → RECHECK` 解释为**发布后的完整性复检**，而不是 Job 的工作延续：

- RECHECK 属于 `17_IMMUTABLE_RELEASE_PROTOCOL.md` 的第 6 步（下载后重新哈希/重装），是对**已发布字节**的复核；
- 其唯一合法出口是 `REGISTERED`（字节一致）或 `BLOCKED`（不一致）；
- 不创建新 Job、不改写 payload、不恢复任何工作状态。

因此 `REGISTERED` 作为**工作状态**仍是终态，仅此一条出边被显式豁免，且豁免集只含 `(REGISTERED, RECHECK)` 这一个二元组。

**是否降门**：**否**。RECHECK 无法通向任何发布或晋升状态（`RECHECK → PUBLISHING` 仍被拒绝，有测试）。这条豁免只允许"复核一个已发布制品"这一动作。

**需 Owner 裁决？** 建议记录在案即可；若未来认为 RECHECK 应另建新 Job，则删除该豁免并把转移 25/26 改为跨 Job 操作。当前选择是最保守解释。

---

## SC-02 — 规范里存在**两套互不兼容的角色枚举**

**现象**：CF-7（D7）宣称统一了角色，`docs/07_STATE_MACHINE.v1.2.md` 第 37 行给了"唯一角色枚举"：

```
PRODUCT_OWNER | DISCOVERY_AGENT | BUILDER_AGENT | VALIDATOR | SECURITY_LICENSE_REVIEWER | RELEASE_APPROVER
```

但**已批准的 v1.2 schema 里另有一套**，且参考引擎按它比较（`scripts/validate_attestation.py` 第 119/127/129 行）：

| 文件 | 枚举 |
|---|---|
| `state-transition.schema.json` / `production-job.schema.json` | `PRODUCT_OWNER, DISCOVERY_AGENT, BUILDER_AGENT, VALIDATOR, SECURITY_LICENSE_REVIEWER, RELEASE_APPROVER` |
| **`evidence.schema.json` / `scoped-attestation.schema.json`** | `BUILDER, INDEPENDENT_VALIDATOR, LICENSE_REVIEWER, SECURITY_REVIEWER, RELEASE_APPROVER` |

参考引擎显式写的比较是 `e['validationRole'] != 'LICENSE_REVIEWER'`、`== 'BUILDER'` —— 即 evidence 侧用的是**短名枚举**，不是 CF-7 的规范角色名。

**影响**：高（实现期直接撞到）。把 CF-7 的角色名写进 `evidence.validationRole` 会被 schema 拒绝。任何跨"转移记录"与"证据记录"的实现都必须做映射，而规范从未提及这件事 —— 它宣称"唯一角色枚举"，实际有两套。

**处理**（`domain/enums.py`）：
- 保留 `Role` 作为**治理角色**（转移、审批、job.ownerRole）；
- 新增 `EvidenceValidationRole` 作为**证据签署角色**（evidence / attestation）；
- 二者的换算集中在 `evidence_role_for(role, gate_id)`：`SECURITY_LICENSE_REVIEWER` 在 `G-LICENSE` 上签为 `LICENSE_REVIEWER`，在 `G-SECURITY` 上签为 `SECURITY_REVIEWER`；`BUILDER_AGENT → BUILDER`、`VALIDATOR → INDEPENDENT_VALIDATOR`。

**是否降门**：**否**。映射是纯命名换算，不改变谁能签哪个门。Builder 仍被禁止签任何门（`BUILDER` 触发 self-certification 阻断），G-LICENSE 仍必须 LICENSE_REVIEWER。

**需 Owner 裁决？** **建议裁决。** 这是规范的真实缺陷，不是实现选择。两条出路：(a) 把 evidence 的 `validationRole` 改为引用 CF-7 规范角色并升 schema 版本；(b) 在 `07` 文档中明确承认"治理角色 / 证据角色"是两个词汇表并给出映射表。当前实现选 (b) 并把它记在案 —— 因为改 schema 需动 `factory-v1.2/` 的已批准制品，超出本轮授权。

---

## SC-03 — "恢复到记录的先前阶段" vs "恢复不得直接落到审批/发布态"（doc 07 行 18/19/21）

**现象**：行 18 允许"任意非终态 → PAUSED"，所以 `AWAITING_RELEASE_APPROVAL`、`PUBLISHING` 也能被暂停。行 19 规定恢复到"记录的先前阶段"，并且"必须重新验证该阶段的 Gate"。但这两个阶段的 Gate 是在 `VALIDATING` 里验证的（行 12/15）。原实现的注释又写着"恢复永不直接落到审批或发布态"。按字面执行，这种 job 会无处可回、永久卡住；硬回原阶段，又会跳过重验。

**处理**（`domain/state_machine.py::resume_target`）：从 `AWAITING_RELEASE_APPROVAL`/`PUBLISHING` 暂停（或阻断）的 job，恢复到 `VALIDATING`。其余阶段按字面回到记录的阶段。暂停可以嵌套：先 BLOCKED 再 PAUSED，恢复 PAUSED 时回到 BLOCKED，只有 VALIDATOR/SLR 解除阻断后才回到工作阶段（`recorded_stage` 用栈回放 journal）。

**是否降门**：**否**。这只会多一次重验，不会少。

**需 Owner 裁决？** 建议确认。

---

## SC-04 — 联签"+"的含义（doc 07 行 4/5/10）

**现象**：行 5 写的是"PRODUCT_OWNER（许可/安全**必要时**加 SECURITY_LICENSE_REVIEWER）"，什么情况算"必要"没有定义。规范也没说联签要记到哪里、记成什么形式。

**处理**：
- "必要时"按**总是需要**处理，因为引擎无法自动判断必要性，取最保守的解释；
- 联签写成 `ROLE:actor`，必须是与发起人不同的具名人员，记入 journal（`cosignatures`）。只写角色名、或自己给自己联签，一律拒绝。

**诚实边界**：工厂没有身份认证，所以联签人的名字仍然是调用方自己声明的。现在能强制的只是"记录上有第二个具名的人"，并不能证明这个人真的签过。要真正强制，必须先有认证层（见 `docs/API.md`）。

**是否降门**：**否**（比原实现更严）。

---

## SC-05 — 编排器以谁的身份停 job（doc 07 行 23、doc 19）

**现象**：doc 19 要求"触发上限时记录 STOPPED_FOR_REVIEW"，但行 23 的执行角色是 PRODUCT_OWNER，而触发上限的是无人值守的编排器。

**处理**（`engine/batch.py::_stop_job`）：编排器以启动该 batch 的 PRODUCT_OWNER 的授权执行行 23，actor 记为 `orchestrator:<batchId>`，reason 里写明"由某人的 batch 批准预先授权"。编排器**只做这一种转移**（有测试 `test_the_orchestrator_only_ever_parks_jobs`），从不把 job 往前推。

**是否降门**：**否**。停下来是限制性动作。

---

## SC-06 — BatchPlan 里有两组重复的上限字段（`batch-plan.schema.json`）

**现象**：尝试次数有两个字段，`budget.maxAttemptsPerJob` 和 `retryPolicy.maxAttempts`；单 job 运行时间也有两个，`budget.maxRuntimeMinutes` 和 `timeout.perJobMinutes`。schema 没有说它们之间是什么关系。

**处理**：两者都生效，取更紧的那个（`min`）。

**是否降门**：**否**。

**需 Owner 裁决？** 建议在 schema 的下一版里合并成一个字段。
