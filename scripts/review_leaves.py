#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path
REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from server.leaf_review import assemble, prepare, status

def main():
    p = argparse.ArgumentParser(description="Prepare and validate offline SaaS leaf review batches")
    p.add_argument("command", choices=["prepare", "status", "assemble"])
    p.add_argument("--source", type=Path, default=REPO / "data/taxonomy/atlas-source.json")
    p.add_argument("--run-root", type=Path, default=REPO / "var/leaf-review/saas-v1")
    p.add_argument("--results", type=Path, default=REPO / "data/taxonomy/leaf-reviews")
    args = p.parse_args()
    if args.command == "prepare":
        result = prepare(args.source, args.run_root)
    elif args.command == "status":
        result = status(args.run_root, args.results, args.source)
    else:
        result = assemble(args.run_root, args.results, args.source, REPO / "data/taxonomy/catalog.json")
    import json
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
