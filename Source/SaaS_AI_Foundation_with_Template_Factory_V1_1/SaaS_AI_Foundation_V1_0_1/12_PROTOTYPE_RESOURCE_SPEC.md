# 12 — Prototype Resources：原型资源规范（V0.1）

> 状态：**规划性资源契约，尚未实现或完成源码审计**。本规范属于 SaaS & AI Foundation V1.0.1 文档修订。与 `02_PRODUCT_LINES_SCOPE.md`、`03_TECHNICAL_ARCHITECTURE.md`、`04_MODULE_TEMPLATE_CONTRACT.md` 一起使用。

## 1. 定义与边界

**Prototype Resource（原型资源）**：描述一个应用模板在特定使用情境下如何呈现界面、组织信息与完成交互的资源；可以包含设计规范、页面、交互流程、演示数据及可运行前端实现。它通常**不单独实现完整业务核心**。

- **Application Template（应用模板）**负责领域模型、业务能力、API、权限规则、执行逻辑及部署边界。
- **Prototype Resource（原型资源）**负责可变的产品呈现与交互，包括界面、导航、信息架构、用户流程与能力映射。
- **UI Pattern（共享 UI/交互模式）**是可跨模板复用的构件（如表格、Kanban、详情页），不等同于绑定某个业务的完整原型。
- **SaaS + AI Module** 仍为 L4 的独立可插拔能力，不因自带 AI 对话面板就自动成为某个业务模板的原型资源。

**关系**：`Business SaaS Template 1 → 0..N Prototype Resources`；`AI Native Template 1 → 0..N Prototype Resources`。每个原型在本版本有一个明确的所属应用模板（`ownerTemplate`）；跨模板复用优先共享更细粒度的 UI Pattern，而不是复制或隐式共用整个业务绑定原型。Catalog 允许按能力及标签检索所有原型，但它们不构成第五条产品线。

**重要**：一个原型可以只覆盖一个页面或工作流，不必重画整个 SaaS；不同原型的资源包也不必属于相同前端技术栈。所谓“替换原型”，只在声明的覆盖范围内保证可替换。

## 2. 一个模板、多个原型的示例

CRM 应用模板提供：`customer.list`、`customer.create`、`opportunity.list`、`opportunity.move-stage`、`activity.append`；数据模型和服务端权限稳定。

| 资源 | 范围 | 产品呈现 | 需要的能力 | 目标交付等级 |
|---|---|---|---|---|
| `crm-enterprise-table` | `full-app` | 客户列表、筛选、详情与概览 | `customer.list`、`customer.create`、`opportunity.list` 等 | `integrated` |
| `crm-sales-kanban` | `page` / `flow` | 拖放销售漏斗与快捷跟进 | `opportunity.list/move-stage`、`activity.append` | `integrated` |
| `crm-mobile-first` | `full-app` | 移动端任务与客户详情 | 由其 manifest 显式声明 | `interactive-mock`（待集成） |

这些是**规划示例**，不是已经存在的交付物。看板需要 `opportunity.move-stage`，如宿主模板没有该能力，必须标记不兼容或提出经过批准的应用模板扩展；不能只修改数据库，也不能只实现一个看似成功的拖拽动画。

AI Native 也适用：同一 AI Workflow 模板可有向导式、流程画布式、任务列表式原型；共享工作流定义/执行/进度/产物服务，但不同原型对如 `workflow.edit-graph` 等能力的要求可能不同。

## 3. 两个独立维度：实现等级与验证状态

| 实现等级 `implementationLevel` | 必须具备 | 不得宣称 |
|---|---|---|
| `design-only` | 布局、交互说明、设计文件/截图 | 已连通真实数据或功能 |
| `interactive-mock` | 可交互前端 + 明确标记模拟数据/行为 | mock 交互为真实业务能力 |
| `integrated` | 真实绑定宿主服务的可运行 UI + 相关测试 | 未测试的场景均生产就绪 |

同时单独使用 `Cataloged / Verified / Release-ready` 作为资源验收状态（见 04）。例如，`design-only + Verified` 只代表设计资源检查通过，**不是**“可运行完整 SaaS”。

## 4. 原型资源元数据示例（非已实现代码）

