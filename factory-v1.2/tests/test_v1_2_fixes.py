"""Factory V1.2 fix tests (ADR-Factory-001).

Positive tests prove that doc-conformant data which V1.1 rejected now validates.
Negative tests prove each named defect is truly closed. All fixtures are
synthetic: passing any of them is metadata self-consistency, never a commercial,
security or legal certification.
"""
import copy
import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

P = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(P / 'scripts'))
from validate_attestation import check_attestation, read_json, verify_shape
from factory_rules import (
    check_batch_plan,
    check_catalog_dependency_gating,
    check_installable,
    check_origin_strategy,
    check_state_transition,
    check_use_policy,
    verify_digest_chain,
    verify_payload_purity,
)

NOW = datetime(2026, 10, 16, 1, tzinfo=timezone.utc)
TS = lambda x: x.isoformat()
HEX_A = 'a' * 64
HEX_B = 'b' * 64
HEX_C = 'c' * 64
PM = 'd' * 64


def loaded(name):
    return read_json(P / 'examples' / name)


def build_chain(level='L1'):
    """Synthetic attestation + profile + evidence up to `level` (NOT a real certification)."""
    profile = loaded('gate_profile.json')
    att = loaded('scoped_attestation.json')
    att.update({'artifactSha256': HEX_A, 'attestationStatus': 'ACTIVE', 'attestedLevel': level,
                'freezeId': 'freeze.test-001', 'payloadManifestSha256': PM,
                'reviewerId': 'release-reviewer', 'reviewDecisionId': 'synthetic-review-not-real',
                'issuedAt': TS(NOW - timedelta(days=1)), 'expiresAt': TS(NOW + timedelta(days=1))})
    evidences = []
    upto = {'L1': 1, 'L2': 2, 'L3': 3}[level]
    for lvl in ('L1', 'L2', 'L3')[:upto]:
        for gate in profile['levels'][lvl]:
            role = 'LICENSE_REVIEWER' if gate == 'G-LICENSE' else 'SECURITY_REVIEWER' if gate == 'G-SECURITY' else 'INDEPENDENT_VALIDATOR'
            ev = {
                'schemaVersion': '1.2', 'id': 'synthetic-' + gate, 'subjectId': att['resourceId'], 'gateId': gate,
                'result': 'PASS', 'kind': 'LICENSE' if gate == 'G-LICENSE' else 'SECURITY' if gate == 'G-SECURITY' else 'E2E',
                'sourceCommit': 'synthetic-revision', 'artifactSha256': HEX_A, 'freezeId': 'freeze.test-001',
                'payloadManifestSha256': PM, 'scopeId': att['scopeId'], 'profileId': att['profileId'],
                'profileVersion': att['profileVersion'],
                'environment': {'type': 'SANDBOX', 'description': 'SYNTHETIC DATA NOT REAL TEST'},
                'validatorVersion': 'synthetic-test', 'method': 'SYNTHETIC NOT EXECUTED', 'outputUri': 'synthetic://fixture',
                'outputSha256': HEX_B, 'collectedAt': TS(NOW - timedelta(hours=1)),
                'expiresAt': TS(NOW + timedelta(days=1)), 'actor': 'synthetic-validator-' + gate,
                'validationRole': role, 'scope': 'synthetic only', 'limitations': ['NOT REAL EXECUTION']}
            evidences.append(ev)
            att['gateEvidenceIds'][gate] = ev['id']
    return att, profile, evidences


