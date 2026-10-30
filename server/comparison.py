"""A small CRM reading lens over existing, immutable catalog evidence. No new products."""
CRM = "customer-relationship-management-crm"
TWENTY = "github:572984571"
ESPO = "github:24459441"
T_README = "5c8dc531b01f1bedddb73acba2181252042d0fc663595bda9214c447617627bb"
E_README = "7e3594c47d68d8410dd68441df06cd897877b0da21ac479a237ea1a61f9ac6ed"
E_SALES = "318d14efa9bc6e42fba5d633590b20a9f1dfaa216623366b8786c27c16c32229"
E_PACK = "229e025cc219418cb386a8f730c6b294b403416aab4885a6900059a8cab2b7fb"
# Restrained summaries of already collected sources. Edition boundaries are not inferred.
ROWS = [
    ("records", "客户记录与视图", {
        TWENTY: ("README 列出 CRM 对象与视图。", [(T_README, "objects, views, workflows, and agents")]),
        ESPO: ("README 列出线索、联系人、商机等 CRM 记录。", [(E_README, "manage leads, contacts, sales opportunities")]),
    }),
    ("pipeline", "商机与销售管道", {
        ESPO: ("商机支持看板、自定义阶段与概率，以及多销售管道。", [(E_SALES, "It is possible to enable multiple [pipelines](../general/pipelines.md) for Opportunities.")]),
    }),
    ("automation", "自动化及授权边界", {
        TWENTY: ("README 列出工作流构建能力；此处未核实各版本的授权边界。", [(T_README, "objects, views, workflows, and agents")]),
        ESPO: ("Workflows、BPM 和报表属于 Advanced Pack 官方单独扩展；不能据社区核心自托管推断已包含扩展授权，具体授权条件待核实。", [(E_PACK, "The extension includes: Reports Business Process Management Workflows")]),
    }),
]

def crm_rows(apps, leaf):
    if leaf != CRM:
        return []
    rows = []
    for key, label, specs in ROWS:
        cells = []
        for app in apps:
            value, required = specs.get(app["id"], ("", []))
            sources = {s.get("sha256"): s for s in (app.get("sources") or [])}
            # If the original source binding is absent, keep this cell unknown.
            if required and all(sha in sources for sha, _ in required):
                evidence = [{"url": sources[sha]["url"], "sha256": sha,
                             "fetched_at": sources[sha].get("fetched_at", ""), "quote": quote}
                            for sha, quote in required]
                cells.append({"status": "recorded", "value": value, "sources": evidence})
            else:
                cells.append({"status": "unknown", "value": "", "sources": []})
        rows.append({"key": key, "label": label, "cells": cells})
    return rows
