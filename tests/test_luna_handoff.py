import hashlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import luna_collection_handoff as handoff


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def report(slug='leaf-116', decision='content_review_passed', findings=None):
    return {'decision': decision, 'findings': [] if findings is None and decision == 'content_review_passed' else findings or [],
            'non_blocking_notes': [], 'leaf_checks': {slug: 'reviewed source and workflow'}, 'limits': []}


class HandoffQueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.run = self.root / 'run'
        self.handoff_dir = self.run / 'luna-handoff'
        self.handoff_dir.mkdir(parents=True)
        self.old = (handoff.ROOT, handoff.RUN, handoff.HANDOFF, handoff.QUEUE, handoff.MANIFEST)
        handoff.ROOT = self.root
        handoff.RUN = self.run
        handoff.HANDOFF = self.handoff_dir
        handoff.QUEUE = self.handoff_dir / 'queue.json'
        handoff.MANIFEST = self.handoff_dir / 'manifest.json'
        self.guard = threading.Lock()
        self._fixture()

    def tearDown(self):
        handoff.ROOT, handoff.RUN, handoff.HANDOFF, handoff.QUEUE, handoff.MANIFEST = self.old
        self.temp.cleanup()

    def _fixture(self, statuses=None, attempts=None):
        agents = {'luna_builder_a': 'build', 'luna_builder_b': 'build', 'luna_reviewer': 'review'}
        manifest_agents = {}
        for name, role in agents.items():
            path = self.handoff_dir / 'agents' / f'{name}-assignment.txt'
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f'{role} task for {name}')
            manifest_agents[name] = {'name': name, 'role': role, 'model': 'gpt-6-luna',
                                     'canonical_task': f'/root/{name}',
                                     'assignment_path': str(path), 'sha256': digest(path)}
        units = []
        assignments = {}
        for number in [116, 117]:
            slug = f'leaf-{number}'
            assignment = self.handoff_dir / 'assignments' / f'part-{number:03}.json'
            assignment.parent.mkdir(parents=True, exist_ok=True)
            assignment.write_text(json.dumps({'unit': number, 'slug': slug, 'project': f'part-{number:03}/project',
                                              'builder_contract': 'build', 'review_contract': 'review',
                                              'input_sha256': 'input'}))
            assignments[str(number)] = {'path': str(assignment), 'sha256': digest(assignment)}
            units.append({'unit': number, 'slug': slug,
                          'status': (statuses or {}).get(number, 'pending'),
                          'attempt': (attempts or {}).get(number, 0)})
        handoff.save(handoff.MANIFEST, {'model': 'gpt-6-luna', 'protocol': 'codex-app-luna-v1',
                       'model_binding': 'role_luna_worker', 'agents': manifest_agents})
        handoff.save(handoff.QUEUE, {'model': 'gpt-6-luna', 'protocol': 'codex-app-luna-v1',
                      'units': units, 'preserved_ready': list(range(1, 99)),
                      'preserved_held': list(range(99, 116)),
                      'allowed_agents': {'build': ['luna_builder_a', 'luna_builder_b'],
                                         'review': ['luna_reviewer']},
                      'assignments': assignments})
        for number in [116, 117]:
            project = self.run / f'part-{number:03}' / 'project'
            (project / 'data/collections').mkdir(parents=True, exist_ok=True)
            (project / 'notes').mkdir(exist_ok=True)
            (project / 'input.json').write_text(json.dumps({'leaves': [{'progress': {'slug': f'leaf-{number}'}}]}))

    def test_claims_are_ordered_unique_under_concurrency_and_skip_preserved_units(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(handoff.claim, 'build', name)
                       for name in ['luna_builder_a', 'luna_builder_b']]
            units = [future.result()['unit']['unit'] for future in futures]
        self.assertEqual(sorted(units), [116, 117])
        self.assertEqual(len(units), len(set(units)))
        self.assertNotIn(1, units)
        self.assertNotIn(115, units)
        queue = json.loads(handoff.QUEUE.read_text())
        self.assertTrue(all(u['status'] == 'building' for u in queue['units']))
        self.assertTrue(handoff._work_remaining(queue))

    def test_one_agent_cannot_build_and_review_or_hold_without_ownership(self):
        manifest = json.loads(handoff.MANIFEST.read_text())
        manifest['agents']['luna_builder_a']['role'] = 'review'
        handoff.save(handoff.MANIFEST, manifest)
        with self.assertRaises(handoff.QueueError):
            handoff.claim('build', 'luna_builder_a')

    def test_report_missing_assigned_slug_fails(self):
        self._make_reviewing(116)
        report_path = self.handoff_dir / 'reports' / 'bad.json'
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps({**report('wrong-leaf'), 'leaf_checks': {'wrong-leaf': 'reviewed'}}))
        checked = {'batch_sha256': 'batch', 'research_sha256': 'research', 'input_sha256': 'input'}
        with patch.object(handoff.workflow, 'validate', return_value=checked):
            with self.assertRaises(handoff.QueueError):
                handoff.review_complete(116, 'luna_reviewer', report_path)

    def test_report_mutated_during_read_fails_closed(self):
        self._make_reviewing(116)
        report_path = self.handoff_dir / 'reports' / 'good.json'
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report()))
        checked = {'batch_sha256': 'batch', 'research_sha256': 'research', 'input_sha256': 'input'}
        real_sha = handoff.sha
        calls = 0

        def changing_sha(path):
            nonlocal calls
            if Path(path).resolve() == report_path.resolve():
                calls += 1
                return 'first' if calls == 1 else 'changed'
            return real_sha(path)

        with patch.object(handoff.workflow, 'validate', return_value=checked), patch.object(handoff, 'sha', side_effect=changing_sha):
            with self.assertRaises(handoff.QueueError):
                handoff.review_complete(116, 'luna_reviewer', report_path)
        self.assertEqual(calls, 2)

    def test_hold_is_terminal_for_one_item_and_other_work_remains_claimable(self):
        claimed = handoff.claim('build', 'luna_builder_a')['unit']
        state = json.loads(handoff.QUEUE.read_text())
        unit = next(x for x in state['units'] if x['unit'] == claimed['unit'])
        unit['agent'] = 'luna_builder_a'
        handoff.save(handoff.QUEUE, state)
        held = handoff.hold(claimed['unit'], 'luna_builder_a', 'sources remain inaccessible')
        self.assertEqual(held['unit']['status'], 'needs_attention')
        self.assertFalse(held['unit']['archived'])
        next_unit = handoff.claim('build', 'luna_builder_b')['unit']
        self.assertEqual(next_unit['unit'], 117)
        self.assertTrue(handoff._work_remaining(json.loads(handoff.QUEUE.read_text())))

    def test_changes_required_allows_only_one_repair_attempt(self):
        for attempt, expected in [(1, 'repair_pending'), (2, 'needs_attention')]:
            self._fixture(statuses={116: 'reviewing'}, attempts={116: attempt})
            queue = json.loads(handoff.QUEUE.read_text())
            unit = next(x for x in queue['units'] if x['unit'] == 116)
            unit.update(agent='luna_reviewer', build_record={
                'batch_sha256': 'batch', 'research_sha256': 'research', 'input_sha256': 'input'})
            handoff.save(handoff.QUEUE, queue)
            path = self.handoff_dir / 'reports' / f'repair-{attempt}.json'
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(report(decision='changes_required', findings=[{'issue': 'unsupported claim'}])))
            checked = {'batch_sha256': 'batch', 'research_sha256': 'research', 'input_sha256': 'input'}
            with patch.object(handoff.workflow, 'validate', return_value=checked):
                result = handoff.review_complete(116, 'luna_reviewer', path)
            self.assertEqual(result['unit']['status'], expected)
            if expected == 'repair_pending':
                issues = json.loads((self.run/'part-116'/'project'/'issues.json').read_text())
                self.assertEqual(issues['findings'][0]['issue'], 'unsupported claim')
            else:
                self.assertEqual(result['unit']['reason'], 'bounded corrections exhausted')
                state = json.loads((self.run/'part-116'/'state.json').read_text())
                self.assertEqual(state['reason'], 'bounded corrections exhausted')

    def _make_reviewing(self, number):
        queue = json.loads(handoff.QUEUE.read_text())
        unit = next(x for x in queue['units'] if x['unit'] == number)
        unit.update(status='reviewing', attempt=1, agent='luna_reviewer', build_record={
            'batch_sha256': 'batch', 'research_sha256': 'research', 'input_sha256': 'input'})
        handoff.save(handoff.QUEUE, queue)


if __name__ == '__main__':
    unittest.main()
