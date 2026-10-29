import base64
import hashlib
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server.case_scope_review as case_review
import server.scope_publication as legacy_publication
from server.store import Store
from server.taxonomy import build_catalog


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


class CaseScopeReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.tax = self.root / "data/taxonomy"
        self.collections = self.root / "data/collections"
        self.tax.mkdir(parents=True)
        self.collections.mkdir(parents=True)
        self.database = self.root / "var/catalog.sqlite"
        self.run = self.root / "var/case-scope/case-fixture"
        self.source = {"schema_version": 1, "source": "fixture", "categories": [
            {"id": "domain", "name": "Domain", "name_zh": "领域", "parent_id": None},
            {"id": "group", "name": "Group", "name_zh": "分类", "parent_id": "domain"}],
            "leaves": [{"slug": slug, "name": slug, "name_zh": slug, "aliases_zh": [],
                        "parent_id": "group", "domain_id": "domain"}
                       for slug in ("case-leaf", "other-conditional", "outside-queue", "excluded-leaf")]}
        self.policy = {"version": 1, "default": {"scope": "conditional", "reason": "Requires case evidence."},
                       "sections": {}, "leaves": {"excluded-leaf": {"scope": "excluded", "reason": "Outside scope."}},
                       "reviewed_leaf_slugs": [row["slug"] for row in self.source["leaves"]]}
        self.overrides = {"categories": {"domain": {"name_zh": "保留的领域名称"}},
                          "leaves": {"case-leaf": {"name_zh": "保留的叶子名称", "aliases_zh": ["保留别名"]},
                                     "outside-queue": {"scope": "included", "scope_reason": "Preserve this decision."}}}
        self.catalog = build_catalog(self.source, self.policy, self.overrides)
        for name, value in (("atlas-source.json", self.source), ("scope-policy.json", self.policy),
                            ("overrides.json", self.overrides), ("catalog.json", self.catalog)):
            (self.tax / name).write_bytes(encoded(value))
        (self.tax / "scope-review.csv").write_bytes(b"original CSV\n")
        self.legacy = self.tax / "leaf-reviews"
        self.legacy.mkdir()
        for name in ("publication.json", "decisions.json", "summary.json", "decisions.csv"):
            (self.legacy / name).write_bytes(b"immutable 548 evidence\n")
        self.app = self.commercial_app()
        Store(self.database).save(self.app, ["case-leaf"], ["commercial"])
        self.review = {"schema_version": 1, "run_id": "case-fixture", "base_revision": self.catalog["revision"],
                       "decisions": [{"slug": "case-leaf", "final_scope": "included",
                                      "reason": "The imported official case establishes the complete customer workflow.",
                                      "service_boundary": "Customer-managed workflow application, excluding bare engines.",
                                      "application_ids": [self.app["id"]],
                                      "source_urls": [self.app["leaf_matches"][0]["source_urls"][0]],
                                      "reviewer": "fixture-reviewer"}]}
        self.review_path = self.root / "review.json"
        self.write_review()

    def source_record(self, url, text, kind="documentation"):
        body = text.encode("utf-8") if isinstance(text, str) else text
        digest = hashlib.sha256(body).hexdigest()
        folder = self.collections / "sources"
        folder.mkdir(exist_ok=True)
        (folder / f"{digest}.txt").write_bytes(body)
        return {"url": url, "sha256": digest, "snapshot_path": f"sources/{digest}.txt",
                "fetched_at": "2026-10-23T10:00:00+00:00", "kind": kind}

    def commercial_app(self):
        main = self.source_record("https://vendor.example/product", "Official workflow application product documentation.")
        unrelated = self.source_record("https://vendor.example/about", "Official company history.", "homepage")
        return {"id": "vendor:fixture", "name": "Fixture Cloud", "track": "commercial",
                "summary": "A commercial customer workflow application.", "homepage": "https://vendor.example",
                "sources": [main, unrelated], "leaf_matches": [
                    {"slug": "case-leaf", "reason": "Official documentation describes the full customer workflow.",
                     "source_urls": [main["url"]]}],
                "verification_status": "official_sources_reviewed", "runtime_tested": False}

    def oss_app(self):
        metadata = self.source_record("https://api.github.com/repos/acme/tool",
                                      encoded({"id": 123, "full_name": "acme/tool"}), "repository_metadata")
        license_source = self.source_record("https://api.github.com/repos/acme/tool/license", encoded({
            "license": {"spdx_id": "MIT"}, "encoding": "base64",
            "content": base64.b64encode(b"MIT License\nPermission is hereby granted.").decode()}), "license")
        docs = self.source_record("https://oss.example/docs", "Official software deployment and customer workflow.")
        return {"id": "github:123", "name": "Fixture OSS", "track": "open_source", "summary": "Customer workflow software.",
                "homepage": "https://oss.example", "repository_url": "https://github.com/acme/tool",
                "github_repository_id": 123, "license": "MIT", "license_evidence_url": license_source["url"],
                "features": ["Customer workflow"], "deployment": ["Official Docker deployment"], "technology_stack": ["Python"],
                "sources": [metadata, license_source, docs], "leaf_matches": [
                    {"slug": "case-leaf", "reason": "Provides a complete customer workflow application.", "source_urls": [docs["url"]]}],
                "verification_status": "official_sources_reviewed", "runtime_tested": False}

    def write_review(self):
        self.review_path.write_bytes(encoded(self.review))

    def save_app(self, app=None, leaves=None):
        app = app or self.app
        Store(self.database).save(app, leaves or ["case-leaf"], [app["track"]])

    def snapshot(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes()
                for p in self.root.rglob("*") if p.is_file()}

    def check(self):
        return case_review.check(self.review_path, self.database, self.root)

    def publish(self):
        return case_review.publish(self.review_path, self.database, self.root)

    def test_check_is_read_only_and_reports_verified_evidence(self):
        before = self.snapshot()
        result = self.check()
        self.assertEqual(result["changed_slugs"], ["case-leaf"])
        self.assertEqual(result["evidence_sources"][0]["applications"][0]["sources"], [self.app["sources"][0]])
        self.assertFalse(self.run.exists())
        self.assertEqual(before, self.snapshot())

    def test_unknown_id_and_missing_database_are_rejected_without_creation(self):
        self.review["decisions"][0]["application_ids"] = ["vendor:missing"]
        self.write_review()
        with self.assertRaisesRegex(ValueError, "unknown application id"):
            self.check()
        missing = self.root / "missing/catalog.sqlite"
        with self.assertRaisesRegex(ValueError, "database does not exist"):
            case_review.check(self.review_path, missing, self.root)
        self.assertFalse(missing.parent.exists())

    def test_sql_relation_and_json_leaf_match_are_both_required(self):
        with sqlite3.connect(self.database) as con:
            con.execute("DELETE FROM leaf_application WHERE leaf='case-leaf'")
        with self.assertRaisesRegex(ValueError, "no leaf_application relation"):
            self.check()
        self.save_app(leaves=["case-leaf", "other-conditional"])
        self.review["decisions"][0]["slug"] = "other-conditional"
        self.write_review()
        with self.assertRaisesRegex(ValueError, "leaf_matches does not establish"):
            self.check()

    def test_source_must_be_cited_by_this_leaf_relation(self):
        self.review["decisions"][0]["source_urls"] = [self.app["sources"][1]["url"]]
        self.write_review()
        with self.assertRaisesRegex(ValueError, "not used by this application leaf match"):
            self.check()
        self.review["decisions"][0]["source_urls"] = [self.app["sources"][0]["url"], "https://wrong.example"]
        self.write_review()
        with self.assertRaisesRegex(ValueError, "outside the cited leaf relation"):
            self.check()

    def test_snapshot_corruption_and_unverified_app_are_rejected(self):
        snapshot = self.collections / self.app["sources"][0]["snapshot_path"]
        original = snapshot.read_bytes()
        snapshot.write_bytes(b"changed source")
        with self.assertRaisesRegex(ValueError, "snapshot sha256 mismatch"):
            self.check()
        snapshot.write_bytes(original)
        self.app["verification_status"] = "not_reviewed"
        self.save_app()
        with self.assertRaisesRegex(ValueError, "official_sources_reviewed"):
            self.check()

    def test_unknown_license_cannot_be_published_as_open_source(self):
        app = self.oss_app()
        self.save_app(app)
        row = self.review["decisions"][0]
        row["application_ids"] = [app["id"]]
        row["source_urls"] = app["leaf_matches"][0]["source_urls"]
        self.write_review()
        self.assertTrue(self.check()["valid"])
        app["license"] = "NOASSERTION"
        self.save_app(app)
        with self.assertRaisesRegex(ValueError, "license must be"):
            self.check()

    def test_old_revision_and_nonconditional_or_unknown_leaves_are_rejected(self):
        self.review["base_revision"] = "outdated-revision"
        self.write_review()
        with self.assertRaisesRegex(ValueError, "base_revision"):
            self.check()
        self.review["base_revision"] = self.catalog["revision"]
        for slug in ("outside-queue", "excluded-leaf", "not-a-leaf"):
            self.review["decisions"][0]["slug"] = slug
            self.write_review()
            with self.subTest(slug=slug), self.assertRaises(ValueError):
                self.check()

    def test_included_requires_cases_and_excluded_is_never_allowed(self):
        row = self.review["decisions"][0]
        row["application_ids"], row["source_urls"] = [], []
        self.write_review()
        with self.assertRaisesRegex(ValueError, "requires an imported case"):
            self.check()
        row["final_scope"] = "excluded"
        self.write_review()
        with self.assertRaisesRegex(ValueError, "only included/conditional"):
            self.check()
        row["final_scope"] = "conditional"
        self.write_review()
        self.assertEqual(self.check()["changed_slugs"], [])

    def test_retained_conditional_has_no_case_verification_claim(self):
        row = self.review["decisions"][0]
        row.update(final_scope="conditional", application_ids=[], source_urls=[])
        self.write_review()
        self.publish()
        publication = json.loads((self.collections / "case-fixture-scope-publication.json").read_text())
        self.assertEqual(publication["changed_slugs"], [])
        self.assertEqual(publication["case_verification"], "not_performed")
        self.assertEqual(publication["before_counts"], publication["after_counts"])

    def test_schema_rejects_duplicate_decisions_short_reason_and_unsafe_run_id(self):
        original = encoded(self.review)
        for mutation in ("duplicate", "reason", "run_id", "extra"):
            self.review = json.loads(original)
            if mutation == "duplicate":
                self.review["decisions"].append(dict(self.review["decisions"][0]))
            elif mutation == "reason":
                self.review["decisions"][0]["reason"] = "Too short"
            elif mutation == "run_id":
                self.review["run_id"] = "../old-548"
            else:
                self.review["decisions"][0]["unsupported"] = "extra"
            self.write_review()
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                self.check()

    def test_custom_run_root_cannot_write_historical_evidence(self):
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, "historical leaf review"):
            case_review.publish(self.review_path, self.database, self.root, self.legacy / "case-run")
        self.assertEqual(before, self.snapshot())

    def test_change_after_validation_is_rejected_before_saving_state(self):
        real_prepare = case_review._prepare

        def prepare_and_modify(*args):
            plan = real_prepare(*args)
            path = self.tax / "overrides.json"
            path.write_bytes(path.read_bytes() + b" ")
            return plan

        with patch.object(case_review, "_prepare", prepare_and_modify):
            with self.assertRaisesRegex(ValueError, "input changed while validating"):
                self.publish()
        self.assertFalse(self.run.exists())

    def test_publish_preserves_outside_scopes_display_and_548_evidence(self):
        before = self.snapshot()
        result = self.publish()
        self.assertFalse(result["idempotent"])
        overrides = json.loads((self.tax / "overrides.json").read_text())
        self.assertEqual(overrides["categories"], self.overrides["categories"])
        self.assertEqual(overrides["leaves"]["case-leaf"]["name_zh"], "保留的叶子名称")
        self.assertEqual(overrides["leaves"]["case-leaf"]["aliases_zh"], ["保留别名"])
        self.assertEqual(overrides["leaves"]["outside-queue"], self.overrides["leaves"]["outside-queue"])
        leaves = {row["slug"]: row for row in json.loads((self.tax / "catalog.json").read_text())["leaves"]}
        self.assertEqual(leaves["case-leaf"]["scope"], "included")
        for old in self.catalog["leaves"]:
            if old["slug"] != "case-leaf":
                self.assertEqual(leaves[old["slug"]], old)
        after = self.snapshot()
        for name, content in before.items():
            if name.startswith("data/taxonomy/leaf-reviews/") or name.startswith("var/catalog.sqlite"):
                self.assertEqual(after[name], content)
        self.assertEqual((self.run / "overrides.before-publication.json").read_bytes(), before["data/taxonomy/overrides.json"])
        self.assertEqual((self.run / "catalog.before-publication.json").read_bytes(), before["data/taxonomy/catalog.json"])
        self.assertEqual((self.run / "scope-review.before-publication.csv").read_bytes(), b"original CSV\n")
        publication = json.loads((self.collections / "case-fixture-scope-publication.json").read_text())
        self.assertEqual(publication["changed_slugs"], ["case-leaf"])
        self.assertEqual(publication["before_counts"]["included"], 1)
        self.assertEqual(publication["after_counts"]["included"], 2)
        self.assertEqual(publication["decisions"], self.review["decisions"])

    def test_repeat_publish_and_check_are_read_only_and_idempotent(self):
        first = self.publish()
        before = self.snapshot()
        repeated = self.publish()
        self.assertTrue(repeated["idempotent"])
        self.assertEqual(first["receipt"], repeated["receipt"])
        self.assertTrue(self.check()["already_published"])
        self.assertEqual(before, self.snapshot())

    def test_replay_rejects_changed_review_policy_source_or_case(self):
        self.publish()
        self.review["decisions"][0]["reason"] += " Modified after publication."
        self.write_review()
        with self.assertRaisesRegex(ValueError, "inputs changed"):
            self.publish()
        self.review["decisions"][0]["reason"] = self.review["decisions"][0]["reason"].removesuffix(" Modified after publication.")
        self.write_review()
        for name in ("scope-policy.json", "atlas-source.json"):
            path = self.tax / name
            original = path.read_bytes()
            value = json.loads(original)
            value["extra_binding_field"] = "third-party change"
            path.write_bytes(encoded(value))
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "bound|inputs changed"):
                self.publish()
            path.write_bytes(original)
        self.app["summary"] += " Changed after publication."
        self.save_app()
        with self.assertRaisesRegex(ValueError, "inputs changed"):
            self.publish()

    def test_external_artifact_changes_and_deleted_receipt_are_rejected(self):
        self.publish()
        for path in (self.tax / "catalog.json", self.tax / "overrides.json", self.tax / "scope-review.csv",
                     self.collections / "case-fixture-scope-publication.json", self.run / "catalog.before-publication.json"):
            original = path.read_bytes()
            path.write_bytes(original + b" ")
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "external modification"):
                self.publish()
            path.write_bytes(original)
        (self.run / "publication-receipt.json").unlink()
        self.assertTrue(self.publish()["resumed"])

    def test_interrupted_publication_resumes_mixed_before_and_target_artifacts(self):
        real_write = legacy_publication._atomic_write

        def interrupted(path, content):
            if Path(path) == self.tax / "catalog.json":
                raise OSError("simulated process interruption")
            return real_write(path, content)

        with patch.object(legacy_publication, "_atomic_write", interrupted):
            with self.assertRaisesRegex(OSError, "simulated"):
                self.publish()
        self.assertTrue((self.run / "publication-state.json").exists())
        self.assertFalse((self.run / "publication-receipt.json").exists())
        self.assertEqual(json.loads((self.tax / "catalog.json").read_text()), self.catalog)
        self.assertEqual(json.loads((self.tax / "overrides.json").read_text())["leaves"]["case-leaf"]["scope"], "included")
        before = self.snapshot()
        self.assertTrue(self.check()["valid"])
        self.assertEqual(before, self.snapshot())
        result = self.publish()
        self.assertTrue(result["resumed"])
        self.assertTrue(self.publish()["idempotent"])

    def test_interrupted_resume_rejects_external_changes_and_modified_targets(self):
        with patch.object(case_review, "_resume_publication", side_effect=OSError("stop before writes")):
            with self.assertRaises(OSError):
                self.publish()
        original = (self.tax / "overrides.json").read_bytes()
        (self.tax / "overrides.json").write_bytes(original + b" ")
        with self.assertRaisesRegex(ValueError, "external modification"):
            self.publish()
        (self.tax / "overrides.json").write_bytes(original)
        state_path = self.run / "publication-state.json"
        state = json.loads(state_path.read_text())
        entry = state["artifacts"][str(self.tax / "scope-review.csv")]
        entry["target_base64"] = base64.b64encode(b"modified recovery target").decode()
        entry["target_sha256"] = hashlib.sha256(b"modified recovery target").hexdigest()
        state_path.write_bytes(encoded(state))
        with self.assertRaisesRegex(ValueError, "targets differ"):
            self.publish()

    def test_cli_check_supports_test_root_without_creating_run(self):
        script = Path(__file__).resolve().parents[2] / "scripts/confirm_case_scopes.py"
        before = self.snapshot()
        result = subprocess.run([sys.executable, str(script), "check", "--review", str(self.review_path),
                                 "--database", str(self.database), "--test-root", str(self.root)],
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["valid"])
        self.assertEqual(before, self.snapshot())


if __name__ == "__main__":
    unittest.main()
