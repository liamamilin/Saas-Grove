"""Publish narrow, evidence-backed updates to currently conditional leaf scopes.

This is deliberately independent of the historical 548-leaf definition review.
Collection evidence is read from the database and immutable local snapshots;
this module neither collects applications nor modifies their database records.
"""
from __future__ import annotations

import base64
import csv
import io
import json
import re
import sqlite3
import tempfile
from pathlib import Path

from .case_collection import _validate_entry
from .config import ROOT
from .scope_publication import (
    _artifact_hash, _json_bytes, _resume_publication, _save_publication_state,
    canonical_hash, read_json, sha256_bytes,
)
from .taxonomy import build_catalog

REVIEW_FIELDS = {"schema_version", "run_id", "base_revision", "decisions"}
DECISION_FIELDS = {"slug", "final_scope", "reason", "service_boundary",
                   "application_ids", "source_urls", "reviewer"}


def _read_review(path):
    raw = Path(path).read_bytes()
    review = json.loads(raw)
    if (not isinstance(review, dict) or set(review) != REVIEW_FIELDS or
            type(review.get("schema_version")) is not int or review["schema_version"] != 1):
        raise ValueError("case scope review schema_version/fields are invalid")
    run_id = review.get("run_id")
    if (not isinstance(run_id, str) or
            not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,127}", run_id) or
            run_id == "saas-recheck-548-v1"):
        raise ValueError("run_id must be a new safe case-scope run identifier")
    if not isinstance(review.get("base_revision"), str) or not review["base_revision"].strip():
        raise ValueError("base_revision is required")
    rows = review.get("decisions")
    if not isinstance(rows, list) or not rows:
        raise ValueError("case scope review requires nonempty decisions")
    slugs = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != DECISION_FIELDS:
            raise ValueError("case scope decision fields are invalid")
        slug = row.get("slug")
        if not isinstance(slug, str) or not slug or slug in slugs:
            raise ValueError("decisions require unique nonempty slugs")
        slugs.add(slug)
        if not isinstance(row.get("final_scope"), str) or row["final_scope"] not in {"included", "conditional"}:
            raise ValueError(f"only included/conditional decisions are allowed: {slug}")
        if not isinstance(row.get("reason"), str) or len(row["reason"].strip()) < 20:
            raise ValueError(f"reason must contain at least 20 characters: {slug}")
        for field in ("service_boundary", "reviewer"):
            if not isinstance(row.get(field), str) or not row[field].strip():
                raise ValueError(f"{field} is required: {slug}")
        for field in ("application_ids", "source_urls"):
            values = row.get(field)
            if (not isinstance(values, list) or
                    any(not isinstance(v, str) or not v.strip() for v in values) or
                    len(values) != len(set(values))):
                raise ValueError(f"{field} must contain unique nonempty strings: {slug}")
        if row["final_scope"] == "included" and (not row["application_ids"] or not row["source_urls"]):
            raise ValueError(f"included scope requires an imported case and cited sources: {slug}")
        if bool(row["application_ids"]) != bool(row["source_urls"]):
            raise ValueError(f"applications and cited sources must be supplied together: {slug}")
    return review, sha256_bytes(raw)


def _paths(repo, run_id, run_root):
    repo = Path(repo).resolve()
    taxonomy = repo / "data/taxonomy"
    run = Path(run_root).resolve() if run_root is not None else repo / "var/case-scope" / run_id
    paths = {
        "source": taxonomy / "atlas-source.json", "policy": taxonomy / "scope-policy.json",
        "overrides": taxonomy / "overrides.json", "catalog": taxonomy / "catalog.json",
        "csv": taxonomy / "scope-review.csv", "source_root": repo / "data/collections",
        "publication": repo / "data/collections" / f"{run_id}-scope-publication.json",
        "state": run / "publication-state.json", "receipt": run / "publication-receipt.json",
        "baseline": run / "publication-basehashes.json",
        "before_overrides": run / "overrides.before-publication.json",
        "before_catalog": run / "catalog.before-publication.json",
        "before_csv": run / "scope-review.before-publication.csv",
    }
    outputs = [paths[k] for k in ("overrides", "catalog", "csv", "publication", "state",
                                  "receipt", "baseline", "before_overrides", "before_catalog", "before_csv")]
    if len(outputs) != len(set(outputs)) or any(p in outputs for p in (paths["source"], paths["policy"])):
        raise ValueError("case scope output paths overlap")
    # Historical definition-review artifacts are never an output of this tool.
    legacy = taxonomy / "leaf-reviews"
    if any(p.is_relative_to(legacy) for p in outputs):
        raise ValueError("case scope output must not overwrite historical leaf review evidence")
    return paths


