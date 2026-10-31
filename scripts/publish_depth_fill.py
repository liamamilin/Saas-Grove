#!/usr/bin/env python3
"""Publish reviewed depth-fill units into the formal catalog. Rehearsal by default.

    python3 -B scripts/publish_depth_fill.py --units 1            # rehearse on a copy, write nothing formal
    python3 -B scripts/publish_depth_fill.py --units 1 --apply    # back up, import, export catalog.sql and snapshot

Existing products only gain the new type link and its sources: before import their incoming entry is
rebuilt from the current formal record, so server.case_collection._merge_entry cannot overwrite core fields.
"""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT/'scripts'))
from server.case_collection import import_batch  # noqa: E402
import fill_type_depth as depth  # noqa: E402

COLLECTIONS = ROOT/'data/collections'
# Main-session final review: entries held back from publication, and which unit's core fields win when two units add one product.
DECISIONS = COLLECTIONS/'depth-fill-20261031-decisions.json'
DATABASE = ROOT/'var/catalog.sqlite'
HEADER = '-- Reviewed SaaS Grove catalog. Restore into a NEW empty database only.\n'


def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()


def rows(path):
    con = sqlite3.connect(path)
    try:
        apps = {r[0]: json.loads(r[1]) for r in con.execute('select id,data from application')}
        tracks = set(con.execute('select app_id,track from application_track'))
        links = set(con.execute('select leaf,app_id from leaf_application'))
    finally:
        con.close()
    return apps, tracks, links


def reviewed_units(numbers):
    plan = depth.read(depth.PLAN)
    decisions = depth.read(DECISIONS) if DECISIONS.exists() else {'exclude': {}, 'core_from': {}}
    units = []
    for number in numbers:
        part = depth.RUN/f'part-{number:03}'
        state = depth.read(part/'state.json')
        assert state['status'] != 'published', f'unit {number} was already published in {state.get("published_in")}'
        checked = depth.depth_validate(part/'project')
        review = depth.read(part/'project/review.json')
        assert all(review[k] == checked[k] for k in ['batch_sha256', 'research_sha256', 'input_sha256']), f'unit {number} changed after review'
        if state['status'] == 'awaiting_final_review':
            assert all(state[k] == checked[k] for k in ['batch_sha256', 'research_sha256', 'input_sha256']), f'unit {number} changed after review'
            assert review['decision'] == 'content_review_passed' and not review.get('findings')
        else:  # the final review may publish the rest of a unit once every entry the review flagged is held back
            held_back = decisions['exclude'].get(str(number), {})
            assert state['status'] == 'needs_attention' and review['decision'] == 'changes_required', f'unit {number} is not ready: {state["status"]}'
            assert all(f.get('application_id') in held_back for f in review['findings']), f'unit {number} has review findings that are not held back'
            state = {**state, **checked}
        units.append((plan['units'][number - 1], part/'project', state))
    return units


