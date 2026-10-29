#!/usr/bin/env python3
"""Continue two ordered phases with an explicitly selected model."""
import argparse
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import sys
import time

import collect_directory_go as engine

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / 'var/collection/beam-continuation-20261025'
PLAN = ROOT / 'data/collections/beam-continuation-20261025-plan.json'
PREVIOUS = ROOT / 'var/collection/opencode-go'
PHASE = 'preparing'
UNITS = []
engine.RUN = RUN
engine.TURN_TIMEOUT = 1200
engine.TURN_IDLE_TIMEOUT = 300
engine.BUILD_STEPS = 50
ALLOWED_MODELS = ('opencode-go/beam-free', 'opencode-go/iceman-contributor-free',
                  'opencode-go/deepseek-v4.1-flash')

def read(p): return json.loads(p.read_text())
def save(p, value): engine.save(p, value)
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def make_plan():
    if PLAN.exists():
        plan = read(PLAN)
        # The frozen plan records its original model; each later selection is
        # separately recorded without rewriting prior model history or inputs.
        assert plan['model'] in ALLOWED_MODELS
        assert engine.MODEL in ALLOWED_MODELS
        assert sha(ROOT / 'data/collections/included-coverage-progress.json') == plan['baseline_progress_sha256']
        assert sha(ROOT / 'data/taxonomy/catalog.json') == plan['catalog_sha256']
        return plan
    progress = read(ROOT / 'data/collections/included-coverage-progress.json')
    old_inputs = {i: read(ROOT / f'var/collection/full-directory-inputs/part-{i:03}.json') for i in range(1,61)}
    records = {x['slug']: x for x in progress['items']}
    units = []
    for phase, status in [('repair', 'review_pending'), ('complete', 'incomplete')]:
        for parent, inp in old_inputs.items():
            targets = [x['progress']['slug'] for x in inp['leaves'] if records[x['progress']['slug']]['case_status'] == status]
            for start in range(0, len(targets), 5):
                units.append({'unit': len(units)+1, 'phase': phase, 'parent': parent,
                              'slugs': targets[start:start+5]})
    assert len({s for u in units for s in u['slugs']}) == 1368
    assert sum(len(u['slugs']) for u in units if u['phase']=='repair') == 525
    assert sum(len(u['slugs']) for u in units if u['phase']=='complete') == 843
    con = sqlite3.connect(f'file:{ROOT}/var/catalog.sqlite?mode=ro', uri=True)
    applications = con.execute('SELECT COUNT(*) FROM application').fetchone()[0]
    links = con.execute('SELECT COUNT(*) FROM leaf_application').fetchone()[0]
    con.close()
    plan = {'schema_version': 1, 'run_id': RUN.name, 'model': engine.MODEL,
            'concurrency': 4, 'max_types_per_unit': 5, 'turn_timeout_seconds': engine.TURN_TIMEOUT,
            'baseline_applications': applications, 'baseline_links': links,
            'baseline_progress_sha256': sha(ROOT / 'data/collections/included-coverage-progress.json'),
            'catalog_sha256': sha(ROOT / 'data/taxonomy/catalog.json'),
            'phase_order': ['repair','complete'], 'units': units,
            'preserved_previous_reviewed_types': 125, 'publication_allowed': False}
    save(PLAN, plan)
    return plan

def profile(project, common, review=False):
    # Deny the entire home tree; expose only CLI dependencies and this public task.
    home = Path.home()
    q = lambda p: json.dumps(str(p), ensure_ascii=False)
    text = '(version 1)\n(allow default)\n'
    text += f'(deny file-read* file-write* (subpath {q(home)}))\n'
    for rel in ['.opencode','.config/opencode','.local/share/opencode','.local/state/opencode','.cache','.nvm','.pyenv','Library/Caches']:
        text += f'(allow file-read* (subpath {q(home/rel)}))\n'
    for rel in ['.local/share/opencode','.local/state/opencode','.cache','Library/Caches']:
        text += f'(allow file-write* (subpath {q(home/rel)}))\n'
    for parent in [project, *project.parents]:
        text += f'(allow file-read* (literal {q(parent)}))\n'
        for name in ['.agents','.claude','.opencode','.git']:
            text += f'(allow file-read* (literal {q(parent/name)}))\n'
    # CLI config discovery always resolves the ancestor project policy file.
    text += f'(allow file-read* (literal {q(ROOT/"opencode.jsonc")}))\n'
    text += f'(allow file-read* (subpath {q(project)}) (subpath {q(common)}))\n'
    if not review:
        for rel in ['data/collections','notes']:
            text += f'(allow file-write* (subpath {q(project/rel)}))\n'
    text += '(deny file-read* (regex #"/[.]env([^/]*)(/|$)"))\n(allow file-read-metadata)\n'
    return text

