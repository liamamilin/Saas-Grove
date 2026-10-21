# 宿主约定（所有模块模板共用）

模块的验收不在真空里跑，它跑在一个"声称实现了该模块的应用"（宿主）上。宿主约定规定：验收怎样启动、认识和操作任何宿主，又不规定宿主的内部实现。每份模块的 contract.md 和 acceptance-plan.md 只引用本文件，不重复。

## 1. 启动
- 环境变量：`PORT`、`DATABASE_URL`（空 Postgres，验收独占）、`APP_BASE_URL`、`TEST_MODE=1`（只在验收时设）。
- 命令：`npm install && npm run build && npm start`；`GET /api/health` 返回 200 即就绪。
- 非 `TEST_MODE` 下，下面第 3 节的测试接口必须不存在（404）。

## 2. 路径映射
模块契约里的路径只是建议名。宿主在根目录放 `module-map.json`，把契约里的"概念"映射到自己的真实路径，例如 `{"auth.signup": {"method":"POST","path":"/api/auth/signup"}}`。验收只读这个映射，不猜路径。缺映射的概念记为"宿主未声明"，不是失败，也不是通过，单独统计。

## 2b. 参数声明
限流次数、超时、TTL 等数值：契约给**下限或上限**（"同一账号 10 次内必须触发限制"），宿主在 `module-map.json` 的 `params` 里声明自己的实际值，验收读取 params，没声明就按契约的界限测。

## 3. 测试支撑（仅 TEST_MODE=1）
| 能力 | 约定 |
|---|---|
| 取邮件 | `GET /api/__test__/outbox?to=<email>` → `{messages:[{to,template,token?,data?,createdAt}]}`；令牌明文只允许出现在名字含 `outbox` 的表 |
| 邮件约定 | outbox 的 `template` 用 `<模块>.<名>`（如 `auth.password_reset`），链接放 `data.link`，令牌放 `token` |
| 时钟 | `POST /api/__test__/clock {advanceSeconds}`，所有时效（令牌、会话、限流窗口、预算月）都跟着走 |
| 限流 | `DELETE /api/__test__/rate-limits` 清空计数；验收也可以用独立的来源标识避免互相干扰 |
| 假模型 | `PUT/DELETE /api/__test__/fake-model`：延迟、故障注入、固定 usage、记录收到的完整请求；`MODEL_PROVIDER=fake` 时模型调用一律走它 |
| 夹具 | 用户、工作区、成员一律通过公开的 auth / workspaces 模块接口创建，不绕过；每条用例用全新账号（唯一邮箱），不共享状态 |

## 3b. 不可测的规则
黑盒下观察不到的建议（耗时相近、加密完整性、代码里的假哈希等）写在 contract 的"建议，验收不测"一节，不放进 MUST。每条 MUST 必须有至少一个验收用例，每个用例必须能追溯到一条规则，契约末尾附追溯表。

## 4. 观察边界
黑盒：HTTP、Cookie、页面、`outbox`、数据库**只读**查询（只用来检查哈希存储、软删除是否清除个人数据等，写在契约里的项）。验收不能读源码、不能改数据库。

## 5. 依赖顺序
auth → workspaces-and-permissions → 其余。其他模块的验收可以假设这两个已经按各自契约通过。一个宿主可以只实现部分模块；验收只运行它声称的模块。

## 6. 不属于本约定的
UI 的美观、AI 回答的内容质量、性能压测、真实第三方服务（支付、邮件服务商）的接通。第三方一律用假实现，模块契约里写清假实现要满足的接口。
