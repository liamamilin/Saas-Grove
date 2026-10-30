import copy
import hashlib
import html
import json
from pathlib import Path
import re
import sqlite3
import unittest
from server.comparison import crm_rows, CRM, TWENTY, ESPO

ROOT = Path(__file__).resolve().parents[2]
class CRMEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        con = sqlite3.connect(":memory:")
        con.executescript((ROOT / "data/catalog.sql").read_text())
        cls.apps = [json.loads(con.execute("SELECT data FROM application WHERE id=?", (key,)).fetchone()[0]) for key in (TWENTY, ESPO, "commercial:salesforce")]
        con.close()

    def test_crm_lens_preserves_formal_records_and_order(self):
        original = copy.deepcopy(self.apps)
        rows = crm_rows(self.apps, CRM)
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(len(r["cells"]) == 3 for r in rows))
        self.assertEqual(self.apps, original)
        self.assertEqual(crm_rows(self.apps, "online-form-builder"), [])

    def test_commercial_and_uncertain_edition_facts_are_not_invented(self):
        rows = crm_rows(self.apps, CRM)
        self.assertTrue(all(r['cells'][2] == {'status':'unknown','value':'','sources':[]} for r in rows))
        self.assertEqual(rows[1]['cells'][0]['status'], 'unknown')  # No Twenty pipeline evidence in this lens.
        self.assertIn('未核实', rows[2]['cells'][0]['value'])
        self.assertIn('单独扩展', rows[2]['cells'][1]['value'])

    def test_missing_or_changed_original_sha_remains_unknown(self):
        apps = copy.deepcopy(self.apps)
        apps[0]['sources'] = None
        for source in apps[1]['sources']: source['sha256'] = 'changed'
        self.assertTrue(all(c['status']=='unknown' for r in crm_rows(apps, CRM) for c in r['cells']))

    def test_each_fact_is_bound_to_its_existing_product_source(self):
        for row in crm_rows(self.apps, CRM):
            for app, cell in zip(self.apps, row['cells']):
                for source in cell['sources']:
                    self.assertTrue(any(s.get('sha256')==source['sha256'] and s['url']==source['url'] for s in app['sources']))
                    self.assertTrue(source['quote'])

    def test_local_source_content_matches_sha_and_excerpt(self):
        for row in crm_rows(self.apps, CRM):
            for cell in row['cells']:
                for source in cell['sources']:
                    path = ROOT / 'data/collections/sources' / (source['sha256']+'.txt')
                    if not path.exists(): self.skipTest('Raw source snapshots are local-only; portable catalog binding tested above')
                    raw = path.read_bytes()
                    self.assertEqual(hashlib.sha256(raw).hexdigest(), source['sha256'])
                    plain = re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]*>', ' ', raw.decode())))
                    self.assertIn(source['quote'], plain)
