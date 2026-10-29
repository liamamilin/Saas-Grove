import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from server.case_collection import import_batch, validate_batch
from server.store import Store
from server.taxonomy import Taxonomy

LEAF_A = "customer-relationship-management-crm"
LEAF_B = "project-management-application"


class CaseCollectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source_root = self.root / "collections"
        self.database = self.root / "catalog.sqlite"
        self.catalog_path = Path(__file__).resolve().parents[2] / "data" / "taxonomy" / "catalog.json"
        catalog = json.loads(self.catalog_path.read_text(encoding="utf-8"))
        self.assertEqual(Taxonomy().leaves[LEAF_A]["scope"], "included")
        self.assertEqual(Taxonomy().leaves[LEAF_B]["scope"], "included")
        self.leaves = {x["slug"]: x for x in catalog["leaves"]}

    def _source(self, url, body, kind):
        data = body.encode("utf-8") if isinstance(body, str) else body
        digest = hashlib.sha256(data).hexdigest()
        folder = self.source_root / "sources"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{digest}.txt").write_bytes(data)
        return {"url": url, "sha256": digest, "snapshot_path": f"sources/{digest}.txt",
                "fetched_at": "2026-10-23T10:00:00+00:00", "kind": kind}

    def _oss_entry(self, leaf=LEAF_A, github_id=12345):
        repo = "acme/tool"
        metadata_url = f"https://api.github.com/repos/{repo}"
        license_url = f"https://api.github.com/repos/{repo}/license"
        metadata = self._source(metadata_url, json.dumps({"id": github_id, "full_name": repo}), "repository_metadata")
        license_api = {"license": {"spdx_id": "MIT"}, "encoding": "base64",
                       "content": base64.b64encode(b"MIT License\nPermission is hereby granted").decode()}
        license = self._source(license_url, json.dumps(license_api), "license")
        homepage_source = self._source("https://acme.example/docs", "Official project docs", "documentation")
        return {
            "id": f"github:{github_id}", "name": "Acme Tool", "track": "open_source",
            "summary": "A project management application for teams.", "homepage": "https://acme.example",
            "repository_url": f"https://github.com/{repo}", "github_repository_id": github_id,
            "license": "MIT", "license_evidence_url": license_url,
            "features": ["Manage projects", "Track tasks"], "deployment": ["Self-hosted"],
            "technology_stack": ["Python"], "sources": [metadata, license, homepage_source],
            "leaf_matches": [{"slug": leaf, "reason": "Provides project records and task workflows for customer teams.",
                               "source_urls": [homepage_source["url"]]}],
            "verification_status": "official_sources_reviewed", "runtime_tested": False,
        }

    def _full_mit_text(self):
        return ("MIT License\n\nCopyright (c) 2026 Acme\n\n"
                "Permission is hereby granted, free of charge, to any person obtaining a copy\n"
                "of this software and associated documentation files (the \"Software\"), to deal\n"
                "in the Software without restriction, including without limitation the rights\n"
                "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n"
                "copies of the Software, and to permit persons to whom the Software is\n"
                "furnished to do so, subject to the following conditions:\n\n"
                "The above copyright notice and this permission notice shall be included in all\n"
                "copies or substantial portions of the Software.\n\n"
                "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n"
                "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n"
                "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n"
                "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n"
                "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n"
                "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\n"
                "SOFTWARE.\n")

    def _add_license_review(self, entry, source, *, scope="repository", spdx="MIT"):
        entry["license_evidence_url"] = source["url"]
        entry["license_review"] = {
            "reviewer": "source_research", "source_url": source["url"], "spdx_id": spdx,
            "scope": scope,
            "rationale": "已逐段核对该仓库完整许可文本中的授权、分发条件与免责声明条款。",
        }

    def _replace_metadata_with_html(self, entry, *, repository="acme/tool", github_id=12345, url=None):
        source = entry["sources"][0]
        body = (f'<html><head><meta name="octolytics-dimension-repository_id" content="{github_id}">'
                f'<meta name="octolytics-dimension-repository_nwo" content="{repository}"></head></html>')
        html_source = self._source(url or f"https://github.com/{repository}", body, "repository_metadata")
        entry["sources"][0] = html_source
        return html_source

    def _commercial_entry(self, leaf=LEAF_A):
        source = self._source("https://vendor.example/product", "Official product overview", "homepage")
        return {"id": "vendor:acme", "name": "Acme Cloud", "track": "commercial",
                "summary": "Commercial software for customer project operations.", "homepage": "https://vendor.example",
                "sources": [source], "leaf_matches": [{"slug": leaf, "reason": "The vendor describes project records and customer task management.",
                                                          "source_urls": [source["url"]]}],
                "verification_status": "official_sources_reviewed", "runtime_tested": False}

    def _write_batch(self, batch_id, entries, name="batch.json"):
        path = self.root / name
        path.write_text(json.dumps({"schema_version": 1, "batch_id": batch_id, "entries": entries}, ensure_ascii=False), encoding="utf-8")
        return path

    def test_rejects_corrupt_source_hash_and_path_traversal(self):
        for mutation in ("hash", "path"):
            with self.subTest(mutation=mutation):
                entry = self._oss_entry()
                source = entry["sources"][0]
                if mutation == "hash":
                    source["sha256"] = "0" * 64
                    source["snapshot_path"] = f"sources/{'0' * 64}.txt"
                else:
                    source["snapshot_path"] = "../../outside.txt"
                batch = self._write_batch(f"bad-{mutation}", [entry])
                with self.assertRaises(ValueError):
                    validate_batch(batch, self.source_root, self.catalog_path)
                self.assertFalse(self.database.exists())

    def test_rejects_forged_github_repository_identity(self):
        entry = self._oss_entry(github_id=12345)
        metadata_source = entry["sources"][0]
        forged = json.dumps({"id": 99999, "full_name": "acme/tool"}).encode("utf-8")
        forged_hash = hashlib.sha256(forged).hexdigest()
        (self.source_root / metadata_source["snapshot_path"]).unlink()
        (self.source_root / "sources" / f"{forged_hash}.txt").write_bytes(forged)
        metadata_source["sha256"] = forged_hash
        metadata_source["snapshot_path"] = f"sources/{forged_hash}.txt"
        batch = self._write_batch("false-id", [entry])
        with self.assertRaisesRegex(ValueError, "repository_metadata"):
            import_batch(batch, self.database, self.source_root, self.catalog_path)
        self.assertFalse(self.database.exists())

    def test_rejects_unknown_or_excluded_leaf_and_commercial_depth_fields(self):
        unknown = self._oss_entry(leaf="not-a-real-leaf")
        unknown_batch = self._write_batch("unknown-leaf", [unknown], "unknown.json")
        with self.assertRaisesRegex(ValueError, "unknown leaf"):
            validate_batch(unknown_batch, self.source_root, self.catalog_path)
        excluded = self._oss_entry(leaf="general-social-network")
        excluded_batch = self._write_batch("excluded-leaf", [excluded], "excluded.json")
        with self.assertRaisesRegex(ValueError, "excluded leaf"):
            validate_batch(excluded_batch, self.source_root, self.catalog_path)
        commercial = self._commercial_entry()
        commercial["features"] = ["Feature details"]
        commercial_batch = self._write_batch("commercial-depth", [commercial], "commercial.json")
        with self.assertRaisesRegex(ValueError, "unsupported fields"):
            import_batch(commercial_batch, self.database, self.source_root, self.catalog_path)
        self.assertFalse(self.database.exists())

    def test_full_batch_validates_before_any_entry_is_imported(self):
        good = self._oss_entry()
        bad = self._oss_entry(leaf="missing-leaf")
        batch = self._write_batch("atomic-failure", [good, bad])
        with self.assertRaises(ValueError):
            import_batch(batch, self.database, self.source_root, self.catalog_path)
        self.assertFalse(self.database.exists())

    def test_new_leaf_link_is_added_without_deleting_old_link_and_reimport_is_idempotent(self):
        first_entry = self._oss_entry(leaf=LEAF_A)
        first_batch = self._write_batch("first", [first_entry], "first.json")
        first_receipt = import_batch(first_batch, self.database, self.source_root, self.catalog_path)
        self.assertEqual(first_receipt["counts"]["applications_created"], 1)
        self.assertEqual(first_receipt["counts"]["leaf_links_added"], 1)
        self.assertFalse(first_receipt["already_imported"])
        repeated = import_batch(first_batch, self.database, self.source_root, self.catalog_path)
        self.assertTrue(repeated["already_imported"])
        self.assertEqual(repeated["counts"]["leaf_links_added"], 0)
        with Store(self.database).connect() as con:
            repeated_data = json.loads(con.execute(
                "SELECT data FROM application WHERE id=?", ("github:12345",)).fetchone()[0])
        self.assertEqual(repeated_data["features"], ["Manage projects", "Track tasks"])

        second_entry = self._oss_entry(leaf=LEAF_B)
        second_entry["features"] = ["Manage projects", "Review tasks"]
        second_batch = self._write_batch("second", [second_entry], "second.json")
        second_receipt = import_batch(second_batch, self.database, self.source_root, self.catalog_path)
        self.assertEqual(second_receipt["counts"]["leaf_links_added"], 1)
        with Store(self.database).connect() as con:
            links = {row[0] for row in con.execute("SELECT leaf FROM leaf_application WHERE app_id=?", ("github:12345",))}
            app = json.loads(con.execute("SELECT data FROM application WHERE id=?", ("github:12345",)).fetchone()[0])
        self.assertEqual(links, {LEAF_A, LEAF_B})
        self.assertEqual({m["slug"] for m in app["leaf_matches"]}, {LEAF_A, LEAF_B})
        self.assertEqual(Store(self.database).counts()[1]["open_source"], 1)

    def test_invalid_catalog_json_shape_returns_value_error(self):
        entry = self._commercial_entry()
        batch = self._write_batch("bad-catalog-shape", [entry])
        catalog = self.root / "catalog.json"
        catalog.write_text("[]", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "catalog must be an object"):
            validate_batch(batch, self.source_root, catalog)

    def test_license_must_be_official_osi_license_with_matching_evidence(self):
        entry = self._oss_entry()
        entry["license"] = "NOASSERTION"
        batch = self._write_batch("not-osi", [entry])
        with self.assertRaisesRegex(ValueError, "OSI"):
            validate_batch(batch, self.source_root, self.catalog_path)

    def test_github_identity_and_license_evidence_require_exact_api_endpoints(self):
        for source_index, fake_url, batch_id, message in (
            (0, "https://api.github.com/prefix/repos/acme/tool", "wrong-metadata-path", "repository_metadata"),
            (1, "https://api.github.com/prefix/repos/acme/tool/license", "wrong-license-path", "license source"),
        ):
            with self.subTest(url=fake_url):
                entry = self._oss_entry()
                entry["sources"][source_index]["url"] = fake_url
                if source_index == 1:
                    entry["license_evidence_url"] = fake_url
                batch = self._write_batch(batch_id, [entry], f"{batch_id}.json")
                with self.assertRaisesRegex(ValueError, message):
                    validate_batch(batch, self.source_root, self.catalog_path)

    def test_json_evidence_arrays_are_rejected_as_value_errors(self):
        entry = self._oss_entry()
        source = entry["sources"][0]
        body = b"[]"
        digest = hashlib.sha256(body).hexdigest()
        (self.source_root / source["snapshot_path"]).unlink()
        (self.source_root / "sources" / f"{digest}.txt").write_bytes(body)
        source.update(sha256=digest, snapshot_path=f"sources/{digest}.txt")
        batch = self._write_batch("metadata-array", [entry])
        with self.assertRaisesRegex(ValueError, "repository_metadata"):
            validate_batch(batch, self.source_root, self.catalog_path)

        entry = self._oss_entry()
        source = entry["sources"][1]
        body = b"[]"
        digest = hashlib.sha256(body).hexdigest()
        (self.source_root / source["snapshot_path"]).unlink()
        (self.source_root / "sources" / f"{digest}.txt").write_bytes(body)
        source.update(sha256=digest, snapshot_path=f"sources/{digest}.txt")
        batch = self._write_batch("license-array", [entry], "license-array.json")
        with self.assertRaisesRegex(ValueError, "license source"):
            validate_batch(batch, self.source_root, self.catalog_path)

    def test_github_html_identity_requires_both_exact_repository_metas_and_url(self):
        for mutation, message in (("id", "repository_metadata"), ("url", "repository_metadata")):
            with self.subTest(mutation=mutation):
                entry = self._oss_entry()
                if mutation == "id":
                    self._replace_metadata_with_html(entry, github_id=99999)
                else:
                    self._replace_metadata_with_html(entry, url="https://github.com/acme/other")
                batch = self._write_batch(f"html-identity-{mutation}", [entry])
                with self.assertRaisesRegex(ValueError, message):
                    validate_batch(batch, self.source_root, self.catalog_path)

        entry = self._oss_entry()
        self._replace_metadata_with_html(entry)
        batch = self._write_batch("html-identity-valid", [entry])
        self.assertTrue(validate_batch(batch, self.source_root, self.catalog_path)["entries"])

    def test_raw_full_license_review_accepts_only_bound_complete_matching_text(self):
        good_text = self._full_mit_text()
        for mutation in ("missing-review", "wrong-repository", "truncated", "wrong-spdx"):
            with self.subTest(mutation=mutation):
                entry = self._oss_entry()
                if mutation == "truncated":
                    good = self._source("https://raw.githubusercontent.com/acme/tool/main/LICENSE",
                                        good_text[:180], "license")
                else:
                    good = self._source("https://raw.githubusercontent.com/acme/tool/main/LICENSE",
                                        good_text, "license")
                entry["sources"][1] = good
                entry["license_evidence_url"] = good["url"]
                if mutation != "missing-review":
                    self._add_license_review(entry, good, spdx="Apache-2.0" if mutation == "wrong-spdx" else "MIT")
                if mutation == "wrong-repository":
                    other = self._source("https://raw.githubusercontent.com/other/tool/main/LICENSE",
                                         good_text, "license")
                    entry["sources"][1] = other
                    entry["license_evidence_url"] = other["url"]
                    entry["license_review"]["source_url"] = other["url"]
                batch = self._write_batch(f"raw-license-{mutation}", [entry])
                with self.assertRaises(ValueError):
                    validate_batch(batch, self.source_root, self.catalog_path)

        entry = self._oss_entry()
        good = self._source("https://raw.githubusercontent.com/acme/tool/main/LICENSE", good_text, "license")
        entry["sources"][1] = good
        self._add_license_review(entry, good)
        batch = self._write_batch("raw-license-valid", [entry])
        self.assertTrue(validate_batch(batch, self.source_root, self.catalog_path)["entries"])

    def test_noassertion_license_uses_full_review_and_community_scope_requires_summary(self):
        entry = self._oss_entry()
        license_url = "https://api.github.com/repos/acme/tool/license"
        complete = self._full_mit_text()
        api = {"license": {"spdx_id": "NOASSERTION"}, "encoding": "base64",
               "content": base64.b64encode(complete.encode()).decode()}
        source = self._source(license_url, json.dumps(api), "license")
        entry["sources"][1] = source
        self._add_license_review(entry, source, scope="community_core")
        entry["summary"] = "该项目以开源核心提供团队密钥管理工作流。"
        batch = self._write_batch("noassertion-reviewed", [entry])
        self.assertTrue(validate_batch(batch, self.source_root, self.catalog_path)["entries"])

        entry["summary"] = "团队密钥管理工作流。"
        batch = self._write_batch("noassertion-community-unclear", [entry])
        with self.assertRaisesRegex(ValueError, "explicit in the summary"):
            validate_batch(batch, self.source_root, self.catalog_path)


if __name__ == "__main__":
    unittest.main()