def refresh_task_config(project, unit, common):
    save(project/'opencode.json', engine.config(project, common))
    task = (ROOT/'docs/BEAM_CONTINUATION_20261025.md').read_text()
    (project/'TASK.md').write_text(task + '\n本单元：' + json.dumps(unit,ensure_ascii=False)
                                  + '\n本次执行模型：' + engine.MODEL
                                  + '\n只读共享资料：' + str(common) + '\n')
    (project/'REVIEW_TASK.md').write_text(
        (ROOT/'docs/SAAS_CASE_REVIEW_CONTRACT.md').read_text()
        + '\n本单元叶子：' + json.dumps(unit['slugs'],ensure_ascii=False) + '\n')

def configure_cli_environment(common):
    configdir=common/'runtime-config'
    (configdir/'opencode').mkdir(parents=True,exist_ok=True)
    engine.CLI_ENV_OVERRIDES={
        'XDG_CONFIG_HOME':str(configdir), 'OPENCODE_CONFIG_DIR':str(configdir/'opencode'),
        'OPENCODE_DISABLE_PROJECT_CONFIG':'1', 'OPENCODE_DISABLE_CLAUDE_CODE':'1',
        'OPENCODE_DISABLE_AUTOUPDATE':'1'}

def prepare(unit, common):
    number = unit['unit']
    partdir = RUN / f'part-{number:03}'
    project = partdir / 'project'
    if (project/'prepared.json').exists():
        assert read(project/'prepared.json')['slugs'] == unit['slugs']
        refresh_task_config(project, unit, common)
        return partdir
    project.mkdir(parents=True, exist_ok=True)
    for rel in ['server','data/taxonomy']:
        shutil.copytree(common/rel, project/rel, dirs_exist_ok=True)
    (project/'scripts').mkdir(exist_ok=True)
    shutil.copy2(common/'scripts/collect_cases.py', project/'scripts/collect_cases.py')
    (project/'notes').mkdir(exist_ok=True)
    (project/'data/collections/sources').mkdir(parents=True, exist_ok=True)
    original = ROOT / f"var/collection/full-directory-inputs/part-{unit['parent']:03}.json"
    inp = read(original)
    inp['leaves'] = [x for x in inp['leaves'] if x['progress']['slug'] in unit['slugs']]
    assert [x['progress']['slug'] for x in inp['leaves']] == unit['slugs']
    inp['continuation'] = unit
    save(project/'input.json', inp)
    old = PREVIOUS / f"part-{unit['parent']:03}/project"
    oldbatch = old/'data/collections/batch.json'
    entries = []
    if oldbatch.exists():
        for original_entry in read(oldbatch).get('entries',[]):
            e = copy.deepcopy(original_entry)
            e['leaf_matches'] = [m for m in e['leaf_matches'] if m['slug'] in unit['slugs']]
            if not e['leaf_matches']: continue
            entries.append(e)
            for source in e['sources']:
                digest = source['sha256']
                assert source['snapshot_path'] == f'sources/{digest}.txt'
                src = old/'data/collections'/source['snapshot_path']
                assert sha(src) == digest
                # A private copy prevents worker edits from altering old evidence.
                shutil.copy2(src, project/'data/collections'/source['snapshot_path'])
    save(project/'data/collections/batch.json', {'schema_version':1,
         'batch_id': f'beam-cont-20261025-u{number:03}', 'entries':entries})
    oldresearch = old/'data/collections/research.json'
    if oldresearch.exists():
        rows = [copy.deepcopy(x) for x in read(oldresearch).get('leaf_cases',[]) if x.get('slug') in unit['slugs']]
        rows.sort(key=lambda x: unit['slugs'].index(x['slug']))
        save(project/'data/collections/research.json', {'schema_version':1,'leaf_cases':rows})
    if (old/'notes').exists():
        shutil.copytree(old/'notes', project/'notes/previous', dirs_exist_ok=True)
    previous = read(old/'review.json') if (old/'review.json').exists() else {}
    ids = {e['id'] for e in entries}
    relevant = []
    for finding in previous.get('findings',[]):
        if isinstance(finding,str):
            # Unstructured findings must not be silently omitted.
            relevant.append(finding)
            continue
        slugs = ' '.join(str(finding.get(k,'')) for k in ['leaf','leaf_slug','slug'])
        appids = ' '.join(str(finding.get(k,'')) for k in ['application_id','entry_id'])
        if not slugs and not appids or any(s in slugs for s in unit['slugs']) or any(i in appids for i in ids):
            relevant.append(finding)
    save(project/'issues.json', {'phase':unit['phase'],'findings':relevant,
                                'previous_review_path':str((old/'review.json').relative_to(ROOT))})
    refresh_task_config(project, unit, common)
    save(project/'prepared.json', {**unit,'input_sha256':sha(project/'input.json'),
                                  'original_input_sha256':sha(original)})
    return partdir