def build_batch(units, current):
    """One batch for the chosen units; relation entries carry the current record plus new links/sources only."""
    decisions = depth.read(DECISIONS) if DECISIONS.exists() else {'exclude': {}, 'core_from': {}}
    entries, research, snapshots, relation_ids = {}, [], {}, set()
    for unit, project, _state in units:
        held_back = decisions['exclude'].get(str(unit['unit']), {})
        for entry in depth.read(project/'data/collections/batch.json')['entries']:
            if entry['id'] in held_back:
                continue
            for source in entry['sources']:
                snapshots[source['sha256']] = project/'data/collections'/source['snapshot_path']
            if entry['id'] in current:
                base = copy.deepcopy(current[entry['id']])
                base['leaf_matches'], base['sources'] = entry['leaf_matches'], entry['sources']
                entry = base
                relation_ids.add(entry['id'])
            if entry['id'] in entries:  # the same product found by two units: union its links and sources
                held = entries[entry['id']]
                differ = sorted(k for k in set(held) | set(entry) if k not in {'leaf_matches', 'sources', '_unit'} and held.get(k) != entry.get(k))
                winner = decisions['core_from'].get(entry['id'])
                assert not differ or winner in {held['_unit'], unit['unit']}, f"{entry['id']} differs between units in {differ}; settle it before publishing"
                if differ and winner == unit['unit']:
                    held.update({k: v for k, v in entry.items() if k not in {'leaf_matches', 'sources'}})
                held['leaf_matches'] += entry['leaf_matches']
                keys = {(x['url'], x['sha256']) for x in held['sources']}
                held['sources'] += [x for x in entry['sources'] if (x['url'], x['sha256']) not in keys]
            else:
                entries[entry['id']] = {**entry, '_unit': unit['unit']}
        for case in depth.read(project/'data/collections/research.json')['leaf_cases']:
            if held_back:
                case = {**case, 'case_ids': [i for i in case['case_ids'] if i not in held_back],
                        'final_review_held_back': held_back}
            research.append(case)
    for entry in entries.values():
        entry.pop('_unit')
    seen = {}
    for entry in entries.values():  # one product created by two units under different IDs
        if entry['id'] in relation_ids:
            continue
        keys = {('name', entry['name'].casefold())} | {('url', u.split('://')[-1].removeprefix('www.').rstrip('/').removesuffix('.git').lower())
                                                       for u in [entry.get('repository_url'), entry.get('homepage')] if u}
        for key in keys:
            assert seen.setdefault(key, entry['id']) == entry['id'], f"{entry['id']} and {seen[key]} look like one product ({key}); settle it before publishing"
    for entry in entries.values():  # the order _merge_entry produces, so a re-import changes nothing
        entry['sources'] = sorted(entry['sources'], key=lambda s: (s['url'], s['sha256']))
        entry['leaf_matches'] = sorted(({**m, 'source_urls': sorted(set(m['source_urls']))} for m in entry['leaf_matches']), key=lambda m: m['slug'])
    batch_id = 'depth-fill-20261031-u' + '-'.join(f"{u['unit']:03}" for u, _, _ in units)
    return {'schema_version': 1, 'batch_id': batch_id, 'entries': list(entries.values())}, research, snapshots, relation_ids


def check_import(before, after, batch, relation_ids):
    """Old rows unchanged apart from relation merges; exactly the expected rows and links added."""
    (apps0, tracks0, links0), (apps1, tracks1, links1) = before, after
    new_ids = {e['id'] for e in batch['entries']} - relation_ids
    assert set(apps1) == set(apps0) | new_ids and not (new_ids & set(apps0))
    for app_id, old in apps0.items():
        if app_id in relation_ids:
            changed = {k for k in set(old) | set(apps1[app_id]) if old.get(k) != apps1[app_id].get(k)}
            assert changed <= {'leaf_matches', 'sources'}, f'{app_id} core fields changed: {changed}'
            new = {m['slug']: m for m in apps1[app_id]['leaf_matches']}
            assert all(new.get(m['slug']) == m for m in old.get('leaf_matches', [])), f'{app_id} old type links changed'
        else:
            assert apps1[app_id] == old, f'{app_id} changed without being in the batch'
    expected_links = {(m['slug'], e['id']) for e in batch['entries'] for m in e['leaf_matches']}
    assert links0 <= links1 and links1 - links0 == expected_links - links0
    assert tracks0 <= tracks1 and {a for a, _ in tracks1 - tracks0} == new_ids
    return {'applications_before': len(apps0), 'applications_after': len(apps1), 'new_applications': sorted(new_ids),
            'relation_only_applications': sorted(relation_ids), 'links_before': len(links0), 'links_after': len(links1),
            'links_added': len(links1 - links0)}


def stage_sources(snapshots, root):
    (root/'sources').mkdir(parents=True, exist_ok=True)
    for digest, path in snapshots.items():
        assert sha_bytes(path.read_bytes()) == digest, f'{path} does not match its sha256'
        target = root/'sources'/f'{digest}.txt'
        if target.exists():
            assert sha_bytes(target.read_bytes()) == digest
        else:
            shutil.copy2(path, target)


def write_atomic(path, text):
    temp = path.with_name(f'.{path.name}.tmp')
    temp.write_text(text)
    temp.replace(path)


def export_catalog(database):
    con = sqlite3.connect(database)
    try:
        text = HEADER + '\n'.join(con.iterdump()) + '\n'
        integrity = con.execute('pragma integrity_check').fetchone()[0]
    finally:
        con.close()
    with tempfile.TemporaryDirectory() as directory:
        restored = Path(directory)/'restored.sqlite'
        con = sqlite3.connect(restored)
        con.executescript(text)
        con.close()
        identical = rows(restored) == rows(database)
    return text, integrity, identical


