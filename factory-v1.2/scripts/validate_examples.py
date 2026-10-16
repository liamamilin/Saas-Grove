#!/usr/bin/env python3
"""Validates Factory V1.2 JSON specimens + cross-object policy invariants.

This is NOT real artifact certification. It only proves the specification
examples and the reference rules are self-consistent. No build, security scan,
license decision or signature is performed here.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

from validate_attestation import check_attestation, verify_shape
from factory_rules import (
    check_batch_plan,
    check_catalog_dependency_gating,
    check_origin_strategy,
    check_state_transition,
    check_use_policy,
    verify_digest_chain,
    verify_payload_purity,
)

ROOT = Path(__file__).resolve().parent.parent
NOW = datetime(2026, 10, 16, 0, 0, 0, tzinfo=timezone.utc)

CANONICAL = {
    'production-catalog': 'production_catalog',
    'resource-manifest': 'resource_manifest',
    'evidence': 'evidence',
    'batch-plan': 'batch_plan',
    'gate-profile': 'gate_profile',
    'scoped-attestation': 'scoped_attestation',
    'artifact-freeze': 'artifact_freeze',
    'resource-state': 'resource_state',
    'deployment-eligibility-decision': 'deployment_eligibility_decision',
    'state-transition': 'state_transition',
    'production-job': 'production_job',
    'scope-definition': 'scope_definition',
    'change-impact-record': 'change_impact_record',
    'acceptance-report': 'acceptance_report',
}


def read(p):
    return json.loads(p.read_text(encoding='utf-8'))


def check(data, schema):
    issues = verify_shape(data, schema)
    if issues:
        raise AssertionError(f'{schema}: ' + '; '.join(issues))


def main():
    for schema, ex in CANONICAL.items():
        check(read(ROOT / 'examples' / f'{ex}.json'), f'{schema}.schema.json')
        print('PASS shape', ex)

    active_att = read(ROOT / 'examples/scoped_attestation_active.json')
    check(active_att, 'scoped-attestation.schema.json')
    print('PASS shape scoped_attestation_active')

    chain = read(ROOT / 'examples/evidence_chain_l1.json')
    assert isinstance(chain, list) and len(chain) == 7, 'expected 7 demo evidence records'
    for ev in chain:
        check(ev, 'evidence.schema.json')
    print('PASS shape evidence_chain_l1 (7 records)')

    file_manifest = read(ROOT / 'FILE_MANIFEST.json')
    check(file_manifest, 'file-manifest.schema.json')
    print('PASS shape FILE_MANIFEST (canonical path keys)')

    catalog = read(ROOT / 'examples/production_catalog.json')
    batch = read(ROOT / 'examples/batch_plan.json')
    manifest = read(ROOT / 'examples/resource_manifest.json')
    freeze = read(ROOT / 'examples/artifact_freeze.json')
    state = read(ROOT / 'examples/resource_state.json')
    decision = read(ROOT / 'examples/deployment_eligibility_decision.json')
    transition = read(ROOT / 'examples/state_transition.json')
    draft_att = read(ROOT / 'examples/scoped_attestation.json')
    profile = read(ROOT / 'examples/gate_profile.json')
    demo_evidence = read(ROOT / 'examples/evidence.json')

    # --- V1.1 cross-object invariants (adapted) ---
    ids = [t['id'] for t in catalog['targets']]
    assert len(ids) == len(set(ids)), 'duplicate catalog target ids'
    assert all(x in ids for x in batch['targetIds']), 'batch references unknown target'
    assert batch['catalogRevision'] == catalog['catalogRevision'], 'batch/catalog revision mismatch'
    assert batch['executionMode'] == 'READ_ONLY' and batch['dryRun'], 'sample batch must be read-only dry run'
    assert all(d in ids for t in catalog['targets'] for d in t.get('dependencies', [])), 'unknown internal dependency'
    assert demo_evidence['result'] == 'NOT_RUN' and demo_evidence['artifactSha256'] == 'UNBUILT'
    assert any(d['status'] == 'UNVERIFIED' for t in catalog['targets'] for d in t.get('externalDependencies', []))
    print('PASS cross-object sample invariants (no real source/build verified)')

    # --- CF-1: documented catalog fields are schema-valid ---
    crm = next(t for t in catalog['targets'] if t['id'] == 'business.crm')
    assert crm['constraints']['stack'] and crm['batchTags'] and crm['selectionPolicy']['mode']
    print('PASS CF-1 target with constraints/batchTags/selectionPolicy validates')

    # --- CF-2 batch rules ---
    assert check_batch_plan(batch) == [], check_batch_plan(batch)
    assert check_catalog_dependency_gating(catalog, batch) == []
    print('PASS CF-2 batch plan risk/retry/approval/audit fields valid (READ_ONLY)')

    # --- CF-3 conditional gates encodable ---
    assert profile['conditional'], 'gate profile must encode conditional gates'
    print('PASS CF-3 GateProfile with conditional[]/validationMethod/expiryPolicy/owner validates')

    # --- CF-5 payload purity + digest chain ---
    purity = verify_payload_purity(manifest)
    assert purity == [], purity
    origin_issues = check_origin_strategy(manifest)
    assert origin_issues == ['REUSE license does not permit the intended distribution: BLOCKED, never auto-PASS'], origin_issues
    chain_issues = verify_digest_chain(freeze, state, attestation=active_att, evidences=chain)
    assert chain_issues == [], chain_issues
    print('PASS CF-5 payload manifest embeds no certification refs; digest chain consistent')

    # --- CF-4 usePolicy single source of truth ---
    use_issues = check_use_policy(decision, state)
    assert use_issues == [], use_issues
    print('PASS CF-4 resource-state carries no usePolicy; decision binds to the same digest')

    # --- CF-7 canonical transition role ---
    assert check_state_transition(transition) == [], check_state_transition(transition)
    print('PASS CF-7 state-transition uses canonical roles')

    # --- negative: the DRAFT/unbuilt sample attestation is blocked ---
    draft_state, draft_reasons = check_attestation(draft_att, profile, [demo_evidence], now=NOW)
    assert draft_state == 'BLOCKED', (draft_state, draft_reasons)
    print('PASS negative: DRAFT/unbuilt sample attestation is blocked')

    # --- positive: the demo L1 chain is metadata-consistent (still not a certification) ---
    active_state, active_reasons = check_attestation(active_att, profile, chain, now=NOW, freeze=freeze, state=state)
    assert active_state == 'METADATA_CONSISTENT', (active_state, active_reasons)
    print('PASS positive: demo L1 digest-chain attestation is METADATA_CONSISTENT (synthetic only)')

    print('Only metadata and synthetic policy tested. NO build, security, legal or signature claim is certified.')


if __name__ == '__main__':
    main()
