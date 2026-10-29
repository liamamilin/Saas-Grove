import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server.scope_publication as publication
from server.scope_publication import check, publish
from server.taxonomy import build_catalog


GROUP_COUNTS = {"exclusions": 203, "mixed-a": 173, "mixed-b": 172}


def encoded(obj):
    return (json.dumps(obj, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


class ScopePublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.run = self.root / "var/leaf-review/recheck-548"
        self.results = self.root / "data/taxonomy/leaf-reviews/rechecks"
        self.review_dir = self.root / "data/taxonomy/leaf-reviews"
        self.tax = self.root / "data/taxonomy"
        for directory in (self.run, self.results, self.review_dir, self.tax):
            directory.mkdir(parents=True, exist_ok=True)

        slugs = [f"leaf-{i:03}" for i in range(548)]
        self.outside_slug = "outside-queue"
        source = {"schema_version": 1, "source": "fixture", "categories": [
            {"id": "domain", "name": "Domain", "name_zh": "领域", "parent_id": None},
            {"id": "group", "name": "Group", "name_zh": "分类", "parent_id": "domain"}],
            "leaves": [{"slug": s, "name": s, "name_zh": s, "aliases_zh": [],
                        "parent_id": "group", "domain_id": "domain"} for s in slugs + [self.outside_slug]]}
        self.source_path = self.tax / "atlas-source.json"
        self.source_path.write_bytes(encoded(source))
        self.queue_path = self.review_dir / "review-queue.json"
        self.queue_path.write_bytes(encoded({"schema_version": 1,
                                             "items": [{"slug": slug} for slug in slugs]}))
        self.source_hash = digest(self.source_path.read_bytes())
        self.queue_hash = digest(self.queue_path.read_bytes())

        groups = {}
        offset = 0
        for group, count in GROUP_COUNTS.items():
            group_slugs = slugs[offset:offset + count]
            offset += count
            packet = {"schema_version": 1, "run_id": "saas-recheck-548-v1",
                      "source_sha256": self.source_hash, "queue_sha256": self.queue_hash,
                      "items": [{"leaf": {"slug": s}} for s in group_slugs]}
            packet_bytes = encoded(packet)
            (self.run / f"{group}.json").write_bytes(packet_bytes)
            groups[group] = {"count": count, "slugs": group_slugs, "packet_sha256": digest(packet_bytes)}
            review = {"schema_version": 1, "run_id": "saas-recheck-548-v1",
                      "reviewer": "fixture-reviewer", "source_sha256": self.source_hash,
                      "queue_sha256": self.queue_hash,
                      "items": [{"slug": s, "final_scope": "included", "reason": "Fixture definition review establishes a distinct software workflow.",
                                 "service_boundary": "Customer-operated workflow application.", "review_outcome": "confirmed",
                                 "evidence_status": "definition_reviewed", "sources": []} for s in group_slugs]}
            (self.results / f"{group}.json").write_bytes(encoded(review))

        manifest = {"schema_version": 1, "run_id": "saas-recheck-548-v1",
                    "source_sha256": self.source_hash, "queue_sha256": self.queue_hash,
                    "groups": groups}
        self.manifest_path = self.run / "manifest.json"
        self.manifest_path.write_bytes(encoded(manifest))
        self.policy = {"version": 1, "default": {"scope": "excluded", "reason": "Default fixture policy."},
                       "sections": {}, "leaves": {}, "reviewed_leaf_slugs": slugs + [self.outside_slug]}
        self.policy_path = self.tax / "scope-policy.json"
        self.policy_path.write_bytes(encoded(self.policy))
        overrides = {"categories": {"domain": {"name_zh": "本地领域名称"}},
                     "leaves": {"leaf-000": {"name_zh": "本地显示名称", "aliases_zh": ["本地别名"]},
                                self.outside_slug: {"scope": "conditional", "scope_reason": "Keep local decision."}}}
        self.overrides_path = self.tax / "overrides.json"
        self.overrides_path.write_bytes(encoded(overrides))
        initial_catalog = build_catalog(source, self.policy, overrides)
        self.catalog_path = self.tax / "catalog.json"
        self.catalog_path.write_bytes(encoded(initial_catalog))

    def tearDown(self):
        self.tmp.cleanup()

    def paths(self):
        return (self.manifest_path, self.queue_path, self.source_path, self.run,
                self.results, self.tax)

    def snapshot(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes()
                for p in self.root.rglob("*") if p.is_file()}

    def test_check_is_read_only_and_accepts_exact_coverage(self):
        before = self.snapshot()
        result = check(*self.paths())
        self.assertEqual(result["coverage"], 548)
        self.assertEqual(before, self.snapshot())

    def test_missing_duplicate_unknown_and_stale_inputs_are_rejected(self):
        review_path = self.results / "mixed-a.json"
        original = json.loads(review_path.read_text())
        cases = []
        missing = dict(original)
        missing["items"] = original["items"][:-1]
        cases.append(missing)
        duplicate = dict(original)
        duplicate["items"] = original["items"][:-1] + [original["items"][0]]
        cases.append(duplicate)
        unknown = dict(original)
        unknown["items"] = [dict(x) for x in original["items"]]
        unknown["items"][-1]["slug"] = "unknown-leaf"
        cases.append(unknown)
        for invalid in cases:
            review_path.write_bytes(encoded(invalid))
            with self.assertRaises(ValueError):
                check(*self.paths())
        review_path.write_bytes(encoded(original))

        manifest = json.loads(self.manifest_path.read_text())
        manifest["source_sha256"] = "0" * 64
        self.manifest_path.write_bytes(encoded(manifest))
        with self.assertRaisesRegex(ValueError, "source hash"):
            check(*self.paths())
        manifest["source_sha256"] = self.source_hash
        self.manifest_path.write_bytes(encoded(manifest))
        self.queue_path.write_bytes(encoded({"schema_version": 1, "items": [{"slug": "changed-queue"}]}))
        with self.assertRaisesRegex(ValueError, "queue hash"):
            check(*self.paths())
        self.queue_path.write_bytes(encoded({"schema_version": 1,
                                             "items": [{"slug": f"leaf-{i:03}"} for i in range(548)]}))

        packet_path = self.run / "mixed-a.json"
        packet = json.loads(packet_path.read_text())
        packet["items"][0]["leaf"]["slug"] = "changed-packet"
        packet_path.write_bytes(encoded(packet))
        with self.assertRaisesRegex(ValueError, "packet hash"):
            check(*self.paths())

    def test_publish_preserves_local_fields_and_changes_only_queue(self):
        result = publish(*self.paths()[:5], self.tax, self.review_dir)
        self.assertFalse(result["idempotent"])
        overrides = json.loads(self.overrides_path.read_text())
        self.assertEqual(overrides["categories"]["domain"]["name_zh"], "本地领域名称")
        self.assertEqual(overrides["leaves"]["leaf-000"]["name_zh"], "本地显示名称")
        self.assertEqual(overrides["leaves"]["leaf-000"]["aliases_zh"], ["本地别名"])
        self.assertEqual(overrides["leaves"][self.outside_slug]["scope"], "conditional")
        catalog = json.loads(self.catalog_path.read_text())
        leaves = {row["slug"]: row for row in catalog["leaves"]}
        self.assertEqual(leaves[self.outside_slug]["scope"], "conditional")
        self.assertEqual(leaves["leaf-000"]["scope"], "included")
        publication = json.loads((self.review_dir / "publication.json").read_text())
        self.assertEqual(publication["coverage"], 548)
        self.assertEqual(publication["evidence_status"], "definition_reviewed")
        self.assertEqual(publication["case_verification"], "not_performed")
        self.assertTrue((self.run / "overrides.before-publication.json").exists())
        self.assertTrue((self.run / "catalog.before-publication.json").exists())

    def test_repeat_publish_is_idempotent_and_rejects_changed_review(self):
        args = (*self.paths()[:5], self.tax, self.review_dir)
        publish(*args)
        before = self.snapshot()
        repeated = publish(*args)
        self.assertTrue(repeated["idempotent"])
        self.assertEqual(before, self.snapshot())

        review_path = self.results / "mixed-b.json"
        review = json.loads(review_path.read_text())
        review["items"][0]["reason"] = "Changed reason after initial publication for this software workflow."
        review_path.write_bytes(encoded(review))
        with self.assertRaisesRegex(ValueError, "inputs changed"):
            publish(*args)

    def test_preexisting_conflicting_scope_is_rejected(self):
        overrides = json.loads(self.overrides_path.read_text())
        overrides["leaves"]["leaf-000"] = {"scope": "conditional", "scope_reason": "conflict"}
        self.overrides_path.write_bytes(encoded(overrides))
        with self.assertRaisesRegex(ValueError, "conflicting local scope"):
            check(*self.paths())

    def test_source_notes_and_adjudication_are_preserved_and_fingerprinted(self):
        review_path = self.results / "exclusions.json"
        review = json.loads(review_path.read_text())
        review["items"][0]["sources"] = [{"url": "https://example.org/policy", "note": "Definition page, section 2."}]
        review["items"][0]["adjudication"] = {
            "reviewer": "senior-reviewer", "original_scope": "conditional",
            "reason": "The original concern was resolved by the explicit customer workflow."}
        review_path.write_bytes(encoded(review))

        result = check(*self.paths())
        decision = result["decisions"][0]
        self.assertEqual(decision["sources"], review["items"][0]["sources"])
        self.assertEqual(decision["adjudication"], review["items"][0]["adjudication"])
        args = (*self.paths()[:5], self.tax, self.review_dir)
        publish(*args)
        published_decisions = json.loads((self.review_dir / "decisions.json").read_text())
        published = next(row for row in published_decisions["items"] if row["slug"] == review["items"][0]["slug"])
        self.assertEqual(published["sources"], review["items"][0]["sources"])
        self.assertEqual(published["adjudication"], review["items"][0]["adjudication"])
        self.assertTrue(publish(*args)["idempotent"])

        review["items"][0]["adjudication"]["reason"] = "Revised provenance reason after publication."
        review_path.write_bytes(encoded(review))
        with self.assertRaisesRegex(ValueError, "inputs changed"):
            publish(*args)

    def test_source_object_requires_url_and_note_and_legacy_url_is_allowed(self):
        review_path = self.results / "mixed-a.json"
        review = json.loads(review_path.read_text())
        item = review["items"][0]
        item["sources"] = [{"url": "https://example.org", "note": "Source note."}]
        review_path.write_bytes(encoded(review))
        self.assertTrue(check(*self.paths())["valid"])
        item["sources"] = ["https://example.org/legacy"]
        review_path.write_bytes(encoded(review))
        self.assertTrue(check(*self.paths())["valid"])
        item["sources"] = [{"url": "https://example.org", "note": "   "}]
        review_path.write_bytes(encoded(review))
        with self.assertRaisesRegex(ValueError, "source must be"):
            check(*self.paths())

    def test_actual_queue_slug_set_must_match_manifest_even_with_fresh_hashes(self):
        queue = json.loads(self.queue_path.read_text())
        queue["items"][0]["slug"] = "not-in-manifest"
        self.queue_path.write_bytes(encoded(queue))
        self.queue_hash = digest(self.queue_path.read_bytes())
        manifest = json.loads(self.manifest_path.read_text())
        manifest["queue_sha256"] = self.queue_hash
        for group in GROUP_COUNTS:
            packet_path = self.run / f"{group}.json"
            packet = json.loads(packet_path.read_text())
            packet["queue_sha256"] = self.queue_hash
            packet_path.write_bytes(encoded(packet))
            manifest["groups"][group]["packet_sha256"] = digest(packet_path.read_bytes())
            review_path = self.results / f"{group}.json"
            review = json.loads(review_path.read_text())
            review["queue_sha256"] = self.queue_hash
            review_path.write_bytes(encoded(review))
        self.manifest_path.write_bytes(encoded(manifest))
        with self.assertRaisesRegex(ValueError, "actual review queue coverage"):
            check(*self.paths())

    def test_interrupted_publish_resumes_and_external_modification_is_rejected(self):
        args = (*self.paths()[:5], self.tax, self.review_dir)
        original_atomic = publication._atomic_write
        failed = {"done": False}

        def fail_once(path, content):
            if Path(path) == self.catalog_path and not failed["done"]:
                failed["done"] = True
                raise OSError("injected interruption")
            return original_atomic(path, content)

        with patch.object(publication, "_atomic_write", side_effect=fail_once):
            with self.assertRaisesRegex(OSError, "injected interruption"):
                publish(*args)
        resumed = publish(*args)
        self.assertTrue(resumed["resumed"])
        self.assertTrue((self.run / "publication-receipt.json").exists())
        self.assertTrue(publish(*args)["idempotent"])

        # A second independent fixture verifies that recovery refuses an unrecognized write.
        self.tearDown()
        self.setUp()
        args = (*self.paths()[:5], self.tax, self.review_dir)
        failed["done"] = False
        with patch.object(publication, "_atomic_write", side_effect=fail_once):
            with self.assertRaisesRegex(OSError, "injected interruption"):
                publish(*args)
        target = self.tax / "scope-review.csv"
        target.write_bytes(b"external modification\n")
        with self.assertRaisesRegex(ValueError, "external modification detected"):
            publish(*args)


if __name__ == "__main__":
    unittest.main()
