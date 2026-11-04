"""Source-bound reading lenses for existing products; never writes the formal catalog."""
import json
import os
from pathlib import Path
from .comparison import CRM, crm_rows
from .config import ROOT

HELP_DESK = "help-desk"
DIMENSIONS = {
    CRM: [("records", "客户与线索记录"), ("pipeline", "商机与销售管道"),
          ("automation", "自动化及授权边界"), ("io", "导入与导出"),
          ("api", "API 与集成"), ("delivery", "自托管方式"), ("license_boundary", "核心与扩展许可边界")],
    HELP_DESK: [("intake", "邮件与渠道受理"), ("ticket", "工单分派与流转"),
                ("knowledge", "知识库"), ("sla", "SLA 与服务时限"),
                ("access", "权限与访问"), ("api", "API 与集成"),
                ("delivery", "自托管方式"), ("license_boundary", "核心与扩展许可边界")],
}
UNKNOWN = {"status": "unknown", "value": "", "sources": []}

class Selection:
    def __init__(self, path=None):
        self.data = json.loads(Path(path or os.environ.get("SAAS_SELECTION_FILE", ROOT / "data/selection-evidence.json")).read_text())

    def decorate(self, app):
        preferred = self.data.get("primary_types", {}).get(app["id"])
        # Only reorder an existing relationship; a preference cannot create a new type.
        app["types"].sort(key=lambda t: t["slug"] != preferred)
        note = self.data.get("product_notes", {}).get(app["id"])
        source = next((s for s in (app.get("sources") or []) if note and s.get("sha256") == note["sha256"]), None)
        app["catalog_note"] = {"text": note["text"], "url": source["url"]} if source else None

    @staticmethod
    def bind(app, fact):
        sources = {s.get("sha256"): s for s in (app.get("sources") or [])}
        if not fact or fact.get("status") not in {"recorded", "unsupported"} or not fact.get("value") or not fact.get("sources"):
            return dict(UNKNOWN)
        evidence = []
        for item in fact["sources"]:
            source = sources.get(item.get("sha256"))
            if not source or not item.get("quote"):
                return dict(UNKNOWN)
            evidence.append({"sha256": item["sha256"], "quote": item["quote"],
                             "url": source["url"], "fetched_at": source.get("fetched_at", "")})
        return {"status": fact["status"], "value": fact["value"], "sources": evidence}

    def rows(self, apps, leaf):
        if leaf not in DIMENSIONS:
            return []
        # Preserve the original CRM evidence and saved row keys as additional products are covered.
        legacy = {r["key"]: r for r in crm_rows(apps, leaf)}
        rows = []
        for key, label in DIMENSIONS[leaf]:
            cells = []
            for index, app in enumerate(apps):
                previous = legacy.get(key, {}).get("cells", [])
                if "commercial" in app.get("tracks", []):
                    cell = dict(UNKNOWN)  # Commercial products remain a shallow index.
                else:
                    product = self.data.get("products", {}).get(app["id"], {})
                    cell = self.bind(app, product.get(leaf, {}).get(key))
                    if cell["status"] == "unknown" and previous and previous[index]["status"] == "recorded":
                        cell = previous[index]
                cells.append(cell)
            rows.append({"key": key, "label": label, "cells": cells})
        return rows
