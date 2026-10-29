"""Versioned Atlas type import and editable SaaS scope decisions."""
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

from .config import TAXONOMY_DIR

VALID_SCOPE = {"included", "conditional", "excluded"}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, ensure_ascii=False, indent=1) + "\n"
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def decide(leaf, policy):
    if leaf["slug"] not in policy["reviewed_leaf_slugs"]:
        decision, rule = policy["default"], "awaiting_review"
    elif leaf["slug"] in policy["leaves"]:
        decision, rule = policy["leaves"][leaf["slug"]], "leaf_boundary_review"
    elif leaf["parent_id"] in policy["sections"]:
        decision, rule = policy["sections"][leaf["parent_id"]], "section_boundary_review"
    else:
        decision, rule = policy["default"], "awaiting_review"
    return decision["scope"], rule, decision["reason"]


def build_catalog(source, policy, overrides):
    nodes = [dict(n) for n in source["categories"]]
    by_id = {n["id"]: n for n in nodes}
    if len(by_id) != len(nodes):
        raise ValueError("分类 ID 重复")
    category_overrides = overrides.get("categories", {})
    if set(category_overrides) - by_id.keys():
        raise ValueError("本地覆盖引用未知分类")
    for node_id, change in category_overrides.items():
        if set(change) - {"name_zh"} or not isinstance(change.get("name_zh"), str) or not change["name_zh"].strip():
            raise ValueError("分类覆盖仅支持非空中文名称")
        by_id[node_id].update(change)
    for node in nodes:
        seen = set()
        current = node
        while current.get("parent_id"):
            if current["id"] in seen:
                raise ValueError("分类存在环")
            seen.add(current["id"])
            if current["parent_id"] not in by_id:
                raise ValueError("分类父级不存在")
            current = by_id[current["parent_id"]]
    source_slugs = {r["slug"] for r in source["leaves"]}
    if len(source_slugs) != len(source["leaves"]):
        raise ValueError("叶子 slug 重复")
    unknown = set(overrides.get("leaves", {})) - source_slugs
    if unknown:
        raise ValueError("本地覆盖引用未知叶子：" + ", ".join(sorted(unknown)))
    if set(policy["leaves"]) - source_slugs:
        raise ValueError("范围规则引用未知叶子")
    if set(policy["reviewed_leaf_slugs"]) - source_slugs:
        raise ValueError("已审阅名单引用未知叶子")
    if set(policy["sections"]) - by_id.keys():
        raise ValueError("范围规则引用未知分类")
    for decision in [policy["default"], *policy["sections"].values(), *policy["leaves"].values()]:
        if decision["scope"] not in VALID_SCOPE or not decision["reason"].strip():
            raise ValueError("范围判断或理由无效")
    leaves = []
    for original in source["leaves"]:
        if original["parent_id"] not in by_id:
            raise ValueError("叶子父级不存在")
        scope, rule, reason = decide(original, policy)
        leaf = {k: original[k] for k in ("slug", "name", "name_zh", "aliases_zh", "parent_id", "domain_id")}
        leaf.update(scope=scope, scope_rule=rule, scope_reason=reason,
                    review_method="awaiting_review" if rule == "awaiting_review" else "taxonomy_boundary_review")
        override = overrides.get("leaves", {}).get(leaf["slug"], {})
        if override:
            if set(override) - {"scope", "scope_reason", "name_zh", "aliases_zh"}:
                raise ValueError("本地覆盖包含不支持的字段")
            leaf.update(override)
            leaf.update(scope_rule="local_override", review_method="local_override")
        if leaf["scope"] not in VALID_SCOPE or not leaf["scope_reason"].strip():
            raise ValueError("范围判断或理由无效")
        leaves.append(leaf)
    leaves.sort(key=lambda r: (r["parent_id"], r["slug"]))
    return {"schema_version": 1, "revision": digest({"source": source, "policy": policy, "overrides": overrides}),
            "source": source["source"], "policy_version": policy["version"], "categories": nodes,
            "leaves": leaves, "counts": dict(Counter(r["scope"] for r in leaves)),
            "review_note": "目录按应用用途与交付边界划分，逐叶初判和争议复核保留独立记录；主目录展示纳入类型，待确认类型单列。类型判断不代表每类已有真实案例，案例资料核对也不代表已完成部署测试。"}


class Taxonomy:
    def __init__(self, directory=TAXONOMY_DIR):
        directory = Path(directory)
        self.source = read_json(directory / "atlas-source.json")
        self.catalog = read_json(directory / "catalog.json")
        self.categories = {r["id"]: r for r in self.catalog["categories"]}
        self.leaves = {r["slug"]: r for r in self.catalog["leaves"]}
        self.details = {r["slug"]: r for r in self.source["leaves"]}
        self.search = {}
        for slug, row in self.leaves.items():
            group = self.categories[row["parent_id"]]
            domain = self.categories[row["domain_id"]]
            self.search[slug] = " ".join([row["name"], row["name_zh"], slug, *row["aliases_zh"],
                                         group["name"], group["name_zh"], domain["name"], domain["name_zh"]]).casefold()

    def leaf(self, slug):
        if slug not in self.leaves or self.leaves[slug]["scope"] == "excluded":
            raise KeyError(slug)
        row = {**self.details[slug], **self.leaves[slug]}
        group = self.categories[row["parent_id"]]
        row["breadcrumbs"] = [self.categories[row["domain_id"]], group]
        row["source"] = self.catalog["source"]
        return row

    def tree(self, query="", scope="included", counts=None):
        if scope not in {"all", "included", "conditional"}:
            raise ValueError("未知的目录范围")
        tokens = query.strip().casefold().split()
        counts = counts or {}
        rows = []
        for leaf in self.leaves.values():
            if leaf["scope"] == "excluded" or scope != "all" and leaf["scope"] != scope:
                continue
            searchable = self.search[leaf["slug"]]
            if not all(re.search(r"(?<![a-z0-9])" + re.escape(token), searchable) if re.fullmatch(r"[a-z0-9]+", token)
                       else token in searchable for token in tokens):
                continue
            rows.append({**leaf, "counts": counts.get(leaf["slug"], {"open_source": 0, "commercial": 0})})
        domains = []
        for domain in self.catalog["categories"]:
            if domain["parent_id"] is not None:
                continue
            groups = []
            for group in self.catalog["categories"]:
                if group["parent_id"] != domain["id"]:
                    continue
                children = [r for r in rows if r["parent_id"] == group["id"]]
                if children:
                    groups.append({**group, "leaves": children})
            if groups:
                domains.append({**domain, "groups": groups, "leaf_count": sum(len(g["leaves"]) for g in groups)})
        return {"domains": domains, "matching_leaves": len(rows), "counts": self.catalog["counts"],
                "source_leaf_count": len(self.leaves), "domain_count": len(domains),
                "revision": self.catalog["revision"], "review_note": self.catalog["review_note"]}
