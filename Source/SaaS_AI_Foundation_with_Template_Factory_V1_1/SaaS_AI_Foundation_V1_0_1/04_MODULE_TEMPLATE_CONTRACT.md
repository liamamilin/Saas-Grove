# 04 — 模块与模板规范（Contract V0.1）

## 1. 基本对象

- **Module**：单一可复用能力，提供稳定接口和可运行测试。
- **Template**：组合 modules + 业务代码，形成可运行的完整应用；可关联 0..N 个原型资源。
- **Prototype Resource**：附属于一个 Business SaaS / AI Native 应用模板的设计、交互或已集成前端实现；声明覆盖范围、能力依赖、版本与资产许可，不独立构成 SaaS 产品。
- **UI Pattern**：可跨原型与跨应用复用的通用页面、组件及交互模式，引用时仍需能力绑定。
- **Adapter**：把现有系统数据、权限、动作映射到模块接口。
- **Provider**：模型、支付、存储等供应商实现；要有能力矩阵。
- **Example**：证明某组合可以实际启动与通过测试的验收样本。

模块必须有 `manifest`、README、样例配置、API contract、测试、版本迁移、许可证资料。不能只有 `npm install` 字样。

应用模板需要额外维护 `prototypeResources: [prototypeId@versionRange]`（可为空）或等价的可查询关联索引；原型资源使用独立 manifest 并在注册时验证双向一致性。原型协议详情见 [`12_PROTOTYPE_RESOURCE_SPEC.md`](12_PROTOTYPE_RESOURCE_SPEC.md)。

## 2. 参考 manifest（规划示意，不是现存软件实现）

```yaml
schemaVersion: "0.1"
id: "@foundation/ai-copilot"
name: "AI Copilot"
kind: "saas-ai-module"
version: "0.1.0"
license:
  spdx: "MIT"
  copyrightFile: "THIRD_PARTY_NOTICES.md"
origin:
  type: "first-party"
  sourceUrl: null
compatibility:
  runtime: ["node>=20"]
  framework: ["nextjs>=15"]
  apiContract: "copilot-adapter@0.1"
requires:
  modules: ["@foundation/ai-runtime@^0.1"]
  services: ["postgres"]
  env: ["MODEL_PROVIDER_API_KEY"]
capabilities:
  provides: ["chat", "tool-call", "human-confirmation"]
  dataAccess: ["read-via-adapter"]
  sideEffects: ["tool-actions-require-approval"]
install:
  guide: "docs/install.md"
  migrationPlan: "migrations/README.md"
verify:
  unit: "bun run test"
  integration: "bun run test:integration"
  acceptance: "docs/acceptance.md"
```

解释：license 只是声明，**不能自行声称第三方代码归我们所有**。`install.guide` 初期为可审查说明，先不要设计完全自动且无限权限的安装器。

## 3. 原型绑定示例（概念约束）

```yaml
# catalog/business-templates/crm/template.yaml
id: "@foundation/business-crm"
version: "1.0.0"
capabilities: ["customer.list", "customer.create", "opportunity.list", "opportunity.move-stage", "activity.append"]
prototypeResources:
  - id: "@foundation/prototype-crm-table"
    version: "^1.0.0"
  - id: "@foundation/prototype-crm-kanban"
    version: "^1.0.0"
```

原型通过 `requiresCapabilities` 和 `bindings` 连接上述业务能力；缺少能力、绑定或许可资料不得自动视为兼容。此处是假设性的架构示例，不是已实现模块。

## 4. 核心 API 契约

### SaaS + AI Adapter

```ts
type ActorContext = {
  principalId: string;
  tenantId: string;
  grantedScopes: string[];  // derived server-side, never trusted from client
  requestId: string;
};

type ToolSpec = {
  name: string;
  inputSchema: unknown;
  effect: 'read' | 'write' | 'destructive' | 'external';
  requiresApproval: boolean;
};

interface BusinessAIAdapter {
  getContext(actor: ActorContext, resourceId?: string): Promise<unknown>;
  listTools(actor: ActorContext): Promise<ToolSpec[]>;
  executeTool(actor: ActorContext, name: string, input: unknown,
              approvalToken?: string): Promise<unknown>;
}
```

**约束**：认证与授权发生在每一次 `executeTool` 的服务端；`requiresApproval` 只是声明，真正的审批 Token 应由可信审批服务签发、绑定用户/动作/参数/期限并防重放。

### Payment Provider

```ts
type PaymentCapability =
  | 'one_time' | 'refund' | 'subscription' | 'query' | 'reconciliation';

interface PaymentProvider {
  capabilities(): PaymentCapability[];
  createPayment(input: unknown, idempotencyKey: string): Promise<unknown>;
  queryPayment(providerOrderId: string): Promise<unknown>;
  verifyWebhook(rawBody: Uint8Array, headers: Record<string, string>): Promise<unknown>;
  refund?(input: unknown, idempotencyKey: string): Promise<unknown>;
}
```

**重要**：以上是概念接口；具体签名校验、订阅协议和退款行为按渠道实现，不能把 `capabilities()` 当成许可证/商户资质自动授予。

## 5. 版本与兼容性

- 使用语义化版本管理公共接口；不稳定 contract 标 `experimental`。
- 模块 manifest 明确 `runtime`、`framework`、`apiContract`、`services` 与 upstream 依赖。
- 重大变更必须含迁移指南、breaking changes、自动测试。
- 模板锁定已验证依赖版本；不使用无限制 `latest` 作为生产默认。
- 替换 Provider 不得改变 Billing Core 的订单和账本不变量。
- 原型独立版本化并记录兼容应用模板的版本区间；不同原型的可运行成熟度与资源许可证独立审计。
- 只换兼容原型不能无提示更改业务模型、租户边界或业务服务接口；若能力契约确需升级，按模板 breaking change 处理。

## 6. Agent 的使用协议

`discover → inspect → choose-template/prototype → capability-binding-check → plan → license-check → dry-run → human-approve → install → verify → report`。

必须输出：新增/修改文件清单、许可证/第三方服务变化、配置项、测试结果、剩余限制、回滚说明。失败不能伪装成功；不能越权修改用户既有生产配置。

## 7. 三层完成定义

- **Cataloged**：资料完整但未运行；展示为「待验证资源」。
- **Verified**：在指定环境通过独立安装及验收。
- **Release-ready**：通过安全、许可、文档、升级及支持门禁。

不得把 Cataloged 或 Verified 对外标称为生产就绪。

**注意两个独立维度**：原型的实现层级（`design-only / interactive-mock / integrated`）和资产的验证状态（`Cataloged / Verified / Release-ready`）不得混淆；设计稿即使文件通过检查，也不能宣称具有真实业务能力。
