import copy
import hashlib
import html
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import unittest
from server.selection import Selection, CRM, HELP_DESK

ROOT = Path(__file__).resolve().parents[2]

def plain(raw):
    raw = re.sub(r"<(script|style|svg)\b[^>]*>.*?</\1>", " ", raw, flags=re.S | re.I)
    return re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]*>", " ", raw))).strip()

class SelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db = sqlite3.connect(":memory:")
        db.executescript((ROOT / "data/catalog.sql").read_text())
        cls.apps = {row[0]: json.loads(row[1]) for row in db.execute("select id,data from application")}
        cls.links = set(db.execute("select app_id,leaf from leaf_application"))
        db.close()
        cls.selection = Selection()

    def test_comparison_is_read_only_and_retains_product_order(self):
        apps = [copy.deepcopy(self.apps[k]) for k in ("github:818991119", "github:668199241")]
        original = copy.deepcopy(apps)
        rows = self.selection.rows(apps, CRM)
        self.assertEqual([r["key"] for r in rows], ["records", "pipeline", "automation", "io", "api", "delivery", "license_boundary"])
        self.assertEqual(apps, original)
        self.assertTrue(all(len(r["cells"]) == 2 for r in rows))
        self.assertEqual(self.selection.rows(apps, "wiki-application"), [])

    def test_source_missing_status_unknown_and_explicit_negative(self):
        fact = {"status": "unsupported", "value": "未内置 REST API", "sources": [{"sha256": "a", "quote": "rather than on a built-in standalone REST API"}]}
        app = {"sources": [{"sha256": "a", "url": "https://example.test/readme", "fetched_at": "2026-10-31"}]}
        self.assertEqual(Selection.bind(app, fact)["status"], "unsupported")
        app["sources"] = None
        self.assertEqual(Selection.bind(app, fact)["status"], "unknown")
        app["sources"] = [{"sha256": "changed", "url": "https://example.test/readme"}]
        self.assertEqual(Selection.bind(app, fact)["status"], "unknown")

    def test_commercial_deep_fields_remain_unknown(self):
        app = copy.deepcopy(self.apps["commercial:salesforce"])
        app["tracks"] = ["commercial"]
        self.assertTrue(all(r["cells"][0]["status"] == "unknown" for r in self.selection.rows([app], CRM)))

    def test_primary_type_preferences_only_reference_existing_relationships(self):
        for app_id, leaf in self.selection.data["primary_types"].items():
            self.assertIn((app_id, leaf), self.links)
        app = {"id": "github:1864233", "types": [{"slug": "contract-to-order-platform"}, {"slug": "enterprise-resource-planning-erp"}]}
        original = copy.deepcopy(app["types"])
        self.selection.decorate(app)
        self.assertEqual(app["types"][0]["slug"], "enterprise-resource-planning-erp")
        self.assertCountEqual(app["types"], original)

    def test_all_published_facts_use_their_own_formal_sources_and_types(self):
        for app_id, types in self.selection.data["products"].items():
            self.assertIn(app_id, self.apps)
            for leaf, facts in types.items():
                self.assertIn((app_id, leaf), self.links)
                for key, fact in facts.items():
                    self.assertNotEqual(Selection.bind(self.apps[app_id], fact)["status"], "unknown", (app_id,key))

    def test_local_snapshot_sha_and_every_published_quote(self):
        total = 0
        for app_id, types in self.selection.data["products"].items():
            for facts in types.values():
                for fact in facts.values():
                    for s in fact["sources"]:
                        path = ROOT / "data/collections/sources" / (s["sha256"] + ".txt")
                        if not path.exists():
                            with self.subTest(app_id=app_id, sha=s["sha256"]):
                                self.skipTest("This source snapshot is local-only")
                            continue
                        raw = path.read_bytes()
                        self.assertEqual(hashlib.sha256(raw).hexdigest(), s["sha256"])
                        self.assertIn(s["quote"], plain(raw.decode()), (app_id,s["quote"]))
                        self.assertNotRegex(s["quote"], r"^[A-Za-z0-9+/]{70,}=?=?$")
                        total += 1
        if not total:
            self.skipTest("Raw source cache is not present; portable product-source binding checks still run")
        self.assertGreater(total, 0)

    def test_approved_facts_are_visible_in_rows_not_shadowed_by_legacy(self):
        for app_id, types in self.selection.data["products"].items():
            for leaf, facts in types.items():
                app = copy.deepcopy(self.apps[app_id])
                app["tracks"] = ["open_source"]
                rows = {r["key"]: r["cells"][0] for r in self.selection.rows([app], leaf)}
                for key, fact in facts.items():
                    self.assertEqual(rows[key], Selection.bind(app, fact), (app_id, key))

    def test_commercial_policy_precedes_any_legacy_evidence(self):
        app = copy.deepcopy(self.apps["github:24459441"])
        app["tracks"] = ["commercial"]
        for leaf in (CRM, HELP_DESK):
            self.assertTrue(all(r["cells"][0]["status"] == "unknown" for r in self.selection.rows([app], leaf)))
