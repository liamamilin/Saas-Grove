# S4 API 旅程清单（没有 UI 锚点的用户可见功能）

判定标准：`brief/contract/testability.md` §8 列出的 `data-testid` 覆盖到的界面功能由 UI 旅程负责
（注册、登录、建工作区、粘贴文本建资料、资料列表与状态、后台预览问答、转人工列表、分析页的
「没答上来的问题」与「本月花费」、嵌入式小窗的问答/引用/转人工表单）；
下面每一条在 §8 里都**没有**对应的 `data-testid`，浏览器里没有入口，只能用 HTTP API 驱动，
因此每条写一个端到端 API 旅程。每个旅程自己建用户和工作区，只依赖 `brief/contract/api.yaml`
与 `brief/contract/testability.md` 里写明的行为。

1. G1 退出登录：会话在服务端作废，旧 Cookie 立刻失效 —— `journey-api-G1-logout.test.ts`
2. G2 忘记密码：申请重置邮件、用令牌换新密码；旧密码与旧会话一起失效，令牌一次性 —— `journey-api-G2-password-reset.test.ts`
3. G3 邀请同事：管理员/所有者发邀请邮件，被邀请人用令牌加入工作区并拿到角色 —— `journey-api-G3-invite-member.test.ts`
4. G4 邀请令牌的归属与一次性：别人拿着令牌进不来，令牌不能用第二次 —— `journey-api-G4-invitation-token-binding.test.ts`
5. G5 改成员角色：只有所有者能改，改完角色立刻生效 —— `journey-api-G5-change-role.test.ts`
6. G6 移除成员：管理员不能删所有者、最后一个所有者不能被删；被移除的人再也进不来 —— `journey-api-G6-remove-member.test.ts`
7. G7 删除工作区：只有所有者能删，删完工作区里的一切对所有人不可达 —— `journey-api-G7-delete-workspace.test.ts`
8. G8 上传资料文件：`.md`/`.pdf`/`.docx`/`.html` 上传后能取出抽取出的正文；读不出来的文件记为 `failed`（`unreadable`），HTML 只留可见文字；不支持的类型 415、超过 10 MB 413 —— `journey-api-G8-upload-document-file.test.ts`
9. G9 删除资料：删除后它立刻不再参与回答 —— `journey-api-G9-delete-document.test.ts`
10. G10 小窗设置：任何成员能读，只有管理员/所有者能改；字段校验、没传的字段保持原值 —— `journey-api-G10-widget-settings.test.ts`
11. G11 轮换小窗密钥：新密钥立刻生效，旧密钥在小窗的每个接口上都 404 —— `journey-api-G11-rotate-widget-key.test.ts`
12. G12 小窗公开接口的来源与 CORS：只认白名单里的来源（没带 Origin 也被拒），回显 `Access-Control-Allow-Origin` 与 `Vary: Origin`，预检 OPTIONS —— `journey-api-G12-widget-origin-cors.test.ts`
13. G13 访客令牌保护会话：没有令牌 401，别人的令牌 404 —— `journey-api-G13-visitor-token.test.ts`
14. G14 转人工通知：访客转人工后每个成员都收到 `handoff` 邮件，会话状态变成 `handed_off`，同一个会话只能转一次 —— `journey-api-G14-handoff-notification.test.ts`
15. G15 处理转人工：列出/筛选转人工、看详情（含整个会话）、标记已解决与重新打开 —— `journey-api-G15-resolve-handoff.test.ts`
16. G16 给回答评分：`up`/`down`，再评一次就替换，给自己的问题评分 400 —— `journey-api-G16-answer-feedback.test.ts`
17. G17 设置月度预算：管理员/所有者能设、`null` 表示不限、新工作区默认 10、负数 400 —— `journey-api-G17-set-budget.test.ts`
18. G18 预算提醒与耗尽邮件：花到预算的 80% 提醒一次，预算付不起时提醒耗尽一次，每月各只发一次 —— `journey-api-G18-budget-emails.test.ts`
19. G19 预算硬停：预算付不起时不再调用模型，直接兜底回答，花费不超预算 —— `journey-api-G19-budget-hard-stop.test.ts`
20. G20 答不出来时的兜底回答：知识库答不上来（以及知识库为空）时给兜底文案、不给引用、不给错误 —— `journey-api-G20-fallback-answer.test.ts`
21. G21 模型出故障时的重试与兜底：可重试的错误最多试 3 次并退避，每次尝试一条用量记录，不可重试的错误不重试、直接兜底 —— `journey-api-G21-model-retry.test.ts`
22. G22 限流：一个会话每分钟最多 10 个问题、一个密钥每小时最多 30 个新会话，超了 429 —— `journey-api-G22-rate-limits.test.ts`
23. G23 工作区里的会话：列表、详情（消息按时间正序）、删除会话后从各处消失、访客令牌失效 —— `journey-api-G23-conversations.test.ts`
24. G24 审计事件：邀请/加入/改角色/移除/改预算/删资料/改小窗/轮换密钥/删会话都留痕，最新的在最前面 —— `journey-api-G24-audit-events.test.ts`
25. G25 导出工作区：成员、资料正文、小窗设置、会话与消息、转人工、用量一次导出，且不带出任何密钥 —— `journey-api-G25-export-workspace.test.ts`
26. G26 嵌入代码与 `/widget.js`：嵌入片段恰好一个 `<script>` 标签并带上小窗密钥，脚本可取 —— `journey-api-G26-embed-snippet.test.ts`
27. G27 本月统计口径：会话数/提问数/答上来/没答上来/转人工的数字与实际一致 —— `journey-api-G27-analytics-summary.test.ts`
28. G28 工作区之间互相看不见：不是成员就是 404，别的路径也拿不到本工作区的资料与会话 —— `journey-api-G28-workspace-isolation.test.ts`
