#!/usr/bin/env python3
"""Import public Atlas type data; rebuild without Atlas from the saved snapshot."""
import argparse
import csv
from datetime import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.taxonomy import build_catalog, read_json, write_json
from server.config import TAXONOMY_DIR


def snapshot(root):
    root = Path(root).resolve()
    public = root / "atlas-web/public/data"
    meta = read_json(public / "meta.json")
    structure = read_json(root / "application-atlas-production-pack/atlas/atlas.json")
    labels = {d["id"]: d for d in meta["l0s"]}
    labels.update({g["id"]: g for d in meta["l0s"] for g in d["subs"]})
    categories = [{"id": n["id"], "parent_id": n["parent"], "name": n["name"],
                   "name_zh": labels.get(n["id"], {}).get("name_zh", "") or n["name"]}
                  for n in structure["sections"]]
    leaves = []
    hashes = {}
    for r in sorted(meta["leafIndex"], key=lambda r: r["slug"]):
        path = public / "leaves" / (r["slug"] + ".json")
        detail = read_json(path)
        fields = ["slug", "name", "name_zh", "aliases_zh", "overview", "overview_zh", "dc", "dc_zh", "rules", "rules_zh"]
        row = {k: detail.get(k, [] if k == "aliases_zh" else "") for k in fields}
        row.update(parent_id=r["sec"], domain_id=r["sec"].split(".")[0])
        leaves.append(row)
        hashes[r["slug"]] = hashlib.sha256(path.read_bytes()).hexdigest()
    if set(structure["leaves"]) != {r["slug"] for r in leaves}:
        raise ValueError("Atlas 正式类型源与公开快照不一致，请先更新源快照")
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    return {"schema_version": 1, "source": {"project": "Application Atlas", "reference_revision": revision,
            "import_date": datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat(), "source_leaf_count": len(leaves),
            "public_content_sha256": hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest(),
            "note": "公开分类与类型资料快照；运行时独立于 Atlas。"}, "categories": categories, "leaves": leaves}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Atlas 仓库；省略时从已保存的快照重建")
    parser.add_argument("--output", type=Path, default=TAXONOMY_DIR)
    args = parser.parse_args()
    source = snapshot(args.source) if args.source else read_json(args.output / "atlas-source.json")
    policy = read_json(args.output / "scope-policy.json")
    overrides = read_json(args.output / "overrides.json")
    catalog = build_catalog(source, policy, overrides)
    if args.source:
        write_json(args.output / "atlas-source.json", source)
    write_json(args.output / "catalog.json", catalog)
    categories = {r["id"]: r for r in catalog["categories"]}
    with (args.output / "scope-review.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["slug", "名称", "领域", "子分类", "范围", "判断依据", "理由"])
        labels = {"included": "主目录", "conditional": "待确认", "excluded": "排除"}
        for leaf in catalog["leaves"]:
            writer.writerow([leaf["slug"], leaf["name_zh"], categories[leaf["domain_id"]]["name_zh"],
                             categories[leaf["parent_id"]]["name_zh"], labels[leaf["scope"]],
                             leaf["scope_rule"], leaf["scope_reason"]])
    print(json.dumps({"source_leaves": len(source["leaves"]), "categories": len(source["categories"]),
                      "scope": catalog["counts"], "revision": catalog["revision"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
