# SaaS 分类目录数据

源快照保留 Atlas 的 1,805 个叶子、29 个大域和 270 个分类节点（包含大域）。运行目录经过用途与交付边界筛选：**主目录 1,646 个、待确认 53 个、排除 106 个**。默认仅显示主目录的 29 个大域、233 个子分类。1,805 个叶子已完成轻量初判，548 个复核项已发布；随后用案例累计确认135项，具体进度见 `../collections/conditional-progress.json`。

- `atlas-source.json`：完整的独立资料快照，保留原始名称、分类、定义和来源。不随 SaaS 边界调整而删除类型。
- `scope-policy.json`：v2 范围判断，明确记录 241 个子分类的用途边界、276 个叶子例外及本次覆盖的 slug 名单。没有行业或关键词自动纳入规则。
- `overrides.json`：本地逐叶子修订及分类显示名称；本次保存 548 条复核结果，导入不会覆盖它。
- `catalog.json`：生成的分类、范围、理由和来源索引。
- `scope-review.csv`：每个源叶子一行的可查阅清单，包含范围和理由，重建时同步导出。

完整调整说明见 [SaaS 范围审阅](../../docs/SAAS_SCOPE_REVIEW.md)。类型是否适合 SaaS 目录，与具体项目是否真有在线服务、能否部署、许可证是否合适，是不同的判断。后者在采集项目时核验。

`included` 表示主目录，`conditional` 表示待确认，`excluded` 表示本轮不收录。待确认在页面中单列，不混入默认目录。消费社交、内容与交易场所、纯客户端、基础组件、设备控制不会因联网或名称带 platform 就被纳入；可在线运营的团队消息、社区管理、业务和协作应用则可纳入。开源应用允许自托管，不要求已有商业运营或多租户。

新增源叶子即使落在已纳入的业务分类中，也先标为待确认；审阅后将 slug 加入策略名单，并按分类规则或叶子例外确定范围。修改本地显示名、范围或别名可编辑覆盖文件：

```json
{
  "version": 1,
  "categories": { "01": { "name_zh": "团队通讯与社区运营" } },
  "leaves": {
    "online-form-builder": {
      "scope": "included",
      "scope_reason": "明确支持在线表单服务的应用类型。",
      "aliases_zh": ["在线表单", "表单工具"]
    }
  }
}
```

叶子支持覆盖 `scope`、`scope_reason`、`name_zh`、`aliases_zh`；分类支持 `name_zh`。不改变稳定 slug 或源归属。编辑后重建并重启 API：

```sh
python3 -B scripts/import_atlas.py
```

此命令仅读取本仓快照，不依赖 Atlas 或网络；相同输入产生相同目录和清单。显式升级源资料时才指定：

```sh
python3 -B scripts/import_atlas.py --source ../application-atlas
```

历史 63 叶子候选草案保留在 `docs/SAAS_DIRECTORY_DRAFT.json`，不作为运行目录。
