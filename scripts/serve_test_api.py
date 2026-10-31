"""Browser-test server with isolated, explicitly synthetic application records."""
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

with tempfile.TemporaryDirectory(prefix="saas-browser-test-") as directory:
    os.environ["SAAS_RUNTIME_DIR"] = directory
    from server.api import main
    from server.store import Store
    if os.environ.get("SAAS_E2E_REAL"):
        import sqlite3
        root = Path(__file__).resolve().parents[1]
        with sqlite3.connect(Path(directory) / "catalog.sqlite") as con:
            con.executescript((root / "data/catalog.sql").read_text())
        sys.argv = [sys.argv[0], "--port", "5399"]
        main()
        sys.exit(0)
    import json
    # Synthetic resource overlay: one logo that fails (placeholder path) and one local image that loads.
    local = "http://127.0.0.1:5388/favicon.svg"
    overlay = {"schema_version": 1, "products": {
        "fixture-open": {"name": "测试开源项目", "curated_at": "2026-10-31",
                         "logo": {"url": "http://127.0.0.1:5399/missing-logo.png", "kind": "official_logo", "found_on": "https://example.test/open", "checked_at": "2026-10-31"},
                         "resources": [{"type": "docs", "url": "https://example.test/open/docs", "label": "测试文档", "found_on": "https://example.test/open", "checked_at": "2026-10-31"},
                                       {"type": "demo", "url": "https://example.test/open/demo", "label": "测试在线演示", "found_on": "https://example.test/open", "checked_at": "2026-10-31"},
                                       {"type": "deployment", "url": "https://example.test/open/install", "label": "测试部署指南", "found_on": "https://example.test/open", "checked_at": "2026-10-31"}],
                         "screenshots": [{"url": local, "caption": "测试主界面", "kind": "ui_screenshot", "found_on": "https://example.test/open", "checked_at": "2026-10-31"},
                                         {"url": local + "?second", "caption": "测试拼图", "kind": "ui_composite", "found_on": "https://example.test/open", "checked_at": "2026-10-31"}],
                         "missing": [{"type": "video", "reason": "测试：未找到演示视频"}]},
        "fixture-replacement": {"name": "候选 CRM", "curated_at": "2026-10-31",
                                "logo": {"url": local, "kind": "official_logo", "found_on": "https://example.test/replacement", "checked_at": "2026-10-31"},
                                "resources": [], "screenshots": [], "missing": [{"type": "screenshot", "reason": "测试：没有可靠截图"}]}}}
    (Path(directory) / "resources.json").write_text(json.dumps(overlay, ensure_ascii=False))
    os.environ["SAAS_RESOURCES_FILE"] = str(Path(directory) / "resources.json")
    store = Store()
    leaf = "customer-relationship-management-crm"
    store.save({"id": "fixture-open", "name": "测试开源项目", "summary": "测试替身：团队协作与客户记录",
                "repository_url": "https://example.test/open", "source_url": "https://example.test/open/readme",
                "sources": [{"url": "https://example.test/open/readme", "kind": "readme",
                             "fetched_at": "2026-10-22T12:00:00Z"},
                            {"url": "https://example.test/open/readme", "kind": "readme", "fetched_at": "2026-10-23T12:00:00Z"},
                            {"url": "https://example.test/open/readme", "kind": "readme", "fetched_at": "2026-10-21T12:00:00Z"}],
                "license": "测试许可证", "verification_status": "official_sources_reviewed", "deployment": ["Docker"],
                "technology_stack": ["Python", "SQLite"], "runtime_tested": False},
               [leaf], ["open_source"])
    store.save({"id": "fixture-commercial", "name": "测试商业产品", "summary": "测试替身：客户管理服务", "homepage": "https://example.test/commercial"}, [leaf], ["commercial"])
    store.save({"id": "fixture-replacement", "name": "候选 CRM", "summary": "替换比较对象的测试数据",
                "features": ["联系人管理"],
                "unsupported_features": [{"name": "离线原生客户端", "source_url": "https://example.test/limitations"}]},
               [leaf], ["open_source"])
    sys.argv = [sys.argv[0], "--port", "5399"]
    main()
