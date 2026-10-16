# Factory V1.1 · 机器可读规范的边界

提供 6 份 JSON Schema、6 份样例和 2 个运行脚本。需要 Python 3.10+ 与 `jsonschema>=4`。

```bash
python scripts/validate_examples.py
python -m unittest discover -s tests -v
```

`schemas/gate-profile.schema.json` 与 `schemas/scoped-attestation.schema.json` 定义范围化认证；`scripts/validate_attestation.py` 提供元数据一致性示例。正面测试中使用的是**合成 PASS 记录**，不代表实际执行过任何软件测试或具备签字授权。

这两套检查只能发现形状与部分跨文档不变量错误，无法证明签名是真实的、日志没有被篡改、开源许可证允许分发、沙箱真正隔离、支付或 AI 调用真实成功。正式发行必须由真正独立的测试系统和人工审批完成。

`example.invalid`、`UNBUILT`、`NOT_RUN` 全部是刻意使用的演示占位值，不能用作真实来源或认证材料。
