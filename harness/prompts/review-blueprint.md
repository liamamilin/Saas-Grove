请独立审查 `blueprint/` 这份模板（验收测试和 spec）的 **v0.2 改动**。`CHANGES.diff` 是从 v0.1.0 到现在的全部差异；改动的原因见 `CHANGES-WHY.md`。你只读，不执行，也不修改任何文件。

这份模板的使用方式：构建者（一个 coding agent）照着它做出产品，产品用 `blueprint/acceptance/` 里的黑盒测试验收。我们还会做对照实验：一组构建者**只拿到** `spec/api.yaml` 和 `spec/architecture.md` 的 §5–§9（可测性契约）加测试，没有其他 spec。所以，**任何测试强制的规则，必须写在这部分里**，否则对那一组不公平。

重点检查：
1. **公平性**：新增或改动的测试强制了哪些规则？它们是否都写在 `api.yaml` 或 `architecture.md` §5–§9 里？
2. **空洞**：测试能否被一个什么也没做的实现（或空应用）通过？有没有"找不到东西就当通过"的路径？
3. **脆弱或误报**：测试有没有依赖 spec 没规定的实现细节？一个合法的实现会不会被误判？重点看 `acceptance/tests/s1/security.test.ts` 与 `acceptance/lib/db.ts`（直接扫描数据库）、`acceptance/tests/s2/jobs.test.ts` 里新增的"取消时中止在途调用"那条（时序是否稳健）。
4. **漏洞**：`security.test.ts` 有没有明显的绕过办法（例如把令牌编码一下再存、把令牌放进别的表）？SQL 拼接有没有风险？
5. **一致性**：`stages/*.md`、`template.json`（`testCount`）、`TEMPLATE.md`、`spec/*` 之间有没有互相矛盾，或者与实际测试数量不符。
6. `spec/review-checklist.md` 有没有不准确、会让审查员误报的条目。

每条写清：文件:行号、问题是什么、为什么重要、建议怎么改。按严重程度排序，只报告有证据的问题；没有发现就明确说没有。中文，1000 字以内。
