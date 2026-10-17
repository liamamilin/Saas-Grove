# A 组 A-ab01：S4 放行时的数字（冻结）

这是 A 组在 **S4 人工确认点**（放行之前、集中修 backlog 之前）的成绩，作为与 B 组比较的依据。之后的"集中修一轮"不计入这组数字；B 组只评分一次、没有修复轮，所以修复轮要单独记，不和这组混在一起。

- 冻结时间：2026-10-17
- 验收：S4 阶段 63/63（harness 用模板原件重验，S1–S4 累计）；每个阶段第一次验收就全过，S1 因人工反馈多做了一轮（S1-a2）
- 人工介入：批准 3 次（S1、S2、S3），反馈 1 次（S1），S4 的批准在冻结之后
- 独立审查：5 次（S1×2、S2、S3、S4），S4 审查报告 `records/reviews/S4-r1.md`

## STATUS.md 原文

# Run A-ab01

- kind: template
- attempts allowed per stage: 6
- blueprint: ai-research-assistant
- phase: **checkpoint** (stage S4)
- agent turns: 10 (builder 5, reviewer 5)
- agent time: 221.2 min; verification time: 2.3 min
- tokens: input 1062022, output 336223, reasoning 734136, cache read 122613504
- turns whose token usage could not be read: 0
- human approvals: 3; human feedback rounds (interventions): 1

| verification | stage | passed | failed | started |
|---|---|---|---|---|
| S1-a1 | S1 | 21 | 0 | yes |
| S1-reverify-sandboxed | S1 | 21 | 0 | yes |
| S1-a2 | S1 | 21 | 0 | yes |
| S2-a1 | S2 | 43 | 0 | yes |
| S3-a1 | S3 | 53 | 0 | yes |
| S4-a1 | S4 | 63 | 0 | yes |

## 逐轮耗时与 token（分钟 / token）

| 轮次 | 角色 | 分钟 | input | output | reasoning |
|---|---|---|---|---|---|
| S1-build-1 | builder | 18.2 | 90901 | 48745 | 35493 |
| S1-review-1 | reviewer | 3.1 | 47715 | 4182 | 14772 |
| S1-build-2 | builder | 16.3 | 26582 | 25313 | 72128 |
| S1-review-2 | reviewer | 7.0 | 72845 | 7295 | 33386 |
| S2-build-1 | builder | 48.0 | 169740 | 71638 | 178788 |
| S2-review-1 | reviewer | 8.1 | 86526 | 5940 | 37049 |
| S3-build-1 | builder | 32.3 | 163609 | 51579 | 151582 |
| S3-review-1 | reviewer | 4.0 | 67083 | 5271 | 12231 |
| S4-build-1 | builder | 71.3 | 242114 | 108176 | 143196 |
| S4-review-1 | reviewer | 13.0 | 94907 | 8084 | 55511 |

## 集中修复轮之后的最终数字（A 组全部结束，2026-10-18）

上面是放行 S4 之前的冻结数字，是与 B 组比较的主要依据。下面是加上集中修复轮之后的总数，单独列出，因为 B 组没有修复轮：

- agent 用时 283.0 分钟（修复轮：builder 47.6 分钟 + reviewer 14.2 分钟）；验收用时 3.1 分钟
- token：input 1,280,956 / output 431,824 / reasoning 812,860 / cache read 203,943,552
- 人工：放行 5 次（S1、S2、S3、S4、修复轮），反馈 2 次（S1 的 4 条审查意见、集中修复轮的 backlog 清单）
- 修复轮后的复审（`S4-r2.md`）又发现 4 条新问题，其中 1 条高（修复轮自己引入的回归）、1 条中；用户决定不再追加修复轮，记入 backlog 24–27
