#!/usr/bin/env python3
"""Retry only the latest fifteen unapproved leaves in independent workspaces."""
import argparse
from collections import Counter
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

engine=workflow.engine
ROOT=workflow.ROOT
RUN=ROOT/'var/collection/pending-leaves-20261027'
PLAN=ROOT/'data/collections/pending-leaves-20261027-plan.json'
PENDING=ROOT/'data/collections/included-go-followup-final-20261027-pending-all.json'
PROGRESS=ROOT/'data/collections/included-coverage-progress.json'
OLD=ROOT/'var/collection/go-followup-20261027'
MODEL='opencode-go/deepseek-v4.1-flash'
read,save,sha=engine.read,engine.save,engine.sha


def formal_counts():
    with sqlite3.connect(f'file:{ROOT}/var/catalog.sqlite?mode=ro',uri=True) as db:
        return {'applications':db.execute('SELECT COUNT(*) FROM application').fetchone()[0],
                'links':db.execute('SELECT COUNT(*) FROM leaf_application').fetchone()[0]}


def plan():
    paths={'pending':PENDING,'progress':PROGRESS,'catalog':ROOT/'data/taxonomy/catalog.json',
           'conditional':ROOT/'data/collections/conditional-progress.json',
           'contract':ROOT/'docs/PENDING_LEAVES_CONTRACT_20261027.md',
           'review_contract':ROOT/'docs/SAAS_CASE_REVIEW_CONTRACT.md'}
    if PLAN.exists():
        value=read(PLAN)
        for name,path in paths.items():assert sha(path)==value['frozen_inputs'][name]['sha256'],name+' changed; create a new plan'
        assert value['baseline']==formal_counts(), 'formal baseline changed; do not rerun a published queue'
        assert sha(RUN/'catalog.before-collection.sqlite')==value['baseline_backup_sha256']
        return value
    current={r['slug']:r for r in read(PROGRESS)['items']};rank={slug:i for i,slug in enumerate(current)}
    units=[];retained=[]
    for row in sorted(read(PENDING)['items'],key=lambda r:rank[r['slug']]):
        assert row['archived'] is False and current[row['slug']]['case_status']==row['status']
        if row.get('retained_reason')=='provider_content_filter':
            part=ROOT/f"var/collection/{row['source_run']}/part-{row['part']:03}"
            engine.verify_content_filter_retention(part,read(part/'state.json'))
            retained.append(copy.deepcopy(row));continue
        assert row['source_run']=='go-followup-20261027'
        original=OLD/f"part-{row['part']:03}/project/input.json"
        units.append({'unit':len(units)+1,'phase':'directory','parent':row['part'],
                      'source_run':row['source_run'],'input_status':row['status'],
                      'slugs':[row['slug']],'old_input_sha256':sha(original)})
    assert len(units)==15 and len(retained)==5
    assert len({u['slugs'][0] for u in units})==15
    assert Counter(u['input_status'] for u in units)=={'review_pending':10,'incomplete':5}
    assert formal_counts()=={'applications':1201,'links':1429}
    backup=RUN/'catalog.before-collection.sqlite';assert not backup.exists()
    with sqlite3.connect(f'file:{ROOT}/var/catalog.sqlite?mode=ro',uri=True) as src:
        with sqlite3.connect(backup) as dst:src.backup(dst)
    value={'schema_version':1,'run_id':RUN.name,'model':MODEL,'concurrency':4,'max_types_per_unit':1,
           'baseline':formal_counts(),'baseline_backup_sha256':sha(backup),
           'frozen_inputs':{k:{'path':str(p.relative_to(ROOT)),'sha256':sha(p)} for k,p in paths.items()},
           'units':units,'phase_order':['directory'],'retained_outside_queue':retained,
           'publication_allowed':False,'created_at':time.strftime('%Y-%m-%dT%H:%M:%S%z')}
    save(PLAN,value);return value


def old_fetch_sources(part):
    """Recover only public fetch receipts, never pass raw model logs to workers."""
    result={};decoder=json.JSONDecoder()
    for path in sorted(part.glob('*.jsonl')):
        for line in path.read_text(errors='replace').splitlines():
            try:event=json.loads(line)
            except ValueError:continue
            if event.get('type')!='tool_use':continue
            state=event.get('part',{}).get('state',{})
            if state.get('status')!='completed' or not isinstance(state.get('output'),str):continue
            text=state['output']
            for match in re.finditer(r'\{\s*"url"\s*:',text):
                try:item,_=decoder.raw_decode(text[match.start():])
                except ValueError:continue
                if set(item)=={'url','sha256','snapshot_path','fetched_at','kind'}:
                    result[item['sha256']]=item
    return result


