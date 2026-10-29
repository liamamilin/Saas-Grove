#!/usr/bin/env python3
"""Validate, fetch and import source-backed application collection batches."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server.case_collection import (DEFAULT_CATALOG, DEFAULT_SOURCE_ROOT, fetch_source,
                                   import_batch, validate_batch)
from server.config import RUNTIME_DIR


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("validate", "import"):
        sub = subparsers.add_parser(name)
        sub.add_argument("--batch", required=True, type=Path)
        sub.add_argument("--database", type=Path, default=RUNTIME_DIR / "catalog.sqlite")
        sub.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
        sub.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    fetch = subparsers.add_parser("fetch")
    fetch.add_argument("--url", required=True)
    fetch.add_argument("--kind", required=True)
    fetch.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    fetch.add_argument("--timeout", type=float, default=10)
    fetch.add_argument("--max-bytes", type=int, default=1_000_000)
    args = parser.parse_args(argv)
    try:
        if args.command == "validate":
            result = validate_batch(args.batch, args.source_root, args.catalog)
            output = {"batch_id": result["batch_id"], "entries_validated": len(result["entries"]),
                      "application_ids": [entry["id"] for entry in result["entries"]], "valid": True}
        elif args.command == "import":
            output = import_batch(args.batch, args.database, args.source_root, args.catalog)
        else:
            output = fetch_source(args.url, args.kind, args.source_root, args.timeout, args.max_bytes)
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
