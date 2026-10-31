from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from server.api import CatalogAPI
from server.config import ROOT
from server.refresh import Fetched, run
from server.resources import Resources, validate
from server.store import Store
from server.taxonomy import Taxonomy

CRM = "customer-relationship-management-crm"
NOW = datetime(2026, 11, 1, 9, 0, tzinfo=timezone.utc)


def overlay(products):
    return {"schema_version": 1, "products": products}


def entry(**extra):
    base = {"name": "Alpha", "curated_at": "2026-10-31",
            "logo": {"url": "https://example.test/logo.png", "kind": "official_logo", "found_on": "https://example.test", "checked_at": "2026-10-31"},
            "resources": [{"type": "docs", "url": "https://example.test/docs", "label": "文档", "found_on": "https://example.test", "checked_at": "2026-10-31", "http_status": 200}],
            "screenshots": [{"url": "https://example.test/shot.png", "caption": "主界面", "kind": "ui_screenshot", "found_on": "https://example.test", "checked_at": "2026-10-31"}],
            "missing": [{"type": "video", "reason": "未找到"}]}
    base.update(extra)
    return base


class RealOverlayTests(unittest.TestCase):
    def test_published_overlay_matches_formal_catalog_and_leaves_snapshot_untouched(self):
        snapshot = json.loads((ROOT / "data/catalog-snapshot.json").read_text())
        sql = (ROOT / "data/catalog.sql").read_bytes()
        self.assertEqual(hashlib.sha256(sql).hexdigest(), snapshot["sha256"])
        with tempfile.TemporaryDirectory() as directory:
            con = sqlite3.connect(Path(directory) / "c.sqlite")
            con.executescript(sql.decode())
            ids = {row[0] for row in con.execute("SELECT id FROM application")}
            self.assertEqual(len(ids), snapshot["applications"])
            self.assertEqual(con.execute("SELECT COUNT(*) FROM leaf_application").fetchone()[0], snapshot["leaf_links"])
            con.close()
        document = json.loads((ROOT / "data/product-resources.json").read_text())
        validate(document, ids)
        curated = [e for e in document["products"].values() if e.get("curated_at")]
        self.assertGreaterEqual(len(curated), 10)
        for item in curated:
            self.assertTrue(item["logo"] and item["screenshots"], item["name"])
            urls = [r["url"] for r in item["resources"]]
            self.assertEqual(len(urls), len(set(urls)), f"{item['name']} 重复填充同一链接")


class ResourceApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.taxonomy = Taxonomy()

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.dir = Path(temp.name)
        self.store = Store(self.dir / "catalog.sqlite")
        self.store.save({"id": "github:1", "name": "Alpha", "summary": "客户记录", "homepage": "https://alpha.test",
                         "repository_url": "https://github.com/alpha/alpha", "license": "MIT"}, [CRM], ["open_source"])
        self.store.save({"id": "beta", "name": "Beta", "summary": "客户服务", "homepage": "https://beta.test"}, [CRM], ["commercial"])
        self.path = self.dir / "resources.json"
        self.path.write_text(json.dumps(overlay({"github:1": entry()}), ensure_ascii=False))
        self.api = CatalogAPI(self.taxonomy, self.store, Resources(self.path))

    def test_cards_carry_logo_and_curation_without_full_profile(self):
        result = self.api.get("/api/products", {"q": ""})
        cards = {a["id"]: a for a in result["applications"]}
        self.assertEqual(cards["github:1"]["logo_url"], "https://example.test/logo.png")
        self.assertTrue(cards["github:1"]["resources_curated"])
        self.assertEqual(cards["github:1"]["screenshot_count"], 1)
        self.assertIsNone(cards["beta"]["logo_url"])
        self.assertFalse(cards["beta"]["resources_curated"])
        self.assertNotIn("resource_profile", cards["github:1"])
        self.assertEqual(result["facets"]["curated"], 1)
        self.assertEqual([a["id"] for a in self.api.get("/api/products", {"curated": "1"})["applications"]], ["github:1"])
        with self.assertRaises(ValueError):
            self.api.get("/api/products", {"curated": "yes"})

    def test_detail_reuses_formal_urls_and_marks_uncurated_products(self):
        detail = self.api.get("/api/products/github:1", {})
        kinds = [r["type"] for r in detail["resource_profile"]["resources"]]
        self.assertEqual(kinds, ["homepage", "repository", "docs"])
        formal = [r for r in detail["resource_profile"]["resources"] if r.get("from_formal_record")]
        self.assertEqual({r["url"] for r in formal}, {"https://alpha.test", "https://github.com/alpha/alpha"})
        self.assertEqual(detail["types"][0]["product_count"], 2)
        self.assertIsNone(self.api.get("/api/products/beta", {})["resource_profile"])

    def test_similar_products_exclude_current_and_leaf_listing_gets_logos(self):
        others = self.api.get("/api/products", {"leaf": CRM, "exclude": "github:1"})["applications"]
        self.assertEqual([a["id"] for a in others], ["beta"])
        listing = self.api.get("/api/applications", {"leaf": CRM, "track": "open_source"})
        self.assertEqual(listing["applications"][0]["logo_url"], "https://example.test/logo.png")
        leaf = self.api.get(f"/api/leaves/{CRM}", {})
        self.assertTrue(all(r["slug"] != CRM and r["scope"] == leaf["scope"] for r in leaf["related"]))
        self.assertLessEqual(len(leaf["related"]), 12)

    def test_invalid_overlays_are_rejected_whole(self):
        bad = [entry(logo={"url": "javascript:alert(1)", "kind": "official_logo", "found_on": "https://x.test"}),
               entry(resources=[{"type": "pricing", "url": "https://x.test", "found_on": "https://x.test", "checked_at": "2026-10-31"}]),
               entry(screenshots=[{"url": "https://x.test/a.png", "kind": "ai_generated", "found_on": "https://x.test", "caption": "x"}]),
               entry(missing=[{"type": "video", "reason": ""}]),
               entry(curated_at="")]
        for item in bad:
            with self.subTest(item=item), self.assertRaises(ValueError):
                validate(overlay({"github:1": item}))
        with self.assertRaises(ValueError):
            validate(overlay({"github:404": entry()}), {"github:1"})

    def test_type_name_matches_outrank_summary_mentions_and_suggest_types(self):
        self.store.save({"id": "aardvark", "name": "Aardvark", "summary": "汽修工单，也做客户管理"}, ["help-desk"], ["open_source"])
        result = self.api.get("/api/products", {"q": "客户管理"})
        self.assertEqual([a["id"] for a in result["applications"]], ["github:1", "beta", "aardvark"])
        suggested = result["suggested_types"]
        self.assertEqual(suggested[0]["slug"], CRM)
        self.assertEqual((suggested[0]["product_count"], suggested[0]["counts"]), (2, {"open_source": 1, "commercial": 1}))
        self.store.save({"id": "erp", "name": "Ledger", "summary": "资源计划"}, ["enterprise-resource-planning-erp"], ["open_source"])
        self.store.save({"id": "wiki", "name": "Pages", "summary": "知识库"}, ["enterprise-wiki"], ["open_source"])
        self.assertEqual([t["slug"] for t in self.api.get("/api/products", {"q": "ERP"})["suggested_types"]], ["enterprise-resource-planning-erp"])  # not "enterprise"
        self.assertEqual(self.api.get("/api/products", {"q": "工单"})["suggested_types"][0]["slug"], "help-desk")
        self.assertEqual(self.api.get("/api/products", {"q": "客户管理", "leaf": CRM})["suggested_types"], [])
        self.assertEqual(self.api.get("/api/products", {"q": ""})["suggested_types"], [])
        self.assertEqual(self.api.get("/api/products", {"q": "c"})["suggested_types"], [])  # one letter is too vague

    def test_compare_carries_resource_profiles_for_activity_and_trial_rows(self):
        comparison = self.api.get("/api/compare", {"ids": "github:1,beta"})
        alpha, beta = comparison["products"]
        self.assertEqual([r["type"] for r in alpha["resource_profile"]["resources"]], ["homepage", "repository", "docs"])
        self.assertIsNone(beta["resource_profile"])
        self.assertTrue(all("resource_profile" not in c for c in comparison["candidates"]))

    def test_stale_overlay_id_is_set_aside_instead_of_blocking_startup(self):
        self.path.write_text(json.dumps(overlay({"github:1": entry(), "github:gone": entry(name="Gone")}), ensure_ascii=False))
        resources = Resources(self.path, {"github:1", "beta"})
        self.assertEqual(resources.unknown, ["github:gone"])
        self.assertEqual(set(resources.products), {"github:1"})
        self.path.write_text(json.dumps(overlay({"github:gone": entry(logo={"url": "ftp://x"})}), ensure_ascii=False))
        with self.assertRaises(ValueError):
            Resources(self.path, {"github:1"})


class RefreshTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.dir = Path(temp.name)
        self.store = Store(self.dir / "catalog.sqlite")
        self.app = {"id": "github:1", "name": "Alpha", "homepage": "https://alpha.test", "repository_url": "https://github.com/alpha/alpha", "license": "MIT"}
        self.store.save(self.app, [CRM], ["open_source"])
        self.path = self.dir / "resources.json"
        self.path.write_text(json.dumps(overlay({"github:1": entry()}), ensure_ascii=False))
        self.lines = []
        self.pages = {
            "https://api.github.com/repos/alpha/alpha": Fetched(200, "", "application/json", json.dumps({
                "archived": False, "pushed_at": "2026-10-30T10:00:00Z", "license": {"spdx_id": "Apache-2.0"}, "homepage": "https://alpha.test/"}).encode()),
            "https://api.github.com/repos/alpha/alpha/releases/latest": Fetched(200, "", "application/json", json.dumps({
                "tag_name": "v2.0", "published_at": "2026-10-20T00:00:00Z", "html_url": "https://github.com/alpha/alpha/releases/tag/v2.0"}).encode()),
            "https://example.test/docs": Fetched(404, "https://example.test/docs"),
            "https://example.test/shot.png": Fetched(200, "", "image/png"),
            "https://example.test/logo.png": Fetched(200, "", "text/html"),
            "https://github.com/alpha/alpha/releases": Fetched(200, "", "text/html"),
        }

    def fetch(self, url):
        page = self.pages[url]
        if isinstance(page, Exception):
            raise page
        return page

    def run_refresh(self, apply):
        return run("github:1", apply, self.path, self.store, self.fetch, NOW, self.lines.append)

    def formal(self):
        with self.store.connect() as con:
            return con.execute("SELECT data FROM application WHERE id='github:1'").fetchone()[0]

    def test_dry_run_reports_without_writing(self):
        before = self.path.read_bytes()
        self.assertEqual(self.run_refresh(False), 0)
        self.assertEqual(self.path.read_bytes(), before)
        text = "\n".join(self.lines)
        self.assertIn("v2.0", text)
        self.assertIn("待复核", text)
        self.assertIn("预览模式", text)

    def test_apply_updates_overlay_flags_core_differences_and_keeps_formal_record(self):
        formal = self.formal()
        self.assertEqual(self.run_refresh(True), 0)
        item = json.loads(self.path.read_text())["products"]["github:1"]
        self.assertEqual(item["repository_facts"]["latest_release"]["tag"], "v2.0")
        self.assertEqual([f["field"] for f in item["review_flags"]], ["license"])  # trailing slash is the same homepage
        docs = next(r for r in item["resources"] if r["type"] == "docs")
        self.assertEqual((docs["status"], docs["url"]), ("unreachable", "https://example.test/docs"))
        self.assertNotIn("status", item["logo"])  # non-image answer is a warning, not a removal
        self.assertEqual(item["logo"]["checked_at"], "2026-10-31")
        self.assertTrue(any(r["type"] == "changelog" for r in item["resources"]))
        self.assertEqual(item["history"][-1]["at"], NOW.isoformat(timespec="seconds"))
        self.assertEqual(self.formal(), formal)
        self.assertIn("Logo", "\n".join(l for l in self.lines if l.startswith("  !")))

    def test_network_failure_and_rate_limit_abort_without_writing(self):
        before = self.path.read_bytes()
        self.pages["https://api.github.com/repos/alpha/alpha"] = ConnectionError("timed out")
        self.assertEqual(self.run_refresh(True), 2)
        self.pages["https://api.github.com/repos/alpha/alpha"] = Fetched(403, "")
        self.assertEqual(self.run_refresh(True), 2)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertIn("未写入", self.lines[-1])

    def test_unknown_product_and_uncurated_refresh_stays_uncurated(self):
        self.assertEqual(run("github:nope", True, self.path, self.store, self.fetch, NOW, self.lines.append), 1)
        self.path.write_text(json.dumps(overlay({}), ensure_ascii=False))
        self.assertEqual(self.run_refresh(True), 0)
        item = json.loads(self.path.read_text())["products"]["github:1"]
        self.assertNotIn("curated_at", item)
        app = Resources(self.path).decorate({"id": "github:1", "homepage": "https://alpha.test"}, full=True)
        self.assertFalse(app["resources_curated"])
        self.assertFalse(app["resource_profile"]["curated"])

    def test_homepage_spellings_that_reach_the_same_page_are_not_flagged_and_resolution_is_recorded(self):
        old = {"field": "homepage", "recorded": "https://alpha.test", "observed": "alpha.test", "source_url": "https://api.github.com/repos/alpha/alpha", "observed_at": "2026-10-31"}
        self.path.write_text(json.dumps(overlay({"github:1": entry(review_flags=[old])}), ensure_ascii=False))
        meta = json.loads(self.pages["https://api.github.com/repos/alpha/alpha"].body)
        for homepage, extra in (("alpha.test", {}), ("https://alpha.example", {"https://alpha.example": Fetched(200, "https://www.alpha.test/", "text/html"),
                                                                          "https://alpha.test": Fetched(200, "https://alpha.test/", "text/html")})):
            with self.subTest(homepage=homepage):
                meta.update(homepage=homepage, license={"spdx_id": "MIT"})
                self.pages["https://api.github.com/repos/alpha/alpha"] = Fetched(200, "", "application/json", json.dumps(meta).encode())
                self.pages.update(extra)
                self.assertEqual(self.run_refresh(True), 0)
                item = json.loads(self.path.read_text())["products"]["github:1"]
                self.assertEqual(item["review_flags"], [])
        self.assertTrue(any("复核项已解除" in c and "alpha.test" in c for c in item["history"][0]["changes"]))
        # Two unrelated domains landing on one shared page elsewhere (parking, login) stay a difference.
        meta["homepage"] = "https://parked.example"
        self.pages["https://api.github.com/repos/alpha/alpha"] = Fetched(200, "", "application/json", json.dumps(meta).encode())
        self.pages["https://parked.example"] = Fetched(200, "https://parking.invalid/", "text/html")
        self.pages["https://alpha.test"] = Fetched(200, "https://parking.invalid/", "text/html")
        self.assertEqual(self.run_refresh(True), 0)
        self.assertEqual([f["observed"] for f in json.loads(self.path.read_text())["products"]["github:1"]["review_flags"]], ["https://parked.example"])
        meta["homepage"] = "https://other.example"
        self.pages["https://api.github.com/repos/alpha/alpha"] = Fetched(200, "", "application/json", json.dumps(meta).encode())
        self.pages["https://other.example"] = Fetched(200, "https://other.example/", "text/html")
        self.assertEqual(self.run_refresh(True), 0)
        item = json.loads(self.path.read_text())["products"]["github:1"]
        self.assertEqual([f["observed"] for f in item["review_flags"]], ["https://other.example"])
        self.assertFalse(any("已解除" in c for c in item["history"][-1]["changes"]))  # A→B is a new difference, not a resolution

    def test_deep_link_that_redirects_to_the_site_root_is_a_warning_not_a_pass(self):
        stale = entry()
        stale["resources"][0].update(checked_at="2026-01-01", http_status=301)
        self.path.write_text(json.dumps(overlay({"github:1": stale}), ensure_ascii=False))
        self.pages["https://example.test/docs"] = Fetched(200, "https://example.test/", "text/html")
        self.assertEqual(self.run_refresh(True), 0)
        docs = next(r for r in json.loads(self.path.read_text())["products"]["github:1"]["resources"] if r["type"] == "docs")
        self.assertEqual((docs["checked_at"], docs["http_status"]), ("2026-01-01", 301))  # not re-stamped as a pass
        self.assertNotIn("status", docs)
        self.assertTrue(any("跳转到了网站首页" in l for l in self.lines if l.startswith("  !")))

    def test_prerelease_tags_are_labelled(self):
        for tag, flag, expected in (("v7.0.0-beta.1", False, True), ("v2.0", True, True), ("v2.0", False, False), ("stable/jitsi-meet_11248", False, False)):
            with self.subTest(tag=tag, flag=flag):
                self.pages["https://api.github.com/repos/alpha/alpha/releases/latest"] = Fetched(200, "", "application/json", json.dumps({
                    "tag_name": tag, "prerelease": flag, "published_at": "2026-10-20T00:00:00Z", "html_url": "https://github.com/alpha/alpha/releases/tag/x"}).encode())
                self.assertEqual(self.run_refresh(True), 0)
                release = json.loads(self.path.read_text())["products"]["github:1"]["repository_facts"]["latest_release"]
                self.assertEqual(release.get("prerelease", False), expected)

    def test_refresh_keeps_stale_entries_and_reports_them(self):
        self.path.write_text(json.dumps(overlay({"github:1": entry(), "github:gone": entry(name="Gone")}), ensure_ascii=False))
        self.assertEqual(self.run_refresh(True), 0)
        self.assertIn("github:gone", json.loads(self.path.read_text())["products"])
        self.assertTrue(any("github:gone" in l for l in self.lines))


if __name__ == "__main__":
    unittest.main()
