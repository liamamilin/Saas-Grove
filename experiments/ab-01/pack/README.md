# ab-01 评测包（冻结）

- `suites/*/s4/`：留出测试（H1*/H2*：contract 桶与 spec 桶，三位免费/付费作者）和功能流程（J1：界面流程 F1–F10；J2：接口层流程 G11–G16）。运行时放进蓝图验收项目的 `tests/s4/`（辅助库见 `blueprints/ai-research-assistant/acceptance/lib/`）。
- `exclude.json`：独立裁决员（看不到产品代码，不看别的产品的结果）在参考实现 `REF-pro`（deepseek-v4-pro，B+T，不进评分）上判定为测试写错/不明确而剔除的 16 条。
- `adjudication.json`：17 条参考实现上失败的留出测试的逐条裁定。
- J1/J2 的作者是 minimax-m3；J1 的 F7 经裁决后改写，F9 在参考实现上失败，裁定为产品缺陷，保留。
- 打分：`node harness/eval.mjs score --suites … --runs … --out … --exclude exclude.json`。
- 已知局限：留出测试与可见验收、流程与留出 contract 测试之间的去重标注还没做；参考实现与评分产品同属 DeepSeek 家族。
