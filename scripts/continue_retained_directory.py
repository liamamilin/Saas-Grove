#!/usr/bin/env python3
"""Revisit the 252 retained leaves; stage evidence, never publish products."""
import argparse
from collections import Counter
import copy
import fcntl
import hashlib
import json
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import time

import continue_directory_beam as workflow

engine = workflow.engine
ROOT = workflow.ROOT
RUN = ROOT/'var/collection/retained-evidence-20261028'
INPUTS = ROOT/'data/collections/retained-evidence-20261028-inputs.json'
PLAN = ROOT/'data/collections/retained-evidence-20261028-plan.json'
CONTRACT = ROOT/'docs/RETAINED_EVIDENCE_CONTRACT_20261028.md'
MODEL = 'open-design/deepseek-v4.1-flash'
ALLOWED_MODELS = (MODEL, 'opencode-go/deepseek-v4.1-flash')
read, save, sha = engine.read, engine.save, engine.sha
CLI_ENVIRONMENT = workflow.configure_cli_environment
SEED_ROWS = None


def counts():
    with sqlite3.connect(f'file:{ROOT}/var/catalog.sqlite?mode=ro', uri=True) as db:
        return {'applications': db.execute('select count(*) from application').fetchone()[0],
                'links': db.execute('select count(*) from leaf_application').fetchone()[0]}


def configure(common):
    CLI_ENVIRONMENT(common)
    source = RUN/'preflight/common/runtime-config/opencode/opencode.json'
    value = read(source)
    assert set(value) == {'provider'} and set(value['provider']) == {'open-design'}
    provider = value['provider']['open-design']
    assert set(provider['options']) == {'baseURL'}
    assert set(provider['models']) == {'deepseek-v4.1-flash'}
    # Public adapter/model metadata only. Credentials remain in the CLI's
    # existing integration/environment; they are not copied into workspaces.
    save(common/'runtime-config/opencode/opencode.json', value)


def plan():
    inventory = read(RUN/'preparation-inventory.json')
    assert sha(INPUTS) == inventory['input_sha256']
    for rel, digest in inventory['historical_files'].items():
        assert sha(ROOT/rel) == digest, rel
    data = read(INPUTS)
    assert counts() == data['baseline'] == {'applications':1211, 'links':1443}
    assert sha(RUN/'catalog.before-collection.sqlite') == inventory['baseline_backup_sha256']
    assert len(data['units']) == 252 and len(data['retained_outside_queue']) == 5
    units = [{'unit':u['unit'], 'phase':'directory', 'parent':u['unit'], 'slugs':u['slugs'],
              'input_status':u['input_status'], 'seed_row_sha256':hashlib.sha256(json.dumps(u, ensure_ascii=False, sort_keys=True).encode()).hexdigest()}
             for u in data['units']]
    paths = {'inputs':INPUTS, 'progress':ROOT/'data/collections/included-coverage-progress.json',
             'conditional':ROOT/'data/collections/conditional-progress.json',
             'catalog':ROOT/'data/taxonomy/catalog.json', 'contract':CONTRACT,
             'review_contract':ROOT/'docs/SAAS_CASE_REVIEW_CONTRACT.md',
             'provider_definition':RUN/'preflight/common/runtime-config/opencode/opencode.json'}
    frozen = {k:{'path':str(p.relative_to(ROOT)), 'sha256':sha(p)} for k,p in paths.items()}
    if PLAN.exists():
        value = read(PLAN)
        assert value['frozen_inputs'] == frozen and value['units'] == units
        return value
    value = {'schema_version':1, 'run_id':RUN.name, 'model':MODEL, 'concurrency':4,
             'max_types_per_unit':1, 'baseline':data['baseline'],
             'baseline_backup_sha256':inventory['baseline_backup_sha256'], 'frozen_inputs':frozen,
             'units':units, 'phase_order':['directory'], 'retained_outside_queue':data['retained_outside_queue'],
             'publication_allowed':False, 'created_at':time.strftime('%Y-%m-%dT%H:%M:%S%z')}
    save(PLAN, value)
    return value


