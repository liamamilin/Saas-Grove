#!/usr/bin/env python3
"""Small, locked handoff queue for the retained-evidence Luna app agents."""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import sys
import time

import continue_directory_beam as workflow

ROOT = workflow.ROOT
RUN = ROOT / 'var/collection/retained-evidence-20261028'
HANDOFF = RUN / 'luna-handoff'
QUEUE = HANDOFF / 'queue.json'
MANIFEST = HANDOFF / 'manifest.json'
TERMINAL = {'awaiting_final_review', 'needs_attention'}
REPORT_KEYS = {'decision', 'findings', 'non_blocking_notes', 'leaf_checks', 'limits'}


def read(path):
    return json.loads(Path(path).read_text())


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class QueueError(RuntimeError):
    pass


def locked():
    """Use only around short metadata/file operations; never around agent work."""
    HANDOFF.mkdir(parents=True, exist_ok=True)
    stream = (HANDOFF / 'queue.lock').open('a')
    fcntl.flock(stream, fcntl.LOCK_EX)
    return stream


def _unit_id(value):
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        digits = value.removeprefix('part-')
        if digits.isdigit():
            return int(digits)
    raise QueueError(f'invalid preserved unit id: {value!r}')


def _load():
    queue = read(QUEUE)
    manifest = read(MANIFEST)
    if (queue.get('model') != 'gpt-6-luna' or queue.get('protocol') != 'codex-app-luna-v1'
            or manifest.get('model') != queue['model'] or manifest.get('protocol') != queue['protocol']
            or manifest.get('model_binding') != 'role_luna_worker'):
        raise QueueError('queue/manifest model or protocol binding mismatch')
    agents = manifest.get('agents')
    if isinstance(agents, list):
        agents = {item.get('name'): item for item in agents if isinstance(item, dict)}
        manifest['agents'] = agents
    if not isinstance(agents, dict):
        raise QueueError('manifest agents must be a name-keyed mapping or list')
    for role in ('build', 'review'):
        allowed = queue.get('allowed_agents', {}).get(role)
        if not isinstance(allowed, list) or not allowed:
            raise QueueError(f'missing allowed_agents.{role}')
        for name in allowed:
            item = agents.get(name)
            if not isinstance(item, dict) or item.get('role') != role or item.get('model') != queue['model']:
                raise QueueError(f'{name}: agent role/model does not match manifest')
            path = Path(item.get('assignment_path', ''))
            if not path.is_absolute():
                path = HANDOFF / path
            if not path.is_file() or sha(path) != item.get('sha256'):
                raise QueueError(f'{name}: agent assignment is missing or changed')
    build_tasks = {agents[name].get('canonical_task') for name in queue['allowed_agents']['build']}
    review_tasks = {agents[name].get('canonical_task') for name in queue['allowed_agents']['review']}
    if None in build_tasks | review_tasks or build_tasks & review_tasks:
        raise QueueError('builder and reviewer must be registered as distinct app sessions')
    if set(queue['allowed_agents']['build']) & set(queue['allowed_agents']['review']):
        raise QueueError('builder and reviewer identities must be independent')
    numbers, slugs = [], []
    for unit in queue.get('units', []):
        if not isinstance(unit.get('unit'), int) or not isinstance(unit.get('slug'), str):
            raise QueueError('each unit needs an integer unit and one slug')
        numbers.append(unit['unit']); slugs.append(unit['slug'])
        if unit.get('status') not in {'pending', 'building', 'repair_pending', 'awaiting_review',
                                      'reviewing', *TERMINAL}:
            raise QueueError(f"unit {unit.get('unit')}: invalid status")
    if len(set(numbers)) != len(numbers) or len(set(slugs)) != len(slugs):
        raise QueueError('unit numbers and slugs must be unique')
    return queue, manifest


def _project(number):
    return RUN / f'part-{number:03}' / 'project'