def _load_state(paths):
    state = read_json(paths["state"])
    expected = {str(paths[k]) for k in ("overrides", "catalog", "csv", "publication", "receipt",
                                       "baseline", "before_overrides", "before_catalog", "before_csv")}
    artifacts = state.get("artifacts") if isinstance(state, dict) else None
    if not isinstance(state, dict) or state.get("schema_version") != 1 or not isinstance(artifacts, dict) or set(artifacts) != expected:
        raise ValueError("case publication recovery artifact paths are invalid")
    decoded = {}
    for raw_path, entry in artifacts.items():
        if not isinstance(entry, dict):
            raise ValueError("case publication recovery target is invalid")
        try:
            content = base64.b64decode(entry["target_base64"], validate=True)
        except (KeyError, ValueError, TypeError) as exc:
            raise ValueError("case publication recovery target is invalid") from exc
        if sha256_bytes(content) != entry.get("target_sha256"):
            raise ValueError("case publication recovery target hash is invalid")
        decoded[Path(raw_path)] = content
    try:
        receipt = json.loads(decoded[paths["receipt"]])
        baseline = json.loads(decoded[paths["baseline"]])
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError("case publication receipt/baseline is invalid") from exc
    if not isinstance(receipt, dict) or not isinstance(baseline, dict):
        raise ValueError("case publication receipt/baseline is invalid")
    if not {"overrides_sha256_before", "catalog_sha256_before", "csv_sha256_before"} <= set(baseline):
        raise ValueError("case publication baseline hashes are missing")
    for key in ("overrides", "catalog", "csv", "publication", "receipt", "baseline",
                "before_overrides", "before_catalog", "before_csv"):
        before_hash = baseline[f"{key}_sha256_before"] if key in {"overrides", "catalog", "csv"} else None
        if artifacts[str(paths[key])].get("before_sha256") != before_hash:
            raise ValueError("case publication recovery before hash differs from the immutable baseline")
    for key, backup in (("overrides", "before_overrides"), ("catalog", "before_catalog"), ("csv", "before_csv")):
        expected_hash = baseline.get(f"{key}_sha256_before")
        if key == "csv" and expected_hash is None and decoded[paths[backup]] == b"":
            continue
        if sha256_bytes(decoded[paths[backup]]) != expected_hash:
            raise ValueError("case publication immutable baseline hash is invalid")
    if receipt.get("input_fingerprint") != state.get("input_fingerprint"):
        raise ValueError("case publication receipt fingerprint is invalid")
    return state, decoded, baseline, receipt


