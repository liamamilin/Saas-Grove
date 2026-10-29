"""Validate and publish the independent 548-leaf SaaS scope recheck."""
from __future__ import annotations

import csv
import base64
import hashlib
import io
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from .taxonomy import build_catalog

GROUPS = ("exclusions", "mixed-a", "mixed-b")
GROUP_COUNTS = {"exclusions": 203, "mixed-a": 173, "mixed-b": 172}
VALID_SCOPE = {"included", "conditional", "excluded"}
EXPECTED_COUNT = 548


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_hash(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical_hash(value) -> str:
    return sha256_bytes(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                   separators=(",", ":")).encode("utf-8"))


def read_json(path: Path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read JSON {path}: {exc}") from exc


def _require_schema(obj, label):
    if not isinstance(obj, dict) or type(obj.get("schema_version")) is not int or obj["schema_version"] != 1:
        raise ValueError(f"unsupported schema version: {label}")


def _atomic_write(path: Path, content: bytes):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_bytes(content)
    os.replace(temp, path)


def _json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _artifact_hash(path):
    path = Path(path)
    return file_hash(path) if path.exists() else None


def _save_publication_state(path, fingerprint, artifacts):
    entries = {}
    for output, content in artifacts.items():
        output = Path(output)
        entries[str(output)] = {"before_sha256": _artifact_hash(output),
                                "target_sha256": sha256_bytes(content),
                                "target_base64": base64.b64encode(content).decode("ascii")}
    state = {"schema_version": 1, "input_fingerprint": fingerprint, "artifacts": entries}
    _atomic_write(path, _json_bytes(state))
    return state


def _resume_publication(state, fingerprint):
    if state.get("schema_version") != 1 or state.get("input_fingerprint") != fingerprint:
        raise ValueError("review inputs changed during an incomplete publication; create a new recheck run")
    artifacts = state.get("artifacts")
    if not isinstance(artifacts, dict) or not artifacts:
        raise ValueError("publication recovery state is invalid")
    decoded = {}
    for raw_path, entry in artifacts.items():
        path = Path(raw_path)
        try:
            content = base64.b64decode(entry["target_base64"], validate=True)
        except (KeyError, ValueError, TypeError) as exc:
            raise ValueError("publication recovery state is invalid") from exc
        target_hash = sha256_bytes(content)
        if target_hash != entry.get("target_sha256"):
            raise ValueError("publication recovery target hash is invalid")
        current_hash = _artifact_hash(path)
        if current_hash not in {entry.get("before_sha256"), target_hash}:
            raise ValueError(f"external modification detected during publication recovery: {path}")
        decoded[path] = content
    receipt_paths = [path for path in decoded if path.name == "publication-receipt.json"]
    if len(receipt_paths) != 1:
        raise ValueError("publication recovery state lacks a unique receipt")
    receipt_path = receipt_paths[0]
    # Receipt is the commit marker and must be the final artifact written.
    for path, content in decoded.items():
        if path != receipt_path and _artifact_hash(path) != sha256_bytes(content):
            _atomic_write(path, content)
    if _artifact_hash(receipt_path) != sha256_bytes(decoded[receipt_path]):
        _atomic_write(receipt_path, decoded[receipt_path])
    return read_json(receipt_path)


def _valid_source_url(value):
    if not isinstance(value, str) or not value.strip():
        return False
    parsed = urlparse(value.strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _validate_source(source, slug):
    # Legacy strings remain accepted; new evidence should include a note.
    if isinstance(source, str):
        if not _valid_source_url(source):
            raise ValueError(f"invalid legacy HTTP(S) source URL: {slug}")
        return
    if (not isinstance(source, dict) or set(source) != {"url", "note"} or
            not _valid_source_url(source.get("url")) or
            not isinstance(source.get("note"), str) or not source["note"].strip()):
        raise ValueError(f"source must be an HTTP(S) URL object with a nonempty note: {slug}")


def _validate_adjudication(value, slug):
    if value is None:
        return
    if (not isinstance(value, dict) or not isinstance(value.get("reviewer"), str) or
            not value["reviewer"].strip() or value.get("original_scope") not in VALID_SCOPE or
            not isinstance(value.get("reason"), str) or not value["reason"].strip()):
        raise ValueError(f"invalid adjudication provenance: {slug}")


def _manifest_queue(manifest, source):
    groups = manifest.get("groups")
    if not isinstance(groups, dict) or set(groups) != set(GROUPS):
        raise ValueError("manifest group names do not match the expected recheck groups")
    source_slugs = [row.get("slug") for row in source.get("leaves", [])]
    if len(source_slugs) != len(set(source_slugs)):
        raise ValueError("source contains duplicate slugs")
    source_set = set(source_slugs)
    expected = []
    for group in GROUPS:
        entry = groups[group]
        if not isinstance(entry, dict) or type(entry.get("count")) is not int:
            raise ValueError(f"invalid manifest group: {group}")
        if entry["count"] != GROUP_COUNTS[group]:
            raise ValueError(f"manifest group count mismatch: {group}")
        slugs = entry.get("slugs")
        if not isinstance(slugs, list) or len(slugs) != entry["count"]:
            raise ValueError(f"manifest slug count mismatch: {group}")
        if any(not isinstance(slug, str) or not slug for slug in slugs) or len(slugs) != len(set(slugs)):
            raise ValueError(f"duplicate or invalid manifest slug: {group}")
        unknown = set(slugs) - source_set
        if unknown:
            raise ValueError(f"manifest contains unknown source slugs: {group}: {sorted(unknown)[:5]}")
        expected.extend(slugs)
    if len(expected) != EXPECTED_COUNT or len(expected) != len(set(expected)):
        raise ValueError(f"recheck queue must contain {EXPECTED_COUNT} unique slugs")
    return expected


def _queue_slugs(queue_path):
    queue = read_json(queue_path)
    if not isinstance(queue, dict) or not isinstance(queue.get("items"), list):
        raise ValueError("review queue items are missing")
    slugs = [item.get("slug") for item in queue["items"] if isinstance(item, dict)]
    if (len(slugs) != len(queue["items"]) or any(not isinstance(s, str) or not s for s in slugs)
            or len(slugs) != len(set(slugs))):
        raise ValueError("review queue must contain unique nonempty slugs")
    return slugs


def validate_review(manifest, source_path, queue_path, run_root, results_dir):
    """Read-only validation; returns reviewed rows and comparison data."""
    manifest_path = Path(manifest)
    source_path, queue_path = Path(source_path), Path(queue_path)
    run_root, results_dir = Path(run_root), Path(results_dir)
    m = read_json(manifest_path)
    _require_schema(m, "recheck manifest")
    if m.get("run_id") != "saas-recheck-548-v1":
        raise ValueError("unexpected run_id")
    source = read_json(source_path)
    _require_schema(source, "taxonomy source")
    source_hash = file_hash(source_path)
    queue_hash = file_hash(queue_path)
    if source_hash != m.get("source_sha256"):
        raise ValueError("current source hash differs from manifest")
    if queue_hash != m.get("queue_sha256"):
        raise ValueError("current queue hash differs from manifest")

    expected = _manifest_queue(m, source)
    queue_slugs = _queue_slugs(queue_path)
    if len(queue_slugs) != EXPECTED_COUNT or set(queue_slugs) != set(expected):
        raise ValueError("actual review queue coverage differs from the 548-leaf manifest")
    packet_rows = {}
    for group in GROUPS:
        entry = m["groups"][group]
        packet_path = run_root / f"{group}.json"
        if file_hash(packet_path) != entry.get("packet_sha256"):
            raise ValueError(f"packet hash mismatch: {group}")
        packet = read_json(packet_path)
        _require_schema(packet, f"packet {group}")
        if (packet.get("run_id") != m["run_id"] or packet.get("source_sha256") != source_hash or
                packet.get("queue_sha256") != queue_hash):
            raise ValueError(f"packet metadata mismatch: {group}")
        packet_items = packet.get("items")
        if not isinstance(packet_items, list):
            raise ValueError(f"packet items missing: {group}")
        packet_slugs = [item.get("leaf", {}).get("slug") for item in packet_items if isinstance(item, dict)]
        if len(packet_slugs) != len(packet_items) or len(packet_slugs) != len(set(packet_slugs)) or set(packet_slugs) != set(entry["slugs"]):
            raise ValueError(f"packet slug coverage mismatch: {group}")
        packet_rows.update({slug: (group, entry["slugs"]) for slug in packet_slugs})

    rows = []
    for group in GROUPS:
        path = results_dir / f"{group}.json"
        review = read_json(path)
        _require_schema(review, f"review {group}")
        if (review.get("run_id") != m["run_id"] or review.get("source_sha256") != source_hash or
                review.get("queue_sha256") != queue_hash):
            raise ValueError(f"review metadata/hash mismatch: {group}")
        items = review.get("items")
        if not isinstance(items, list):
            raise ValueError(f"review items missing: {group}")
        expected_group = m["groups"][group]["slugs"]
        slugs = [item.get("slug") for item in items if isinstance(item, dict)]
        if (len(slugs) != len(items) or len(slugs) != len(set(slugs)) or
                len(slugs) != len(expected_group) or set(slugs) != set(expected_group)):
            raise ValueError(f"review slug coverage mismatch: {group}")
        for item in items:
            slug = item["slug"]
            scope = item.get("final_scope")
            if scope not in VALID_SCOPE:
                raise ValueError(f"invalid final_scope: {slug}")
            outcome = "needs_case" if scope == "conditional" else "confirmed"
            if item.get("review_outcome") != outcome:
                raise ValueError(f"review_outcome conflicts with final_scope: {slug}")
            reason = item.get("reason")
            if not isinstance(reason, str) or len(reason.strip()) < 20:
                raise ValueError(f"reason must contain at least 20 characters: {slug}")
            boundary = item.get("service_boundary")
            if not isinstance(boundary, str) or not boundary.strip():
                raise ValueError(f"service_boundary is empty: {slug}")
            if item.get("evidence_status") != "definition_reviewed":
                raise ValueError(f"invalid evidence_status: {slug}")
            sources = item.get("sources")
            if not isinstance(sources, list):
                raise ValueError(f"sources must be an array: {slug}")
            for source_entry in sources:
                _validate_source(source_entry, slug)
            _validate_adjudication(item.get("adjudication"), slug)
            rows.append({**item, "review_group": group, "reviewer": review.get("reviewer")})
    by_slug = {row["slug"]: row for row in rows}
    if len(by_slug) != EXPECTED_COUNT or set(by_slug) != set(expected):
        raise ValueError("combined review coverage is not exactly the 548-leaf queue")
    return {"manifest": m, "source": source, "source_hash": source_hash,
            "queue_hash": queue_hash, "expected_slugs": expected,
            "rows": [by_slug[s] for s in expected]}


def _comparison(validated, taxonomy_dir):
    taxonomy_dir = Path(taxonomy_dir)
    old_catalog = read_json(taxonomy_dir / "catalog.json")
    old_overrides = read_json(taxonomy_dir / "overrides.json")
    old_rows = {row["slug"]: row for row in old_catalog.get("leaves", [])}
    override_leaves = old_overrides.setdefault("leaves", {})
    decisions = []
    for row in validated["rows"]:
        slug = row["slug"]
        old = old_rows.get(slug)
        local = override_leaves.get(slug, {})
        if "scope" in local and local["scope"] != row["final_scope"]:
            raise ValueError(f"conflicting local scope override for {slug}; resolve explicitly before publish")
        decisions.append({
            "slug": slug, "review_group": row["review_group"], "reviewer": row["reviewer"],
            "previous_scope": old.get("scope") if old else None,
            "final_scope": row["final_scope"],
            "previous_reason": old.get("scope_reason") if old else None,
            "reason": row["reason"], "service_boundary": row["service_boundary"],
            "review_outcome": row["review_outcome"], "evidence_status": row["evidence_status"],
            "sources": row["sources"],
            **({"adjudication": row["adjudication"]} if "adjudication" in row else {}),
            "scope_changed": bool(old and old.get("scope") != row["final_scope"]),
        })
    return old_catalog, old_overrides, decisions


def check(manifest, queue_path, source_path, run_root, results_dir, taxonomy_dir):
    """Validate all inputs and report planned changes without writing anything."""
    validated = validate_review(manifest, source_path, queue_path, run_root, results_dir)
    catalog, overrides, decisions = _comparison(validated, taxonomy_dir)
    changed = [d["slug"] for d in decisions if d["scope_changed"]]
    return {"valid": True, "run_id": validated["manifest"]["run_id"], "coverage": len(decisions),
            "source_sha256": validated["source_hash"], "queue_sha256": validated["queue_hash"],
            "catalog_revision": catalog.get("revision"), "scope_changed_slugs": changed,
            "scope_changed_count": len(changed),
            "decisions": decisions, "overrides": overrides, "catalog": catalog,
            "validated": validated}


def _csv_content(decisions):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["slug", "review_group", "reviewer", "previous_scope", "final_scope",
                     "scope_changed", "previous_reason", "reason", "service_boundary",
                     "review_outcome", "evidence_status", "sources", "adjudication"])
    for d in decisions:
        sources = " | ".join(
            source if isinstance(source, str) else f"{source['url']} — {source['note']}"
            for source in d["sources"])
        writer.writerow([d["slug"], d["review_group"], d["reviewer"], d["previous_scope"],
                         d["final_scope"], str(d["scope_changed"]).lower(), d["previous_reason"],
                         d["reason"], d["service_boundary"], d["review_outcome"],
                         d["evidence_status"], sources,
                         json.dumps(d.get("adjudication"), ensure_ascii=False, sort_keys=True)
                         if d.get("adjudication") is not None else ""])
    return ("\ufeff" + stream.getvalue()).encode("utf-8")


def publish(manifest, queue_path, source_path, run_root, results_dir, taxonomy_dir, review_dir):
    """Validate then update only queued leaf overrides and their generated catalog files."""
    report = check(manifest, queue_path, source_path, run_root, results_dir, taxonomy_dir)
    validated, decisions = report["validated"], report["decisions"]
    taxonomy_dir, review_dir, run_root = Path(taxonomy_dir), Path(review_dir), Path(run_root)
    overrides_path, catalog_path = taxonomy_dir / "overrides.json", taxonomy_dir / "catalog.json"
    receipt_path = run_root / "publication-receipt.json"
    state_path = run_root / "publication-state.json"
    input_fingerprint = canonical_hash({"run_id": validated["manifest"]["run_id"],
                                       "source": validated["source_hash"], "queue": validated["queue_hash"],
                                       "policy": file_hash(taxonomy_dir / "scope-policy.json"),
                                       "reviews": [{**{k: r[k] for k in ("slug", "final_scope", "reason", "service_boundary", "review_outcome", "evidence_status", "sources")},
                                                    "reviewer": r.get("reviewer"), "adjudication": r.get("adjudication")}
                                                   for r in validated["rows"]]})
    override_hash, catalog_hash = file_hash(overrides_path), file_hash(catalog_path)
    baselines_path = run_root / "publication-basehashes.json"
    if receipt_path.exists():
        receipt = read_json(receipt_path)
        if receipt.get("input_fingerprint") != input_fingerprint:
            raise ValueError("review inputs changed after publication; create a new recheck run")
        if (receipt.get("overrides_sha256_after") != override_hash or
                receipt.get("catalog_sha256_after") != catalog_hash):
            raise ValueError("taxonomy changed after publication; recheck before publishing")
        if not state_path.exists():
            raise ValueError("publication recovery state is missing; cannot verify published artifacts")
        state = read_json(state_path)
        if state.get("input_fingerprint") != input_fingerprint:
            raise ValueError("publication recovery state fingerprint mismatch")
        for raw_path, entry in state.get("artifacts", {}).items():
            if _artifact_hash(raw_path) != entry.get("target_sha256"):
                raise ValueError(f"published artifact changed after publication: {raw_path}")
        return {"published": True, "idempotent": True, "coverage": EXPECTED_COUNT,
                "receipt": receipt, "scope_changed_count": receipt.get("scope_changed_count", 0)}
    if state_path.exists():
        receipt = _resume_publication(read_json(state_path), input_fingerprint)
        return {"published": True, "idempotent": False, "resumed": True,
                "coverage": EXPECTED_COUNT, "receipt": receipt,
                "scope_changed_count": receipt.get("scope_changed_count", 0)}
    if baselines_path.exists():
        raise ValueError("publication baseline exists without recovery state; refusing unsafe resume")

    old_overrides = report["overrides"]
    old_catalog = report["catalog"]
    updated = json.loads(json.dumps(old_overrides))
    leaf_overrides = updated.setdefault("leaves", {})
    by_slug = {r["slug"]: r for r in validated["rows"]}
    for d in decisions:
        row = by_slug[d["slug"]]
        existing = leaf_overrides.get(d["slug"], {})
        merged = dict(existing)
        merged.update(scope=row["final_scope"], scope_reason=row["reason"])
        leaf_overrides[d["slug"]] = merged

    new_catalog = build_catalog(validated["source"], read_json(taxonomy_dir / "scope-policy.json"), updated)
    old_scope = {r["slug"]: r["scope"] for r in old_catalog["leaves"]}
    new_scope = {r["slug"]: r["scope"] for r in new_catalog["leaves"]}
    outside = set(old_scope) - set(validated["expected_slugs"])
    if any(old_scope[s] != new_scope[s] for s in outside):
        raise ValueError("building the catalog changed a scope outside the 548-leaf queue")
    changed_slugs = [s for s in validated["expected_slugs"] if old_scope[s] != new_scope[s]]
    old_counts = old_catalog.get("counts", {})
    new_counts = new_catalog.get("counts", {})
    category_map = {x["id"]: x for x in new_catalog["categories"]}
    csv_stream = io.StringIO(newline="")
    writer = csv.writer(csv_stream)
    writer.writerow(["slug", "名称", "领域", "子分类", "范围", "判断依据", "理由"])
    labels = {"included": "主目录", "conditional": "待确认", "excluded": "排除"}
    for leaf in new_catalog["leaves"]:
        writer.writerow([leaf["slug"], leaf["name_zh"], category_map[leaf["domain_id"]]["name_zh"],
                         category_map[leaf["parent_id"]]["name_zh"], labels[leaf["scope"]],
                         leaf["scope_rule"], leaf["scope_reason"]])
    scope_csv = ("\ufeff" + csv_stream.getvalue()).encode("utf-8")

    baseline_data = {"schema_version": 1, "run_id": validated["manifest"]["run_id"],
                     "source_sha256": validated["source_hash"], "queue_sha256": validated["queue_hash"],
                     "overrides_sha256_before": override_hash, "catalog_sha256_before": catalog_hash}
    backup_overrides = run_root / "overrides.before-publication.json"
    backup_catalog = run_root / "catalog.before-publication.json"
    if backup_overrides.exists() and backup_overrides.read_bytes() != overrides_path.read_bytes():
        raise ValueError("pre-publication overrides backup already exists with different contents")
    if backup_catalog.exists() and backup_catalog.read_bytes() != catalog_path.read_bytes():
        raise ValueError("pre-publication catalog backup already exists with different contents")
    decisions_json = {"schema_version": 1, "run_id": validated["manifest"]["run_id"],
                      "source_sha256": validated["source_hash"], "queue_sha256": validated["queue_hash"],
                      "items": decisions}
    summary = {"schema_version": 1, "run_id": validated["manifest"]["run_id"],
               "source_sha256": validated["source_hash"], "queue_sha256": validated["queue_hash"],
               "coverage": EXPECTED_COUNT, "final_scope_counts": {
                   s: sum(r["final_scope"] == s for r in decisions) for s in sorted(VALID_SCOPE)},
               "before_scope_counts": old_counts, "after_scope_counts": new_counts,
               "scope_changed_count": len(changed_slugs), "scope_changed_slugs": changed_slugs,
               "evidence_status": "definition_reviewed", "case_verification": "not_performed"}
    publication = {"schema_version": 1, "run_id": validated["manifest"]["run_id"],
                   "source_sha256": validated["source_hash"], "queue_sha256": validated["queue_hash"],
                   "coverage": EXPECTED_COUNT, "before_counts": old_counts, "after_counts": new_counts,
                   "catalog_revision_before": old_catalog.get("revision"),
                   "catalog_revision_after": new_catalog.get("revision"),
                   "changed_slugs": changed_slugs, "evidence_status": "definition_reviewed",
                   "case_verification": "not_performed"}
    artifact_contents = {
        backup_overrides: overrides_path.read_bytes(),
        backup_catalog: catalog_path.read_bytes(),
        baselines_path: _json_bytes(baseline_data),
        overrides_path: _json_bytes(updated),
        catalog_path: _json_bytes(new_catalog),
        taxonomy_dir / "scope-review.csv": scope_csv,
        review_dir / "decisions.json": _json_bytes(decisions_json),
        review_dir / "decisions.csv": _csv_content(decisions),
        review_dir / "summary.json": _json_bytes(summary),
        review_dir / "publication.json": _json_bytes(publication),
    }
    receipt = {"schema_version": 1, "run_id": validated["manifest"]["run_id"],
               "input_fingerprint": input_fingerprint, "overrides_sha256_before": override_hash,
               "catalog_sha256_before": catalog_hash,
               "overrides_sha256_after": sha256_bytes(artifact_contents[overrides_path]),
               "catalog_sha256_after": sha256_bytes(artifact_contents[catalog_path]), "catalog_revision_before": old_catalog.get("revision"),
               "catalog_revision_after": new_catalog.get("revision"), "scope_changed_count": len(changed_slugs),
               "backups": [str(backup_overrides), str(backup_catalog)]}
    artifact_contents[receipt_path] = _json_bytes(receipt)
    # Store immutable recovery targets and pre-publish hashes before changing any output.
    state = _save_publication_state(state_path, input_fingerprint, artifact_contents)
    _resume_publication(state, input_fingerprint)
    return {"published": True, "idempotent": False, "coverage": EXPECTED_COUNT,
            "scope_changed_count": len(changed_slugs), "receipt": receipt}