def _assignment(queue, unit):
    mapping = queue.get('assignments', {})
    ref = mapping.get(str(unit['unit']), mapping.get(unit['unit']))
    if not isinstance(ref, dict) or not isinstance(ref.get('path'), str):
        raise QueueError(f"unit {unit['unit']}: missing assigned input reference")
    path = Path(ref['path'])
    if not path.is_absolute():
        path = HANDOFF / path
    if not path.is_file() or sha(path) != ref.get('sha256'):
        raise QueueError(f"unit {unit['unit']}: assigned input missing or changed")
    payload = read(path)
    if payload.get('unit') != unit['unit'] or payload.get('slug') != unit['slug']:
        raise QueueError(f"unit {unit['unit']}: assignment does not match unit")
    return path, ref['sha256']


def _agent_assignment(manifest, name, role):
    info = manifest['agents'][name]
    if info.get('role') != role:
        raise QueueError(f'{name} is not registered as {role}')
    path = Path(info['assignment_path'])
    if not path.is_absolute():
        path = HANDOFF / path
    digest = sha(path) if path.is_file() else None
    if digest != info.get('sha256'):
        raise QueueError(f'{name}: task assignment changed')
    return str(path), digest


def _record_state(unit, state):
    part = RUN / f"part-{unit['unit']:03}"
    statepath = part / 'state.json'
    if statepath.exists():
        history = HANDOFF / 'history' / f"part-{unit['unit']:03}"
        history.mkdir(parents=True, exist_ok=True)
        shutil.copy2(statepath, history / f'state-{time.time_ns()}.json')
    save(statepath, state)


def _backup_first_build(unit):
    number = unit['unit']
    project = _project(number)
    history = HANDOFF / 'history' / f'part-{number:03}'
    marker = history / 'initial-backup.json'
    if marker.exists():
        return read(marker)
    copied, hashes = [], {}
    for rel in ['data/collections/batch.json', 'data/collections/research.json',
                'review.json', 'issues.json']:
        source = project / rel
        if source.is_file():
            target = history / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            copied.append(rel); hashes[rel] = sha(source)
    notes = project / 'notes'
    if notes.is_dir():
        target = history / 'notes'
        shutil.copytree(notes, target, dirs_exist_ok=True)
        for source in sorted(p for p in notes.rglob('*') if p.is_file()):
            rel = str(source.relative_to(project))
            copied.append(rel); hashes[rel] = sha(source)
    sources = []
    source_dir = project / 'data/collections/sources'
    if source_dir.is_dir():
        for source in sorted(p for p in source_dir.rglob('*') if p.is_file()):
            sources.append({'path': str(source.relative_to(project)), 'sha256': sha(source)})
    record = {'unit': number, 'slug': unit['slug'], 'files': copied, 'file_sha256': hashes,
              'sources': sources, 'created_at': time.strftime('%Y-%m-%dT%H:%M:%S%z')}
    marker.parent.mkdir(parents=True, exist_ok=True)
    save(marker, record)
    return record


def _research_counts(queue):
    found = retained = rows = 0
    approved = []
    approved.extend((_unit_id(n), None) for n in queue.get('preserved_ready', []))
    approved.extend((u['unit'], u.get('build_record')) for u in queue['units']
                    if u['status'] == 'awaiting_final_review')
    old_base = HANDOFF / 'history' / 'before-luna'
    for number, build_record in approved:
        preserved = number in {_unit_id(n) for n in queue.get('preserved_ready', [])}
        state_path = (old_base / f'part-{number:03}' / 'state.json') if preserved else (
            RUN / f'part-{number:03}' / 'state.json')
        try:
            state = read(state_path)
        except (OSError, ValueError):
            continue
        if state.get('status') != 'awaiting_final_review':
            continue
        path = _project(number) / 'data/collections/research.json'
        if not path.is_file() or sha(path) != state.get('research_sha256'):
            continue
        if not path.is_file():
            continue
        records = read(path).get('leaf_cases', [])
        for row in records:
            rows += 1
            if row.get('assessment') == 'case_found' and row.get('case_ids'):
                found += 1
            else:
                retained += 1
    return found, retained, rows