def _case_evidence(decisions, database, source_root, leaves):
    """Read only committed application records; never initialize/migrate a database."""
    needs_cases = any(row["application_ids"] for row in decisions)
    if not needs_cases:
        return [], canonical_hash([]), {}
    database = Path(database).resolve()
    if not database.is_file():
        raise ValueError("case database does not exist")
    results, app_states = [], {}
    temporary = tempfile.TemporaryDirectory(prefix="case-scope-read-")
    try:
        # SQLite may write shared-memory reader marks even with mode=ro. Query a
        # disposable copy of the database and its committed WAL instead, without
        # opening the original SQLite files or touching their SHM bookkeeping.
        wal = database.with_name(database.name + "-wal")

        def stamp(path):
            try:
                stat = path.stat()
                return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
            except FileNotFoundError:
                return None

        before = (stamp(database), stamp(wal))
        try:
            database_bytes = database.read_bytes()
            wal_bytes = wal.read_bytes() if before[1] is not None else None
        except FileNotFoundError as exc:
            raise ValueError("case database changed while reading; retry validation") from exc
        if before != (stamp(database), stamp(wal)):
            raise ValueError("case database changed while reading; retry validation")
        snapshot = Path(temporary.name) / "catalog.sqlite"
        snapshot.write_bytes(database_bytes)
        if wal_bytes is not None:
            snapshot.with_name(snapshot.name + "-wal").write_bytes(wal_bytes)
        con = sqlite3.connect(snapshot.as_uri() + "?mode=ro", uri=True, timeout=10)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA query_only=ON")
        con.execute("BEGIN")
        with con:
            for decision in decisions:
                slug = decision["slug"]
                cited = set(decision["source_urls"])
                matched_urls, applications = set(), []
                for app_id in decision["application_ids"]:
                    row = con.execute("SELECT data FROM application WHERE id=?", (app_id,)).fetchone()
                    if row is None:
                        raise ValueError(f"unknown application id: {app_id}")
                    try:
                        app = json.loads(row["data"])
                    except (ValueError, TypeError) as exc:
                        raise ValueError(f"invalid stored application: {app_id}") from exc
                    if not isinstance(app, dict) or app.get("id") != app_id:
                        raise ValueError(f"stored application identity mismatch: {app_id}")
                    if con.execute("SELECT 1 FROM leaf_application WHERE leaf=? AND app_id=?", (slug, app_id)).fetchone() is None:
                        raise ValueError(f"application has no leaf_application relation: {slug}: {app_id}")
                    tracks = [r[0] for r in con.execute("SELECT track FROM application_track WHERE app_id=? ORDER BY track", (app_id,))]
                    if tracks != [app.get("track")]:
                        raise ValueError(f"stored application track/identity mismatch: {app_id}")
                    # Also verifies official host, verification status, all snapshot hashes,
                    # and OSS repository identity/known license through the collector boundary.
                    checked = _validate_entry(app, source_root, leaves)
                    matches = [m for m in checked["leaf_matches"] if m["slug"] == slug]
                    if len(matches) != 1:
                        raise ValueError(f"application leaf_matches does not establish this leaf: {slug}: {app_id}")
                    urls = cited.intersection(matches[0]["source_urls"])
                    if not urls:
                        raise ValueError(f"cited source is not used by this application leaf match: {slug}: {app_id}")
                    matched_urls.update(urls)
                    sources = [s for s in checked["sources"] if s["url"] in urls]
                    applications.append({"id": app_id, "name": checked["name"], "track": checked["track"],
                                         "match_reason": matches[0]["reason"], "sources": sources})
                    app_states[app_id] = {"application": checked, "tracks": tracks,
                                         "relations": [r[0] for r in con.execute(
                                             "SELECT leaf FROM leaf_application WHERE app_id=? ORDER BY leaf", (app_id,))]}
                if matched_urls != cited:
                    raise ValueError(f"source_urls includes a source outside the cited leaf relation: {slug}")
                results.append({"slug": slug, "application_ids": decision["application_ids"],
                                "source_urls": decision["source_urls"], "applications": applications})
    except sqlite3.Error as exc:
        raise ValueError(f"cannot read case database: {exc}") from exc
    finally:
        if "con" in locals():
            con.close()
        temporary.cleanup()
    database_proof = {str(database): sha256_bytes(database_bytes),
                      str(wal): sha256_bytes(wal_bytes) if wal_bytes is not None else None}
    for app_state in app_states.values():
        for source in app_state["application"]["sources"]:
            database_proof[str(source_root / source["snapshot_path"])] = source["sha256"]
    return results, canonical_hash(app_states), database_proof


def _scope_csv(catalog):
    categories = {row["id"]: row for row in catalog["categories"]}
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["slug", "名称", "领域", "子分类", "范围", "判断依据", "理由"])
    labels = {"included": "主目录", "conditional": "待确认", "excluded": "排除"}
    for leaf in catalog["leaves"]:
        writer.writerow([leaf["slug"], leaf["name_zh"], categories[leaf["domain_id"]]["name_zh"],
                         categories[leaf["parent_id"]]["name_zh"], labels[leaf["scope"]],
                         leaf["scope_rule"], leaf["scope_reason"]])
    return ("\ufeff" + stream.getvalue()).encode("utf-8")


