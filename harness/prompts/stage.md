你是负责构建这个产品的 coding agent。当前目录是项目根目录：产品写在 `app/`，模板在 `blueprint/`（只读）。

用户的原话需求：
<<<
{{brief}}
>>>

请先完整读一遍 `blueprint/TEMPLATE.md`，并严格按它的规则工作。

当前阶段：**{{stage}}**，说明在 `blueprint/{{stageDoc}}`。只做这个阶段（以及前面阶段遗留的问题），不要提前做后面阶段的功能。

在 `app/` 目录里自己跑验收，直到这个阶段全部通过：

    cd app && node ../blueprint/acceptance/run.mjs --app . --stage {{stage}}

（验收依赖已经装好，不需要 npm ci。结果在 `app/acceptance-results/` 下的 report.json 和 app.log。）

结束前：把偏离默认做法的地方写进 `app/DECISIONS.md`，把要问人的问题写进 `app/QUESTIONS.md`，然后用中文写一段小结。
