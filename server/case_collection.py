"""Validate and import evidence-backed application collection batches.

This module never executes collected material. Source snapshots are plain text
or JSON bytes fetched from public official URLs and are retained by SHA-256.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .config import ROOT, TAXONOMY_DIR
from .store import Store

DEFAULT_SOURCE_ROOT = ROOT / "data" / "collections"
DEFAULT_CATALOG = TAXONOMY_DIR / "catalog.json"
TRACKS = {"open_source", "commercial"}
SOURCE_KINDS = {"repository_metadata", "readme", "license", "documentation", "homepage"}
OSI_LICENSES = {
    "MIT", "MIT-0", "Apache-1.1", "Apache-2.0", "AGPL-1.0", "AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later",
    "GPL-1.0", "GPL-1.0-only", "GPL-1.0-or-later",
    "GPL-2.0", "GPL-2.0-only", "GPL-2.0-or-later", "GPL-3.0", "GPL-3.0-only",
    "GPL-3.0-or-later", "LGPL-2.0", "LGPL-2.0-only", "LGPL-2.0-or-later",
    "LGPL-2.1", "LGPL-2.1-only", "LGPL-2.1-or-later", "LGPL-3.0",
    "LGPL-3.0-only", "LGPL-3.0-or-later", "MPL-2.0", "BSD-2-Clause",
    "BSD-3-Clause", "BSD-3-Clause-Clear", "BSD-4-Clause", "ISC", "0BSD",
    "Unlicense", "Zlib", "EPL-1.0", "EPL-2.0", "EUPL-1.1", "EUPL-1.2",
    "CC0-1.0", "Artistic-1.0", "Artistic-2.0", "BSL-1.0", "PostgreSQL", "OpenSSL",
    "CDDL-1.0", "CDDL-1.1", "CPL-1.0", "ECL-2.0", "IPL-1.0", "MS-PL", "NCSA",
    "OFL-1.1", "OSL-3.0", "Python-2.0", "UPL-1.0", "W3C", "ZPL-2.1",
}
COMMON_FIELDS = {"id", "name", "track", "summary", "homepage", "sources", "leaf_matches",
                 "verification_status", "runtime_tested"}
OSS_FIELDS = COMMON_FIELDS | {"repository_url", "github_repository_id", "license",
                              "license_evidence_url", "features", "deployment", "technology_stack"}
OPTIONAL_OSS_FIELDS = {"license_review"}
URL_FIELDS = {"homepage", "repository_url", "license_evidence_url"}


def _fail(message):
    raise ValueError(message)


def _http_url(value, label):
    if not isinstance(value, str) or not value.strip():
        _fail(f"{label} must be an HTTP(S) URL")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.hostname is None:
        _fail(f"{label} must be an HTTP(S) URL with a host")
    if parsed.username is not None or parsed.password is not None:
        _fail(f"{label} must not contain URL credentials")
    return parsed


def _snapshot_bytes(root: Path, source: dict) -> bytes:
    expected = source.get("sha256")
    if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
        _fail("source sha256 is invalid")
    relative = source.get("snapshot_path")
    if relative != f"sources/{expected}.txt":
        _fail("source snapshot_path must be sources/<sha256>.txt")
    root_resolved = root.resolve()
    original_path = root / relative
    if original_path.is_symlink():
        _fail("source snapshot must not be a symbolic link")
    path = original_path.resolve()
    if not path.is_relative_to(root_resolved) or path.parent != (root / "sources").resolve():
        _fail("source snapshot path escapes source root")
    if path.is_symlink() or not path.is_file():
        _fail("source snapshot is missing or not a regular file")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        _fail("source snapshot sha256 mismatch")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("source snapshot must be UTF-8 text") from exc
    if "\x00" in text:
        _fail("source snapshot is not text")
    return data


def _iso_timestamp(value):
    if not isinstance(value, str) or not value:
        _fail("source fetched_at is required")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("source fetched_at must be ISO-8601") from exc
    if parsed.tzinfo is None:
        _fail("source fetched_at must include a timezone")


def _official_host(url, homepage, repository_url=None):
    host = _http_url(url, "source url").hostname.lower().rstrip(".")
    home_host = _http_url(homepage, "homepage").hostname.lower().rstrip(".")
    if host == home_host or host.endswith("." + home_host):
        return True
    if repository_url:
        repo = _http_url(repository_url, "repository_url").hostname.lower()
        if repo == "github.com" and host in {"github.com", "raw.githubusercontent.com", "api.github.com"}:
            return True
    return False


def _github_api_endpoint(url, owner, repo_name, *, license_endpoint=False):
    """Require GitHub's canonical API host and the endpoint for this repo."""
    parsed = urlparse(url)
    suffix = "/license" if license_endpoint else ""
    expected = f"/repos/{owner}/{repo_name}{suffix}"
    return (parsed.scheme == "https" and parsed.hostname == "api.github.com"
            and parsed.port is None and parsed.username is None and parsed.password is None
            and parsed.query == "" and parsed.fragment == "" and parsed.path.casefold() == expected.casefold())