class Positives(unittest.TestCase):
    """Data that V1.1 schemas rejected but the docs already required."""

    def test_cf1_target_with_constraints_batchtags_selectionpolicy(self):
        catalog = loaded('production_catalog.json')
        crm = next(t for t in catalog['targets'] if t['id'] == 'business.crm')
        self.assertIn('constraints', crm)
        self.assertIn('batchTags', crm)
        self.assertIn('selectionPolicy', crm)
        self.assertIn('maxCandidates', crm)
        self.assertEqual(verify_shape(catalog, 'production-catalog.schema.json'), [])

    def test_cf2_batchplan_full_fields(self):
        batch = loaded('batch_plan.json')
        for k in ('riskClass', 'retryPolicy', 'timeout', 'approvalStrategy', 'auditScope'):
            self.assertIn(k, batch)
        self.assertEqual(verify_shape(batch, 'batch-plan.schema.json'), [])
        self.assertEqual(check_batch_plan(batch), [])

    def test_cf3_gateprofile_with_public_conditional_gate(self):
        profile = loaded('gate_profile.json')
        self.assertTrue(profile['conditional'])
        self.assertEqual(verify_shape(profile, 'gate-profile.schema.json'), [])

    def test_cf4_use_policy_only_in_decision(self):
        state = loaded('resource_state.json')
        decision = loaded('deployment_eligibility_decision.json')
        self.assertNotIn('usePolicy', state)
        self.assertEqual(verify_shape(decision, 'deployment-eligibility-decision.schema.json'), [])
        self.assertEqual(check_use_policy(decision, state), [])

    def test_cf5_frozen_payload_and_digest_chain(self):
        manifest = loaded('resource_manifest.json')
        freeze = loaded('artifact_freeze.json')
        state = loaded('resource_state.json')
        active = loaded('scoped_attestation_active.json')
        chain = loaded('evidence_chain_l1.json')
        self.assertEqual(verify_shape(manifest, 'resource-manifest.schema.json'), [])
        self.assertEqual(verify_payload_purity(manifest), [])
        self.assertEqual(verify_shape(freeze, 'artifact-freeze.schema.json'), [])
        self.assertEqual(verify_shape(state, 'resource-state.schema.json'), [])
        self.assertEqual(verify_digest_chain(freeze, state, attestation=active, evidences=chain), [])
        state_result, reasons = check_attestation(active, loaded('gate_profile.json'), chain, now=NOW, freeze=freeze, state=state)
        self.assertEqual((state_result, reasons), ('METADATA_CONSISTENT', []))

    def test_cf7_canonical_roles_and_transition(self):
        transition = loaded('state_transition.json')
        self.assertEqual(verify_shape(transition, 'state-transition.schema.json'), [])
        self.assertEqual(check_state_transition(transition), [])

    def test_cf8_dangling_objects_have_schemas(self):
        pairs = [('production_job', 'production-job.schema.json'),
                 ('scope_definition', 'scope-definition.schema.json'),
                 ('change_impact_record', 'change-impact-record.schema.json'),
                 ('acceptance_report', 'acceptance-report.schema.json')]
        for ex, schema in pairs:
            self.assertEqual(verify_shape(loaded(ex + '.json'), schema), [], schema)

    def test_origin_strategies_all_valid(self):
        reuse = loaded('resource_manifest.json')
        self.assertEqual(check_origin_strategy(reuse),
                         ['REUSE license does not permit the intended distribution: BLOCKED, never auto-PASS'])
        integrate = copy.deepcopy(reuse)
        integrate['originStrategy'] = {'strategy': 'INTEGRATE', 'upstreamUrl': 'https://example.invalid/svc',
                                       'externalSystemTermsRef': 'legal://terms', 'externalSystemSeparate': True,
                                       'deliversThirdPartySource': False, 'acceptanceRequirementRef': '14#L1'}
        self.assertEqual(verify_shape(integrate, 'resource-manifest.schema.json'), [])
        self.assertEqual(check_origin_strategy(integrate), [])
        first_party = copy.deepcopy(reuse)
        first_party['originStrategy'] = {'strategy': 'BUILD_FROM_SPEC', 'specRef': 'spec://crm/v1',
                                         'firstParty': True, 'acceptanceRequirementRef': '14#L1'}
        self.assertEqual(verify_shape(first_party, 'resource-manifest.schema.json'), [])
        self.assertEqual(check_origin_strategy(first_party), [])

    def test_production_eligible_with_decision_is_accepted(self):
        state = loaded('resource_state.json')
        state.update({'qualityLevel': 'L2', 'verificationStatus': 'RELEASE_READY',
                      'publicationStatus': 'LISTED', 'deploymentEligibilityRef': 'decision.prod.001'})
        decision = loaded('deployment_eligibility_decision.json')
        decision.update({'decisionId': 'decision.prod.001', 'usePolicy': 'PRODUCTION_ELIGIBLE',
                         'artifactSha256': state['artifactSha256'], 'approvalId': 'approval.real.001',
                         'decidedByRole': 'RELEASE_APPROVER'})
        self.assertEqual(verify_shape(state, 'resource-state.schema.json'), [])
        self.assertEqual(verify_shape(decision, 'deployment-eligibility-decision.schema.json'), [])
        self.assertEqual(check_use_policy(decision, state), [])

    def test_cf8_file_manifest_convention(self):
        fm = read_json(P / 'FILE_MANIFEST.json')
        self.assertEqual(verify_shape(fm, 'file-manifest.schema.json'), [])
        self.assertTrue(fm['files'])
        self.assertTrue(all('path' in f and 'name' not in f for f in fm['files']))


