#!/usr/bin/env python3
"""Read-only check or controlled publication of a case-backed scope review."""
import argparse
import json
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from server.case_scope_review import check, publish


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "publish"))
    parser.add_argument("--review", required=True, type=Path)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--repo", "--test-root", dest="repo", type=Path, default=REPO)
    parser.add_argument("--run-root", type=Path)
    args = parser.parse_args(argv)
    operation = check if args.command == "check" else publish
    result = operation(args.review, args.database, args.repo, args.run_root)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as exc:
        print(f"confirm_case_scopes: {exc}", file=sys.stderr)
        raise SystemExit(2)
