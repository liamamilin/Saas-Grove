#!/usr/bin/env python3
"""Depth fill for common types (docs/DEPTH_FILL_PLAN.md): stage drafts only, never publish.

    python3 -B scripts/fill_type_depth.py prepare            # backup, frozen inputs and plan (no model calls)
    python3 -B scripts/fill_type_depth.py check              # short route + sandbox write/read test
    python3 -B scripts/fill_type_depth.py run --units 1      # collect + independent review for chosen units

Reuses the tested OpenCode engine (scripts/collect_directory_go.py) and workflow sandbox
(scripts/continue_directory_beam.py). Unlike earlier runs, a unit enumerates mainstream products
of one type instead of stopping at the first case. Publication is a separate main-session step.
"""
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import sys
import time
from urllib.parse import urlparse

import continue_directory_beam as workflow

engine = workflow.engine
ROOT = workflow.ROOT
RUN = ROOT/'var/collection/depth-fill-20261031'
INPUTS = ROOT/'data/collections/depth-fill-20261031-inputs.json'
PLAN = ROOT/'data/collections/depth-fill-20261031-plan.json'
CONTRACT = ROOT/'docs/DEPTH_FILL_CONTRACT_20261031.md'
REVIEW_ADDENDUM = ROOT/'docs/DEPTH_FILL_REVIEW_ADDENDUM_20261031.md'
PROVIDER_DEFINITION = ROOT/'var/collection/retained-evidence-20261028/preflight/common/runtime-config/opencode/opencode.json'
MODEL = 'opencode-go/deepseek-v4.1-flash'
BASELINE = {'applications': 1440, 'links': 1724}
CATALOG_SQL_SHA = '87840707370316c08e58dfd90516643c8ba297e8c670d2b534b2ca7987c7f2fa'
BUILD_STEPS = 300  # earlier runs used 100 for one case per leaf; a unit here verifies ~10 products
REVIEW_ONLY = False  # run --review-only: review the current draft once more without a build turn
EXTRA_CORRECTION = False  # run --extra-correction: units whose two rounds were exhausted get one more
TARGETS = {'open_source': [6, 8], 'commercial': [3, 5]}
DECISIONS = {'added', 'relation_added', 'rejected'}
read, save, sha = engine.read, engine.save, engine.sha

# Order is the plan's table order; unit 1 is the approved pilot. Leads are discovery hints only.
TYPES = [
    ('help-desk', ['Zammad', 'FreeScout', 'UVdesk', 'Peppermint', 'Zendesk', 'Freshdesk', 'Help Scout', 'Chatwoot（已在库，待核关联）']),
    ('project-management-application', ['Taiga', 'Leantime', 'Redmine', 'Kanboard', 'monday.com', 'Jira']),
    ('customer-relationship-management-crm', ['SuiteCRM', 'Krayin', 'vtiger', 'HubSpot CRM', 'Pipedrive']),
    ('team-messaging-application', ['Mattermost', 'Rocket.Chat', 'Element', 'Microsoft Teams']),
    ('wiki-application', ['BookStack', 'Wiki.js', 'Outline', 'XWiki', 'Confluence', 'Notion']),
    ('survey-platform', ['OpnForm', 'HeyForm', 'SurveyMonkey', 'LimeSurvey（已在库，待核关联）']),
    ('email-marketing-platform', ['Keila', 'Mailchimp', 'Brevo', 'Mautic（已在库，待核关联）', 'listmonk（已在库，待核关联）']),
    ('time-tracking-application', ['TimeTagger', 'solidtime', 'Toggl Track', 'Harvest', 'Clockify']),
    ('headless-cms', ['Directus', 'Payload', 'Contentful', 'Sanity', 'Ghost（已在库，待核关联）']),
    ('video-conferencing-application', ['Galène', 'Zoom', 'Google Meet', 'BigBlueButton（已在库，待核关联）']),
]


