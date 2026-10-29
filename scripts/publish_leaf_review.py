#!/usr/bin/env python3
"""Read-only validation or controlled publication of the 548-leaf recheck."""
import argparse
import json
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from server.config import TAXONOMY_DIR
from server.scope_publication import check, publish


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "publish"))
    parser.add_argument("--repo", type=Path, default=REPO)
    parser.add_argument("--run-root", type=Path)
    parser.add_argument("--results-dir", type=Path)
    parser.add_argument("--taxonomy-dir", type=Path)
    parser.add_argument("--review-dir", type=Path)
    args = parser.parse_args(argv)
    root = args.repo.resolve()
    run_root = (args.run_root or root / "var/leaf-review/recheck-548").resolve()
    results_dir = (args.results_dir or root / "data/taxonomy/leaf-reviews/rechecks").resolve()
    taxonomy_dir = (args.taxonomy_dir or root / "data/taxonomy").resolve()
    review_dir = (args.review_dir or root / "data/taxonomy/leaf-reviews").resolve()
    manifest = run_root / "manifest.json"
    source = taxonomy_dir / "atlas-source.json"
    queue = review_dir / "review-queue.json"
    if args.command == "check":
        result = check(manifest, queue, source, run_root, results_dir, taxonomy_dir)
        # check() is intentionally read-only; keep stdout useful and compact.
        result = {k: result[k] for k in ("valid", "run_id", "coverage", "source_sha256", "queue_sha256",
                                          "catalog_revision", "scope_changed_count", "scope_changed_slugs")}
    else:
        result = publish(manifest, queue, source, run_root, results_dir, taxonomy_dir, review_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as exc:
        print(f"publish_leaf_review: {exc}", file=sys.stderr)
        raise SystemExit(2)