def _prepare(review_path, database, repo, run_root):
    review_path = Path(review_path).resolve()
    review, review_hash = _read_review(review_path)
    paths = _paths(repo, review["run_id"], run_root)
    if review_path in set(paths.values()) or Path(database).resolve() in set(paths.values()):
        raise ValueError("review/database path overlaps a publication artifact")
    source_bytes, policy_bytes = paths["source"].read_bytes(), paths["policy"].read_bytes()
    source, policy = json.loads(source_bytes), json.loads(policy_bytes)
    state_info = _load_state(paths) if paths["state"].exists() else None
    if state_info:
        state, targets, baseline, _ = state_info
        before_overrides = targets[paths["before_overrides"]]
        before_catalog = targets[paths["before_catalog"]]
        before_csv = targets[paths["before_csv"]] if baseline["csv_sha256_before"] is not None else None
    else:
        before_overrides, before_catalog = paths["overrides"].read_bytes(), paths["catalog"].read_bytes()
        before_csv = paths["csv"].read_bytes() if paths["csv"].exists() else None
    overrides, catalog = json.loads(before_overrides), json.loads(before_catalog)
    if catalog.get("revision") != review["base_revision"]:
        raise ValueError("base_revision differs from the current catalog revision")
    if build_catalog(source, policy, overrides) != catalog:
        raise ValueError("catalog baseline is not bound to the current source/policy/overrides")
    leaves = {row["slug"]: row for row in catalog["leaves"]}
    for decision in review["decisions"]:
        slug = decision["slug"]
        if slug not in leaves:
            raise ValueError(f"unknown leaf slug: {slug}")
        if leaves[slug]["scope"] != "conditional":
            raise ValueError(f"only currently conditional leaves may be reviewed: {slug}")
    evidence, evidence_hash, database_proof = _case_evidence(review["decisions"], database, paths["source_root"], leaves)
    updated = json.loads(before_overrides)
    for decision in review["decisions"]:
        existing = updated.setdefault("leaves", {}).setdefault(decision["slug"], {})
        existing.update(scope=decision["final_scope"], scope_reason=decision["reason"])
    new_catalog = build_catalog(source, policy, updated)
    after = {row["slug"]: row for row in new_catalog["leaves"]}
    reviewed = {row["slug"] for row in review["decisions"]}
    if set(after) != set(leaves) or any(after[s]["scope"] != leaves[s]["scope"] for s in set(leaves) - reviewed):
        raise ValueError("catalog build changed a leaf scope outside the case review")
    changed = [row["slug"] for row in review["decisions"] if row["final_scope"] != leaves[row["slug"]]["scope"]]
    binding = {"review_sha256": review_hash, "source_sha256": sha256_bytes(source_bytes),
               "policy_sha256": sha256_bytes(policy_bytes), "base_revision": review["base_revision"],
               "database": str(Path(database).resolve()), "evidence_sha256": evidence_hash,
               "overrides_sha256_before": sha256_bytes(before_overrides),
               "catalog_sha256_before": sha256_bytes(before_catalog),
               "csv_sha256_before": sha256_bytes(before_csv) if before_csv is not None else None}
    fingerprint = canonical_hash(binding)
    if state_info:
        if state["input_fingerprint"] != fingerprint:
            raise ValueError("case review inputs changed after publication began; use a new run_id")
        committed = paths["receipt"].exists()
        for raw_path, entry in state["artifacts"].items():
            acceptable = {entry["target_sha256"]} if committed else {entry["before_sha256"], entry["target_sha256"]}
            if _artifact_hash(raw_path) not in acceptable:
                raise ValueError(f"external modification detected in case publication artifact: {raw_path}")
    report = {"valid": True, "run_id": review["run_id"], "coverage": len(review["decisions"]),
              "catalog_revision_before": catalog["revision"], "catalog_revision_after": new_catalog["revision"],
              "before_counts": catalog["counts"], "after_counts": new_catalog["counts"],
              "scope_changed_count": len(changed), "changed_slugs": changed,
              "source_sha256": binding["source_sha256"], "policy_sha256": binding["policy_sha256"],
              "evidence_sources": evidence, "already_published": paths["receipt"].exists()}
    plan = {"review": review, "paths": paths, "report": report, "binding": binding,
            "fingerprint": fingerprint, "state_info": state_info,
            "before_overrides": before_overrides, "before_catalog": before_catalog, "before_csv": before_csv,
            "updated": updated, "new_catalog": new_catalog, "review_path": review_path,
            "database_proof": database_proof}
    if state_info and state_info[1] != _targets(plan)[0]:
        raise ValueError("case publication recovery targets differ from the validated review")
    return plan


