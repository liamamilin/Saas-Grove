from functools import partial
import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest

from server.api import CatalogAPI, Handler
from server.products import deployment_options
from server.store import Store
from server.taxonomy import Taxonomy

CRM = "customer-relationship-management-crm"
FORM = "online-form-builder"


class ProductTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.taxonomy = Taxonomy()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name) / "catalog.sqlite")
        self.api = CatalogAPI(self.taxonomy, self.store)
        self.open = {"id": "github:alpha", "name": "Alpha CRM", "name_en": "AlphaCloud", "aliases_zh": ["阿尔法"],
                     "summary": "组织客户资料与协作记录", "features": ["维护联系人"], "license": "MIT",
                     "license_evidence_url": "https://example.test/license", "deployment": ["Docker 自托管"],
                     "verification_status": "official_sources_reviewed", "runtime_tested": False,
                     "sources": [{"url": "https://example.test/readme", "kind": "readme", "fetched_at": "2026-10-28T20:00:00+08:00"}]}
        self.store.save(self.open, [CRM, FORM], ["open_source"])
        self.store.save({"id": "beta", "name": "Beta", "summary": "客户记录", "checked_at": "2026-10-28T13:00:00Z"}, [CRM], ["commercial"])
        self.store.save({"id": "gamma", "name": "Gamma", "summary": "在线问卷", "license": "MIT", "deployment": []}, [FORM], ["open_source", "commercial"])

    def search(self, **query):
        return self.api.get("/api/products", query)

    def test_global_name_english_chinese_alias_and_type_alias_search(self):
        for q in ["ALPHA", "AlphaCloud", "阿尔法", "客户 协作", "ＣＲＭ"]:
            self.assertIn("github:alpha", [a["id"] for a in self.search(q=q)["applications"]], q)
        self.assertEqual({a["id"] for a in self.search(q="CRM系统")["applications"]}, {"github:alpha", "beta"})
        self.assertEqual({a["id"] for a in self.search(q="在线表单")["applications"]}, {"github:alpha", "gamma"})
        self.assertEqual(self.search(q="不存在")['total'], 0)
        self.assertEqual(self.store.applications(CRM, query="阿尔法")["total"], 1)
        self.assertEqual(self.store.applications(CRM, query="AlphaCloud")["total"], 1)

    def test_tracks_license_and_positive_deployment_evidence(self):
        self.assertEqual(self.search()["total"], 3)  # Dual-track identity appears once.
        self.assertEqual(self.search(track="commercial")["total"], 2)
        self.assertEqual([a["id"] for a in self.search(license="MIT", deployment="docker")["applications"]], ["github:alpha"])
        self.assertEqual(self.search(track="commercial", deployment="managed_cloud")["total"], 0)
        self.assertEqual(self.search(track="commercial", license="MIT")["total"], 1)
        self.assertEqual(deployment_options(["不支持 Docker", "尚未进行部署测试"]), [])
        self.assertEqual(deployment_options(["自托管；不支持 Windows 客户端"]), ["self_hosted"])
        self.assertEqual(deployment_options(["仅支持 Docker，不支持自托管"]), ["docker"])
        self.assertEqual(deployment_options(["无法自托管", "no Docker", "not available as SaaS"]), [])
        self.assertEqual(deployment_options(["self-hosted is not supported; official cloud"]), ["managed_cloud"])
        self.assertEqual(deployment_options(["Docker Compose 自托管，可选官方云服务"]), ["self_hosted", "docker", "managed_cloud"])

    def test_paging_and_stable_sorting(self):
        first, second = self.search(page_size="2"), self.search(page_size="2", page="2")
        self.assertEqual((first['page'], first['pages'], first['total']), (1, 2, 3))
        self.assertFalse({a['id'] for a in first['applications']} & {a['id'] for a in second['applications']})
        self.assertEqual(self.search(sort="name")['applications'][0]['name'], "Alpha CRM")
        self.assertEqual(self.search(sort="checked")['applications'][0]['name'], "Beta")
        self.assertEqual(self.search(page="999", page_size="2")['page'], 2)

    def test_detail_keeps_evidence_identity_and_no_invented_facts(self):
        app = self.api.get('/api/products/github:alpha', {})
        self.assertEqual(app['id'], self.open['id'])
        self.assertEqual(app['sources'], self.open['sources'])
        self.assertEqual(app['features'], self.open['features'])
        self.assertEqual(app['license_status'], 'reviewed')
        self.assertEqual(app['checked_at_basis'], 'source_fetched')
        self.assertEqual(app['runtime_tested'], False)
        self.assertEqual({t['slug'] for t in app['types']}, {CRM, FORM})
        self.assertEqual(self.api.get('/api/products/gamma', {})['license_status'], 'unverified')
        beta = self.api.get('/api/products/beta', {})
        self.assertNotIn('features', beta)
        self.assertNotIn('deployment', beta)
        self.assertEqual(beta['checked_at_basis'], 'recorded')
        with self.assertRaises(KeyError): self.api.get('/api/products/missing', {})

    def test_comparison_order_common_type_and_missing_information(self):
        result = self.api.get('/api/compare', {'ids': 'beta,github:alpha', 'leaf': CRM})
        self.assertEqual([a['id'] for a in result['products']], ['beta', 'github:alpha'])
        self.assertEqual(result['leaf']['slug'], CRM)
        self.assertNotIn('features', result['products'][0])
        for ids in ['', 'beta', 'beta,beta', 'beta,gamma', 'beta,gamma,github:alpha,beta,gamma']:
            with self.assertRaises(ValueError): self.api.get('/api/compare', {'ids': ids})
        with self.assertRaises(KeyError): self.api.get('/api/compare', {'ids': 'beta,missing'})
        with self.assertRaises(ValueError): self.api.get('/api/compare', {'ids': 'beta,github:alpha', 'leaf': FORM})

    def test_four_products_compare_and_fifth_is_rejected(self):
        self.store.save({"id":"delta", "name":"Delta"}, [CRM], ["open_source"])
        self.store.save({"id":"epsilon", "name":"Epsilon"}, [CRM], ["commercial"])
        result = self.api.get('/api/compare', {'ids':'github:alpha,beta,delta,epsilon', 'leaf':CRM})
        self.assertEqual(len(result['products']), 4)
        with self.assertRaises(ValueError): self.api.get('/api/compare', {'ids':'github:alpha,beta,delta,epsilon,gamma'})

    def test_nullable_optional_record_fields_remain_unknown(self):
        self.store.save({"id":"nullable", "name":"Nullable", "summary":None, "aliases":None, "aliases_zh":None,
                         "sources":None, "deployment":None, "license_review":None}, [CRM], ["commercial"])
        self.assertEqual(self.search(q="nullable")['total'], 1)
        self.assertEqual(self.api.get('/api/products/nullable', {})['license_status'], 'unverified')
        self.assertEqual(len(self.api.get('/api/compare', {'ids':'nullable, beta', 'leaf':CRM})['products']), 2)

    def test_invalid_parameters_and_sql_metacharacters(self):
        for query in [{'track': 'typo'}, {'sort': 'random'}, {'deployment': 'unknown'}, {'license': 'unknown'}, {'page': 'x'}, {'page': '0'}, {'page_size': '61'}, {'q': 'x'*161}]:
            with self.assertRaises(ValueError): self.search(**query)
        self.assertEqual(self.search(q="%' OR 1=1 --")['total'], 0)
        self.assertEqual(self.store.applications(CRM)['total'], 1)
        self.assertIn(CRM, [leaf['slug'] for d in self.taxonomy.tree('CRM系统')['domains'] for g in d['groups'] for leaf in g['leaves']])

    def test_read_endpoints_leave_sqlite_rows_unchanged(self):
        def rows():
            with self.store.connect() as con:
                return {t: sorted(map(tuple, con.execute('SELECT * FROM '+t))) for t in ['application', 'application_track', 'leaf_application']}
        before = rows()
        self.search(q='CRM系统')
        self.api.get('/api/products/github:alpha', {})
        self.api.get('/api/compare', {'ids': 'beta,github:alpha'})
        self.assertEqual(before, rows())

    def test_http_encoded_product_ids_and_new_spa_routes_refresh(self):
        root = Path(self.temp.name) / 'web'; root.mkdir()
        (root / 'index.html').write_text('<html>products</html>')
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, api=self.api, web_root=root))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close); self.addCleanup(server.shutdown)
        for route in ['/search?q=CRM', '/products/github%3Aalpha', '/compare?ids=beta,github%3Aalpha']:
            client = http.client.HTTPConnection('127.0.0.1', server.server_port)
            client.request('GET', route); r = client.getresponse()
            self.assertEqual((r.status, r.read()), (200, b'<html>products</html>')); client.close()
        client = http.client.HTTPConnection('127.0.0.1', server.server_port)
        client.request('GET', '/api/products/github%3Aalpha'); r = client.getresponse()
        self.assertEqual(json.loads(r.read())['id'], 'github:alpha'); client.close()