def published_baseline():
    """Counts and catalog.sql SHA the next units start from: the frozen baseline, or the snapshot written by this run's last publish."""
    snapshot = read(ROOT/'data/catalog-snapshot.json')
    if snapshot['source_report'].startswith(f'collections/{RUN.name}-u'):
        report = read(ROOT/'data'/snapshot['source_report'])
        assert report['published'] and report['snapshot']['sha256'] == snapshot['sha256']
        return {'applications': snapshot['applications'], 'links': snapshot['leaf_links']}, snapshot['sha256']
    return BASELINE, CATALOG_SQL_SHA


def catalog_counts(path=None):
    db = sqlite3.connect(f'file:{ROOT}/var/catalog.sqlite?mode=ro', uri=True) if path is None else sqlite3.connect(path)
    try:
        return {'applications': db.execute('select count(*) from application').fetchone()[0],
                'links': db.execute('select count(*) from leaf_application').fetchone()[0]}
    finally:
        db.close()


def linked_products(slug):
    with sqlite3.connect(f'file:{ROOT}/var/catalog.sqlite?mode=ro', uri=True) as db:
        rows = db.execute('select a.data from application a join leaf_application l on l.app_id=a.id where l.leaf=? order by a.id', (slug,))
        return [{k: e.get(k) for k in ['id', 'name', 'track', 'homepage', 'repository_url']} for e in (json.loads(r[0]) for r in rows)]


DEFINITION_KEYS = ['slug', 'name', 'name_zh', 'aliases_zh', 'domain_id', 'parent_id', 'overview', 'overview_zh', 'dc', 'dc_zh', 'rules', 'rules_zh']


def definition_row(slug):
    """Same definition fields the earlier unit inputs carried, read from the current taxonomy."""
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from server.taxonomy import Taxonomy
    row = Taxonomy().leaf(slug)
    assert row['scope'] == 'included', slug
    catalog = ROOT/'data/taxonomy/catalog.json'
    return {'definition': {k: row[k] for k in DEFINITION_KEYS}}, {'path': str(catalog.relative_to(ROOT)), 'sha256': sha(catalog)}