def refresh(project, unit, common):
    save(project/'opencode.json', engine.config(project, common))
    contract = CONTRACT.read_text().replace('本轮使用 OpenDesign / DeepSeek V4.1 Flash，并发4。',
                                           '本次使用 '+MODEL+' 的API入口，并发4。')
    (project/'TASK.md').write_text(contract+'\n本单元：'+json.dumps(unit, ensure_ascii=False)+'\n共享只读资料：'+str(common)+'\n')
    (project/'REVIEW_TASK.md').write_text((ROOT/'docs/SAAS_CASE_REVIEW_CONTRACT.md').read_text()
         +'\n本单元唯一叶子：'+json.dumps(unit['slugs'], ensure_ascii=False)+'\n')


def prepare(unit, common):
    global SEED_ROWS
    part = RUN/f"part-{unit['unit']:03}"
    project = part/'project'
    if (project/'prepared.json').exists():
        prepared = read(project/'prepared.json')
        assert prepared['slugs'] == unit['slugs'] and prepared['input_sha256'] == sha(project/'input.json')
        refresh(project, unit, common)
        return part
    if SEED_ROWS is None:
        SEED_ROWS = read(INPUTS)['units']
    row = SEED_ROWS[unit['unit']-1]
    assert hashlib.sha256(json.dumps(row, ensure_ascii=False, sort_keys=True).encode()).hexdigest() == unit['seed_row_sha256']
    slug = unit['slugs'][0]
    for rel in ['server','data/taxonomy']:
        shutil.copytree(common/rel, project/rel, dirs_exist_ok=True)
    for rel in ['scripts','notes/previous','data/collections/sources']:
        (project/rel).mkdir(parents=True, exist_ok=True)
    shutil.copy2(common/'scripts/collect_cases.py', project/'scripts/collect_cases.py')
    original = ROOT/row['original_input']['path']
    assert sha(original) == row['original_input']['sha256']
    inp = read(original)
    inp['leaves'] = [x for x in inp['leaves'] if x['progress']['slug'] == slug]
    assert len(inp['leaves']) == 1
    inp['leaves'][0]['progress'] = copy.deepcopy(row['progress'])
    inp['previous_continuation'] = inp.get('continuation')
    inp['continuation'] = unit
    save(project/'input.json', inp)
    entries, history, snapshots, manifest = {}, [], {}, []
    source_maps = []
    for layer in row['seed_layers']:
        old = ROOT/layer['project']
        for file in layer['files']:
            assert sha(ROOT/file['path']) == file['sha256']
            manifest.append(file)
        batch = old/'data/collections/batch.json'
        all_entries = read(batch).get('entries', []) if batch.exists() else []
        for entry in all_entries:
            for source in entry.get('sources', []):
                source_maps.append((source, old/'data/collections'/source['snapshot_path']))
            matches = [m for m in entry.get('leaf_matches', []) if m['slug'] == slug]
            if not matches: continue
            candidate = copy.deepcopy(entry); candidate['leaf_matches'] = matches
            if candidate['id'] not in entries: entries[candidate['id']] = candidate
            for source in candidate['sources']:
                snapshots.setdefault(source['sha256'], (old/'data/collections'/source['snapshot_path'], source))
        research = old/'data/collections/research.json'
        if research.exists():
            for item in read(research).get('leaf_cases', []):
                if item['slug'] == slug:
                    history.append({'source':str(research.relative_to(ROOT)), 'source_sha256':sha(research), 'record':copy.deepcopy(item)})
    # Final main-review records and their gaps are authoritative seed context;
    # the latest raw candidate above remains an explicitly unapproved draft.
    for ref in row['historical_research_refs']:
        assert ref['exists']
        path = ROOT/ref['path']; assert sha(path) == ref['sha256']
        obj = read(path)
        for item in obj.get('leaf_cases', []):
            if item['slug'] == slug:
                history.append({'source':ref['record'], 'source_sha256':ref['sha256'], 'record':copy.deepcopy(item)})
    assert history
    referenced_urls = {url for h in history for url in h['record'].get('source_urls', []) if isinstance(url, str)}
    referenced_text = json.dumps([h['record'].get('fetch_outcomes', []) for h in history], ensure_ascii=False)
    digests = set(re.findall(r'\b[0-9a-f]{64}\b', referenced_text))
    for source, path in source_maps:
        if source['url'] in referenced_urls or source['sha256'] in digests:
            snapshots.setdefault(source['sha256'], (path, source))
    # Research-only SHA references may not have a five-field source object.
    # Keep the bytes and provenance without inventing a URL or fetch date.
    for digest in digests - snapshots.keys():
        for layer in row['seed_layers']:
            path = ROOT/layer['project']/'data/collections/sources'/(digest+'.txt')
            if path.exists(): snapshots[digest] = (path, None); break
    reused = []
    for digest, (path, source) in sorted(snapshots.items()):
        assert path.is_file() and sha(path) == digest
        destination = project/'data/collections/sources'/(digest+'.txt')
        shutil.copy2(path, destination)
        manifest.append({'path':str(path.relative_to(ROOT)), 'sha256':digest})
        record = {'path':str(destination.relative_to(project)), 'sha256':digest,
                  'original_path':str(path.relative_to(ROOT))}
        if source is not None: record['original_source_record'] = copy.deepcopy(source)
        reused.append(record)
    save(project/'REUSED_SOURCES.json', {'sources':reused, 'note':'真实历史快照与原source记录；未补造缺失URL/抓取时间，不表示已通过最终收录。'})
    save(project/'HISTORY.json', {'current_hold_reason':row['progress']['note'], 'history':history, 'historical_decisions_are_new_approval':False})
    save(project/'data/collections/batch.json', {'schema_version':1, 'batch_id':f'retained-evidence-20261028-u{unit["unit"]:03}', 'entries':list(entries.values())})
    save(project/'data/collections/research.json', {'schema_version':1, 'leaf_cases':[copy.deepcopy(history[-1]['record'])]})
    save(project/'issues.json', {'findings':[{'slug':slug, 'issue':row['progress']['note'],
          'fix':'针对性复核或补证；形态不符时优先换完整开源应用服务；仍不足如实留档，不把旧候选当通过。'}],
          'prior_case_status':row['input_status'], 'previous_review_is_approval':False})
    refresh(project, unit, common)
    save(project/'prepared.json', {**unit, 'input_sha256':sha(project/'input.json'), 'seed_artifacts':manifest})
    return part


