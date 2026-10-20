# S4 成熟化：运营分析、对话记录、审计、导出、删除、嵌入

**目标**：补齐客户真正用起来之后一定会需要的能力。看得到访客问了什么、哪些没答上来；敏感操作有据可查；数据能完整带走；删除的东西真的删掉了；小窗能一行代码挂到客户网站上，key 泄露了能换。

## 范围

- 运营分析：`GET /analytics/summary`（本月对话数、问题数、答上/没答上的数量、转人工数、花费）；`GET /analytics/questions`（按时间倒序，可以只看没答上的，每条带 `reason`：`no_answer`、`model_error`、`budget_exceeded`）。所有成员可看。
- 对话记录：`GET /conversations`、`GET /conversations/{id}`（带完整消息、引用、评价、`reason`）；`DELETE`（admin/owner）后对话、它的消息和访客联系方式都不可访问，访客令牌也失效。
- 审计日志：`member.invited`、`member.joined`、`member.role_changed`、`member.removed`、`budget.updated`、`document.deleted`、`widget.updated`、`widget.key_rotated`、`conversation.deleted`、`export.created`，带操作人，按时间倒序；只有 admin/owner 能看。
- 导出：`GET /export`（admin/owner）导出成员、资料（含文本）、小窗设置、对话（含消息和联系方式，decisions H11）、转人工和用量记录；**不包含**任何密码、哈希、会话令牌、邀请令牌、访客令牌，也不包含其他工作区的数据。
- 删除资料：上传者或 admin/owner；删除后立即不再出现在列表里、不再被用来回答。
- 删除工作区：只有 owner；之后工作区内的一切（包括小窗公开接口）对所有人 404；成员账号不受影响。
- 更换 widget key：`POST /widget/rotate-key`（admin/owner）；旧 key 立即失效。
- 嵌入：`embedSnippet` 是一行 `<script src="<APP_BASE_URL>/widget.js" data-widget-key="<key>" async></script>`；`/widget.js` 在宿主页面的 DOM（或开放的 shadow DOM）里渲染小窗，**不用 iframe**（§4.5），请求直接从客户网站的 Origin 发出。
- 界面：嵌入在客户网站上的小窗（提问、出处、转人工）、转人工列表页、分析页（没答上的问题、本月花费）。

## 验收（`acceptance/tests/s4/`，共 14 条）

分析（2）：本月汇总对所有成员可见且数字正确；问题列表按时间倒序，没答上的问题带正确的原因。

对话（2）：团队能看到每个对话和完整记录；admin 删除对话后，团队和访客都读不到了。

治理（6）：审计事件齐全、有操作人、按时间倒序；member 看不到审计日志；导出内容完整且不含任何敏感字段；删除的资料立即不再被用来回答；member 只能删除自己上传的资料；删除工作区后其中一切都不可访问，小窗也是。

嵌入（2）：更换 key 后旧 key 立即失效、新 key 可用；嵌入代码是一行脚本，`/widget.js` 能拿到。

界面（2）：在另一个 Origin 的"客户网站"上用嵌入代码挂出小窗，提问、看到出处、转人工，团队在后台看到这条转人工；分析页显示没答上的问题和本月花费。

## 完成条件

`--stage S4` 全部通过（连同 S1–S3），并经人工确认。到这一步，产品才算达到本模板定义的"成熟"。
