独立验收没有通过（阶段 {{stage}}，第 {{attempt}} 次验收）。验收用的是模板原件，不是你目录里的副本。

失败的测试（{{failedCount}} 条）：
{{failures}}

应用日志末尾：
```
{{appLog}}
```

请修复这些问题，然后自己在 `app/` 里重跑 `node ../blueprint/acceptance/run.mjs --app . --stage {{stage}}` 确认通过，再结束。不要修改任何测试；如果你认为某条测试本身有错，写进 `app/QUESTIONS.md` 并说明理由。
