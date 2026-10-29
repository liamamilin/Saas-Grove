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
    store = Store()
    leaf = "customer-relationship-management-crm"
    store.save({"id": "fixture-open", "name": "测试开源项目", "summary": "测试替身：团队协作与客户记录",
                "repository_url": "https://example.test/open", "source_url": "https://example.test/open/readme",
                "sources": [{"url": "https://example.test/open/readme", "kind": "readme",
                             "fetched_at": "2026-10-22T12:00:00Z"}],
                "license": "测试许可证", "deployment": ["Docker"],
                "technology_stack": ["Python", "SQLite"], "runtime_tested": False},
               [leaf], ["open_source"])
    store.save({"id": "fixture-commercial", "name": "测试商业产品", "summary": "测试替身：客户管理服务", "homepage": "https://example.test/commercial"}, [leaf], ["commercial"])
    sys.argv = [sys.argv[0], "--port", "5399"]
    main()