def validate(project):
    result = engine.validate(project)
    prepared = read(project/'prepared.json')
    assert sha(project/'input.json') == prepared['input_sha256'], 'assigned input changed'
    assert [x['progress']['slug'] for x in read(project/'input.json')['leaves']] == prepared['slugs']
    return result

def prepare_review_sources(project):
    paths = {}
    for entry in read(project/'data/collections/batch.json')['entries']:
        for source in entry['sources']:
            relative = 'data/collections/' + source['snapshot_path']
            path = project/relative
            assert path.is_file() and sha(path)==source['sha256'], 'review source missing or changed'
            item = paths.setdefault(relative,{'path':relative,'sha256':source['sha256'],
                                              'url':source['url'],'kind':source['kind'],
                                              'applications':[]})
            if entry['id'] not in item['applications']: item['applications'].append(entry['id'])
    save(project/'REVIEW_SOURCES.json',{'snapshot_base':'data/collections',
                                      'sources':list(paths.values())})

def run_unit(number, common):
    unit = UNITS[number-1]
    partdir = prepare(unit, common)
    project = partdir/'project'
    statepath = partdir/'state.json'
    if statepath.exists():
        previous = read(statepath)
        if previous.get('status') == 'needs_attention':
            if previous.get('error_kind') == 'content_filter':
                engine.verify_content_filter_retention(partdir, previous)
                assert sha(project/'input.json') == read(project/'prepared.json')['input_sha256']
                return previous
            if previous.get('reason') == 'bounded corrections exhausted':
                # Its two correction attempts already ended. Keep the findings
                # for final review instead of restarting the same unit on resume.
                return previous
    if statepath.exists() and read(statepath).get('status') == 'awaiting_final_review':
        state = read(statepath)
        assert all(state[k]==v for k,v in validate(project).items())
        if state.get('review_protocol') == engine.REVIEW_PROTOCOL:
            return state
        # Retain the old result, then repeat only its independent review under
        # the isolated-input protocol; never rebuild a validated draft for this.
    if statepath.exists():
        save(partdir/'state-history'/f'{time.time_ns()}.json',read(statepath))
    if not (project/'.git').exists():
        engine.run_tracked(['git','init','--quiet',str(project)],timeout=20).check_returncode()
    save(statepath, {'part':number,'phase':unit['phase'],'parent':unit['parent'],
                     'status':'running','model':engine.MODEL,'targets':len(unit['slugs'])})
    summary()
    issues = read(project/'issues.json')['findings']
    builder = ('先读TASK.md、input.json和issues.json。只处理本单元最多5个类型，优先复用已有草稿、来源和notes/previous候选。'
               '若已有review.json，核对其中尚未解决的初审问题，保留已完成的修正。'
               '修复实际初审问题；无证断言直接收窄或移除对应关系并留档，不能把无结果当不存在。'
               '每完成一个叶子立即保存研究与批次文件；结束前写齐本单元batch.json/research.json。'
               '开源优先，商业仅基本记录；不能运行第三方项目或修改正式数据。')
    reviewprompt = ('请对本单元公开应用资料做只读独立初审。先读REVIEW_TASK.md、input.json、REVIEW_SOURCES.json，再核对data/collections/batch.json、data/collections/research.json和实际引用快照。'
                    '快照必须按REVIEW_SOURCES.json的path原样读取；sources前缀相对于data/collections而非项目根目录，不猜测路径或摘要。'
                    '检查每叶定义性核心、SaaS服务形态、ID/track、开源完整许可证及社区版边界；不能用简介/元数据/Loading替代核心正文。'
                    '商业只要求基本真实性和类型匹配；非关键措辞不阻断。已如实记录查询/抓取缺口的留档可通过。'
                    '不得运行shell、写文件或读取其他单元。直接返回一个完整JSON：decision(content_review_passed或changes_required)、'
                    'findings(必须修复的问题)、non_blocking_notes、leaf_checks(本单元全部slug为键)、limits。'
                    '每个finding尽量包含slug/application_id/issue/fix，不要照抄采集结论。'
                    'JSON所有键都必须提供，leaf_checks为对象，键精确使用这些slug：' + json.dumps(unit['slugs'],ensure_ascii=False))
    runs = []
    needs_build = unit['phase']=='complete' or bool(issues)
    reused_validation = None
    try:
        current = validate(project)
        for previous in sorted(partdir.glob('validation-*.json'),reverse=True):
            if read(previous) == current:
                reused_validation = str(previous.relative_to(ROOT))
                needs_build = False
                break
    except Exception:
        pass
    if not needs_build:
        try: validate(project)
        except Exception: needs_build = True
    feedback = ''
    for attempt in [1,2]:
        if needs_build or attempt==2:
            runs.append(engine.turn(partdir,common,builder+feedback,'build',attempt))
        try:
            checked = validate(project)
        except Exception as exc:
            if attempt==2: raise
            feedback = '\n结构未完成，请修复并保存后结束：' + type(exc).__name__ + ': ' + str(exc)
            needs_build = True
            continue
        save(partdir/f'validation-{attempt}.json',checked)
        prepare_review_sources(project)
        if (project/'review.json').exists():
            save(partdir/'review-history'/f'{time.time_ns()}.json',read(project/'review.json'))
            (project/'review.json').unlink()
        runs.append(engine.turn(partdir,common,reviewprompt,'review',attempt))
        review = read(project/'review.json')
        review.update(**{k:checked[k] for k in ['batch_sha256','research_sha256','input_sha256']})
        save(project/'review.json',review)
        if review.get('decision')=='content_review_passed':
            assert not review.get('findings')
            assert isinstance(review.get('leaf_checks'),dict) and set(review['leaf_checks'])==set(unit['slugs'])
            assert validate(project)==checked
            state = {'part':number,'phase':unit['phase'],'parent':unit['parent'],
                     'status':'awaiting_final_review',**checked,'model':engine.MODEL,
                     'same_model_independent_sessions':any(r['role']=='build' for r in runs),
                     'independent_review_session':True,'review_protocol':engine.REVIEW_PROTOCOL,
                     'reused_validation':reused_validation,
                     'runs':runs,'published':False,'runtime_tested':False}
            save(statepath,state)
            return state
        feedback = '\n仅修复独立初审的实际问题：' + json.dumps(review,ensure_ascii=False)
    state = {'part':number,'phase':unit['phase'],'parent':unit['parent'],'status':'needs_attention',
             'reason':'bounded corrections exhausted','runs':runs,'published':False}
    save(statepath,state)
    return state