class _RepositoryMeta(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}

    def handle_starttag(self, tag, attrs):
        if tag == "meta":
            values = dict(attrs)
            if values.get("name", "").startswith("octolytics-dimension-repository_"):
                self.values[values["name"]] = values.get("content")


def _github_page_identity(url, body, owner, repo_name, repository_id):
    parsed = urlparse(url)
    if (parsed.scheme != "https" or parsed.hostname != "github.com" or parsed.port is not None
            or parsed.query or parsed.fragment or parsed.path.rstrip("/").casefold() != f"/{owner}/{repo_name}".casefold()):
        return False
    parser = _RepositoryMeta()
    parser.feed(body.decode("utf-8"))
    return (parser.values.get("octolytics-dimension-repository_id") == str(repository_id)
            and str(parser.values.get("octolytics-dimension-repository_nwo", "")).casefold()
            == f"{owner}/{repo_name}".casefold())


def _reviewed_license_text(entry, source_pairs, owner, repo_name):
    """Explicit curation of complete license text, independent of API classification.

    This is an editorial attestation backed by immutable text, not an automatic
    legal determination. Publication still requires independent content review.
    """
    review = entry.get("license_review")
    if review is None:
        return False
    fields = {"reviewer", "source_url", "spdx_id", "scope", "rationale"}
    if (not isinstance(review, dict) or set(review) != fields
            or not isinstance(review.get("reviewer"), str) or not review["reviewer"].strip()
            or review["reviewer"].strip().lower().startswith("pending")
            or review.get("source_url") != entry["license_evidence_url"]
            or review.get("spdx_id") != entry["license"]
            or review.get("scope") not in {"repository", "community_core"}
            or not isinstance(review.get("rationale"), str) or len(review["rationale"].strip()) < 20):
        _fail("license_review must bind reviewer, SPDX, scope and rationale to the license source")
    if review["scope"] == "community_core" and not any(word in entry["summary"] for word in ("开源核心", "社区", "community", "Community")):
        _fail("community_core license scope must be explicit in the summary")
    markers = {
        "MIT": ("permission is hereby granted, free of charge", "the software is provided"),
        "Apache-2.0": ("apache license", "version 2.0", "limitations under the license"),
        "AGPL-3.0": ("gnu affero general public license", "version 3", "terms and conditions"),
        "GPL-3.0": ("gnu general public license", "version 3", "terms and conditions"),
        "GPL-2.0": ("gnu general public license", "version 2", "terms and conditions"),
        "MPL-2.0": ("mozilla public license", "2.0", "source code"),
        "BSD-2-Clause": ("redistribution and use in source and binary forms", "this software is provided"),
        "BSD-3-Clause": ("redistribution and use in source and binary forms", "neither the name", "this software is provided"),
    }
    marker_key = entry["license"].removesuffix("-only").removesuffix("-or-later")
    if marker_key not in markers:
        _fail("raw license text for this SPDX identifier needs a supported editorial check")
    for source, body in source_pairs:
        parsed = urlparse(source["url"])
        text = None
        if _github_api_endpoint(source["url"], owner, repo_name, license_endpoint=True):
            try:
                evidence = json.loads(body)
                if isinstance(evidence, dict) and isinstance(evidence.get("content"), str):
                    text = base64.b64decode("".join(evidence["content"].split()), validate=True).decode("utf-8")
            except (ValueError, UnicodeDecodeError):
                pass
        elif (parsed.scheme == "https" and parsed.hostname == "raw.githubusercontent.com"
              and parsed.port is None and not parsed.query and not parsed.fragment
              and parsed.path.casefold().startswith(f"/{owner}/{repo_name}/".casefold())
              and re.match(r"(?i)(?:license|licence|copying)", Path(parsed.path).name)):
            text = body.decode("utf-8")
        if text is None or len(text.strip()) < 250 or "<html" in text[:500].lower():
            continue
        normalized = " ".join(text.lower().split())
        if all(marker in normalized for marker in markers[marker_key]):
            return True
    _fail("license_review needs matching, nontruncated license text from this repository")


