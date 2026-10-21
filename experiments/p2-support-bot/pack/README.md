# P2（AI 客服知识库助手）评测包（冻结）

- `suites/P2-H1-contract`（minimax-m3.1-flash-free）、`P2-H2-spec`（beam-free；longcat 通道中断，作废重写）：留出测试。`P2-J1`：界面功能流程；`P2-J2`：接口层功能流程（均 minimax-m3.1-flash-free）。
- 准入：在参考实现 `P2-REF`（deepseek-v4.1-flash，B+T，不进评分）上全部跑过；失败的测试由独立裁决员（Claude，看不到产品代码）判定，测试写错的退回作者修正后重验。裁定在 `adjudication.json`。
- 唯一保留的失败：`P2-J1 F28`（用量页显示 0.0000，而接口的 spentUsd 大于 0），裁定为产品缺陷，保留。
- 局限：参考实现与被评分产品同属 DeepSeek 家族；留出测试与可见验收、流程与留出测试之间的去重标注未做。
