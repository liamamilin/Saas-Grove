# 17 — Immutable Release：修复“验收后打包”的证据缺口

## V1.0 的冲突

旧流程 `VALIDATE → APPROVE → PACKAGE`，但 Evidence 必须包含 `artifactSha256`。若打包后修改 README、Notices、依赖或源码，最终摘要与测试对象不同，已通过的 Gate 无法证明新制品质量。

## V1.1 的不可违反顺序

1. `BUILD/CALIBRATE`：隔离改造、测试前期调试；可多次迭代，每次保留 attempt。
2. `PACKAGE_CANDIDATE` / `STAGING_ARTIFACT`：产生完整安装/分发 payload（源码或二进制、manifest payload 视图、锁文件、许可证/NOTICE、SBOM、安装说明），计算内容 digest，置为只读。
3. `VALIDATE`：Validator 在隔离环境中从**相同 digest 的 payload** 安装和测试；每条 Evidence 都引用该 digest 和 scope。
4. `APPROVE`：Validator 汇总 Gate；独立 Reviewer 检查许可证、安全与残余风险；Release Approver 按 digest+scope+profile 批准。
5. `PUBLISH`：仓储只上传相同 payload 字节，使用**独立 release envelope** 附签名、认证、SKU、权限与 registry 索引。不得回写已通过验收的 payload。
6. `RECHECK`：下载后重新哈希、必要时重新安装，证明交付仍是经过验证的 payload。

## 验收失败如何返工

从 `VALIDATING` 发现错误后回到独立修复 attempt；老 payload、老测试与失败日志保留供审计，新改动创建新 digest。与老 digest 绑定的 PASS 不允许自动证明新 digest 合格。重新进入 STAGING_ARTIFACT 再测试；不得简单修改日志状态。

## 幂等与重试

`registryKey = resourceId@resourceVersion + artifactSha256`；相同 key 重试允许返回同一结果；同一 resourceId@version 但不同 digest 是**版本冲突**，不得静默覆盖。事故响应可以隔离特定 digest，不擦除既有历史签发记录。

## 数据边界

认证和商品许可元数据放 detached envelope；用户下载时可附带单独的证书/NOTICE 索引，但不能让这一步修改待测试的原 payload。若发行方要求分发物本身包含签名文件，则应在 STAGING_ARTIFACT 时完成签名并对最终字节整体重复校验。