def summary(_part=None):
    with engine.STATUS_LOCK:
        states = [read(p) for p in sorted(RUN.glob('part-*/state.json'))]
        byid = {s['part']:s for s in states}
        def ready(state):
            return state.get('status')=='awaiting_final_review' and state.get('review_protocol')==engine.REVIEW_PROTOCOL
        def terminal(state):
            return state.get('status')=='needs_attention' or ready(state)
        phases = {}
        for phase in ['repair','complete']:
            units = [u for u in UNITS if u['phase']==phase]
            done = [u for u in units if terminal(byid.get(u['unit'],{}))]
            approved = [u for u in units if ready(byid.get(u['unit'],{}))]
            phases[phase] = {'units':len(units),'types':sum(len(u['slugs']) for u in units),
                             'ended_units':len(done),'ready_units':len(approved),
                             'types_ready_for_final_review':sum(len(u['slugs']) for u in approved)}
        save(RUN/'status.json', {'model':engine.MODEL,'concurrency':4,'phase':PHASE,
             'updated_at':time.strftime('%Y-%m-%dT%H:%M:%S%z'),
             'active_parts':sorted(s['part'] for s in states if s['status']=='running'),
             'queue_finished':len(states)==len(UNITS) and all(terminal(s) for s in states),
             'stopped':engine.STOP.is_set(),'phases':phases,'processed_parts':sum(terminal(s) for s in states),
             'awaiting_final_review':sum(ready(s) for s in states),
             'legacy_reviews_pending_recheck':[s['part'] for s in states if s['status']=='awaiting_final_review' and not ready(s)],
             'needs_attention':sum(s['status']=='needs_attention' for s in states),
             'content_filter_retained_parts':[s['part'] for s in states if s.get('error_kind')=='content_filter'],
             'errors':[{'part':s['part'],'kind':s.get('error_kind'),'error':str(s.get('error',''))[:500]} for s in states if s.get('error')],
             'published':False})