class Negatives(unittest.TestCase):
    """Each named defect must still be rejected after the fix."""

    def test_n1_payload_manifest_embedding_certification_refs(self):
        manifest = loaded('resource_manifest.json')
        for key in ('evidenceIds', 'qualityLevel', 'attestationRefs', 'usePolicy'):
            bad = copy.deepcopy(manifest); bad[key] = [] if key != 'qualityLevel' else 'L2'
            self.assertTrue(verify_shape(bad, 'resource-manifest.schema.json'), f'{key} must be rejected')
            self.assertTrue(any(key in r for r in verify_payload_purity(bad)), key)

    def test_n2_state_digest_not_equal_freeze(self):
        freeze = loaded('artifact_freeze.json')
        state = loaded('resource_state.json')
        state['artifactSha256'] = HEX_C
        self.assertIn('state artifact digest mismatch', verify_digest_chain(freeze, state))
        active, profile, chain = build_chain('L1')
        mismatch_state = dict(state)
        status, reasons = check_attestation(active, profile, chain, now=NOW, freeze=freeze, state=mismatch_state)
        self.assertEqual(status, 'BLOCKED')
        self.assertIn('state digest mismatch', ' | '.join(reasons))

    def test_n3_attested_level_exceeds_profile_max(self):
        att, profile, evidence = build_chain('L2')
        profile['maxAttestableLevel'] = 'L1'
        status, reasons = check_attestation(att, profile, evidence, now=NOW)
        self.assertEqual(status, 'BLOCKED')
        self.assertIn('exceeds profile max', ' | '.join(reasons))

    def test_n4_activated_conditional_gate_without_pass(self):
        att, profile, evidence = build_chain('L1')
        att['activeConditionalTriggers'] = ['PAYMENTS']
        status, reasons = check_attestation(att, profile, evidence, now=NOW)
        self.assertEqual(status, 'BLOCKED')
        self.assertIn('activated conditional gate not PASS P-LIVE-TEST', ' | '.join(reasons))

    def test_n5_production_sensitive_in_generic_batch(self):
        batch = loaded('batch_plan.json')
        batch['riskClass'] = 'PRODUCTION_SENSITIVE'
        batch.pop('dedicatedRiskExecution', None)
        self.assertTrue(verify_shape(batch, 'batch-plan.schema.json'))
        self.assertIn('generic batch', ' | '.join(check_batch_plan(batch)))

    def test_n6_production_eligible_without_decision_or_approval(self):
        # (a) no decision supplied at all
        state = loaded('resource_state.json')
        state['deploymentEligibilityRef'] = 'decision.missing'
        self.assertIn('was not supplied', ' | '.join(check_use_policy(None, state)))
        # (b) PRODUCTION_ELIGIBLE with an empty approvalId is schema-invalid
        decision = loaded('deployment_eligibility_decision.json')
        decision.update({'usePolicy': 'PRODUCTION_ELIGIBLE', 'approvalId': ''})
        self.assertTrue(verify_shape(decision, 'deployment-eligibility-decision.schema.json'))
        # (c) PRODUCTION_ELIGIBLE decided by a non-approver role is rejected
        decision2 = loaded('deployment_eligibility_decision.json')
        decision2.update({'usePolicy': 'PRODUCTION_ELIGIBLE', 'approvalId': 'approval.x', 'decidedByRole': 'BUILDER_AGENT'})
        self.assertTrue(verify_shape(decision2, 'deployment-eligibility-decision.schema.json'))
        self.assertIn('RELEASE_APPROVER', ' | '.join(check_use_policy(decision2, state)))

    def test_n7_catalog_target_missing_constraints_or_extra_field(self):
        catalog = loaded('production_catalog.json')
        missing = copy.deepcopy(catalog); del missing['targets'][0]['constraints']
        self.assertTrue(verify_shape(missing, 'production-catalog.schema.json'))
        extra = copy.deepcopy(catalog); extra['targets'][0]['undocumentedField'] = True
        self.assertTrue(verify_shape(extra, 'production-catalog.schema.json'))

    def test_n8_legacy_product_line_codes_rejected_as_resource_type(self):
        for code in ('L1', 'L3', 'L4'):
            catalog = loaded('production_catalog.json')
            catalog['targets'][0]['resourceType'] = code
            self.assertTrue(verify_shape(catalog, 'production-catalog.schema.json'), code)
            manifest = loaded('resource_manifest.json')
            manifest['resourceType'] = code
            self.assertTrue(verify_shape(manifest, 'resource-manifest.schema.json'), code)

    def test_n9_non_canonical_role_and_builder_self_approval(self):
        transition = loaded('state_transition.json')
        transition['role'] = 'REGISTRY_CONTROLLER'
        self.assertTrue(verify_shape(transition, 'state-transition.schema.json'))
        builder = loaded('state_transition.json')
        builder.update({'role': 'BUILDER_AGENT', 'to': 'REGISTERED'})
        self.assertIn('Builder cannot self-approve', ' | '.join(check_state_transition(builder)))
        non_approver = loaded('state_transition.json')
        non_approver.update({'role': 'VALIDATOR', 'to': 'PUBLISHING'})
        self.assertIn('requires RELEASE_APPROVER', ' | '.join(check_state_transition(non_approver)))

    def test_n10_reuse_license_not_permitted_never_auto_pass(self):
        manifest = loaded('resource_manifest.json')
        manifest['originStrategy']['licenseDistributionPermitted'] = False
        self.assertIn('BLOCKED, never auto-PASS', ' | '.join(check_origin_strategy(manifest)))

    def test_n11_unresolved_dependency_blocks_code_production(self):
        catalog = loaded('production_catalog.json')
        batch = loaded('batch_plan.json')
        batch['executionMode'] = 'SANDBOX_BUILD'
        batch['riskClass'] = 'SANDBOX_CODE'
        reasons = check_catalog_dependency_gating(catalog, batch)
        self.assertIn('unresolved external dependency blocks code production', ' | '.join(reasons))
        # read-only discovery is still allowed
        batch['executionMode'] = 'READ_ONLY'
        self.assertEqual(check_catalog_dependency_gating(catalog, batch), [])

    def test_n12_withdrawn_or_quarantined_not_installable(self):
        state = loaded('resource_state.json')
        state['publicationStatus'] = 'WITHDRAWN'
        self.assertIn('forbids new installs', ' | '.join(check_installable(state)))
        state['publicationStatus'] = 'QUARANTINED'
        self.assertIn('forbids new installs', ' | '.join(check_installable(state)))


if __name__ == '__main__':
    unittest.main()
