# unit 117 — infrastructure-automation-platform 补证笔记

## 起点
- input_status: insufficient_evidence；唯一叶子 infrastructure-automation-platform（parent 14.01, domain 14）。
- 已有 batch.json 为空（entries: []），research.json 为上一轮 AWX 的 insufficient_evidence 记录；本工作区无 review.json，初审问题见 issues.json：AWX 许可证证据未闭合。
- 历史快照复用（REUSED_SOURCES.json，SHA/URL 原样保留）：AWX repo metadata、license API、README、LICENSE.md、licenses/awx.txt、docs/overview.md、docs/rbac.md。

## 第一组定向补证：AWX 许可证缺口复核
- 重新抓 GitHub license API：`1430a43f...`，spdx_id=NOASSERTION，content 解码为 LICENSE.md 正文，止于第 9 条，无 APPENDIX —— 与历史一致。
- 取仓库根目录清单（`deff690...`）：根级仅 LICENSE.md 与 licenses/ 目录，无可绑定的根级许可命名文件；`awx_collection/COPYING` 为 GPL-3.0（`7c50cd9b...`），仅覆盖子目录，不可作仓库整体许可证据。
- 按标签 24.6.1 / 23.9.0 取 LICENSE.md，sha256 与 devel 完全相同（`3e3f8281...`），排除“单分支偶发截断”。
- 结论：缺口仍在，AWX 不建立关系；保留候选事实与缺口，不宣称不存在。

## 第二组定向补证：完整开源 Web 应用服务替代
- 定位 semaphoreui/semaphore（Ansible/Terraform/OpenTofu/Terragrunt/脚本 的 Web UI + API）。
- 身份：repo metadata id=23267883，full_name=semaphoreui/semaphore，archived=false，homepage=https://semaphoreui.com。
- 许可：license API spdx_id=MIT，含完整 MIT 正文（`8105039...`），许可由 API 端点闭合。
- 三支柱正文：
  - 内容：task-templates 文档（模板定义 application/repository/file/inventory/variable groups/credentials，支持 Ansible、Terraform、Shell、PowerShell、Python）；README Key Concepts「reusable definitions ... on demand or scheduled」。
  - 执行：inventory 文档（受管主机、绑定凭证、静态 INI/YAML/文件/terraform 工作区）；tasks 文档（模板创建任务、队列、日志/状态/发起人/仓库修订）。
  - 治理：key-store 文档（集中凭证仓库、运行注入、Vault 解密）；team 文档（Owner/Manager/Task Runner/Guest，按项目 × 模板 × 动作授权）。
- 社区版边界：README 与官网分 Community/Pro/Enterprise；Workflows、外部密钥存储、Runners、自定义角色标注为 Pro/Enterprise，未计入社区版事实。
- 失败抓取留档：docs.semaphoreui.com 308/跨主机重定向（改用 semaphoreui.com/docs）；/user-guide/users、/history、/teams 均 403（以 team/projects/tasks 正文覆盖所需事实）。

## 产物
- `data/collections/batch.json`：1 条开源条目 github:23267883（MIT），validate 通过。
- `data/collections/research.json`：leaf_cases 恰一行，assessment=case_found，case_ids 与 batch 一致。
- 未部署/未运行第三方项目；runtime_tested=false；未改正式数据、验证器或目录。