def _merge_leaf_matches(old, new):
    merged = {item["slug"]: dict(item) for item in old}
    for item in new:
        current = merged.get(item["slug"])
        if current is None:
            merged[item["slug"]] = dict(item)
            continue
        current["reason"] = item["reason"] or current["reason"]
        current["source_urls"] = sorted(set(current["source_urls"]) | set(item["source_urls"]))
    return [merged[key] for key in sorted(merged)]


def _merge_sources(old, new):
    merged = {(item["url"], item["sha256"]): dict(item) for item in old}
    for item in new:
        merged[(item["url"], item["sha256"])] = dict(item)
    return [merged[key] for key in sorted(merged)]


def _validate_entry(entry, source_root, leaves):
    if not isinstance(entry, dict):
        _fail("entry must be an object")
    if not isinstance(entry.get("track"), str) or entry["track"] not in TRACKS:
        _fail("entry track is invalid")
    allowed = OSS_FIELDS | OPTIONAL_OSS_FIELDS if entry["track"] == "open_source" else COMMON_FIELDS
    unknown = set(entry) - allowed
    if unknown:
        _fail("entry has unsupported fields: " + ", ".join(sorted(unknown)))
    for key in ("id", "name", "summary"):
        if not isinstance(entry.get(key), str) or not entry[key].strip():
            _fail(f"entry {key} is required")
    if entry.get("verification_status") != "official_sources_reviewed":
        _fail("verification_status must be official_sources_reviewed")
    if entry.get("runtime_tested") is not False:
        _fail("runtime_tested must be false for collection")
    _http_url(entry.get("homepage"), "homepage")

    sources = entry.get("sources")
    if not isinstance(sources, list) or not sources:
        _fail("entry requires at least one official source")
    source_by_url = {}
    checked_sources = []
    for source in sources:
        if not isinstance(source, dict) or set(source) != {"url", "sha256", "snapshot_path", "fetched_at", "kind"}:
            _fail("source fields are invalid")
        _http_url(source["url"], "source url")
        if not isinstance(source["kind"], str) or source["kind"] not in SOURCE_KINDS:
            _fail("source kind is invalid")
        _iso_timestamp(source["fetched_at"])
        body = _snapshot_bytes(source_root, source)
        if not _official_host(source["url"], entry["homepage"], entry.get("repository_url")):
            _fail("source is not on the official homepage or repository host")
        checked = dict(source)
        checked_sources.append(checked)
        source_by_url.setdefault(source["url"], []).append((checked, body))

    matches = entry.get("leaf_matches")
    if not isinstance(matches, list) or not matches:
        _fail("entry requires at least one leaf match")
    match_slugs = set()
    for match in matches:
        if not isinstance(match, dict) or set(match) != {"slug", "reason", "source_urls"}:
            _fail("leaf match fields are invalid")
        slug = match.get("slug")
        if not isinstance(slug, str) or slug not in leaves:
            _fail(f"unknown leaf: {slug}")
        if leaves[slug].get("scope") == "excluded":
            _fail(f"excluded leaf cannot be imported: {slug}")
        if slug in match_slugs:
            _fail(f"duplicate leaf match: {slug}")
        match_slugs.add(slug)
        if not isinstance(match.get("reason"), str) or len(match["reason"].strip()) < 10:
            _fail(f"leaf match reason is required: {slug}")
        urls = match.get("source_urls")
        if (not isinstance(urls, list) or not urls or
                any(not isinstance(url, str) or url not in source_by_url for url in urls)):
            _fail(f"leaf match must cite an entry source: {slug}")
        if len(set(urls)) != len(urls):
            _fail(f"duplicate source URL in leaf match: {slug}")

    if entry["track"] == "open_source":
        if set(entry) - OPTIONAL_OSS_FIELDS != OSS_FIELDS:
            missing = OSS_FIELDS - set(entry)
            _fail("open-source entry fields missing: " + ", ".join(sorted(missing)))
        repository = _http_url(entry["repository_url"], "repository_url")
        if (repository.scheme != "https" or repository.hostname.lower() != "github.com"
                or repository.port is not None or repository.query or repository.fragment):
            _fail("repository_url must be https://github.com/owner/repo")
        repo_match = re.fullmatch(r"/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/?", repository.path)
        if not repo_match:
            _fail("repository_url must be https://github.com/owner/repo")
        owner, repo_name = repo_match.groups()
        if type(entry.get("github_repository_id")) is not int or entry["github_repository_id"] <= 0:
            _fail("github_repository_id must be a positive integer")
        if entry["id"] != f"github:{entry['github_repository_id']}":
            _fail("open-source id must match github_repository_id")
        license_id = entry.get("license")
        is_bsd = isinstance(license_id, str) and license_id in {
            "BSD-2-Clause", "BSD-2-Clause-FreeBSD", "BSD-2-Clause-Patent",
            "BSD-3-Clause", "BSD-3-Clause-Attribution", "BSD-3-Clause-Clear",
            "BSD-3-Clause-LBNL", "BSD-3-Clause-Modification", "BSD-3-Clause-Open-MPI",
            "BSD-4-Clause",
        }
        if not isinstance(license_id, str) or (license_id not in OSI_LICENSES and not is_bsd):
            _fail("license must be an approved OSI SPDX identifier")
        if entry.get("license_evidence_url") not in source_by_url:
            _fail("license_evidence_url must cite a source in this entry")
        license_sources = [pair for pair in source_by_url[entry["license_evidence_url"]] if pair[0]["kind"] == "license"]
        if not license_sources:
            _fail("license_evidence_url must point to a license source")
        license_proved = False
        for source, body in license_sources:
            try:
                evidence = json.loads(body)
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
            if not isinstance(evidence, dict):
                continue
            try:
                encoded_content = evidence.get("content", "")
                if not isinstance(encoded_content, str):
                    continue
                content = base64.b64decode("".join(encoded_content.split()), validate=True).decode("utf-8").strip()
            except (ValueError, UnicodeDecodeError):
                content = ""
            license_info = evidence.get("license")
            if (isinstance(license_info, dict) and license_info.get("spdx_id") == entry["license"] and content and
                    _github_api_endpoint(source["url"], owner, repo_name, license_endpoint=True)):
                license_proved = True
        reviewed_text = _reviewed_license_text(entry, license_sources, owner, repo_name)
        if not license_proved and not reviewed_text:
            _fail("license source must prove SPDX via GitHub license API or reviewed complete license text")
        metadata_sources = [source_pair for pairs in source_by_url.values()
                            for source_pair in pairs if source_pair[0]["kind"] == "repository_metadata"]
        repo_proved = False
        for source, body in metadata_sources:
            if _github_page_identity(source["url"], body, owner, repo_name, entry["github_repository_id"]):
                repo_proved = True
                continue
            try:
                metadata = json.loads(body)
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
            if not isinstance(metadata, dict) or not _github_api_endpoint(source["url"], owner, repo_name):
                continue
            full_name = metadata.get("full_name")
            if (type(metadata.get("id")) is int and metadata["id"] == entry["github_repository_id"]
                    and isinstance(full_name, str) and full_name.casefold() == f"{owner}/{repo_name}".casefold()):
                repo_proved = True
        if not repo_proved:
            _fail("repository_metadata must prove github id and full_name")
        for key in ("features", "deployment", "technology_stack"):
            value = entry.get(key)
            if not isinstance(value, list) or not value or any(not isinstance(x, str) or not x.strip() for x in value):
                _fail(f"open-source {key} must be a nonempty string list")
    return {**entry, "sources": checked_sources, "leaf_matches": [dict(x) for x in matches]}


