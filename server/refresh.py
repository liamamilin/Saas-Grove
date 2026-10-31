"""Refresh one product's official resources from its recorded sources. Dry-run unless --apply.

    python3 -m server.refresh github:572984571            # show what would change
    python3 -m server.refresh github:572984571 --apply    # write data/product-resources.json

Only the resource overlay is written. Differences in formal fields (license, homepage) become
review flags; the reviewed SQLite record is never rewritten here. A failed GitHub or homepage read
aborts before writing, so the previous data stays as it was.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .resources import default_path, read, validate
from .store import Store

USER_AGENT = "SaaS-Grove-refresh/1 (+local catalog maintenance)"
GONE = {404, 410}


class RefreshError(Exception):
    """The run cannot produce a trustworthy update; nothing is written."""


class Fetched:
    def __init__(self, status, url, content_type="", body=b""):
        self.status, self.url, self.content_type, self.body = status, url, content_type, body

    def json(self):
        return json.loads(self.body.decode("utf-8"))


def http_fetch(url, timeout=15, limit=512_000):
    """GET with redirects. HTTP errors come back as a status; network failures raise."""
    headers = {"User-Agent": USER_AGENT}
    if urlparse(url).hostname == "api.github.com":
        headers["Accept"] = "application/vnd.github+json"
        if os.environ.get("GITHUB_TOKEN"):
            headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    try:
        with urlopen(Request(url, headers=headers), timeout=timeout) as response:
            return Fetched(response.status, response.geturl(), response.headers.get("Content-Type", ""), response.read(limit))
    except HTTPError as error:
        return Fetched(error.code, url, error.headers.get("Content-Type", "") if error.headers else "")
    except (URLError, TimeoutError, OSError) as error:
        raise ConnectionError(f"{url}: {getattr(error, 'reason', error)}") from error


def github_repo(url):
    match = re.match(r"https?://github\.com/([^/]+)/([^/#?]+)", url or "")
    return (match.group(1), match.group(2).removesuffix(".git")) if match else None


def same_site(a, b):
    def key(value):
        parsed = urlparse(value or "")
        return (parsed.netloc.lower().removeprefix("www."), parsed.path.rstrip("/"))
    return key(a) == key(b)


def load_app(store, app_id):
    with store.connect() as con:
        row = con.execute("SELECT data FROM application WHERE id=?", (app_id,)).fetchone()
    if not row:
        raise KeyError(app_id)
    return json.loads(row[0])


def plan(app, entry, fetch, now):
    """Return (updated entry, human-readable changes, warnings). Pure apart from `fetch`."""
    today, stamp = now.date().isoformat(), now.isoformat(timespec="seconds")
    entry = json.loads(json.dumps(entry or {"name": app["name"]}, ensure_ascii=False))
    changes, warnings = [], []

    repo = github_repo(app.get("repository_url"))
    if repo:
        api = f"https://api.github.com/repos/{repo[0]}/{repo[1]}"
        try:
            meta = fetch(api)
        except ConnectionError as error:
            raise RefreshError(f"无法读取 GitHub 仓库信息，未写入任何更改：{error}")
        if meta.status in {403, 429}:
            raise RefreshError("GitHub 接口限流（未登录每小时 60 次），未写入任何更改；稍后重试或设置 GITHUB_TOKEN")
        if meta.status != 200:
            raise RefreshError(f"GitHub 仓库信息返回 HTTP {meta.status}，未写入任何更改")
        data = meta.json()
        release = None
        try:
            latest = fetch(f"{api}/releases/latest")
            if latest.status == 200:
                r = latest.json()
                release = {"tag": r.get("tag_name") or r.get("name") or "", "published_at": r.get("published_at") or "", "url": r.get("html_url") or ""}
            elif latest.status not in GONE:
                warnings.append(f"最新发布暂时无法确认（HTTP {latest.status}），沿用旧记录")
                release = (entry.get("repository_facts") or {}).get("latest_release")
        except ConnectionError as error:
            warnings.append(f"最新发布读取失败，沿用旧记录：{error}")
            release = (entry.get("repository_facts") or {}).get("latest_release")
        facts = {"source_url": api, "fetched_at": stamp, "archived": bool(data.get("archived")), "pushed_at": data.get("pushed_at") or "",
                 "license_spdx": (data.get("license") or {}).get("spdx_id"), "homepage": data.get("homepage") or "", "latest_release": release}
        old = entry.get("repository_facts") or {}
        if (old.get("latest_release") or {}).get("tag") != (release or {}).get("tag"):
            changes.append(f"最新发布：{(old.get('latest_release') or {}).get('tag') or '未记录'} → {(release or {}).get('tag') or '无正式发布'}")
        if bool(old.get("archived")) != facts["archived"]:
            changes.append(f"仓库归档状态：{'已归档' if facts['archived'] else '未归档'}")
        if old.get("pushed_at", "")[:10] != facts["pushed_at"][:10]:
            changes.append(f"最近代码推送：{old.get('pushed_at', '')[:10] or '未记录'} → {facts['pushed_at'][:10]}")
        entry["repository_facts"] = facts

        flags = []
        spdx = facts["license_spdx"]
        if spdx and spdx != "NOASSERTION" and app.get("license") and spdx.casefold() != app["license"].casefold():
            flags.append({"field": "license", "recorded": app["license"], "observed": spdx, "source_url": api, "observed_at": today})
        if facts["homepage"] and app.get("homepage") and not same_site(facts["homepage"], app["homepage"]):
            flags.append({"field": "homepage", "recorded": app["homepage"], "observed": facts["homepage"], "source_url": api, "observed_at": today})
        old_flags = {(f["field"], f["observed"]) for f in entry.get("review_flags", [])}
        for flag in flags:
            if (flag["field"], flag["observed"]) not in old_flags:
                changes.append(f"待复核：GitHub {flag['field']} 为 {flag['observed']}，正式记录为 {flag['recorded']}（不自动覆写）")
        entry["review_flags"] = flags

        releases_url = f"https://github.com/{repo[0]}/{repo[1]}/releases"
        if release and not any(r["type"] == "changelog" for r in entry.get("resources", [])):
            entry.setdefault("resources", []).append({"type": "changelog", "url": releases_url, "label": "GitHub Releases", "found_on": f"{api}/releases/latest",
                                                      "checked_at": today, "http_status": 200})
            changes.append(f"新增更新记录：{releases_url}")
    elif app.get("homepage"):
        try:
            home = fetch(app["homepage"])
        except ConnectionError as error:
            raise RefreshError(f"无法打开官网，未写入任何更改：{error}")
        if home.status >= 400:
            warnings.append(f"官网返回 HTTP {home.status}；正式记录未改动，请人工复核")

    for item in entry.get("resources", []):
        check_link(item, fetch, today, changes, warnings, f"{item['type']} {item['url']}")
    for shot in entry.get("screenshots", []):
        check_link(shot, fetch, today, changes, warnings, f"截图 {shot['url']}", image=True)
    if entry.get("logo"):
        check_link(entry["logo"], fetch, today, changes, warnings, f"Logo {entry['logo']['url']}", image=True)

    if changes:
        entry.setdefault("history", []).append({"at": stamp, "changes": changes})
    entry["refreshed_at"] = stamp
    return entry, changes, warnings


def check_link(item, fetch, today, changes, warnings, label, image=False):
    try:
        result = fetch(item["url"])
    except ConnectionError as error:
        warnings.append(f"{label} 暂时无法连接，保留原状态：{error}")
        return
    if 200 <= result.status < 400 and (not image or result.content_type.startswith("image/")):
        if item.get("status") == "unreachable":
            changes.append(f"{label} 已恢复可访问")
            item.pop("status")
        item["checked_at"], item["http_status"] = today, result.status
    elif result.status in GONE:
        if item.get("status") != "unreachable":
            changes.append(f"{label} 返回 HTTP {result.status}，标记为无法打开（链接保留）")
        item["status"], item["http_status"] = "unreachable", result.status
    elif 200 <= result.status < 400:
        warnings.append(f"{label} 返回的不是图片（{result.content_type or '类型未知'}），保留原状态")
    else:
        warnings.append(f"{label} 返回 HTTP {result.status}，暂时无法确认，保留原状态")


def write_atomic(path, document):
    path = Path(path)
    fd, temp = tempfile.mkstemp(prefix=".product-resources-", suffix=".json", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(document, ensure_ascii=False, indent=2) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, path.stat().st_mode & 0o777 if path.exists() else 0o644)
        os.replace(temp, path)
    except BaseException:
        Path(temp).unlink(missing_ok=True)
        raise


def run(app_id, apply=False, path=None, store=None, fetch=http_fetch, now=None, out=print):
    path = Path(path or default_path())
    store = store or Store()
    try:
        app = load_app(store, app_id)
    except KeyError:
        out(f"错误：正式产品库中没有 {app_id}")
        return 1
    document = read(path)
    with store.connect() as con:
        validate(document, {row[0] for row in con.execute("SELECT id FROM application")})
    now = now or datetime.now(timezone.utc).astimezone()
    try:
        entry, changes, warnings = plan(app, document["products"].get(app_id), fetch, now)
    except RefreshError as error:
        out(f"错误：{error}")
        return 2
    out(f"{app['name']}（{app_id}）")
    for line in changes or ["没有发现需要更新的资源"]:
        out(f"  · {line}")
    for line in warnings:
        out(f"  ! {line}")
    if not apply:
        out("预览模式，未写入。确认后加 --apply 写入资源文件。")
        return 0
    document["products"][app_id] = entry
    validate(document)
    write_atomic(path, document)
    out(f"已写入 {path}（正式产品记录未改动）")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("product_id")
    parser.add_argument("--apply", action="store_true", help="写入资源文件；默认只预览")
    parser.add_argument("--resources", help="资源文件路径（默认 data/product-resources.json）")
    args = parser.parse_args(argv)
    return run(args.product_id, args.apply, args.resources)


if __name__ == "__main__":
    sys.exit(main())
