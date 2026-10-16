#!/usr/bin/env python3
"""Validates JSON specimen schemas + policy invariants; not real artifact certification."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
ROOT=Path(__file__).resolve().parent.parent
names={'production-catalog':'production_catalog','resource-manifest':'resource_manifest','evidence':'evidence','batch-plan':'batch_plan','gate-profile':'gate_profile','scoped-attestation':'scoped_attestation'}
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def check(data,schema):
    Draft202012Validator.check_schema(schema)
    issues=list(Draft202012Validator(schema,format_checker=FormatChecker()).iter_errors(data))
    if issues:raise AssertionError('; '.join(f'{list(x.path)}: {x.message}' for x in issues))
for schema,ex in names.items():
    check(read(ROOT/'examples'/f'{ex}.json'),read(ROOT/'schemas'/f'{schema}.schema.json'))
    print('PASS shape',ex)
catalog=read(ROOT/'examples/production_catalog.json');batch=read(ROOT/'examples/batch_plan.json');manifest=read(ROOT/'examples/resource_manifest.json');ev=read(ROOT/'examples/evidence.json')
ids=[t['id'] for t in catalog['targets']]
assert len(ids)==len(set(ids))
assert all(x in ids for x in batch['targetIds'])
assert batch['catalogRevision']==catalog['catalogRevision']
assert batch['executionMode']=='READ_ONLY' and batch['dryRun']
assert all(d in ids for t in catalog['targets'] for d in t.get('dependencies',[]))
assert manifest['qualityLevel']=='L0' and manifest['publicationStatus']=='PRIVATE' and manifest['usePolicy']=='RESEARCH_ONLY'
assert ev['result']=='NOT_RUN' and ev['artifactSha256']=='UNBUILT'
assert any(d['status']=='UNVERIFIED' for t in catalog['targets'] for d in t.get('externalDependencies',[]))
print('PASS cross-object sample invariants (no real source/build verified)')
from validate_attestation import check_attestation
state,reasons=check_attestation(read(ROOT/'examples/scoped_attestation.json'),read(ROOT/'examples/gate_profile.json'),[ev])
assert state=='BLOCKED', (state,reasons)
print('PASS negative: DRAFT/unbuilt sample attestation is blocked')
print('Only metadata and synthetic policy tested. NO build, security, or legal claim is certified.')