def validate_batch(batch_path, source_root=DEFAULT_SOURCE_ROOT, catalog_path=DEFAULT_CATALOG):
    """Validate every entry and cited source snapshot before any database writes."""
    batch = json.loads(Path(batch_path).read_text(encoding="utf-8"))
    if (not isinstance(batch, dict) or type(batch.get("schema_version")) is not int
            or batch.get("schema_version") != 1):
        _fail("batch schema_version must be 1")
    if not isinstance(batch.get("batch_id"), str) or not batch["batch_id"].strip():
        _fail("batch_id is required")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", batch["batch_id"]):
        _fail("batch_id may contain only letters, numbers, dot, underscore and hyphen")
    entries = batch.get("entries")
    if not isinstance(entries, list) or not entries:
        _fail("batch entries must be a nonempty list")
    catalog = json.loads(Path(catalog_path).read_text(encoding="utf-8"))
    if not isinstance(catalog, dict) or not isinstance(catalog.get("leaves"), list):
        _fail("catalog must be an object containing a leaves list")
    if any(not isinstance(leaf, dict) or not isinstance(leaf.get("slug"), str) for leaf in catalog["leaves"]):
        _fail("catalog leaves must be objects with string slugs")
    leaves = {leaf["slug"]: leaf for leaf in catalog.get("leaves", [])}
    root = Path(source_root)
    validated = [_validate_entry(entry, root, leaves) for entry in entries]
    ids = [entry["id"] for entry in validated]
    if len(ids) != len(set(ids)):
        _fail("duplicate application id in batch")
    return {"schema_version": 1, "batch_id": batch["batch_id"], "entries": validated}