def summary(_part=None):
    with engine.STATUS_LOCK:
        states = [read(p) for p in sorted(RUN.glob('part-*/state.json'))]
        ready = lambda s: s.get('status') == 'awaiting_final_review' and s.get('review_protocol') in {engine.REVIEW_PROTOCOL, 'codex-app-luna-v1'}
        terminal = lambda s: ready(s) or s.get('status') == 'needs_attention'
        save(RUN/'status.json', {'model':MODEL, 'concurrency':4, 'phase':workflow.PHASE,
             'updated_at':time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'total_parts':252, 'total_types':252,
             'active_parts':sorted(s['part'] for s in states if s['status']=='running'),
             'processed_parts':sum(terminal(s) for s in states), 'awaiting_final_review':sum(ready(s) for s in states),
             'needs_attention':sum(s['status']=='needs_attention' for s in states),
             'queue_finished':len(states)==252 and all(terminal(s) for s in states), 'stopped':engine.STOP.is_set(),
             'errors':[{'part':s['part'], 'kind':s.get('error_kind'), 'error':str(s.get('error',''))[:500]} for s in states if s.get('error')],
             'retained_outside_queue':5, 'published':False})


def resume_unit(number, common):
    """Keep individual failures held; retry interrupted/global provider work."""
    path = RUN/f'part-{number:03}/state.json'
    if path.exists():
        state = read(path)
        if state.get('status') == 'awaiting_final_review' and state.get('review_protocol') == 'codex-app-luna-v1':
            checked = workflow.validate(RUN/f'part-{number:03}/project')
            assert all(state[k] == checked[k] for k in ['batch_sha256','research_sha256','input_sha256'])
            return state
        if state.get('status') == 'awaiting_review' and state.get('engine_backend') == 'codex_app_subagent':
            checked = workflow.validate(RUN/f'part-{number:03}/project')
            assert all(state[k] == checked[k] for k in ['batch_sha256','research_sha256','input_sha256'])
            save(RUN/f'part-{number:03}/validation-reused-app.json', checked)
            save(RUN/f'part-{number:03}/app-build-reuse.json', {
                'original_build_state':state, 'original_state_sha256':sha(path),
                'validation':checked, 'new_api_build_claimed':False})
        if (state.get('status') == 'needs_attention'
                and state.get('error_kind') in {'batch', 'transient_provider', 'temporary_stall'}):
            return state
    return workflow.run_unit(number, common)


