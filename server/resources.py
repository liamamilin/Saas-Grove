"""Official resource overlay keyed by formal product ID; formal SQLite records stay untouched."""
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from .config import ROOT

RESOURCE_TYPES = ("homepage", "repository", "docs", "demo", "deployment", "features", "changelog", "video")
MISSING_TYPES = (*RESOURCE_TYPES, "screenshot", "logo")
LOGO_KINDS = {"official_logo", "github_org_avatar"}
SCREENSHOT_KINDS = {"ui_screenshot", "ui_composite"}


def default_path():
    return Path(os.environ.get("SAAS_RESOURCES_FILE", ROOT / "data" / "product-resources.json"))


def web_url(value):
    return isinstance(value, str) and urlparse(value).scheme in {"http", "https"} and bool(urlparse(value).netloc)


def validate(document, known_ids=None):
    """Reject the whole overlay on any invalid entry instead of showing half-checked links.

    With known_ids, an entry for a product the formal catalog lacks is also an error."""
    if document.get("schema_version") != 1 or not isinstance(document.get("products"), dict):
        raise ValueError("资源文件格式无效")
    for app_id, entry in document["products"].items():
        where = f"资源 {app_id}"
        if known_ids is not None and app_id not in known_ids:
            raise ValueError(f"{where}：正式产品库中没有这个 ID")
        if not entry.get("curated_at") and not entry.get("refreshed_at"):
            raise ValueError(f"{where}：缺少整理或更新日期")
        logo = entry.get("logo")
        if logo is not None and (not web_url(logo.get("url")) or logo.get("kind") not in LOGO_KINDS or not web_url(logo.get("found_on"))):
            raise ValueError(f"{where}：Logo 链接、类型或出处无效")
        for item in entry.get("resources", []):
            if item.get("type") not in RESOURCE_TYPES or not web_url(item.get("url")) or not web_url(item.get("found_on")) or not item.get("checked_at"):
                raise ValueError(f"{where}：资源类型、链接、出处或核对日期无效")
        for shot in entry.get("screenshots", []):
            if not web_url(shot.get("url")) or shot.get("kind") not in SCREENSHOT_KINDS or not web_url(shot.get("found_on")) or not shot.get("caption"):
                raise ValueError(f"{where}：截图链接、类型、出处或说明无效")
        for gap in entry.get("missing", []):
            if gap.get("type") not in MISSING_TYPES or not gap.get("reason"):
                raise ValueError(f"{where}：缺失资源须写明类型与原因")
        facts = entry.get("repository_facts")
        release = (facts or {}).get("latest_release")
        if facts is not None and (not web_url(facts.get("source_url")) or not facts.get("fetched_at") or (release and not web_url(release.get("url")))):
            raise ValueError(f"{where}：仓库信息缺少来源或日期")
    return document


def read(path=None):
    path = Path(path or default_path())
    if not path.exists():
        return {"schema_version": 1, "products": {}}
    return json.loads(path.read_text(encoding="utf-8"))


class Resources:
    def __init__(self, path=None, known_ids=None):
        self.path = Path(path or default_path())
        products = validate(read(self.path))["products"]
        # A stale ID (product removed from the formal catalog) must not stop the server; it is set aside and reported.
        self.unknown = sorted(set(products) - set(known_ids)) if known_ids is not None else []
        self.products = {k: v for k, v in products.items() if k not in self.unknown}

    def logo(self, app_id):
        logo = (self.products.get(app_id) or {}).get("logo")
        return logo["url"] if logo else None

    def decorate(self, app, full=False):
        """Cards get the logo only; details also get the curated profile or an explicit not-curated marker."""
        entry = self.products.get(app["id"])
        app["logo_url"] = entry["logo"]["url"] if entry and entry.get("logo") else None
        app["resources_curated"] = bool(entry and entry.get("curated_at"))
        shots = [s for s in (entry or {}).get("screenshots", []) if s.get("status") != "unreachable"]
        app["screenshot_count"] = len(shots)
        app["ui_screenshot_count"] = sum(s["kind"] == "ui_screenshot" for s in shots)
        if full:
            app["resource_profile"] = self.profile(app, entry) if entry else None
        return app

    @staticmethod
    def profile(app, entry):
        resources = list(entry.get("resources", []))
        present = {item["type"] for item in resources}
        # Reuse the formal record's own URLs instead of copying them into the overlay.
        for kind, field in (("repository", "repository_url"), ("homepage", "homepage")):
            if kind not in present and app.get(field):
                resources.insert(0, {"type": kind, "url": app[field], "label": "正式记录", "found_on": app[field], "from_formal_record": True})
        # Keep the formal homepage visible when the overlay names a different product homepage.
        if app.get("homepage") and any(r["type"] == "homepage" and r["url"].rstrip("/") != app["homepage"].rstrip("/") for r in resources):
            resources.append({"type": "homepage", "url": app["homepage"], "label": "正式记录", "found_on": app["homepage"], "from_formal_record": True})
        resources.sort(key=lambda item: RESOURCE_TYPES.index(item["type"]))
        return {"curated": bool(entry.get("curated_at")), "curated_at": entry.get("curated_at", ""), "refreshed_at": entry.get("refreshed_at", ""), "logo": entry.get("logo"), "resources": resources,
                "screenshots": [s for s in entry.get("screenshots", []) if s.get("status") != "unreachable"], "missing": entry.get("missing", []),
                "repository_facts": entry.get("repository_facts"), "review_flags": entry.get("review_flags", []),
                "history": entry.get("history", [])[-5:]}
