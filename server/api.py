"""Read-only catalog API and optional built-web server. Localhost by default."""
import argparse
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from .config import WEB_ROOT
from .store import Store
from .taxonomy import Taxonomy


class CatalogAPI:
    def __init__(self, taxonomy=None, store=None):
        self.taxonomy = taxonomy or Taxonomy()
        self.store = store or Store()

    def get(self, path, query):
        q = query.get("q", "").strip()
        if len(q) > 160:
            raise ValueError("搜索内容最多 160 个字符")
        if path == "/api/health":
            return {"status": "ok", "service": "saas-catalog"}
        if path == "/api/taxonomy":
            counts, totals = self.store.counts()
            return {**self.taxonomy.tree(q, query.get("scope", "included"), counts), "application_counts": totals}
        if path.startswith("/api/leaves/"):
            slug = path.removeprefix("/api/leaves/")
            leaf = self.taxonomy.leaf(slug)
            counts, _ = self.store.counts()
            return {**leaf, "counts": counts.get(slug, {"open_source": 0, "commercial": 0})}
        if path == "/api/applications":
            leaf = query.get("leaf", "")
            self.taxonomy.leaf(leaf)
            return self.store.applications(leaf, query.get("track", "open_source"), q)
        raise KeyError(path)


class Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, api, web_root=WEB_ROOT, **kwargs):
        self.api, self.web_root = api, Path(web_root).resolve()
        super().__init__(*args, **kwargs)

    def send(self, status, content, content_type="application/json; charset=utf-8"):
        if isinstance(content, dict):
            content = json.dumps(content, ensure_ascii=False).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass  # A navigation or a new search can cancel an in-flight read.

    def do_GET(self):
        parsed = urlsplit(self.path)
        path = unquote(parsed.path)
        if "\x00" in path:
            return self.send(400, {"error": "无效的页面路径"})
        if path.startswith("/api/"):
            try:
                query = {k: v[0] for k, v in parse_qs(parsed.query, keep_blank_values=True).items()}
                return self.send(200, self.api.get(path, query))
            except KeyError:
                return self.send(404, {"error": "没有找到这个类型或页面"})
            except ValueError as error:
                return self.send(400, {"error": str(error)})
        target = (self.web_root / path.lstrip("/")).resolve()
        if not target.is_relative_to(self.web_root) or any(p.startswith(".") for p in Path(path).parts if p != "/"):
            return self.send(404, {"error": "页面不存在"})
        if not target.is_file() and (path in {"/", "/browse"} or path.startswith("/types/")):
            target = self.web_root / "index.html"
        if target.is_file():
            return self.send(200, target.read_bytes(), mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        return self.send(404, {"error": "页面不存在；开发时使用前端地址，或先构建 web"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5299)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    api = CatalogAPI()
    server = ThreadingHTTPServer((args.host, args.port), partial(Handler, api=api))
    print(f"SaaS catalog: http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