def check(review, database, repo=ROOT, run_root=None):
    """Validate a proposed case review without writing publication or database data."""
    return _prepare(review, database, repo, run_root)["report"]


def _targets(plan):
    paths, report = plan["paths"], plan["report"]
    has_cases = any(row["application_ids"] for row in plan["review"]["decisions"])
    baseline = {"schema_version": 1, "run_id": report["run_id"], **plan["binding"]}
    publication = {"schema_version": 1, **{k: v for k, v in report.items() if k != "already_published"},
                   "decisions": plan["review"]["decisions"],
                   "evidence_status": "imported_official_sources_reviewed" if has_cases else "definition_reviewed_pending_case",
                   "case_verification": "official_materials_only" if has_cases else "not_performed", "runtime_tested": False}
    artifacts = {
        paths["before_overrides"]: plan["before_overrides"],
        paths["before_catalog"]: plan["before_catalog"],
        paths["before_csv"]: plan["before_csv"] if plan["before_csv"] is not None else b"",
        paths["baseline"]: _json_bytes(baseline),
        paths["overrides"]: _json_bytes(plan["updated"]),
        paths["catalog"]: _json_bytes(plan["new_catalog"]),
        paths["csv"]: _scope_csv(plan["new_catalog"]),
        paths["publication"]: _json_bytes(publication),
    }
    receipt = {"schema_version": 1, "run_id": report["run_id"], "input_fingerprint": plan["fingerprint"],
               **plan["binding"], "catalog_revision_after": report["catalog_revision_after"],
               "before_counts": report["before_counts"], "after_counts": report["after_counts"],
               "scope_changed_count": report["scope_changed_count"], "changed_slugs": report["changed_slugs"],
               "artifact_hashes": {str(path): sha256_bytes(content) for path, content in artifacts.items()}}
    artifacts[paths["receipt"]] = _json_bytes(receipt)
    return artifacts, receipt


def _assert_inputs_unchanged(plan):
    """Reject changes between validation and recording the recovery targets."""
    paths, binding = plan["paths"], plan["binding"]
    expected = {plan["review_path"]: binding["review_sha256"],
                paths["source"]: binding["source_sha256"], paths["policy"]: binding["policy_sha256"],
                **{Path(path): digest for path, digest in plan["database_proof"].items()}}
    if plan["state_info"]:
        committed = paths["receipt"].exists()
        for raw_path, entry in plan["state_info"][0]["artifacts"].items():
            allowed = {entry["target_sha256"]} if committed else {entry["before_sha256"], entry["target_sha256"]}
            if _artifact_hash(raw_path) not in allowed:
                raise ValueError(f"input changed while validating case scope publication: {raw_path}")
    else:
        expected.update({paths["overrides"]: binding["overrides_sha256_before"],
                         paths["catalog"]: binding["catalog_sha256_before"],
                         paths["csv"]: binding["csv_sha256_before"]})
    for path, digest in expected.items():
        if _artifact_hash(path) != digest:
            raise ValueError(f"input changed while validating case scope publication: {path}")


def publish(review, database, repo=ROOT, run_root=None):
    """Publish only specified conditional leaves, with immutable recovery targets."""
    plan = _prepare(review, database, repo, run_root)
    paths, report = plan["paths"], plan["report"]
    _assert_inputs_unchanged(plan)
    if plan["state_info"]:
        state, _, _, receipt = plan["state_info"]
        if report["already_published"]:
            return {"published": True, "idempotent": True, "receipt": receipt,
                    "scope_changed_count": report["scope_changed_count"]}
        receipt = _resume_publication(state, plan["fingerprint"])
        return {"published": True, "idempotent": False, "resumed": True, "receipt": receipt,
                "scope_changed_count": report["scope_changed_count"]}
    for key in ("publication", "receipt", "baseline", "before_overrides", "before_catalog", "before_csv"):
        if paths[key].exists():
            raise ValueError(f"case publication artifact exists without recovery state: {paths[key]}")
    artifacts, receipt = _targets(plan)
    state = _save_publication_state(paths["state"], plan["fingerprint"], artifacts)
    _resume_publication(state, plan["fingerprint"])
    return {"published": True, "idempotent": False, "receipt": receipt,
            "scope_changed_count": report["scope_changed_count"]}
