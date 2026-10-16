# 11 — 初始研究与证据登记

**时点**：2026-10-16。以下来源为公开页面核对结果；不代表已克隆运行上游仓库，也不替代基于固定 commit 的 Phase 0 审计。

| 编号 | 事实/待核查 | 初始公开来源 | 初步状态 |
|---|---|---|---|
| R-01 | next-forge 定位为生产级 Next.js/Turborepo 起点，含 web/app/api/docs/email/storybook 及共享包 | https://github.com/vercel/next-forge | DOCUMENTED，未实测 |
| R-02 | 仓库 `license.md` 为 MIT，版权标注 `Copyright (c) 2025 Vercel` | https://github.com/vercel/next-forge/blob/main/license.md | DOCUMENTED；依赖待审 |
| R-03 | 官方文档描述 apps 独立部署、packages 共享、边界检查 | https://www.next-forge.com/docs/structure | DOCUMENTED，待代码核查 |
| R-04 | 官方当前 Quickstart：基本启动需要 Clerk 与 PostgreSQL；Stripe 等按需配置 | https://www.next-forge.com/docs/setup/quickstart | DOCUMENTED，待测试 |
| R-05 | 官方 Payments 文档以 Stripe 为默认，含 Webhook 基础能力 | https://www.next-forge.com/docs/packages/payments | DOCUMENTED，不等于完整 Billing |
| R-06 | 上游网页显示 `package.json` 版本 6.0.2；需要以实际 git SHA/tags 锁定 | https://github.com/vercel/next-forge/blob/main/package.json | SNAPSHOT，必须重核 |
| R-07 | 支付宝官方 Node.js SDK 可用 MIT；提供请求签名与验签能力 | https://github.com/alipay/alipay-sdk-nodejs-all | DOCUMENTED，未实测 |
| R-08 | 微信支付 APIv3 有签名、验签、解密、查单/回调规范 | https://pay.wechatpay.cn/doc/v3/merchant/4012365342 | DOCUMENTED，商户资格未知 |
| R-09 | 微信支付 JSAPI 接入需要下单、拉起、查单及成功通知 | https://pay.wechatpay.cn/doc/v3/merchant/4012791870 | DOCUMENTED，场景需确认 |
| R-10 | next-forge 与 AI SDK/Agent 层的具体能力边界需以代码为准 | https://github.com/vercel/next-forge/tree/main/packages | TO AUDIT |

## 后续候选资源（仅进入评估队列，未通过许可证筛选）

| 分类 | 项目 | 评估重点 |
|---|---|---|
| SaaS 备选底座 | Next.js SaaS Starter | 功能范围、依赖、上游维护、MIT 源文件 |
| SaaS 备选底座 | Open SaaS / Wasp | 开发框架约束、商业扩展成本 |
| AI UI | assistant-ui | Chat UI、license、可复用边界 |
| AI Copilot | CopilotKit | SDK + UI、Agent 操作、人类审批，子目录授权 |
| AI 路由 | LiteLLM / Vercel AI SDK | 路由/流式/成本归属、实际依赖 |
| 业务模板 | 各类 CRM、项目管理、知识库 | Fork 与 Integration，尤其 Copyleft/品牌条款 |

## 本次设计修订（不是外部事实）

- D-01：Business SaaS 与 AI Native 应用模板支持 `prototypeResources: 0..N`，原型为其子资源，不新增第五条产品线。
- D-02：原型实现分级与资产成熟度独立；通过能力标识与 binding 连接真实业务，不能把 mock 当成 live。
- D-03：业务 UI 可使用共享 UI Pattern，但原型必须显式声明应用模板的兼容范围及引用素材的许可。
- D-04：正式采用这些规则前，应在 Phase 0 盘点真实原型候选与潜在许可限制；Phase 5 验证同一业务模板的两个完整绑定原型。详见 `12_PROTOTYPE_RESOURCE_SPEC.md`。

## 调研方法

`官方代码/许可证 > 官方文档 > 官方发布记录 > 第三方评价`。每项结论记录检索日期、链接、版本、证据路径、可信程度和阻断项。不要把文档所述特性直接写成测试 PASS。

## 关键未知与阻断

1. next-forge 的具体 commit、依赖许可证、部署/集成实际可用性。
2. 国内支付所需商户资质、可申请渠道、真实测试环境与地域要求。
3. 用户最需要的首个 Business SaaS 模板及开源可商用选择。
4. 首批 AI Workflow 与 AI Copilot 实际复用收益。
5. 最终品牌名称、商业授权及对外支持条款。
6. 可商用、可重新分发的原型设计资产与 UI 套件候选；两种原型共用业务核心所需适配成本。