def prepare_inputs():
    """Back up the formal catalog and freeze the ten unit inputs. No model calls."""
    assert catalog_counts() == BASELINE, catalog_counts()
    assert sha(ROOT/'data/catalog.sql') == CATALOG_SQL_SHA
    RUN.mkdir(parents=True, exist_ok=True)
    backup = RUN/'catalog.before-collection.sqlite'
    if not backup.exists():
        src, dst = sqlite3.connect(f'file:{ROOT}/var/catalog.sqlite?mode=ro', uri=True), sqlite3.connect(backup)
        src.backup(dst)
        src.close()
        dst.close()
    assert catalog_counts(backup) == BASELINE
    if INPUTS.exists():
        return read(INPUTS)
    progress = {row['slug']: row for row in read(ROOT/'data/collections/included-coverage-progress.json')['items']}
    units = []
    for number, (slug, leads) in enumerate(TYPES, 1):
        leaf, origin = definition_row(slug)
        row = progress.get(slug)
        current = row or {'slug': slug, 'name_zh': leaf['definition']['name_zh'], 'case_status': 'covered', 'research_records': []}
        leaf = {**leaf, 'progress': {**current, 'slug': slug}}
        units.append({'unit': number, 'slug': slug, 'leaf': leaf, 'definition_source': origin,
                      'existing_products': linked_products(slug), 'candidate_leads': leads})
    value = {'schema_version': 1, 'run_id': RUN.name, 'baseline': BASELINE, 'catalog_sql_sha256': CATALOG_SQL_SHA,
             'backup_sha256': sha(backup), 'targets': TARGETS, 'units': units,
             'created_at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'publication_allowed': False}
    save(INPUTS, value)
    return value


def plan(inputs):
    frozen = {name: {'path': str(p.relative_to(ROOT)), 'sha256': sha(p)}
              for name, p in [('inputs', INPUTS), ('contract', CONTRACT), ('review_addendum', REVIEW_ADDENDUM),
                              ('review_contract', ROOT/'docs/SAAS_CASE_REVIEW_CONTRACT.md'),
                              ('catalog', ROOT/'data/taxonomy/catalog.json'), ('provider_definition', PROVIDER_DEFINITION)]}
    units = [{'unit': u['unit'], 'phase': 'depth', 'parent': u['unit'], 'slugs': [u['slug']]} for u in inputs['units']]
    if PLAN.exists():
        value = read(PLAN)
        assert value['frozen_inputs'] == frozen and value['units'] == units, 'frozen plan inputs changed'
        return value
    value = {'schema_version': 1, 'run_id': RUN.name, 'model': MODEL, 'concurrency': 4, 'build_steps': BUILD_STEPS,
             'baseline': inputs['baseline'], 'backup_sha256': inputs['backup_sha256'], 'frozen_inputs': frozen,
             'units': units, 'pilot_units': [1], 'publication_allowed': False,
             'created_at': datetime.now(timezone.utc).isoformat(timespec='seconds')}
    save(PLAN, value)
    return value


def configure(common):
    workflow.configure_cli_environment(common)
    # Same public provider metadata the 2026-10-29 Go runs used; credentials stay with the CLI.
    save(common/'runtime-config/opencode/opencode.json', read(PROVIDER_DEFINITION))


def bind_engine():
    engine.MODEL = MODEL
    engine.PROVIDER, engine.MODEL_ID = MODEL.split('/', 1)
    engine.RUN = workflow.RUN = RUN  # before prepare_common/turn: the sandbox denies reads under RUN
    engine.profile = workflow.profile
    engine.BUILD_STEPS = BUILD_STEPS
    engine.TURN_TIMEOUT = 7200  # the workflow default (1200 s) is too short for ~10 products per unit
    common = engine.prepare_common()
    manifest = read(common/'manifest.json')
    # The shared index must list every formal product, including ones earlier units published.
    assert manifest['applications'] == published_baseline()[0]['applications'], 'shared index is stale; move common/ aside to rebuild it'
    configure(common)
    return common


def check():
    """Fresh route and sandbox tool check for today's run; never starts the queue."""
    common = bind_engine()
    engine.TURN_TIMEOUT, engine.TURN_IDLE_TIMEOUT = 120, 60
    folder = RUN/'provider-checks'/str(time.time_ns())
    part, result = folder/'part-000', {'model': MODEL, 'available': False, 'checked_at': datetime.now(timezone.utc).isoformat()}
    project = part/'project'
    (project/'notes').mkdir(parents=True)
    (project/'data/collections').mkdir(parents=True)
    try:
        result['receipt'] = engine.turn_once(part, common, '仅验证指定模型调用。只回复 GROVE_PROVIDER_OK，不调用工具、不读文件。', 'build', 'routecheck')
        target, expected = project/'notes/provider-check.json', {'probe': 'grove-depth-fill', 'ok': True}
        receipt = engine.turn_once(part, common, '仅验证沙箱文件工具。使用write工具在这个完整路径写入指定JSON，再使用read工具读回：'
                                   + str(target) + '\nJSON：' + json.dumps(expected) + '\n只调用write和read，不用shell、不读其他文件。最后回复 GROVE_TOOLS_OK。',
                                   'build', 'toolcheck')
        events = []
        for line in (ROOT/receipt['log_path']).read_text().splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get('type') == 'tool_use':
                events.append(event.get('part', {}))
        result['tool_check'] = {'receipt': receipt, 'completed_tools': [e.get('tool') for e in events if e.get('state', {}).get('status') == 'completed'],
                                'content_verified': target.is_file() and read(target) == expected,
                                'no_shell': all(e.get('tool') in {'write', 'read'} for e in events)}
        receipts = [result['receipt'], receipt]
        result['available'] = (all(r['prompt_verified'] and r['model_actual'].get('providerID') == engine.PROVIDER
                                   and r['model_actual'].get('id') == engine.MODEL_ID for r in receipts)
                               and result['tool_check']['completed_tools'] == ['write', 'read']
                               and result['tool_check']['content_verified'] and result['tool_check']['no_shell'])
    except Exception as exc:
        result['error'] = f'{type(exc).__name__}: {exc}'
    save(folder/'result.json', result)
    save(RUN/'provider-checks/latest.json', result)
    print(json.dumps({k: result.get(k) for k in ['model', 'available', 'error']}, ensure_ascii=False))
    return 0 if result['available'] else 3


def prepare_unit(unit, common):
    """Isolated workspace for one type: public catalog identities, never controller files."""
    row = read(INPUTS)['units'][unit['unit'] - 1]
    part = RUN/f"part-{unit['unit']:03}"
    project = part/'project'
    if not (project/'prepared.json').exists():
        for rel in ['server', 'data/taxonomy']:
            shutil.copytree(common/rel, project/rel, dirs_exist_ok=True)
        for rel in ['scripts', 'notes', 'data/collections/sources']:
            (project/rel).mkdir(parents=True, exist_ok=True)
        shutil.copy2(common/'scripts/collect_cases.py', project/'scripts/collect_cases.py')
        shutil.copy2(common/'application-index.json', project/'CATALOG_INDEX.json')
        prior = [r for r in row['leaf']['progress'].get('research_records', [])]
        save(project/'input.json', {'schema_version': 1, 'phase': 'depth_fill', 'unit': unit, 'leaves': [row['leaf']],
                                    'existing_products': row['existing_products'], 'candidate_leads': row['candidate_leads'],
                                    'prior_research': prior, 'targets': TARGETS,
                                    'note': 'candidate_leads 与 prior_research 只是线索，不是证据；existing_products 已关联本类型，不要再提交。'})
        save(project/'data/collections/batch.json', {'schema_version': 1, 'batch_id': f"depth-fill-20261031-u{unit['unit']:03}", 'entries': []})
        save(project/'data/collections/research.json', {'schema_version': 1, 'leaf_cases': []})
        save(project/'issues.json', {'findings': []})
        save(project/'prepared.json', {**unit, 'input_sha256': sha(project/'input.json')})
    save(project/'opencode.json', engine.config(project, common))
    (project/'TASK.md').write_text(CONTRACT.read_text() + '\n本单元：' + json.dumps(unit, ensure_ascii=False)
                                   + '\n本次执行模型：' + MODEL + '\n只读共享资料：' + str(common) + '\n')
    (project/'REVIEW_TASK.md').write_text((ROOT/'docs/SAAS_CASE_REVIEW_CONTRACT.md').read_text() + REVIEW_ADDENDUM.read_text()
                                          + '\n本单元叶子：' + json.dumps(unit['slugs'], ensure_ascii=False) + '\n')
    return part


def depth_validate(project):
    """Structural checks the stock validator does not make for an enumeration unit."""
    result = workflow.validate(project)
    inp = read(project/'input.json')
    existing = {p['id'] for p in inp['existing_products']}
    index = {e['id']: e for e in read(project/'CATALOG_INDEX.json')}
    norm = lambda u: (u or '').rstrip('/').removesuffix('.git').casefold()
    # Whole homepage, not just the domain: vendors share domains (Jira and Jira Service Management on atlassian.com)
    # and many open-source homepages are github.com.
    domain = lambda u: ((urlparse(u or '').hostname or '').casefold().removeprefix('www.') + urlparse(u or '').path.rstrip('/').casefold()) if u else ''
    repos = {norm(e.get('repository_url')): e['id'] for e in index.values() if e.get('repository_url')}
    homes = {domain(e.get('homepage')): e['id'] for e in index.values() if domain(e.get('homepage')) not in {'', 'github.com', 'gitlab.com'}}
    names = {(e.get('name') or '').casefold(): e['id'] for e in index.values()}
    entries = read(project/'data/collections/batch.json')['entries']
    row = read(project/'data/collections/research.json')['leaf_cases'][0]
    dispositions = row.get('candidate_dispositions')
    assert isinstance(dispositions, list) and dispositions, 'research row needs candidate_dispositions'
    chosen = {}
    for d in dispositions:
        assert isinstance(d, dict) and d.get('name') and re.match(r'https?://', d.get('url') or ''), f'disposition needs name and official url: {d}'
        assert d.get('decision') in DECISIONS, f"unknown decision: {d.get('decision')}"
        assert isinstance(d.get('reason'), str) and d['reason'].strip(), f"{d['name']}: decision needs a reason"
        if d['decision'] != 'rejected':
            assert d.get('application_id'), f"{d['name']}: chosen candidate needs application_id"
            assert d['application_id'] not in chosen, f"{d['application_id']}: listed twice in candidate_dispositions"
            chosen[d['application_id']] = d['decision']
    ids = {e['id'] for e in entries}
    assert set(chosen) == ids, f'dispositions and batch entries differ: {sorted(set(chosen) ^ ids)}'
    for e in entries:
        assert e['id'] not in existing, f"{e['id']} is already linked to this type"
        if e['id'] in index:
            assert chosen[e['id']] == 'relation_added', f"{e['id']} exists in the catalog; mark it relation_added"
            original = read(RUN/'common/applications'/(e['id'].replace(':', '_') + '.json'))
            changed = sorted(k for k in set(original) | set(e) if k not in {'leaf_matches', 'sources'} and original.get(k) != e.get(k))
            assert not changed, f"{e['id']}: copy the catalog record unchanged, only leaf_matches and sources may differ ({', '.join(changed)})"
        else:
            assert chosen[e['id']] == 'added', f"{e['id']} is new; mark it added"
            home = homes.get(domain(e.get('homepage')))
            # A shared vendor homepage is not a duplicate when both sides name different repositories
            # (Nextcloud Server, Calendar and Forms all use nextcloud.com).
            if home and e.get('repository_url') and index[home].get('repository_url') and norm(index[home]['repository_url']) != norm(e['repository_url']) \
                    and (index[home].get('name') or '').casefold() != (e.get('name') or '').casefold():
                home = None
            owner = (repos.get(norm(e.get('repository_url'))) if e.get('repository_url') else None) \
                or home or names.get((e.get('name') or '').casefold())
            assert not owner, f"{e['id']} looks like existing {owner} (same repository, homepage or name); reuse that ID"
    result['dispositions'] = {k: sum(d['decision'] == k for d in dispositions) for k in sorted(DECISIONS)}
    result['new_by_track'] = {t: sum(1 for e in entries if e['id'] not in index and e['track'] == t) for t in ['open_source', 'commercial']}
    return result


def run_unit(number, common):
    unit = read(PLAN)['units'][number - 1]
    part = prepare_unit(unit, common)
    project, statepath = part/'project', part/'state.json'
    extra = False
    if statepath.exists():
        previous = read(statepath)
        if previous.get('status') == 'awaiting_final_review':
            checked = depth_validate(project)
            assert all(previous[k] == checked[k] for k in ['batch_sha256', 'research_sha256', 'input_sha256']), 'frozen draft changed'
            return previous
        # The session logs are the record: a build3 log means the extra round was spent, whatever later states say.
        extra = EXTRA_CORRECTION and previous.get('reason') == 'bounded corrections exhausted' and not any(part.glob('ses_*build3_*-run.json'))
        if REVIEW_ONLY:
            assert previous.get('status') == 'needs_attention', previous.get('status')
        elif (previous.get('reason') == 'bounded corrections exhausted' and not extra) or previous.get('status') == 'published':
            return previous
        save(part/'state-history'/f'{time.time_ns()}.json', previous)
    if not (project/'.git').exists():
        engine.run_tracked(['git', 'init', '--quiet', str(project)], timeout=20).check_returncode()
    save(statepath, {'part': number, 'slug': unit['slugs'][0], 'status': 'running', 'model': MODEL})
    summary()
    slug = unit['slugs'][0]
    builder = ('先读TASK.md和input.json。本单元只处理类型 ' + slug + '：按定义性核心列举并核实主流产品，目标开源6–8个、商业3–5个，找不到就如实少收。'
               'existing_products 已关联本类型，不要再提交；新建前按仓库URL、官网域名和名称对照 CATALOG_INDEX.json 去重，已在库的产品只补关系并复用原ID与原字段。'
               '每个候选都写进 research.json 的 candidate_dispositions（added/relation_added/rejected 加具体原因）。'
               '每核实完一个产品立即保存 batch.json 和 research.json，结束前用 scripts/collect_cases.py validate 校验。'
               '只用官方来源取证，第三方列表只作线索；不运行第三方项目、不改正式数据。'
               'data/collections/ 下已有草稿时先读它，在其基础上继续，不要从头重做。'
               'GitHub 匿名 API 每小时只有 60 次且与其他单元共用：一次请求同时取元数据和许可证，已抓到的快照不再重抓；'
               '遇到限流不要用 sleep 循环等待，把该候选在 note 里记为待核实后继续其他工作。')
    review = ('请对本单元公开应用资料做只读独立初审。先读REVIEW_TASK.md、input.json、REVIEW_SOURCES.json，再核对data/collections/batch.json、data/collections/research.json和实际引用快照。'
              '快照按REVIEW_SOURCES.json的path原样读取；去重时在CATALOG_INDEX.json中检索，不必通读。'
              '逐个产品检查定义性核心、服务形态、ID/track、开源完整许可证及社区版边界、仓库是否归档与近期推送、是否与已有产品重复；逐条看被拒候选的理由是否有依据。'
              '商业只要求基本真实性和类型匹配；数量少于目标不是问题；非关键措辞不阻断。'
              '不得运行shell、写文件或读取其他单元。直接返回一个完整JSON：decision(content_review_passed或changes_required)、'
              'findings(必须修复的问题，尽量含slug/application_id/issue/fix)、non_blocking_notes、leaf_checks(键精确为'
              + json.dumps(unit['slugs'], ensure_ascii=False) + ')、limits。')
    runs, feedback, attempts = [], '', [1, 2]
    if extra:  # one extra round on the last independent review's findings
        attempts = [3]
        feedback = '\n仅修复独立初审的实际问题：' + json.dumps(read(project/'review.json'), ensure_ascii=False)
    if REVIEW_ONLY:
        attempts = ['r']
    for attempt in attempts:
        if not REVIEW_ONLY:
            runs.append(engine.turn(part, common, builder + feedback, 'build', attempt))
        try:
            checked = depth_validate(project)
        except Exception as exc:
            if attempt == attempts[-1]:
                raise
            feedback = '\n结构或去重检查未通过，请修复并保存后结束：' + type(exc).__name__ + ': ' + str(exc)
            continue
        save(part/f'validation-{attempt}.json', checked)
        workflow.prepare_review_sources(project)
        if (project/'review.json').exists():
            save(part/'review-history'/f'{time.time_ns()}.json', read(project/'review.json'))
            (project/'review.json').unlink()
        runs.append(engine.turn(part, common, review, 'review', attempt))
        report = read(project/'review.json')
        report.update({k: checked[k] for k in ['batch_sha256', 'research_sha256', 'input_sha256']})
        save(project/'review.json', report)
        if report.get('decision') == 'content_review_passed' and not report.get('findings'):
            assert depth_validate(project) == checked
            state = {'part': number, 'slug': slug, 'status': 'awaiting_final_review', **checked, 'model': MODEL,
                     'same_model_independent_sessions': True, 'independent_review_session': True,
                     'review_protocol': engine.REVIEW_PROTOCOL, 'runs': runs, 'published': False, 'runtime_tested': False}
            save(statepath, state)
            return state
        feedback = '\n仅修复独立初审的实际问题：' + json.dumps(report, ensure_ascii=False)
    state = {'part': number, 'slug': slug, 'status': 'needs_attention', 'reason': 'bounded corrections exhausted',
             'runs': runs, 'published': False, 'extra_correction_used': any(part.glob('ses_*build3_*-run.json'))}
    save(statepath, state)
    return state


def summary(_part=None):
    with engine.STATUS_LOCK:
        states = [read(p) for p in sorted(RUN.glob('part-*/state.json'))]
        save(RUN/'status.json', {'model': MODEL, 'updated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                                 'active': [s['part'] for s in states if s['status'] == 'running'],
                                 'awaiting_final_review': [s['part'] for s in states if s['status'] == 'awaiting_final_review'],
                                 'needs_attention': [s['part'] for s in states if s['status'] == 'needs_attention'],
                                 'errors': [{'part': s['part'], 'kind': s.get('error_kind'), 'error': str(s.get('error', ''))[:500]} for s in states if s.get('error')],
                                 'stopped': engine.STOP.is_set(), 'published': False})


def run(units, concurrency):
    latest = read(RUN/'provider-checks/latest.json')
    assert latest['available'] and latest['model'] == MODEL, 'run the check first'
    checked = datetime.fromisoformat(latest['checked_at']).astimezone().date()
    assert checked == datetime.now().astimezone().date(), 'provider check is not from today'
    counts, catalog_sha = published_baseline()
    assert catalog_counts() == counts and sha(ROOT/'data/catalog.sql') == catalog_sha, 'formal catalog changed outside this run'
    for row in read(INPUTS)['units']:  # frozen inputs must still describe the formal links of the units about to run
        if row['unit'] in units:
            assert row['existing_products'] == linked_products(row['slug']), f"unit {row['unit']} existing products changed"
    common = bind_engine()
    assert read(common/'manifest.json')['catalog_sha256'] == sha(ROOT/'data/taxonomy/catalog.json')
    value = plan(read(INPUTS))
    assert set(units) <= {u['unit'] for u in value['units']}
    engine.run_part, engine.queue_status = run_unit, summary
    selection = {'model': MODEL, 'units': units, 'concurrency': concurrency, 'plan_sha256': sha(PLAN), 'automatic_fallback': False,
                 'controller_sha256': sha(Path(__file__)), 'selected_at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'published': False}
    save(RUN/'model-selections'/f'{time.time_ns()}.json', selection)
    save(RUN/'process.json', {'pid': os.getpid(), **selection})

    def stop(_signal, _frame):
        engine.stop_children()
        raise KeyboardInterrupt('queue interrupted; drafts preserved')
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        return 0 if engine.run_queue(units, common, concurrency) else 1
    finally:
        with engine.PROCESS_LOCK:
            children = list(engine.ACTIVE_PROCESSES.values())
        engine.terminate_processes(children)
        summary()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('prepare')
    sub.add_parser('check')
    go = sub.add_parser('run')
    go.add_argument('--units', type=int, nargs='+', required=True)
    go.add_argument('--concurrency', type=int, default=4, choices=[1, 2, 3, 4])
    go.add_argument('--extra-correction', action='store_true')
    go.add_argument('--review-only', action='store_true')
    args = parser.parse_args()
    global EXTRA_CORRECTION, REVIEW_ONLY
    EXTRA_CORRECTION = getattr(args, 'extra_correction', False)
    REVIEW_ONLY = getattr(args, 'review_only', False)
    lock = (ROOT/'var/collection/opencode-go/queue.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if args.command == 'prepare':
        inputs = prepare_inputs()
        value = plan(inputs)
        print(json.dumps({'units': len(value['units']), 'baseline': value['baseline'], 'backup_sha256': value['backup_sha256']}))
        return 0
    if args.command == 'check':
        return check()
    return run(args.units, min(args.concurrency, len(args.units)))


if __name__ == '__main__':
    raise SystemExit(main())