```yaml
schemaVersion: "0.1"
kind: "prototype-resource"
id: "@foundation/prototype-crm-kanban"
name: "CRM Sales Kanban"
version: "1.0.0"
ownerTemplate:
  id: "@foundation/business-crm"
  version: "^1.0.0"
coverage:
  type: "flow"              # full-app | page | flow
  entrypoints: ["/opportunities"]
implementationLevel: "integrated"
verificationStatus: "Cataloged"  # 不声明已经验证
frameworks: ["react", "nextjs"]
requiresCapabilities:
  - "opportunity.list"
  - "opportunity.move-stage"
bindings:
  - control: "opportunityBoard"
    capability: "opportunity.list"
    effect: "read"
  - control: "moveStage"
    capability: "opportunity.move-stage"
    effect: "write"
    permission: "opportunity:update"
resources:
  design: "design/README.md"
  screens: "screens/"
  components: "src/"
  flows: "flows/"
  mockData: "fixtures/"
  sharedPatterns: ["@foundation/ui-kanban@^1.0"]
license:
  spdx: "MIT"             # 仅在有授权证明时填写
  notices: "THIRD_PARTY_NOTICES.md"
verify:
  binding: "tests/capability-binding.test.ts"
  interaction: "tests/interaction.e2e.ts"
  permissions: "tests/authorization.e2e.ts"
```

`implementationLevel` 是资源所含代码的声明（能否实际集成待验收）；`verificationStatus` 才是证据状态。对于 `design-only`，`verify.interaction` 可以不存在；对于已发布的 `integrated`，必须提供可复跑的真实集成及权限测试。`license.spdx` 不替代对设计文件、素材和第三方子目录逐项许可检查。

**目录惯例**（仅建议）：

```text
catalog/
  business-templates/crm/template.yaml
  ai-native-templates/workflow/template.yaml
  prototype-resources/
    crm-enterprise-table/manifest.yaml
    crm-sales-kanban/manifest.yaml
    workflow-wizard/manifest.yaml
packages/
  ui-patterns/              # 跨原型共享的 UI 模式，可选
```

## 5. 模板与原型的组合约束

1. **先选择应用模板**：确定业务/AI 能力、权限、数据契约与部署需求。
2. **发现候选原型**：按 `ownerTemplate`、版本、`coverage`、实现等级、技术栈过滤；可没有原型，也可以关联多个。
3. **能力检查**：所有 `requiresCapabilities` 必须由宿主模板声明且可调用，版本契约一致；缺失能力阻止“直接可运行”装配。
4. **映射检查**：用户可触发的真实动作必须有到业务服务的显式绑定；后端仍负责认证、授权、审计与事务。
5. **资源与许可检查**：设计稿、UI 套件、字体、图标、图像、演示素材需要可在目标发行方式下合法使用。
6. **隔离与安装**：生成差异预览，测试环境装配，运行测试；只有通过发布门禁的 integrated 原型才可宣传即装即用。
7. **切换与升级**：记录原型版本及迁移影响；默认不改变业务数据库、权限模型或 API。确需扩展则提出显式的领域契约变更。

**原则**：原型可以有不同交互流程，但不可以绕过业务动作审计或自行持有“另一套真实业务数据库”。跨技术栈原型是否可直接切换取决于集成成本，不做无限兼容承诺。

## 6. 测试与验收矩阵

| 检查 | Design-only | Interactive-mock | Integrated |
|---|---|---|---|
| 设计文件/资源可读、资产许可 | 必须 | 必须 | 必须 |
| 交互/流程说明一致 | 必须 | 必须 | 必须 |
| Mock 行为标识 | 不适用 | 必须 | 如有 mock 必须标识 |
| `requiresCapabilities` 解析 | 可声明 | 必须声明 | 强制校验 |
| 真正 API binding / 权限 E2E | 不适用 | 不适用 | 必须 |
| 原型切换不改领域核心 | 设计审查 | 模拟对照 | 两原型完整回归 |

**首个业务模板的商业级证明**：至少 2 个已集成原型，在同一个锁定应用模板版本上运行，并具备**可比较的共同覆盖范围**（例如都覆盖商机列表页）；统一 capability registry 下分别通过对应页面/流程的 E2E 与越权负向用例；在共同覆盖范围内切换时领域服务/Schema 无未声明变更，数据保持一致；报告差异与成本。某个原型只是部分覆盖时，只对其明确覆盖的页面/流程保证可用，不得宣传能整体替换另一个完整原型。

**AI Native 第一版**：先有一个生产级 integrated 原型也可以发布，但其 schema/manifest 应支持追加第 N 个原型；没有第二个实例就不宣称“多原型切换已实测”。

## 7. Agent 使用提示与输出要求

Agent 收到“给现有应用换一种设计/交互”的任务，应先判断是替换原型、组合 UI Pattern、还是新增业务能力；不能默认重做业务后端。

输出至少包含：`selectedTemplate`、`selectedPrototype`、`coverage`、`requiredCapabilities`、`bindingResult`、`licenseResult`、`mock/live status`、测试证据与切换风险。信息缺失标 `UNKNOWN/BLOCKED`，不推断兼容。

**Phase 0 当前只应完成资源审计和候选评估，不能创建新业务实现或擅自引入第三方受限设计资产。**