def refresh(project,unit,common):
    save(project/'opencode.json',engine.config(project,common))
    (project/'TASK.md').write_text((ROOT/'docs/PENDING_LEAVES_CONTRACT_20261027.md').read_text()
        +'\n本单元：'+json.dumps(unit,ensure_ascii=False)+'\n共享只读索引：'+str(common)+'\n')
    (project/'REVIEW_TASK.md').write_text((ROOT/'docs/SAAS_CASE_REVIEW_CONTRACT.md').read_text()
        +'\n本单元唯一叶子：'+json.dumps(unit['slugs'],ensure_ascii=False)+'\n')


def prepare(unit,common):
    part=RUN/f"part-{unit['unit']:03}";project=part/'project';slug=unit['slugs'][0]
    if (project/'prepared.json').exists():
        prepared=read(project/'prepared.json');assert prepared['slugs']==[slug]
        assert prepared['input_sha256']==sha(project/'input.json')
        refresh(project,unit,common);return part
    old=OLD/f"part-{unit['parent']:03}/project";assert sha(old/'input.json')==unit['old_input_sha256']
    for rel in ['server','data/taxonomy']:shutil.copytree(common/rel,project/rel,dirs_exist_ok=True)
    for rel in ['scripts','notes/previous','data/collections/sources']:(project/rel).mkdir(parents=True,exist_ok=True)
    shutil.copy2(common/'scripts/collect_cases.py',project/'scripts/collect_cases.py')
    inp=read(old/'input.json');inp['leaves']=[x for x in inp['leaves'] if x['progress']['slug']==slug]
    assert len(inp['leaves'])==1
    inp['leaves'][0]['progress']=copy.deepcopy(next(r for r in read(PROGRESS)['items'] if r['slug']==slug))
    inp['previous_continuation']=inp.get('continuation');inp['continuation']=unit
    save(project/'input.json',inp)
    entries=[];manifest=[]
    for entry in read(old/'data/collections/batch.json')['entries']:
        item=copy.deepcopy(entry);item['leaf_matches']=[m for m in item['leaf_matches'] if m['slug']==slug]
        if item['leaf_matches']:entries.append(item)
    save(project/'data/collections/batch.json',{'schema_version':1,'batch_id':f'pending-leaves-20261027-u{unit["unit"]:03}','entries':entries})
    research=old/'data/collections/research.json'
    rows=[copy.deepcopy(r) for r in read(research)['leaf_cases'] if r['slug']==slug] if research.exists() else []
    if rows:save(project/'data/collections/research.json',{'schema_version':1,'leaf_cases':rows})
    receipts=old_fetch_sources(old.parent);index=[]
    for source in sorted((old/'data/collections/sources').glob('*.txt')):
        assert re.fullmatch(r'[0-9a-f]{64}',source.stem) and sha(source)==source.stem
        dest=project/'data/collections/sources'/source.name;shutil.copy2(source,dest)
        manifest.append({'path':str(source.relative_to(ROOT)),'sha256':source.stem})
        item={'path':str(dest.relative_to(project)),'sha256':source.stem}
        if source.stem in receipts:
            receipt=receipts[source.stem]
            assert receipt['snapshot_path']=='sources/'+source.name
            item['original_fetch_receipt']=receipt
        index.append(item)
    save(project/'REUSED_SOURCES.json',{'sources':index,'note':'仅复制并核对SHA；原抓取收据来自原工具输出，没有收据时不补造URL或fetched_at。'})
    if (old/'notes').exists():
        for source in sorted((old/'notes').rglob('*')):
            if not source.is_file() or source.is_symlink() or any(p.startswith('.env') for p in source.relative_to(old/'notes').parts):continue
            dest=project/'notes/previous'/source.relative_to(old/'notes');dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(source,dest);manifest.append({'path':str(source.relative_to(ROOT)),'sha256':sha(source)})
    reportpath=old/'review.json';findings=[]
    if reportpath.exists():
        report=read(reportpath);shutil.copy2(reportpath,project/'notes/previous-unit-review.json')
        ids={e['id'] for e in entries}
        for finding in report.get('findings',[]):
            if isinstance(finding,str):findings.append(finding);continue
            target=finding.get('slug',finding.get('leaf_slug',finding.get('leaf')))
            if target is not None:
                if target==slug:findings.append(copy.deepcopy(finding))
            elif not finding.get('application_id') or finding['application_id'] in ids:findings.append(copy.deepcopy(finding))
    if not rows:findings.append({'slug':slug,'issue':'旧单元未保存本叶research.json；必须根据真实复用/补采动作生成该文件，不把缺产物写成找不到案例。'})
    save(project/'issues.json',{'findings':findings,'prior_unit_state':read(old.parent/'state.json'),
                              'previous_review_is_approval':False,'original_unit':unit['parent']})
    for source in [old/'data/collections/batch.json',research,reportpath,old/'input.json']:
        if source.exists():manifest.append({'path':str(source.relative_to(ROOT)),'sha256':sha(source)})
    refresh(project,unit,common)
    save(project/'prepared.json',{**unit,'input_sha256':sha(project/'input.json'),'seed_artifacts':manifest})
    return part


