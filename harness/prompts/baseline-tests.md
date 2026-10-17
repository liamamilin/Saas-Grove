用户的原话需求：
<<<
{{brief}}
>>>

请在当前目录的 `app/` 里把这个产品做出来，一直做到你认为它已经成熟、可以交给团队真实使用为止。

另外，为了能用自动化方式给你做出来的产品打分，`brief/contract/` 里有两份**测试接口约定**：`api.yaml`（接口路径、字段和错误码）和 `testability.md`（假模型、测试专用接口、启动脚本、界面上的 data-testid）。它们只是约定，不是需求说明；产品必须遵守，评分时会用到。

评分用的**验收测试套件**就在 `blueprint/acceptance/`（黑盒测试，共 63 条），你可以自己运行它来检查产品：

    cd app && node ../blueprint/acceptance/run.mjs --app . --stage S4

（验收依赖已经装好，不需要 npm ci。结果在 `app/acceptance-results/` 下的 report.json 和 app.log。`--stage S1` 到 `S4` 是累计的，可以只跑前面几段。）

验收全部通过、并且你认为产品已经成熟，就在回复的最后一行单独写 `DONE`。
