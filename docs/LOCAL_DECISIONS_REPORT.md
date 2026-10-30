# 本地选型记录与 CRM 比较验收

2026-10-30，基于 `e3646d8`，开发分支 `codex/local-decisions`。不扩大数据规模，仅本地使用。

## 实际交付

- 比较页按关注维度显示；URL 和命名比较保留维度、相同记录展开状态、产品顺序与类型。相同只指记录值一致，不代表产品等价；未知不会作为相同支持能力折叠，也不用于能力评分。
- CRM 样板使用已有 Twenty、EspoCRM、Salesforce。专项单元附既有来源链接、原文节选和来源采集日期，来源 SHA 绑定到原产品；没有来源的单元保持未知。EspoCRM 的工作流/BPM/报表归属 Advanced Pack 官方扩展；本轮没有从扩展介绍推断免费或具体授权条件。原始产品记录仍独立展示，没有覆盖。
- 详情、候选清单和比较页可以编辑／删除个人备注，记录待了解、准备试用或暂不考虑。个人记录在独立区域展示，不混入官方事实；取消收藏保留备注。
- 命名保存／更新／删除比较，保存个人结论，从候选清单恢复，产品事实仍实时读取本地正式目录。
- JSON 备份包含收藏、备注、状态及已保存比较；导入先预览再合并，同 ID 当前优先，缺失于备份的旧记录不删除。一次本地存储写入，失败不提交部分记录；兼容读入旧 v1 收藏，首次写入升为 v2，保留原 key、ID 和时间，旧 v1 标签页会拒绝写入新格式。同浏览器标签页同步。

## 实际验证

```sh
python3 -B -m unittest discover -s server/tests
# 74 passed，包括原来源 SHA/正文节选、本轮只读 CRM 组织与旧接口回归
python3 -B -m unittest discover -s tests
# 28 passed
npm --prefix web run test:e2e
# 33 passed，8 个真实模式用例在隔离模式按设计跳过
SAAS_E2E_REAL=1 npm --prefix web run test:e2e -- e2e/real-products.spec.ts e2e/real-shortlist.spec.ts e2e/real-decisions.spec.ts
# 8 passed，正式 SQL 快照的临时副本，旧轮截图原样保留
npm --prefix web run build
# TypeScript 与 Vite 成功
```

新增回归实际检查旧收藏兼容、跨标签同步、个人备注/比较写失败的字节保留、无效比较不能保存、维度/顺序恢复、备份下载、预览不写入、冲突合并及非法备份拒绝。桌面 1440×1000：收藏三款 CRM → 核对依据/未知 → 备注与状态 → 保存比较 → 导出 → 空白浏览器完整恢复。手机 390×844：搜索与详情收藏 → 两款开源 CRM 比较 → 展开相同记录/横向浏览 → 备注 → 保存重开 → 导出。新页面及恢复页面均无 pageerror，手机无页面横向溢出。

OpenCode Go / DeepSeek V4.1 Flash 独立只读审查了代码和测试。依据表述、空白名称、删除记录与回归缺口已处理；旧资料缺失与非法 API 比较的误判依据完整后端契约核实。审查模型未运行测试，上述通过结果来自本地实际执行。

逐表逻辑 SHA 与开始前一致：1,440 application、1,440 track 行、1,724 leaf_application；正式 SQL 快照／元数据和203项无关本地文件内容保持。没有启动采集、修改分类、变更产品身份或部署到公网。

## 实际截图

- [桌面比较](local-decisions/crm-comparison-desktop.png)、[CRM 逐项依据](local-decisions/crm-evidence-desktop.png)
- [桌面个人记录](local-decisions/personal-reasoning-desktop.png)、[保存与备份](local-decisions/saved-comparison-desktop.png)
- [手机比较](local-decisions/crm-comparison-mobile.png)、[手机个人记录](local-decisions/personal-reasoning-mobile.png)、[手机保存比较](local-decisions/saved-comparison-mobile.png)

## 当前范围

CRM 专项是基于已有来源的少量人工整理，不是全目录能力标准化；商业产品没有新增深度研究，资料不足仍未知。没有实测第三方 CRM 的部署或功能。个人记录按浏览器和 origin 保存，不自动跨设备同步；JSON 合并导入不会覆盖同 ID 的当前内容。分享比较 URL 只包含产品和显示条件，个人备注和结论仅随本地备份保存。旧前端标签页会对新 v2 格式停止写入，刷新后即可继续使用；没有改名收藏存储 key。
