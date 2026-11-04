"""Product discovery over the existing SQLite identities; never rewrites research data."""
from collections import Counter, defaultdict
from datetime import datetime
import json
import re
import unicodedata
from .comparison import crm_rows
from .resources import Resources
from .selection import Selection

DEPLOYMENTS = {"self_hosted": "自托管", "docker": "Docker", "managed_cloud": "云部署 / 托管服务"}


def mentions(word, text):
    """Latin words match at a word start ("erp" is not inside "enterprise"); Chinese matches as a substring."""
    if re.fullmatch(r"[a-z0-9]+", word):
        return re.search(r"(?<![a-z0-9])" + re.escape(word), text) is not None
    return word in text


def normalized(value):
    return unicodedata.normalize("NFKC", value or "").casefold().strip()


def timestamp(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return 0


def deployment_options(values):
    """Only index delivery forms actually named in the record, not inferred from track."""
    patterns = {"self_hosted": r"自托管|自建|self[- ]?host(?:ed|ing)?|on[- ]premises?",
                "docker": r"\bdocker\b", "managed_cloud": r"(?<!自)托管|官方云|云部署|云服务|\bcloud\b|\bsaas\b"}
    supported = set()
    for value in values or []:
        for clause in re.split(r"[;；,，。\n]|\bbut\b|但是|不过", value, flags=re.I):
            for option, pattern in patterns.items():
                for match in re.finditer(pattern, clause, re.I):
                    before, after = clause[:match.start()], clause[match.end():]
                    negative_before = re.search(r"(?:不支持|不提供|未提供|无需|无法|不能|不允许|未支持|未核实|待核实|\bnot\b|\bno\b|\bwithout\b|\bcannot\b).{0,20}$", before, re.I)
                    negative_after = re.match(r"\s*(?:(?:is|are)\s+)?(?:not\b|unavailable|unsupported|未提供|不支持|不可|无法)", after, re.I)
                    if not negative_before and not negative_after:
                        supported.add(option)
    return [option for option in DEPLOYMENTS if option in supported]


class Products:
    def __init__(self, store, taxonomy, resources=None):
        self.store, self.taxonomy = store, taxonomy
        self.resources = resources if resources is not None else Resources()
        self.selection = Selection()

    def leaf_ref(self, slug):
        row = self.taxonomy.leaves[slug]
        return {key: row[key] for key in ("slug", "name", "name_zh", "scope", "domain_id")}

    def records(self, app_id=None, app_ids=None, full=False):
        # 1,440 records fit comfortably in memory. Three SQLite reads avoid N+1 queries,
        # JSON/schema migrations, and a second search index that can drift from imports.
        with self.store.connect() as con:
            args = (app_id,) if app_id is not None else ()
            where = " WHERE id=?" if app_id is not None else ""
            relation_where = " WHERE app_id=?" if app_id is not None else ""
            if app_ids is not None:
                if not app_ids:
                    return []
                args = tuple(app_ids)
                placeholders = ",".join("?" for _ in args)
                where = f" WHERE id IN ({placeholders})"
                relation_where = f" WHERE app_id IN ({placeholders})"
            apps = [json.loads(row[0]) for row in con.execute("SELECT data FROM application" + where, args)]
            tracks, leaves = defaultdict(list), defaultdict(list)
            for row in con.execute("SELECT app_id,track FROM application_track" + relation_where + " ORDER BY track DESC", args):
                tracks[row[0]].append(row[1])
            for row in con.execute("SELECT app_id,leaf FROM leaf_application" + relation_where + " ORDER BY leaf", args):
                if row[1] in self.taxonomy.leaves and self.taxonomy.leaves[row[1]]["scope"] != "excluded":
                    leaves[row[0]].append(row[1])
        for app in apps:
            app["tracks"] = tracks[app["id"]]
            app["types"] = [self.leaf_ref(slug) for slug in leaves[app["id"]]]
            dates = [s.get("fetched_at", "") for s in (app.get("sources") or [])]
            app["checked_at_basis"] = "recorded" if app.get("checked_at") else "source_fetched"
            app["checked_at"] = app.get("checked_at") or max(dates, key=timestamp, default="")
            license_evidence = app.get("license_evidence_url") or (app.get("license_review") or {}).get("source_url")
            app["license_status"] = "reviewed" if app.get("license") and license_evidence and app.get("verification_status") == "official_sources_reviewed" else "unverified"
            app["deployment_options"] = deployment_options(app.get("deployment", []))
            self.resources.decorate(app, full)
            self.selection.decorate(app)
        return apps

    @staticmethod
    def card(app):
        keys = ("id", "name", "summary", "homepage", "repository_url", "tracks", "types", "license",
                "license_status", "deployment_options", "checked_at", "checked_at_basis", "verification_status", "runtime_tested",
                "logo_url", "resources_curated", "screenshot_count", "ui_screenshot_count", "catalog_note")
        return {k: app[k] for k in keys if k in app}

    def search(self, query):
        track = query.get("track", "all")
        sort = query.get("sort", "relevance")
        deployment, license_name = query.get("deployment", ""), query.get("license", "")
        leaf, exclude = query.get("leaf", ""), query.get("exclude", "")
        curated = query.get("curated", "")
        if curated not in {"", "1"}:
            raise ValueError("未知的资源筛选")
        if track not in {"all", "open_source", "commercial"}:
            raise ValueError("未知的应用分区")
        if sort not in {"relevance", "name", "checked"}:
            raise ValueError("未知的排序方式")
        if deployment and deployment not in DEPLOYMENTS:
            raise ValueError("未知的部署方式")
        try:
            page, page_size = int(query.get("page", "1")), int(query.get("page_size", "24"))
        except (TypeError, ValueError):
            raise ValueError("分页参数必须为整数")
        if page < 1 or not 1 <= page_size <= 60:
            raise ValueError("页码必须为正数，每页数量为 1–60")
        if leaf:
            self.taxonomy.leaf(leaf)
        q = normalized(query.get("q", ""))
        words = q.split()
        records = self.records()
        if license_name and license_name not in {app.get("license") for app in records}:
            raise ValueError("未知的许可证")
        ranked = []
        for app in records:
            if track != "all" and track not in app["tracks"]:
                continue
            slugs = [t["slug"] for t in app["types"]]
            if leaf and leaf not in slugs or app["id"] == exclude:
                continue
            aliases = [app.get("name_en") or "", app.get("english_name") or "", *(app.get("aliases") or []), *(app.get("aliases_zh") or [])]
            name = normalized(" ".join([app["name"], *aliases]))
            summary = normalized(app.get("summary", ""))
            types = " ".join(self.taxonomy.search[slug] for slug in slugs)
            type_names = " ".join(self.taxonomy.names[slug] for slug in slugs)
            if not all(w in name or w in summary or w in types for w in words):
                continue
            # A match on the product's own type name or alias outranks a passing mention in the summary
            # ("工单" should surface help desks before car-repair work orders).
            score = (100 if q and q == normalized(app["name"]) else 0) + sum(20 if w in name else 15 if mentions(w, type_names) else 5 if w in summary else 1 for w in words)
            ranked.append((app, score))
        licenses = Counter(a.get("license") for a, _ in ranked if a.get("license"))
        deployments = Counter(d for a, _ in ranked for d in a["deployment_options"])
        curated_count = sum(1 for a, _ in ranked if a["resources_curated"])
        ranked = [(a, s) for a, s in ranked if (not license_name or a.get("license") == license_name)
                  and (not deployment or deployment in a["deployment_options"]) and (not curated or a["resources_curated"])]
        def order(item):
            app, score = item
            stable = (normalized(app["name"]), app["id"])
            if sort == "name":
                return stable
            if sort == "checked":
                return (-timestamp(app["checked_at"]), *stable)
            return (-score, "open_source" not in app["tracks"], *stable)
        ranked.sort(key=order)
        total = len(ranked)
        pages = max(1, (total + page_size - 1) // page_size)
        page = min(page, pages)
        start = (page - 1) * page_size
        return {"applications": [self.card(app) for app, _ in ranked[start:start + page_size]],
                "total": total, "page": page, "page_size": page_size, "pages": pages,
                "facets": {"licenses": [{"value": v, "count": n} for v, n in sorted(licenses.items())],
                           "deployments": [{"value": v, "label": label, "count": deployments[v]} for v, label in DEPLOYMENTS.items() if deployments[v]],
                           "curated": curated_count},
                "suggested_types": self.suggested_types(words) if words and not leaf and len("".join(words)) >= 2 else []}

    def suggested_types(self, words, limit=4):
        """Main-directory types whose own name or alias contains every query word and that have products."""
        counts, _ = self.store.counts()
        found = []
        for slug, row in self.taxonomy.leaves.items():
            total = sum(counts.get(slug, {}).values())
            if row["scope"] == "included" and total and all(mentions(w, self.taxonomy.names[slug]) for w in words):
                own = [row["name"].casefold(), row["name_zh"].casefold()]
                exact = " ".join(words) in [*own, *(a.casefold() for a in row["aliases_zh"])]
                tier = 0 if exact else 1 if all(any(mentions(w, n) for n in own) for w in words) else 2  # exact, own name, alias only
                found.append((tier, -total, row["name"], {**self.leaf_ref(slug), "counts": counts.get(slug, {"open_source": 0, "commercial": 0}), "product_count": total}))
        return [item[-1] for item in sorted(found, key=lambda t: t[:3])[:limit]]

    def detail(self, app_id):
        for app in self.records(app_id, full=True):
            if app["id"] == app_id:
                counts, _ = self.store.counts()
                for ref in app["types"]:
                    ref["product_count"] = sum(counts.get(ref["slug"], {}).values())
                return app
        raise KeyError(app_id)

    def lookup(self, ids):
        requested = list(dict.fromkeys(value.strip() for value in ids.split(",") if value.strip()))
        if len(requested) > 60:
            raise ValueError("每次最多读取 60 个产品")
        by_id = {app["id"]: app for app in self.records(app_ids=requested)}
        return {"applications": [self.card(by_id[app_id]) for app_id in requested if app_id in by_id],
                "missing_ids": [app_id for app_id in requested if app_id not in by_id]}

    def compare(self, ids, leaf=""):
        ids = [value.strip() for value in ids.split(",")] if ids else []
        if not 2 <= len(ids) <= 4 or len(set(ids)) != len(ids):
            raise ValueError("请选择 2–4 个不同产品进行比较")
        by_id = {app["id"]: app for app in self.records()}
        apps = [by_id[app_id] for app_id in ids]  # A missing ID is a real 404.
        full = {app["id"]: app for app in self.records(app_ids=ids, full=True)}
        apps = [full[app["id"]] for app in apps]  # resource profiles feed the activity and trial rows
        common = set.intersection(*({t["slug"] for t in app["types"]} for app in apps))
        if leaf:
            self.taxonomy.leaf(leaf)
            if leaf not in common:
                raise ValueError("比较对象必须属于同一个应用类型")
        elif common:
            leaf = sorted(common)[0]
        else:
            raise ValueError("比较对象没有共同的应用类型，请从类型页重新选择")
        return {"products": apps, "leaf": self.leaf_ref(leaf), "crm_rows": crm_rows(apps, leaf), "selection_rows": self.selection.rows(apps, leaf),
                "candidates": [self.card(a) for a in sorted(by_id.values(), key=lambda a: (normalized(a["name"]), a["id"])) if any(t["slug"] == leaf for t in a["types"])]}