def summary(_part=None):
    with engine.STATUS_LOCK:
        states=[read(p) for p in sorted(RUN.glob('part-*/state.json'))]
        ready=lambda s:s.get('status')=='awaiting_final_review' and s.get('review_protocol')==engine.REVIEW_PROTOCOL
        terminal=lambda s:ready(s) or s.get('status')=='needs_attention'
        save(RUN/'status.json',{'model':MODEL,'concurrency':4,'phase':workflow.PHASE,
             'updated_at':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'total_parts':15,'total_types':15,
             'active_parts':sorted(s['part'] for s in states if s['status']=='running'),
             'processed_parts':sum(terminal(s) for s in states),'awaiting_final_review':sum(ready(s) for s in states),
             'needs_attention':sum(s['status']=='needs_attention' for s in states),
             'queue_finished':len(states)==15 and all(terminal(s) for s in states),'stopped':engine.STOP.is_set(),
             'errors':[{'part':s['part'],'kind':s.get('error_kind'),'error':str(s['error'])[:500]} for s in states if s.get('error')],
             'retained_outside_queue':5,'published':False})


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--prepare-only',action='store_true');args=parser.parse_args()
    RUN.mkdir(parents=True,exist_ok=True);lock=(ROOT/'var/collection/opencode-go/queue.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    engine.MODEL=MODEL;engine.PROVIDER,engine.MODEL_ID=MODEL.split('/',1);engine.RUN=workflow.RUN=RUN
    workflow.PLAN=PLAN;engine.profile=workflow.profile;engine.queue_status=workflow.summary=summary
    engine.run_part=workflow.run_unit;workflow.prepare=prepare
    value=plan();workflow.UNITS=value['units']
    check=read(RUN/'preflight/write-check.json')
    assert check['outcome']=='succeeded' and check['prompt_verified'] and check['stdin_isolated']
    assert check['model_actual']['providerID']=='opencode-go' and check['model_actual']['id']=='deepseek-v4.1-flash'
    common=engine.prepare_common();assert read(common/'manifest.json')['applications']==1201
    workflow.configure_cli_environment(common)
    selection={'model':MODEL,'concurrency':4,'plan_sha256':sha(PLAN),'baseline':value['baseline'],
               'selected_at':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'automatic_fallback':False,'published':False}
    save(RUN/'runtime-selection.json',selection);save(RUN/'model-selections'/f'{time.time_ns()}.json',selection)
    for unit in value['units']:prepare(unit,common)
    summary()
    if args.prepare_only:print(json.dumps({'prepared_units':15,'types':15,'retained_outside_queue':5,'baseline':value['baseline']}));return
    def stop(_signal,_frame):engine.stop_children();raise KeyboardInterrupt('queue interrupted; drafts preserved')
    signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGTERM,stop)
    save(RUN/'process.json',{'pid':os.getpid(),'script':'scripts/continue_remaining_leaves.py','model':MODEL,'concurrency':4,'units':15,'started_at':selection['selected_at']})
    try:
        workflow.PHASE='directory';summary()
        if not engine.run_queue(list(range(1,16)),common,4):raise SystemExit(1)
        save(RUN/'directory-ended.json',{'units':list(range(1,16)),'ended_at':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'published':False})
        workflow.PHASE='finished'
    finally:
        with engine.PROCESS_LOCK:children=list(engine.ACTIVE_PROCESSES.values())
        engine.terminate_processes(children);summary()


if __name__=='__main__':main()