def _refresh_status(queue):
    units = queue['units']
    ready_old = [_unit_id(x) for x in queue.get('preserved_ready', [])]
    held_old = [_unit_id(x) for x in queue.get('preserved_held', [])]
    ready_new = [u['unit'] for u in units if u['status'] == 'awaiting_final_review']
    held_new = [u['unit'] for u in units if u['status'] == 'needs_attention']
    active_builders = sorted({u['agent'] for u in units if u['status'] == 'building' and u.get('agent')})
    active_reviewers = sorted({u['agent'] for u in units if u['status'] == 'reviewing' and u.get('agent')})
    found, retained, rows = _research_counts(queue)
    ended = (RUN / 'directory-ended.json').is_file()
    summary = {'model': 'gpt-6-luna', 'backend': 'codex_app_subagents', 'concurrency': 3,
               'requested_concurrency': 4, 'phase': 'finished' if ended else 'directory',
               'total_units': 252, 'total_parts': 252,
               'processed_units': len(ready_old) + len(held_old) + len(ready_new) + len(held_new),
               'processed_parts': len(ready_old) + len(held_old) + len(ready_new) + len(held_new),
               'awaiting_final_review': len(ready_old) + len(ready_new),
               'needs_attention': len(held_old) + len(held_new),
               'preserved_ready': ready_old, 'preserved_held': held_old,
               'new_ready': sorted(ready_new), 'new_held': sorted(held_new),
               'active_builders': active_builders, 'active_reviewers': active_reviewers,
               'active_parts': sorted(u['unit'] for u in units if u['status'] in {'building', 'reviewing'}),
               'stopped': False, 'retained_outside_queue': 5,
               'case_found': found, 'retained': retained, 'research_rows_counted': rows,
               'queue_finished': ended, 'published': False,
               'updated_at': time.strftime('%Y-%m-%dT%H:%M:%S%z')}
    save(RUN / 'status.json', summary)
    return summary