def main():
    global PHASE, UNITS
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-only',action='store_true')
    parser.add_argument('--model',choices=ALLOWED_MODELS,default='opencode-go/beam-free',
                        help='Explicit user-selected model; never falls back automatically')
    args=parser.parse_args()
    RUN.mkdir(parents=True,exist_ok=True)
    lock=(PREVIOUS/'queue.lock').open('a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    engine.MODEL=args.model
    engine.PROVIDER, engine.MODEL_ID=args.model.split('/',1)
    plan=make_plan(); UNITS=plan['units']
    engine.profile=profile; engine.queue_status=summary; engine.run_part=run_unit
    common=engine.prepare_common()
    assert read(common/'manifest.json')['applications']==plan['baseline_applications']
    configure_cli_environment(common)
    selection={'model':engine.MODEL,'original_plan_model':plan['model'],
               'selected_at':time.strftime('%Y-%m-%dT%H:%M:%S%z'),
               'plan_sha256':sha(PLAN),'concurrency':4,'automatic_fallback':False,
               'isolated_cli_config':True,'published':False}
    save(RUN/'model-selections'/f'{time.time_ns()}.json',selection)
    save(RUN/'runtime-selection.json',selection)
    for unit in UNITS: prepare(unit,common)
    summary()
    if args.prepare_only:
        print(json.dumps({'prepared_units':len(UNITS),'repair_types':525,'complete_types':843,
                          'shared_applications':read(common/'manifest.json')['applications']},ensure_ascii=False))
        return
    def stop(_signal,_frame):
        engine.stop_children()
        raise KeyboardInterrupt('queue interrupted; drafts preserved')
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    save(RUN/'process.json',{'pid':os.getpid(),'script':'scripts/continue_directory_beam.py',
                            'model':engine.MODEL,'concurrency':4,'units':len(UNITS),'phase_order':plan['phase_order']})
    try:
        for phase in plan['phase_order']:
            PHASE=phase
            numbers=[u['unit'] for u in UNITS if u['phase']==phase]
            summary()
            if not engine.run_queue(numbers,common,4):raise SystemExit(1)
            assert all(read(RUN/f'part-{n:03}/state.json')['status'] in ['awaiting_final_review','needs_attention'] for n in numbers)
            save(RUN/f'{phase}-ended.json',{'units':numbers,'ended_at':time.strftime('%Y-%m-%dT%H:%M:%S%z'),
                                          'published':False})
        PHASE='finished'
    finally:
        with engine.PROCESS_LOCK: children=list(engine.ACTIVE_PROCESSES.values())
        engine.terminate_processes(children)
        summary()

if __name__=='__main__':main()
