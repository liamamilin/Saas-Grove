#!/usr/bin/env python3
"""Resume the final-review pending list against a fresh, frozen formal baseline."""
import argparse
import copy
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import time

import continue_directory_beam as workflow

engine = workflow.engine
ROOT = workflow.ROOT
RUN = ROOT / 'var/collection/go-followup-20261027'
PLAN = ROOT / 'data/collections/go-followup-20261027-plan.json'
OLD = ROOT / 'var/collection/beam-continuation-20261025'
PENDING = ROOT / 'data/collections/included-continuation-final-20261027-pending.json'
PROGRESS = ROOT / 'data/collections/included-coverage-progress.json'
MODEL = 'opencode-go/deepseek-v4.1-flash'
read, save, sha = engine.read, engine.save, engine.sha


def formal_counts():
    with sqlite3.connect(f'file:{ROOT}/var/catalog.sqlite?mode=ro', uri=True) as db:
        return {name: db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                for name, table in [('applications', 'application'), ('links', 'leaf_application')]}


def make_plan():
    inputs = {'pending': PENDING, 'progress': PROGRESS,
              'catalog': ROOT / 'data/taxonomy/catalog.json',
              'conditional': ROOT / 'data/collections/conditional-progress.json'}
    if PLAN.exists():
        plan = read(PLAN)
        assert plan['model'] == MODEL
        for name, path in inputs.items():
            assert sha(path) == plan['frozen_inputs'][name]['sha256'], f'{name} changed; create a new plan'
        assert formal_counts() == plan['baseline'], 'formal baseline changed; do not restart this queue'
        assert sha(RUN/'catalog.before-collection.sqlite') == plan['baseline_backup_sha256']
        for item in plan['retained_outside_queue']:
            engine.verify_content_filter_retention(OLD/f"part-{item['old_part']:03}",
                                                  read(OLD/f"part-{item['old_part']:03}/state.json"))
        return plan
    progress = read(PROGRESS)['items']
    current = {row['slug']: row for row in progress}
    rank = {row['slug']: i for i, row in enumerate(progress)}
    groups = {}
    for row in read(PENDING)['items']:
        assert current[row['slug']]['case_status'] == row['status']
        assert row['status'] in ['review_pending', 'incomplete'] and row['archived'] is False
        groups.setdefault(row['part'], []).append(row)
    units, retained = [], []
    for status, phase in [('review_pending', 'repair'), ('incomplete', 'complete')]:
        for oldpart, rows in sorted(groups.items(), key=lambda pair: min(rank[r['slug']] for r in pair[1])):
            if rows[0]['status'] != status:
                continue
            assert all(row['status'] == status for row in rows)
            olddir = OLD/f'part-{oldpart:03}'
            state = read(olddir/'state.json')
            if state.get('error_kind') == 'content_filter':
                engine.verify_content_filter_retention(olddir, state)
                retained.append({'old_part': oldpart, 'slugs': [r['slug'] for r in rows],
                                 'reason': 'provider.content-filter; no retry or provider rerouting',
                                 'archived': False, 'state_sha256': sha(olddir/'state.json')})
                continue
            inp = read(olddir/'project/input.json')
            slugs = [leaf['progress']['slug'] for leaf in inp['leaves']]
            assert slugs == sorted(slugs, key=rank.__getitem__)
            assert set(slugs) == {r['slug'] for r in rows} and len(slugs) <= 5
            units.append({'unit': len(units)+1, 'phase': phase, 'parent': oldpart,
                          'slugs': slugs, 'old_input_sha256': sha(olddir/'project/input.json')})
    assert len(units) == 44 and sum(len(u['slugs']) for u in units) == 220
    assert sum(len(r['slugs']) for r in retained) == 5
    assert len({s for u in units for s in u['slugs']}) == 220
    baseline = formal_counts()
    assert baseline == {'applications': 1057, 'links': 1256}
    backup = RUN/'catalog.before-collection.sqlite'
    assert not backup.exists(), 'unexpected existing baseline backup'
    with sqlite3.connect(f'file:{ROOT}/var/catalog.sqlite?mode=ro', uri=True) as src:
        with sqlite3.connect(backup) as dest:
            src.backup(dest)
    plan = {'schema_version': 1, 'run_id': RUN.name, 'model': MODEL, 'concurrency': 4,
            'baseline': baseline, 'baseline_backup_sha256': sha(backup),
            'frozen_inputs': {name: {'path': str(p.relative_to(ROOT)), 'sha256': sha(p)} for name, p in inputs.items()},
            'phase_order': ['repair', 'complete'], 'units': units,
            'retained_outside_queue': retained, 'publication_allowed': False,
            'created_at': time.strftime('%Y-%m-%dT%H:%M:%S%z')}
    save(PLAN, plan)
    return plan


