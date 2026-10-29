import json
import tempfile
import unittest
from pathlib import Path

from server.leaf_review import PROMPT_VERSION, assemble, prepare, status, validate_batch


class LeafReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.source_path = self.base / "atlas-source.json"
        self.run_root = self.base / "run"
        self.results = self.base / "results"
        self.catalog = self.base / "catalog.json"
        self.catalog.write_text(json.dumps({"leaves": []}), encoding="utf-8")
        self._write_source(["zeta", "alpha", "beta"])

    def tearDown(self):
        self.tmp.cleanup()

    def _write_source(self, slugs):
        source = {"categories": [{"id": "d", "parent_id": None}, {"id": "p", "parent_id": "d"}],
                  "leaves": [{"slug": s, "name": s, "name_zh": s, "parent_id": "p", "domain_id": "d",
                              "overview_zh": "完整定义 " + s, "dc_zh": "判定标准 " + s, "rules_zh": "不可带入"} for s in slugs]}
        self.source_path.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")

    def _result(self, batch_id, changes=None):
        m = json.loads((self.run_root / "manifest.json").read_text(encoding="utf-8"))
        b = next(x for x in m["batches"] if x["batch_id"] == batch_id)
        items = [{"slug": slug, "verdict": "included", "confidence": "medium", "software_role": "customer_software",
                  "service_form": "在线业务管理软件", "reason": "该类型定义描述客户持续管理自身业务流程的软件。",
                  "search_queries": ["该类型 软件 产品"]} for slug in b["slugs"]]
        if changes:
            items = changes(items)
        out = {"schema_version": 1, "prompt_version": PROMPT_VERSION, "batch_id": batch_id,
               "input_sha256": b["input_sha256"], "model": "gpt-6-luna", "items": items}
        dest = self.results / "batches" / f"{batch_id}.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")

    def test_prepare_sorts_and_resume_preserves_result_and_new_leaf_unreviewed(self):
        manifest = prepare(self.source_path, self.run_root, batch_size=2)
        self.assertEqual(manifest["batches"][0]["slugs"], ["alpha", "beta"])
        self.assertEqual(manifest["batches"][1]["slugs"], ["zeta"])
        self._result("batch-001")
        before = (self.results / "batches/batch-001.json").read_bytes()
        prepare(self.source_path, self.run_root, batch_size=2)
        self.assertEqual((self.results / "batches/batch-001.json").read_bytes(), before)
        self._write_source(["alpha", "beta", "new", "zeta"])
        updated = prepare(self.source_path, self.run_root, batch_size=2)
        self.assertIn("new", [s for batch in updated["batches"] for s in batch["slugs"]])
        self.assertEqual(status(self.run_root, self.results)["valid_batches"], 0)

    def test_missing_duplicate_unknown_and_stale_results_rejected(self):
        prepare(self.source_path, self.run_root, batch_size=3)
        self.assertEqual(status(self.run_root, self.results)["valid_batches"], 0)
        self._result("batch-001", lambda xs: xs[:-1])
        self.assertEqual(status(self.run_root, self.results)["batches"][0]["state"], "invalid")
        self._result("batch-001", lambda xs: [xs[0], xs[0], xs[2]])
        self.assertEqual(status(self.run_root, self.results)["batches"][0]["state"], "invalid")
        self._result("batch-001", lambda xs: [{**x, "slug": "unknown"} if i == 0 else x for i, x in enumerate(xs)])
        self.assertEqual(status(self.run_root, self.results)["batches"][0]["state"], "invalid")
        self._result("batch-001")
        packet = self.run_root / "packets/batch-001.json"
        packet.write_text(packet.read_text(encoding="utf-8") + " ", encoding="utf-8")
        self.assertEqual(status(self.run_root, self.results)["batches"][0]["state"], "invalid")

    def test_assemble_requires_all_batches_then_preserves_provenance_unverified(self):
        prepare(self.source_path, self.run_root, batch_size=2)
        self._result("batch-001")
        with self.assertRaises(ValueError):
            assemble(self.run_root, self.results, self.source_path, self.catalog)
        self._result("batch-002")
        report = assemble(self.run_root, self.results, self.source_path, self.catalog)
        self.assertEqual(report["source_leaf_count"], 3)
        data = json.loads((self.results / "assessments.json").read_text(encoding="utf-8"))
        self.assertEqual(len(data["items"]), 3)
        self.assertTrue(all(x["source_sha256"] == data["source_sha256"] for x in data["items"]))
        self.assertTrue(all(x["stage"] == "model_triage" and x["evidence_status"] == "unverified" for x in data["items"]))

    def test_bad_enum_or_missing_required_fields_rejected(self):
        prepare(self.source_path, self.run_root, batch_size=3)
        self._result("batch-001", lambda xs: [{**xs[0], "verdict": "excluded-ish"}, *xs[1:]])
        self.assertEqual(status(self.run_root, self.results)["batches"][0]["state"], "invalid")
        self._result("batch-001", lambda xs: [{**xs[0], "confidence": ["high"]}, *xs[1:]])
        self.assertEqual(status(self.run_root, self.results)["batches"][0]["state"], "invalid")

    def test_malformed_output_is_invalid_and_order_does_not_matter(self):
        prepare(self.source_path, self.run_root, batch_size=3)
        self._result("batch-001", lambda xs: list(reversed(xs)))
        self.assertEqual(status(self.run_root, self.results)["valid_leaves"], 3)
        assemble(self.run_root, self.results, self.source_path, self.catalog)
        rows = json.loads((self.results / "assessments.json").read_text())["items"]
        self.assertEqual([r["slug"] for r in rows], ["alpha", "beta", "zeta"])
        result = self.results / "batches/batch-001.json"
        result.write_text("[]")
        self.assertEqual(status(self.run_root, self.results)["batches"][0]["state"], "invalid")
        self._result("batch-001", lambda xs: [{**xs[0], "slug": ["bad"]}, *xs[1:]])
        self.assertEqual(status(self.run_root, self.results)["batches"][0]["state"], "invalid")

    def test_exclusions_and_uncertainty_are_queued_without_publishing(self):
        prepare(self.source_path, self.run_root, batch_size=3)
        self._result("batch-001", lambda xs: [{**x, "verdict": "excluded"} for x in xs])
        self.catalog.write_text(json.dumps({"leaves": [{"slug": s, "scope": "excluded"} for s in ["alpha", "beta", "zeta"]]}))
        before = self.catalog.read_bytes()
        report = assemble(self.run_root, self.results, self.source_path, self.catalog)
        self.assertEqual(report["queued_changes"], 0)
        self.assertEqual(report["review_items"], 3)
        self.assertEqual(self.catalog.read_bytes(), before)
        queue = json.loads((self.results / "review-queue.json").read_text())
        self.assertTrue(all("proposed_exclusion" in r["flags"] for r in queue["items"]))
        self.assertTrue(all(r["evidence_status"] == "unverified" for r in queue["items"]))

    def test_source_changed_since_prepare_prevents_assembly(self):
        prepare(self.source_path, self.run_root, batch_size=3)
        self._result("batch-001")
        self._write_source(["alpha", "beta", "zeta", "new-type"])
        with self.assertRaisesRegex(ValueError, "source hash differs"):
            assemble(self.run_root, self.results, self.source_path, self.catalog)
        self.assertFalse((self.results / "assessments.json").exists())
        progress = status(self.run_root, self.results, self.source_path)
        self.assertTrue(progress["source_changed"])
        self.assertEqual(progress["valid_leaves"], 0)

    def test_schema_versions_reject_bool_float_and_unsupported_values(self):
        manifest = prepare(self.source_path, self.run_root, batch_size=3)
        self._result("batch-001")
        packet_path = self.run_root / "packets/batch-001.json"
        result_path = self.results / "batches/batch-001.json"
        for target in ("manifest", "packet", "result"):
            for version in (True, 1.0, 2, "1", None):
                packet = json.loads(packet_path.read_text())
                result = json.loads(result_path.read_text())
                current = json.loads(json.dumps(manifest))
                if target == "manifest":
                    current["schema_version"] = version
                elif target == "packet":
                    packet["schema_version"] = version
                    packet_path.write_text(json.dumps(packet))
                    import hashlib
                    current["batches"][0]["input_sha256"] = hashlib.sha256(packet_path.read_bytes()).hexdigest()
                    result["input_sha256"] = current["batches"][0]["input_sha256"]
                    result_path.write_text(json.dumps(result))
                else:
                    result["schema_version"] = version
                    result_path.write_text(json.dumps(result))
                with self.assertRaisesRegex(ValueError, "schema version"):
                    validate_batch(packet_path, result_path, current, current["batches"][0])
                prepare(self.source_path, self.run_root, batch_size=3)
                self._result("batch-001")


if __name__ == "__main__":
    unittest.main()