def _merge_entry(previous, incoming):
    merged = dict(previous)
    merged.update(incoming)
    merged["sources"] = _merge_sources(previous.get("sources", []), incoming["sources"])
    merged["leaf_matches"] = _merge_leaf_matches(previous.get("leaf_matches", []), incoming["leaf_matches"])
    return merged


def import_batch(batch_path, database_path, source_root=DEFAULT_SOURCE_ROOT, catalog_path=DEFAULT_CATALOG):
    """Validate the full batch, then atomically merge applications and relations."""
    batch = validate_batch(batch_path, source_root, catalog_path)
    batch_bytes = json.dumps(batch, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    batch_hash = hashlib.sha256(batch_bytes).hexdigest()
    root = Path(source_root)
    receipt_dir = root / "receipts"
    receipt_path = receipt_dir / f"{batch['batch_id']}.json"
    batch_was_imported = receipt_path.exists()
    if batch_was_imported:
        previous_receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        if previous_receipt.get("batch_sha256") != batch_hash:
            _fail("batch_id already used for different batch content")

    counts = {"entries_processed": len(batch["entries"]), "applications_created": 0,
              "applications_updated": 0, "track_links_added": 0, "leaf_links_added": 0}
    store = Store(database_path)
    with store.connect() as con:
        for entry in batch["entries"]:
            row = con.execute("SELECT name,data FROM application WHERE id=?", (entry["id"],)).fetchone()
            if row:
                existing = json.loads(row["data"])
                if entry["track"] == "open_source":
                    old_repo = existing.get("repository_url")
                    if old_repo and old_repo.rstrip("/").casefold() != entry["repository_url"].rstrip("/").casefold():
                        _fail("application id conflicts with a different repository identity")
                    old_id = existing.get("github_repository_id")
                    if old_id is not None and old_id != entry["github_repository_id"]:
                        _fail("application id conflicts with a different GitHub repository id")
                merged = _merge_entry(existing, entry)
                con.execute("UPDATE application SET name=?,data=? WHERE id=?",
                            (merged["name"], json.dumps(merged, ensure_ascii=False, sort_keys=True), entry["id"]))
                counts["applications_updated"] += 1
            else:
                merged = dict(entry)
                con.execute("INSERT INTO application(id,name,data) VALUES(?,?,?)",
                            (entry["id"], entry["name"], json.dumps(merged, ensure_ascii=False, sort_keys=True)))
                counts["applications_created"] += 1
            cur = con.execute("INSERT OR IGNORE INTO application_track(app_id,track) VALUES(?,?)",
                              (entry["id"], entry["track"]))
            counts["track_links_added"] += cur.rowcount
            for match in entry["leaf_matches"]:
                cur = con.execute("INSERT OR IGNORE INTO leaf_application(leaf,app_id) VALUES(?,?)",
                                  (match["slug"], entry["id"]))
                counts["leaf_links_added"] += cur.rowcount

    receipt = {"schema_version": 1, "batch_id": batch["batch_id"], "batch_sha256": batch_hash,
               "checkpoint": {"last_entry_id": batch["entries"][-1]["id"], "entries_processed": len(batch["entries"])},
               "counts": counts, "already_imported": batch_was_imported}
    receipt_dir.mkdir(parents=True, exist_ok=True)
    temporary = receipt_path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(receipt_path)
    return receipt


def fetch_source(url, kind, source_root=DEFAULT_SOURCE_ROOT, timeout=10, max_bytes=1_000_000):
    """Fetch a public text source without credentials and save its immutable snapshot."""
    _http_url(url, "source url")
    if not isinstance(kind, str) or kind not in SOURCE_KINDS:
        _fail("source kind is invalid")
    if timeout <= 0 or max_bytes <= 0:
        _fail("timeout and max_bytes must be positive")
    request = Request(url, headers={"User-Agent": "SaaS-Grove-case-collector/1.0", "Accept": "text/*, application/json"})
    with urlopen(request, timeout=timeout) as response:
        status = getattr(response, "status", 200)
        if status < 200 or status >= 300:
            _fail(f"source request failed with HTTP {status}")
        final_url = response.geturl()
        if _http_url(final_url, "final source url").hostname.lower() != urlparse(url).hostname.lower():
            _fail("source request redirected to a different host")
        content_type = response.headers.get_content_type().lower()
        if not (content_type.startswith("text/") or content_type in {"application/json", "application/xml", "application/xhtml+xml"}):
            _fail("source response is not a text content type")
        body = response.read(max_bytes + 1)
    if len(body) > max_bytes:
        _fail("source response exceeds max_bytes")
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("source response must be UTF-8 text") from exc
    if "\x00" in text:
        _fail("source response is not text")
    digest = hashlib.sha256(body).hexdigest()
    root = Path(source_root)
    snapshots = root / "sources"
    snapshots.mkdir(parents=True, exist_ok=True)
    root_resolved = root.resolve()
    if snapshots.is_symlink() or not snapshots.resolve().is_relative_to(root_resolved):
        _fail("source snapshot directory escapes source root")
    path = snapshots / f"{digest}.txt"
    if path.is_symlink():
        _fail("source snapshot must not be a symbolic link")
    if path.exists() and path.read_bytes() != body:
        _fail("snapshot hash collision")
    path.write_bytes(body)
    return {"url": url, "sha256": digest, "snapshot_path": f"sources/{digest}.txt",
            "fetched_at": datetime.now().astimezone().isoformat(), "kind": kind}