def _finalize_if_complete(queue):
    preserved_ready = {_unit_id(x) for x in queue.get('preserved_ready', [])}
    preserved_held = {_unit_id(x) for x in queue.get('preserved_held', [])}
    new_terminal = {u['unit'] for u in queue['units'] if u['status'] in TERMINAL}
    all_ids = preserved_ready | preserved_held | {u['unit'] for u in queue['units']}
    new_ids = {u['unit'] for u in queue['units']}
    if (len(queue['units']) != 137 or len(preserved_ready) != 98 or len(preserved_held) != 17
            or preserved_ready & preserved_held or all_ids != set(range(1, 253))
            or (preserved_ready | preserved_held) & new_ids
            or new_terminal != new_ids):
        return False
    if any(u['status'] not in TERMINAL for u in queue['units']):
        return False
    if not _verify_preserved(queue):
        return False
    report = {'units': list(range(1, 253)), 'ready': sorted(preserved_ready | {
                u['unit'] for u in queue['units'] if u['status'] == 'awaiting_final_review'}),
              'held': sorted(preserved_held | {u['unit'] for u in queue['units']
                                                   if u['status'] == 'needs_attention'}),
              'phase': 'finished', 'queue_finished': True,
              'ended_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'published': False}
    save(RUN / 'directory-ended.json', report)
    return True


def _verify_preserved(queue):
    snapshot_root = HANDOFF / 'history' / 'before-luna'
    ready = {_unit_id(x) for x in queue.get('preserved_ready', [])}
    held = {_unit_id(x) for x in queue.get('preserved_held', [])}
    if ready & held:
        return False
    for number, expected in [(n, 'awaiting_final_review') for n in ready] + [
            (n, 'needs_attention') for n in held]:
        frozen = snapshot_root / f'part-{number:03}' / 'state.json'
        current = RUN / f'part-{number:03}' / 'state.json'
        if not frozen.is_file() or not current.is_file() or sha(frozen) != sha(current):
            return False
        state = read(frozen)
        if state.get('status') != expected:
            return False
        if expected == 'awaiting_final_review':
            checked = workflow.validate(_project(number))
            if any(state.get(k) != checked.get(k)
                   for k in ('batch_sha256', 'research_sha256', 'input_sha256')):
                return False
    return True


def _work_remaining(queue):
    return any(u['status'] not in TERMINAL for u in queue['units'])


def claim(role, agent):
    if role not in {'build', 'review'}:
        raise QueueError('role must be build or review')
    with locked():
        queue, manifest = _load()
        if agent not in queue['allowed_agents'][role]:
            raise QueueError(f'{agent} is not allowed for {role}')
        active_status = 'building' if role == 'build' else 'reviewing'
        if any(u.get('agent') == agent and u.get('status') == active_status for u in queue['units']):
            raise QueueError(f'{agent} already owns an active {role} unit')
        prompt_path, prompt_sha = _agent_assignment(manifest, agent, role)
        eligible = {'build': {'pending', 'repair_pending'},
                    'review': {'awaiting_review'}}[role]
        unit = next((u for u in sorted(queue['units'], key=lambda x: x['unit'])
                     if u['status'] in eligible), None)
        if unit is None:
            summary = _refresh_status(queue)
            return {'work_remaining': _work_remaining(queue), 'unit': None, 'status': summary}
        if role == 'build':
            backup = _backup_first_build(unit)
            # The historical review is preserved in the backup, but it cannot
            # be mistaken for the independent review of this newly built draft.
            (_project(unit['unit']) / 'review.json').unlink(missing_ok=True)
            unit['attempt'] = int(unit.get('attempt', 0)) + 1
            unit['status'] = 'building'
        else:
            backup = None
            unit['status'] = 'reviewing'
        unit['agent'] = agent
        unit['agent_assignment_path'] = prompt_path
        unit['agent_assignment_sha256'] = prompt_sha
        unit['claimed_at'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        assignment_path, assignment_sha = _assignment(queue, unit)
        unit['assigned_input_path'] = str(assignment_path)
        unit['assigned_input_sha256'] = assignment_sha
        if role == 'build':
            _record_state(unit, {'part': unit['unit'], 'status': 'running', 'phase': 'directory',
                         'model': queue['model'], 'backend': 'codex_app_subagents',
                         'agent': agent, 'attempt': unit['attempt'], 'archived': False,
                         'input_path': str(assignment_path), 'input_sha256': assignment_sha})
        save(QUEUE, queue)
        summary = _refresh_status(queue)
        return {'work_remaining': True, 'unit': {**unit, 'role': role,
                'project': str(_project(unit['unit'])), 'assignment_path': str(assignment_path),
                'assignment_sha256': assignment_sha, 'agent_prompt_path': prompt_path,
                'agent_prompt_sha256': prompt_sha, 'history_backup': backup}, 'status': summary}


def build_complete(number, agent):
    with locked():
        queue, manifest = _load()
        unit = _find_unit(queue, number)
        _assert_owner(unit, 'building', agent, queue, 'build')
        assignment_path, assignment_sha = _assignment(queue, unit)
        if (unit.get('assigned_input_path') != str(assignment_path)
                or unit.get('assigned_input_sha256') != assignment_sha):
            raise QueueError('assigned input differs from the claimed input')
        project = _project(number)
        checked = workflow.validate(project)
        if checked.get('targets') != 1 or workflow.read(project/'input.json')['leaves'][0]['progress']['slug'] != unit['slug']:
            raise QueueError('validated project does not contain exactly the assigned leaf')
        assigned = read(assignment_path)
        if assigned.get('input_sha256') != checked.get('input_sha256'):
            raise QueueError('validated input SHA does not match the assignment input SHA')
        prompt_path, prompt_sha = _agent_assignment(manifest, agent, 'build')
        record = {'unit': number, 'slug': unit['slug'], 'status': 'awaiting_review',
                  'batch_sha256': checked['batch_sha256'], 'research_sha256': checked['research_sha256'],
                  'input_sha256': checked['input_sha256'], 'assigned_input_path': str(assignment_path),
                  'assigned_input_sha256': assignment_sha, 'agent': agent, 'attempt': unit['attempt'],
                  'agent_assignment_path': prompt_path, 'agent_assignment_sha256': prompt_sha,
                  'engine_backend': 'codex_app_subagent', 'model_binding': manifest['model_binding'],
                  'model': queue['model'], 'published': False, 'archived': False}
        unit.update(status='awaiting_review', build_record=record, completed_at=time.strftime('%Y-%m-%dT%H:%M:%S%z'))
        _record_state(unit, {'part': number, 'status': 'awaiting_review', **record})
        save(QUEUE, queue)
        return {'unit': unit, 'status': _refresh_status(queue)}


def review_complete(number, agent, report_path):
    with locked():
        queue, manifest = _load()
        unit = _find_unit(queue, number)
        _assert_owner(unit, 'reviewing', agent, queue, 'review')
        project = _project(number)
        before = workflow.validate(project)
        _assert_built_bytes(unit, before)
        input_data = workflow.read(project/'input.json')
        slug = unit['slug']
        targets = [leaf['progress']['slug'] for leaf in input_data['leaves']]
        if targets != [slug]:
            raise QueueError('review input is not the unit\'s single assigned leaf')
        assignment_path, assignment_sha = _assignment(queue, unit)
        assigned = read(assignment_path)
        if assigned.get('input_sha256') != before.get('input_sha256'):
            raise QueueError('review input SHA does not match the assigned input SHA')
        supplied = Path(report_path).resolve()
        reports_root = (HANDOFF/'reports').resolve()
        if not supplied.is_relative_to(reports_root) or not supplied.is_file():
            raise QueueError('review report must be a file under luna-handoff/reports')
        before_sha = sha(supplied)
        raw = supplied.read_bytes()
        after_sha = sha(supplied)
        if before_sha != after_sha:
            raise QueueError('review report changed while being read')
        try:
            report = json.loads(raw)
        except ValueError as exc:
            raise QueueError('review report is not valid JSON') from exc
        _validate_report(report, slug)
        after = workflow.validate(project)
        if after != before:
            raise QueueError('batch/research/input changed during independent review')
        if after.get('input_sha256') != assigned.get('input_sha256'):
            raise QueueError('review changed the assignment-bound input SHA')
        prompt_path, prompt_sha = _agent_assignment(manifest, agent, 'review')
        result = {'unit': number, 'slug': slug, 'decision': report['decision'],
                  'report_path': str(supplied), 'report_sha256': before_sha,
                  'batch_sha256': before['batch_sha256'], 'research_sha256': before['research_sha256'],
                  'input_sha256': before['input_sha256'], 'review_agent': agent,
                  'review_assignment_path': prompt_path, 'review_assignment_sha256': prompt_sha,
                  'engine_backend': 'codex_app_subagent', 'model_binding': manifest['model_binding'],
                  'model': queue['model'], 'independent_review_session': True,
                  'published': False, 'archived': False}
        immutable = HANDOFF / 'reports' / f'part-{number:03}-attempt-{unit["attempt"]}-{before_sha}.json'
        if immutable.exists() and sha(immutable) != before_sha:
            raise QueueError('immutable report destination already exists with different bytes')
        if not immutable.exists():
            immutable.write_bytes(raw)
        if sha(immutable) != before_sha:
            raise QueueError('immutable report copy failed SHA verification')
        result['report_path'] = str(immutable)
        unit['review_record'] = result
        if report['decision'] == 'content_review_passed':
            unit['status'] = 'awaiting_final_review'
            state = {'part': number, 'status': unit['status'], **result,
                     'review_protocol': queue['protocol'], 'review': report}
        elif unit['attempt'] < 2:
            unit['status'] = 'repair_pending'
            findings = report['findings']
            workflow.save(project/'issues.json', {'findings': findings,
                           'review_protocol': queue['protocol'], 'report_path': str(supplied),
                           'report_sha256': before_sha, 'batch_sha256': before['batch_sha256'],
                           'research_sha256': before['research_sha256'],
                           'input_sha256': before['input_sha256'], 'previous_review_is_approval': False})
            state = {'part': number, 'status': 'repair_pending', **result,
                     'reason': 'independent review requested one bounded repair'}
        else:
            unit['status'] = 'needs_attention'
            unit['reason'] = 'bounded corrections exhausted'
            state = {'part': number, 'status': unit['status'], **result,
                     'reason': 'bounded corrections exhausted', 'archived': False}
        unit.pop('agent', None)
        _record_state(unit, state)
        save(QUEUE, queue)
        _finalize_if_complete(queue)
        return {'unit': unit, 'status': _refresh_status(queue)}


def hold(number, agent, reason):
    with locked():
        queue, manifest = _load()
        unit = _find_unit(queue, number)
        if not reason.strip():
            raise QueueError('hold reason must be nonempty')
        role = 'build' if unit.get('agent') in queue['allowed_agents']['build'] else 'review'
        if unit.get('agent') != agent or unit.get('status') not in {'building', 'reviewing', 'repair_pending', 'pending'}:
            raise QueueError(f'{agent} does not own active unit {number}')
        _agent_assignment(manifest, agent, role)
        unit.update(status='needs_attention', reason=reason, agent=agent, archived=False,
                    held_at=time.strftime('%Y-%m-%dT%H:%M:%S%z'))
        _record_state(unit, {'part': number, 'status': 'needs_attention', 'reason': reason,
                     'agent': agent, 'model': queue['model'], 'backend': 'codex_app_subagents',
                     'archived': False, 'published': False})
        save(QUEUE, queue)
        _finalize_if_complete(queue)
        return {'unit': unit, 'status': _refresh_status(queue)}


def _find_unit(queue, number):
    for unit in queue['units']:
        if unit['unit'] == number:
            return unit
    raise QueueError(f'unknown unit {number}')


def _assert_owner(unit, status, agent, queue, role):
    if unit.get('status') != status or unit.get('agent') != agent:
        raise QueueError(f'{agent} does not own unit {unit["unit"]} in {status} state')
    if agent not in queue['allowed_agents'][role]:
        raise QueueError(f'{agent} is not an allowed {role} agent')


def _assert_built_bytes(unit, checked):
    built = unit.get('build_record')
    if not isinstance(built, dict):
        raise QueueError('unit has no successful build receipt')
    for key in ('batch_sha256', 'research_sha256', 'input_sha256'):
        if built.get(key) != checked.get(key):
            raise QueueError(f'{key} changed since build completion')


def _validate_report(report, slug):
    if not isinstance(report, dict) or set(report) != REPORT_KEYS:
        raise QueueError('review report must contain exactly decision/findings/non_blocking_notes/leaf_checks/limits')
    if report['decision'] not in {'content_review_passed', 'changes_required'}:
        raise QueueError('review report has invalid decision')
    findings = report['findings']
    if not isinstance(findings, list) or not all(isinstance(x, (str, dict)) and bool(x) for x in findings):
        raise QueueError('review findings must be a list of nonempty strings or objects')
    if report['decision'] == 'content_review_passed' and findings:
        raise QueueError('passing review cannot contain blocking findings')
    if report['decision'] == 'changes_required' and not findings:
        raise QueueError('changes_required needs at least one blocking finding')
    if not isinstance(report['non_blocking_notes'], (str, list)) or not isinstance(report['limits'], (str, list)):
        raise QueueError('non_blocking_notes and limits must be text or lists')
    checks = report['leaf_checks']
    if not isinstance(checks, dict) or set(checks) != {slug}:
        raise QueueError('leaf_checks must contain exactly the assigned slug')
    if not isinstance(checks[slug], (str, dict)) or not checks[slug]:
        raise QueueError('leaf_checks entry must be nonempty')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    c = sub.add_parser('claim'); c.add_argument('--role', choices=['build', 'review'], required=True); c.add_argument('--agent', required=True)
    c = sub.add_parser('build-complete'); c.add_argument('--unit', type=int, required=True); c.add_argument('--agent', required=True)
    c = sub.add_parser('review-complete'); c.add_argument('--unit', type=int, required=True); c.add_argument('--agent', required=True); c.add_argument('--report', required=True)
    c = sub.add_parser('hold'); c.add_argument('--unit', type=int, required=True); c.add_argument('--agent', required=True); c.add_argument('--reason', required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'claim': result = claim(args.role, args.agent)
        elif args.command == 'build-complete': result = build_complete(args.unit, args.agent)
        elif args.command == 'review-complete': result = review_complete(args.unit, args.agent, args.report)
        else: result = hold(args.unit, args.agent, args.reason)
    except (QueueError, AssertionError, OSError, ValueError, KeyError) as exc:
        print(json.dumps({'error': str(exc), 'work_remaining': True}, ensure_ascii=False), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
