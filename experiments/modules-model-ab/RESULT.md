# 模块模板生成：minimax-m3.1-flash-free vs deepseek-v4.1-flash（单模块、单样本）

模块 rate-limiting，同一提示词（`harness/modules.mjs`，2026-10-21 版），生成后交给同一个 Claude 子代理盲评（不告知来源；X=minimax，Y=deepseek）。

| | minimax (X) | deepseek (Y) |
|---|---|---|
| 生成用时 | 24 分钟 | 6 分钟 |
| 阻断 / 应修 / 建议 | 2 / 7 / 4 | 4 / 8 / 4 |
| 对非专家 agent 的可用性 | 4/5 | 3/5 |

裁决：minimax 明显更好（约一档）。deepseek 的阻断是结构性的（用例互斥：没有任何窗口算法能全部通过；TEST_MODE 下业务行为与生产不同，使生产路径测不到；键定义与用例矛盾；判定顺序矛盾），minimax 的两处是局部的（缺一个概念、窗口语义不统一）。

局限：一个模块、一次生成、一位评审者；deepseek 快 4 倍。不能推广为"minimax 总是更好"，只说明"免费模型不是主要问题"：付费 flash 并没有更少的缺陷。两份都漏了 IPv6 /64 聚合和能识别固定窗口的用例，说明这类缺口与模型无关，靠独立审查补。