def covered_included(links):
    taxonomy = depth.read(ROOT/'data/taxonomy/catalog.json')
    included = {leaf['slug'] for leaf in taxonomy['leaves'] if leaf['scope'] == 'included'}
    return len(included & {leaf for leaf, _ in links}), len(included)


def write_snapshot(final, text, integrity, identical, report_path, stamp):
    covered, included = covered_included(final[2])
    tracks = {}
    for _, track in final[1]:
        tracks[track] = tracks.get(track, 0) + 1
    snapshot = {'schema_version': 1, 'generated_at': stamp, 'file': 'catalog.sql', 'sha256': sha_bytes(text.encode()),
                'applications': len(final[0]), 'tracks': dict(sorted(tracks.items(), reverse=True)), 'leaf_links': len(final[2]),
                'included_covered_leaves': covered, 'included_total': included,
                'source_report': str(report_path.relative_to(ROOT/'data')), 'round_trip_rows_identical': identical,
                'sqlite_integrity': integrity, 'restore_only_into_empty_database': True}
    write_atomic(ROOT/'data/catalog-snapshot.json', json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
    return snapshot


def withdraw(app_id, reason):
    """Take back a product this run published (final review found it wrong); backup first, nothing else changes."""
    counts, catalog_sha = depth.published_baseline()
    assert depth.catalog_counts() == counts and sha_bytes((ROOT/'data/catalog.sql').read_bytes()) == catalog_sha
    published = [depth.read(p) for p in sorted(COLLECTIONS.glob(f'{depth.RUN.name}-u*-report.json'))]
    owner = [r for r in published if r.get('published') and app_id in r.get('rehearsal', {}).get('new_applications', [])]
    assert owner, f'{app_id} was not added by this run'
    safe = app_id.replace(':', '_')
    report_path = COLLECTIONS/f'{depth.RUN.name}-u-withdraw-{safe}-report.json'
    backup = depth.RUN/f'catalog.before-withdraw-{safe}.sqlite'
    assert not report_path.exists() and not backup.exists(), f'{app_id} was already withdrawn'
    before = rows(DATABASE)
    src, dst = sqlite3.connect(DATABASE), sqlite3.connect(backup)
    src.backup(dst)
    src.close()
    dst.close()
    assert rows(backup) == before
    con = sqlite3.connect(DATABASE)
    try:
        with con:
            for table, column in [('leaf_application', 'app_id'), ('application_track', 'app_id'), ('application', 'id')]:
                con.execute(f'delete from {table} where {column}=?', (app_id,))
    finally:
        con.close()
    final = rows(DATABASE)
    assert set(final[0]) == set(before[0]) - {app_id} and all(final[0][k] == v for k, v in before[0].items() if k != app_id)
    assert final[2] == {l for l in before[2] if l[1] != app_id} and final[1] == {t for t in before[1] if t[0] != app_id}
    text, integrity, identical = export_catalog(DATABASE)
    assert integrity == 'ok' and identical
    write_atomic(ROOT/'data/catalog.sql', text)
    stamp = datetime.now(timezone.utc).isoformat(timespec='seconds')
    snapshot = write_snapshot(final, text, integrity, identical, report_path, stamp)
    depth.save(report_path, {'batch_id': report_path.stem.removesuffix('-report'), 'published': True, 'withdrawn': app_id, 'reason': reason,
                             'added_in': owner[0]['batch_id'], 'withdrawn_record': before[0][app_id],
                             'links_removed': sorted(l[0] for l in before[2] if l[1] == app_id), 'withdrawn_at': stamp,
                             'backup': str(backup.relative_to(ROOT)), 'backup_sha256': depth.sha(backup), 'snapshot': snapshot})
    print(json.dumps({'withdrawn': app_id, 'applications': snapshot['applications'], 'leaf_links': snapshot['leaf_links'],
                      'catalog_sql_sha256': snapshot['sha256']}, ensure_ascii=False))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--units', type=int, nargs='+')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--withdraw', metavar='APP_ID', help='take back one product this run published')
    parser.add_argument('--reason')
    args = parser.parse_args()
    depth.engine.RUN = depth.workflow.RUN = depth.RUN
    if args.withdraw:
        assert args.reason, '--withdraw needs --reason'
        return withdraw(args.withdraw, args.reason)
    assert args.units, '--units is required'
    units = reviewed_units(args.units)
    counts, catalog_sha = depth.published_baseline()
    assert depth.catalog_counts() == counts and sha_bytes((ROOT/'data/catalog.sql').read_bytes()) == catalog_sha, 'formal catalog is not the last published state'
    before = rows(DATABASE)
    batch, research, snapshots, relation_ids = build_batch(units, before[0])
    stamp = datetime.now(timezone.utc).isoformat(timespec='seconds')

    # Rehearsal: a copy of the formal database and a private source root, so no formal receipt is written.
    rehearsal = depth.RUN/'rehearsal'
    shutil.rmtree(rehearsal, ignore_errors=True)
    rehearsal.mkdir(parents=True)
    shutil.copy2(DATABASE, rehearsal/'catalog.sqlite')
    stage_sources(snapshots, rehearsal)
    depth.save(rehearsal/'batch.json', batch)
    first = import_batch(rehearsal/'batch.json', rehearsal/'catalog.sqlite', rehearsal, ROOT/'data/taxonomy/catalog.json')
    after = rows(rehearsal/'catalog.sqlite')
    summary = check_import(before, after, batch, relation_ids)
    again = import_batch(rehearsal/'batch.json', rehearsal/'catalog.sqlite', rehearsal, ROOT/'data/taxonomy/catalog.json')
    assert again['already_imported'] and again['counts']['leaf_links_added'] == 0 and rows(rehearsal/'catalog.sqlite') == after
    report = {'batch_id': batch['batch_id'], 'units': args.units, 'rehearsal': {**summary, 'first_receipt': first, 'reimport_idempotent': True},
              'rehearsed_at': stamp, 'published': False}
    depth.save(rehearsal/'rehearsal.json', report)
    print(json.dumps(summary, ensure_ascii=False))
    if not args.apply:
        print('演练通过，正式库未改动。确认后加 --apply。')
        return 0

    backup = depth.RUN/f'catalog.before-import-{batch["batch_id"]}.sqlite'
    # A second --apply would see every product as existing and overwrite the real pre-import backup.
    assert not (COLLECTIONS/'receipts'/f'{batch["batch_id"]}.json').exists() and not backup.exists(), f'{batch["batch_id"]} was already published'
    src, dst = sqlite3.connect(DATABASE), sqlite3.connect(backup)
    src.backup(dst)
    src.close()
    dst.close()
    assert rows(backup) == before
    batch_path = COLLECTIONS/f'{batch["batch_id"]}.json'
    depth.save(batch_path, batch)
    depth.save(COLLECTIONS/f'{batch["batch_id"]}-research.json', {'schema_version': 1, 'leaf_cases': research})
    stage_sources(snapshots, COLLECTIONS)
    receipt = import_batch(batch_path, DATABASE, COLLECTIONS, ROOT/'data/taxonomy/catalog.json')
    final = rows(DATABASE)
    assert final == after, 'formal import differs from the rehearsal'
    text, integrity, identical = export_catalog(DATABASE)
    assert integrity == 'ok' and identical
    write_atomic(ROOT/'data/catalog.sql', text)
    report_path = COLLECTIONS/f'{batch["batch_id"]}-report.json'
    snapshot = write_snapshot(final, text, integrity, identical, report_path, stamp)
    covered = snapshot['included_covered_leaves']
    report.update({'published': True, 'published_at': stamp, 'receipt': receipt, 'backup': str(backup.relative_to(ROOT)),
                   'backup_sha256': depth.sha(backup), 'snapshot': snapshot, 'old_products_core_preserved': True,
                   'third_party_runtime_tested': False, 'model': depth.MODEL,
                   'unit_states': {str(u['unit']): {k: s[k] for k in ['batch_sha256', 'research_sha256', 'input_sha256', 'dispositions', 'new_by_track']}
                                   for u, _, s in units},
                   'published_by_track': {t: sum(1 for e in batch['entries'] if e['id'] not in relation_ids and e['track'] == t) for t in ['open_source', 'commercial']}})
    depth.save(report_path, report)
    for unit, project, state in units:
        depth.save(project.parent/'state.json', {**state, 'status': 'published', 'published': True, 'published_in': report['batch_id']})
    print(json.dumps({'published': True, 'applications': snapshot['applications'], 'leaf_links': snapshot['leaf_links'],
                      'included_covered_leaves': covered, 'catalog_sql_sha256': snapshot['sha256']}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
