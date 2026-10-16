# 11 — Batch Orchestrator：批量调度与止损

## 先计划，后执行

BatchPlan 必须声明：`batchId`、锁定 `catalogRevision`、选中的 `targetIds[]`、并发上限、预算、重试/超时、执行模式、依赖图、审批策略、风险分类和停止条件。

启动前生成 **Batch Preview**：每个目标需发现什么、许可状态、是否可自动执行、预估依赖、测试资源与外部调用成本。默认 `dryRun=true`；未经批准不启动写入型任务。

## 调度原则

- **发现阶段可宽并发，代码执行阶段严格限额**；每条生产线可以设独立并发，避免下载/构建干扰服务。
- 按依赖 DAG 启动：例如 Billing Core 与 Provider Adapter，先验可复用公共契约再并行提供商适配；循环依赖必须阻断。
- 按风险设置类别：`READ_ONLY`、`SANDBOX_CODE`、`EXTERNAL_SANDBOX_API`、`PRODUCTION_SENSITIVE`，最后一类不得在通用批量任务中自动运行。
- 每资源独立 workspace/checkpoint/预算；不得共享可写数据库或真实凭证。
- 使用稳定 `jobId/attemptId/idempotencyKey`、原子状态提交、租约/心跳与超时恢复，确保 worker 崩溃后不会重复发布或重放不可幂等的真实动作；同一个 artifact/version 的 Registry promotion 必须唯一。
- 将 `maxSpend`、外部 API 限额、构建资源成本设为独立预算池；抢占/取消必须保留必要审计日志与 checkpoint。
- 每批和每任务设 `maxSpend`、`maxAttempts`、`maxRuntime`、`maxStorage`；资源耗尽必须停止并可恢复，不凭 LLM 判断继续无限循环。

## 故障与重试

- 临时外部网络问题：有限指数退避，重新执行前检查幂等性。
- 构建依赖冲突：首次记录根因；超过重试阈值转人工，不自动任意升级关键包。
- 测试失败：保留原日志与 diff，返工另建 attempt；不得删测例换 PASS。
- 许可未知或关键安全风险：立即阻断当前候选/任务，可能改选备选来源，但必须重审。
- 单个 Job 失败不得自动取消同批其他独立 Job；发现共享核心污染风险则暂停整个依赖子图。

## 生产成功的定义

不是“本批发布了 X 个包”，而是：实际入库数、各等级分布、成功独立安装率、跨项目复用成功率、误报/漏报缺陷、单位制品成本、升级与维护成本、阻断和拒绝原因。

不要用流水线进度百分比伪装通过度；展示阶段和 Gate 真实状态。

## 实施节奏

第一版用 `catalog.json + CLI/任务文件 + Agent Harness + 测试脚本 + 人工批准`；至少完成三类试生产，再决定是否建设可视化 Orchestrator、持久任务调度、门户或付费版工厂功能。所有自动化前先证明基本状态机、隔离与 Gate 能抓住负向用例。