def main():
    global MODEL
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', choices=ALLOWED_MODELS, default=MODEL,
                        help='Explicit provider selection; frozen plan and prior receipts remain unchanged')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--resume-after-quota', action='store_true',
                        help='After a successful provider check, preserve held individual failures on resume')
    args = parser.parse_args()
    MODEL = args.model
    RUN.mkdir(parents=True, exist_ok=True)
    lock = (ROOT/'var/collection/opencode-go/queue.lock').open('a'); fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
    engine.MODEL = MODEL; engine.PROVIDER, engine.MODEL_ID = MODEL.split('/',1)
    engine.RUN = workflow.RUN = RUN; workflow.PLAN = PLAN
    engine.profile = workflow.profile; engine.queue_status = workflow.summary = summary
    engine.run_part = resume_unit if args.resume_after_quota else workflow.run_unit
    workflow.prepare = prepare
    value = plan(); workflow.UNITS = value['units']
    if args.resume_after_quota:
        history = RUN/'resume-history'/str(time.time_ns())
        before = {}
        for path in [RUN/'status.json', RUN/'process.json', RUN/'runtime-selection.json', *sorted(RUN.glob('part-*/state.json'))]:
            if path.is_file():
                target = history/path.relative_to(RUN); target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
                before[str(path.relative_to(RUN))] = sha(path)
        save(history/'manifest.json', {'files':before, 'model':MODEL,
             'individual_batch_failures_retained':True, 'individual_transport_failures_retained':True,
             'prior_reports_and_evidence_preserved':True})
    if MODEL == 'open-design/deepseek-v4.1-flash':
        checks = [read(RUN/'preflight'/name) for name in ['route-check.json','write-check.json']]
    else:
        verified = read(RUN/'provider-checks'/engine.PROVIDER/'latest.json')
        assert verified['available'] and verified['model'] == MODEL
        assert verified['tool_check']['completed_tools'] == ['write', 'read']
        assert verified['tool_check']['content_verified'] and verified['tool_check']['no_shell']
        checks = [verified['receipt'], verified['tool_check']['receipt']]
    for check in checks:
        assert check['outcome']=='succeeded' and check['prompt_verified'] and check['stdin_isolated']
        assert check['model_actual']['providerID']==engine.PROVIDER and check['model_actual']['id']==engine.MODEL_ID
    common = engine.prepare_common(); assert read(common/'manifest.json')['applications']==1211
    configure(common)
    for unit in value['units']: prepare(unit, common)
    summary()
    if args.prepare_only:
        print(json.dumps({'prepared_units':252, 'types':252, 'retained_outside_queue':5, 'baseline':value['baseline']})); return
    selection = {'model':MODEL, 'concurrency':4, 'plan_sha256':sha(PLAN), 'baseline':value['baseline'],
                 'original_plan_model':value['model'],
                 'selected_at':time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'automatic_fallback':False, 'published':False,
                 'resume_after_quota':args.resume_after_quota, 'controller_sha256':sha(Path(__file__))}
    save(RUN/'runtime-selection.json', selection); save(RUN/'model-selections'/f'{time.time_ns()}.json', selection)
    def stop(_signal,_frame): engine.stop_children(); raise KeyboardInterrupt('queue interrupted; drafts preserved')
    signal.signal(signal.SIGINT, stop); signal.signal(signal.SIGTERM, stop)
    import os
    save(RUN/'process.json', {'pid':os.getpid(), 'script':'scripts/continue_retained_directory.py', 'model':MODEL,
                            'concurrency':4, 'units':252, 'started_at':selection['selected_at']})
    try:
        workflow.PHASE = 'directory'; summary()
        if not engine.run_queue(list(range(1,253)), common, 4): raise SystemExit(1)
        save(RUN/'directory-ended.json', {'units':list(range(1,253)), 'ended_at':time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'published':False})
        workflow.PHASE = 'finished'
    finally:
        with engine.PROCESS_LOCK: children = list(engine.ACTIVE_PROCESSES.values())
        engine.terminate_processes(children); summary()


if __name__ == '__main__': main()
