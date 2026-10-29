import copy
from functools import partial
import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest

from server.api import CatalogAPI, Handler
from server.config import TAXONOMY_DIR
from server.store import Store
from server.taxonomy import Taxonomy, build_catalog, read_json

CRM = "customer-relationship-management-crm"
FORM = "online-form-builder"


class CatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.taxonomy = Taxonomy()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name) / "catalog.sqlite")
        self.api = CatalogAPI(self.taxonomy, self.store)

    def test_every_source_leaf_has_one_explicit_scope_and_valid_membership(self):
        taxonomy = self.taxonomy
        self.assertEqual(len(taxonomy.leaves), 1805)
        self.assertEqual(sum(taxonomy.catalog["counts"].values()), 1805)
        self.assertEqual(len(taxonomy.categories), 270)
        self.assertEqual(taxonomy.catalog["revision"], "4a544fd965f46c177a017c798097fd2d468435ce5e34af2f246691388ee091be")
        self.assertEqual(taxonomy.catalog["counts"], {"included": 1646, "conditional": 53, "excluded": 106})
        for slug, row in taxonomy.leaves.items():
            self.assertIn(row["parent_id"], taxonomy.categories)
            self.assertTrue(row["scope_reason"])
            self.assertEqual(taxonomy.details[slug]["parent_id"], row["parent_id"])
        self.assertEqual(self.api.get("/api/taxonomy", {})["matching_leaves"], 1646)

    def test_rebuild_is_deterministic_and_preserves_local_scope_and_alias_override(self):
        source = self.taxonomy.source
        policy = read_json(TAXONOMY_DIR / "scope-policy.json")
        overrides = {"leaves": {FORM: {"scope": "conditional", "scope_reason": "本地边界修订", "aliases_zh": ["自定义表单别名"]}}}
        first = build_catalog(source, policy, overrides)
        second = build_catalog(source, policy, overrides)
        self.assertEqual(first, second)
        row = next(r for r in second["leaves"] if r["slug"] == FORM)
        self.assertEqual(row["aliases_zh"], ["自定义表单别名"])
        self.assertEqual(row["scope_rule"], "local_override")
        self.assertEqual(self.taxonomy.leaves[FORM]["scope"], "included")

    def test_invalid_tree_and_unknown_overrides_fail_before_publication(self):
        policy = read_json(TAXONOMY_DIR / "scope-policy.json")
        source = copy.deepcopy(self.taxonomy.source)
        source["categories"][0]["parent_id"] = source["categories"][0]["id"]
        with self.assertRaisesRegex(ValueError, "环"):
            build_catalog(source, policy, {})
        with self.assertRaisesRegex(ValueError, "未知叶子"):
            build_catalog(self.taxonomy.source, policy, {"leaves": {"unknown": {"scope": "included"}}})

    def test_search_aliases_scope_and_excluded_types(self):
        result = self.taxonomy.tree("CRM系统")
        slugs = [l["slug"] for d in result["domains"] for g in d["groups"] for l in g["leaves"]]
        self.assertIn(CRM, slugs)
        self.assertEqual(self.taxonomy.tree("online form")['matching_leaves'], 1)
        self.assertEqual(self.taxonomy.tree("does-not-exist-991")['matching_leaves'], 0)
        self.assertEqual(self.taxonomy.tree(scope="conditional")['matching_leaves'], 53)
        with self.assertRaises(KeyError):
            self.taxonomy.leaf("cli-accounting-tool")

    def test_saas_boundaries_do_not_treat_every_online_service_as_software(self):
        for slug in ("team-messaging-application", "community-platform", "online-forum", CRM,
                     "marketplace-platform", "customer-support-chat", "cloud-ide", "data-catalog"):
            self.assertEqual(self.taxonomy.leaves[slug]["scope"], "included", slug)
        for slug in ("code-editor", "smart-home-platform", "email-client", "mechanical-cad",
                     "digital-audio-workstation-daw", "web-browser", "q-a-community", "api-management-platform", "virtual-phone-application"):
            self.assertEqual(self.taxonomy.leaves[slug]["scope"], "included", slug)
        for slug in ("general-social-network", "dating-application", "social-live-streaming-platform",
                     "online-marketplace", "model-api-platform", "scada", "food-delivery-marketplace"):
            self.assertEqual(self.taxonomy.leaves[slug]["scope"], "excluded", slug)
            with self.assertRaises(KeyError):
                self.taxonomy.leaf(slug)
        for slug in ("softphone-application", "machine-learning-platform", "file-transfer-application"):
            self.assertEqual(self.taxonomy.leaves[slug]["scope"], "conditional", slug)
        main = self.api.get("/api/taxonomy", {})
        main_rows = [r for d in main["domains"] for g in d["groups"] for r in g["leaves"]]
        self.assertTrue(all(r["scope"] == "included" for r in main_rows))
        self.assertEqual(main["domains"][0]["name_zh"], "团队通讯与社区运营")
        conditional = self.taxonomy.tree(scope="conditional")
        conditional_slugs = {r["slug"] for d in conditional["domains"] for g in d["groups"] for r in g["leaves"]}
        self.assertIn("softphone-application", conditional_slugs)
        self.assertNotIn("web-browser", conditional_slugs)
        self.assertNotIn("email-client", conditional_slugs)

    def test_future_imports_do_not_auto_admit_new_types_and_category_edits_preserve_source(self):
        source = copy.deepcopy(self.taxonomy.source)
        new_leaf = {**source["leaves"][0], "slug": "new-business-cloud-platform", "parent_id": "09.01", "domain_id": "09"}
        source["leaves"].append(new_leaf)
        policy = read_json(TAXONOMY_DIR / "scope-policy.json")
        overrides = read_json(TAXONOMY_DIR / "overrides.json")
        result = build_catalog(source, policy, overrides)
        row = next(r for r in result["leaves"] if r["slug"] == new_leaf["slug"])
        self.assertEqual((row["scope"], row["scope_rule"]), ("conditional", "awaiting_review"))
        self.assertEqual(source["categories"][0]["name_zh"], "通讯与社交")
        with self.assertRaisesRegex(ValueError, "未知分类"):
            build_catalog(source, policy, {"categories": {"unknown": {"name_zh": "无效分类"}}})
        with self.assertRaisesRegex(ValueError, "仅支持非空中文名称"):
            build_catalog(source, policy, {"categories": {"01": {"parent_id": "09"}}})

    def test_two_tracks_global_identity_and_multiple_leaves_survive_restart(self):
        self.store.save({"id": "open", "name": "开源测试", "summary": "团队应用"}, [CRM, FORM], ["open_source"])
        self.store.save({"id": "commercial", "name": "商业测试", "homepage": "https://example.test/product"}, [CRM], ["commercial"])
        self.store.save({"id": "both", "name": "两种提供方式"}, [CRM], ["open_source", "commercial"])
        self.store.save({"id": "open", "name": "开源测试更新", "summary": "团队应用"}, [CRM, FORM], ["open_source"])
        reopened = Store(self.store.path)
        self.assertEqual({r['id'] for r in reopened.applications(CRM)['applications']}, {"open", "both"})
        self.assertEqual({r['id'] for r in reopened.applications(CRM, "commercial")['applications']}, {"commercial", "both"})
        self.assertEqual(reopened.applications(FORM)["total"], 1)
        self.assertEqual(reopened.applications(CRM, query="团队")["total"], 1)
        _, totals = reopened.counts()
        self.assertEqual(totals, {"open_source": 2, "commercial": 2})

    def test_missing_and_invalid_api_inputs_do_not_return_unfiltered_data(self):
        with self.assertRaises(KeyError):
            self.api.get("/api/leaves/unknown", {})
        with self.assertRaises(KeyError):
            self.api.get("/api/applications", {"track": "commercial"})
        with self.assertRaises(ValueError):
            self.api.get("/api/applications", {"leaf": CRM, "track": "typo"})
        with self.assertRaises(ValueError):
            self.api.get("/api/taxonomy", {"q": "x" * 161})
        with self.assertRaises(ValueError):
            self.store.save({"id": "unsafe", "name": "unsafe", "homepage": "javascript:alert(1)"}, [CRM], ["commercial"])

    def test_http_api_spa_refresh_and_static_path_containment(self):
        root = Path(self.temp.name) / "public"
        root.mkdir()
        (root / "index.html").write_text("<html>catalog</html>")
        (root.parent / "private.txt").write_text("must not be exposed")
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, api=self.api, web_root=root))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        def get(path):
            client = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
            client.request("GET", path)
            response = client.getresponse()
            result = response.status, response.read()
            client.close()
            return result
        self.assertEqual(get("/api/health")[0], 200)
        status, body = get("/api/applications?leaf=" + CRM + "&track=commercial")
        self.assertEqual((status, json.loads(body)["applications"]), (200, []))
        self.assertEqual(get("/types/" + CRM)[1], b"<html>catalog</html>")
        self.assertEqual(get("/api/taxonomy?scope=unknown")[0], 400)
        self.assertEqual(get("/%2e%2e/private.txt")[0], 404)
        self.assertEqual(get("/.env")[0], 404)
        self.assertEqual(get("/api/leaves/missing")[0], 404)


if __name__ == "__main__":
    unittest.main()