def refresh_task_config(project, unit, common):
    save(project/'opencode.json', engine.config(project, common))
    task = (ROOT/'docs/GO_FOLLOWUP_CONTRACT_20261027.md').read_text()
    (project/'TASK.md').write_text(task+'\n本单元：'+json.dumps(unit, ensure_ascii=False)
                                  +'\n本次执行模型：'+MODEL+'\n只读共享资料：'+str(common)+'\n')
    (project/'REVIEW_TASK.md').write_text((ROOT/'docs/SAAS_CASE_REVIEW_CONTRACT.md').read_text()
        +'\n本单元叶子：'+json.dumps(unit['slugs'], ensure_ascii=False)+'\n')


def prepare(unit, common):
    partdir = RUN/f"part-{unit['unit']:03}"
    project = partdir/'project'
    if (project/'prepared.json').exists():
        prepared = read(project/'prepared.json')
        assert prepared['slugs'] == unit['slugs']
        assert sha(project/'input.json') == prepared['input_sha256']
        refresh_task_config(project, unit, common)
        return partdir
    old = OLD/f"part-{unit['parent']:03}/project"
    # Preparation is local only: no old model session or runtime config is reused.
    for rel in ['server', 'data/taxonomy']:
        shutil.copytree(common/rel, project/rel, dirs_exist_ok=True)
    for rel in ['scripts', 'notes/previous', 'data/collections/sources']:
        (project/rel).mkdir(parents=True, exist_ok=True)
    shutil.copy2(common/'scripts/collect_cases.py', project/'scripts/collect_cases.py')
    assert sha(old/'input.json') == unit['old_input_sha256']
    inp = read(old/'input.json')
    current = {r['slug']: r for r in read(PROGRESS)['items']}
    for leaf in inp['leaves']:
        leaf['progress'] = copy.deepcopy(current[leaf['progress']['slug']])
    inp['previous_continuation'] = inp.get('continuation')
    inp['continuation'] = unit
    save(project/'input.json', inp)
    source_manifest, seed_issues = [], []
    for relative in ['data/collections/batch.json', 'data/collections/research.json', 'review.json']:
        src = old/relative
        if src.is_file() and not src.is_symlink():
            shutil.copy2(src, project/relative)
            source_manifest.append({'path': str(src.relative_to(ROOT)), 'sha256': sha(src)})
    batchpath = project/'data/collections/batch.json'
    if not batchpath.exists():
        save(batchpath, {'schema_version': 1, 'batch_id': f'go-followup-20261027-u{unit["unit"]:03}', 'entries': []})
    for entry in read(batchpath).get('entries', []):
        assert all(m['slug'] in unit['slugs'] for m in entry['leaf_matches'])
        for source in entry['sources']:
            digest, relative = source['sha256'], source['snapshot_path']
            assert re.fullmatch(r'[0-9a-f]{64}', digest) and relative == f'sources/{digest}.txt'
            src = old/'data/collections'/relative
            if src.is_file() and not src.is_symlink() and sha(src) == digest:
                shutil.copy2(src, project/'data/collections'/relative)
                source_manifest.append({'path': str(src.relative_to(ROOT)), 'sha256': digest})
            else:
                seed_issues.append({'application_id': entry['id'], 'issue': '旧来源缺失或SHA不匹配，不能作为已验证来源；补取真实来源或留档。', 'source_url': source['url']})
    if (old/'notes').exists():
        for src in sorted((old/'notes').rglob('*')):
            if src.is_file() and not src.is_symlink() and not any(p.startswith('.env') for p in src.relative_to(old/'notes').parts):
                dest = project/'notes/previous'/src.relative_to(old/'notes')
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
                source_manifest.append({'path': str(src.relative_to(ROOT)), 'sha256': sha(src)})
    oldreview = read(old/'review.json') if (old/'review.json').exists() else {}
    rows = [r for r in read(PENDING)['items'] if r['slug'] in unit['slugs']]
    findings = copy.deepcopy(oldreview.get('findings', [])) + seed_issues
    findings.extend({'slug': r['slug'], 'issue': r['reason']} for r in rows)
    save(project/'issues.json', {'phase': unit['phase'], 'findings': findings,
                                'previous_review_path': str((old/'review.json').relative_to(ROOT)),
                                'previous_review_is_approval': False})
    refresh_task_config(project, unit, common)
    save(project/'prepared.json', {**unit, 'input_sha256': sha(project/'input.json'),
                                  'seed_artifacts': source_manifest})
    return partdir


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    RUN.mkdir(parents=True, exist_ok=True)
    lock = (ROOT/'var/collection/opencode-go/queue.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    engine.MODEL = MODEL
    engine.PROVIDER, engine.MODEL_ID = MODEL.split('/', 1)
    engine.RUN = workflow.RUN = RUN
    workflow.PLAN = PLAN
    engine.profile = workflow.profile
    engine.queue_status = workflow.summary
    engine.run_part = workflow.run_unit
    workflow.prepare = prepare
    workflow.refresh_task_config = refresh_task_config
    plan = make_plan()
    workflow.UNITS = plan['units']
    for name in ['reply-check.json', 'tool-check.json']:
        receipt = read(RUN/'preflight'/name)
        assert receipt['outcome'] == 'succeeded' and receipt['prompt_verified'] and receipt['stdin_isolated']
        assert receipt['model_actual'] == {'providerID': engine.PROVIDER, 'id': engine.MODEL_ID, 'variant': 'default'}
    common = engine.prepare_common()
    assert read(common/'manifest.json')['applications'] == plan['baseline']['applications']
    assert sha(common/'data/taxonomy/catalog.json') == plan['frozen_inputs']['catalog']['sha256']
    workflow.configure_cli_environment(common)
    selection = {'model': MODEL, 'concurrency': 4, 'plan_sha256': sha(PLAN),
                 'selected_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'automatic_fallback': False,
                 'publication_allowed': False, 'baseline': plan['baseline']}
    save(RUN/'runtime-selection.json', selection)
    save(RUN/'model-selections'/f'{time.time_ns()}.json', selection)
    for unit in plan['units']:
        prepare(unit, common)
    workflow.summary()
    if args.prepare_only:
        print(json.dumps({'units': len(plan['units']), 'types': 220, 'retained_outside_queue': 5,
                          'baseline': plan['baseline'], 'published': False}))
        return
    def stop(_sig, _frame):
        engine.stop_children()
        raise KeyboardInterrupt('queue interrupted; drafts preserved')
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    save(RUN/'process.json', {'pid': os.getpid(), 'script': 'scripts/continue_pending_directory.py',
                            'model': MODEL, 'concurrency': 4, 'units': len(plan['units']),
                            'phase_order': plan['phase_order'], 'started_at': selection['selected_at']})
    try:
        for phase in plan['phase_order']:
            workflow.PHASE = phase
            numbers = [u['unit'] for u in plan['units'] if u['phase'] == phase]
            workflow.summary()
            if not engine.run_queue(numbers, common, 4):
                raise SystemExit(1)
            assert all(read(RUN/f'part-{n:03}/state.json')['status'] in
                       ['awaiting_final_review', 'needs_attention'] for n in numbers)
            save(RUN/f'{phase}-ended.json', {'units': numbers,
                 'ended_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'published': False})
        workflow.PHASE = 'finished'
    finally:
        with engine.PROCESS_LOCK:
            children = list(engine.ACTIVE_PROCESSES.values())
        engine.terminate_processes(children)
        workflow.summary()


if __name__ == '__main__':
    main()
