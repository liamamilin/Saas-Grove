#!/usr/bin/env python3
"""Cross-object policy rules for Factory V1.2 (ADR-Factory-001).

These functions encode the invariants that a single JSON Schema cannot express.
They NEVER grant release/deployment permission; they only return reasons that a
provider of data is non-conformant. Every function returns a list of reasons;
an empty list means "no metadata violation detected".

Honesty note: passing these rules is NOT a commercial certification, a license
decision, a security result or a signature verification.
"""
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent.parent

# CF-5: a payload object must not embed certification/registry data.
FORBIDDEN_PAYLOAD_KEYS = (
    'qualityLevel',
    'verificationStatus',
    'usePolicy',
    'publicationStatus',
    'evidenceIds',
    'attestationRefs',
    'artifactSha256',
    'deploymentEligibilityRef',
    'defaultScopeId',
)

CANONICAL_ROLES = (
    'PRODUCT_OWNER',
    'DISCOVERY_AGENT',
    'BUILDER_AGENT',
    'VALIDATOR',
    'SECURITY_LICENSE_REVIEWER',
    'RELEASE_APPROVER',
)


def verify_shape(data, filename):
    import json
    schema = json.loads((ROOT / 'schemas' / filename).read_text(encoding='utf-8'))
    Draft202012Validator.check_schema(schema)
    errors = list(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(data))
    return [f'schema: {list(e.path)} {e.message}' for e in errors]


def verify_payload_purity(manifest):
    """CF-5: no payload object may embed certification refs or its own digest."""
    reasons = []
    for key in FORBIDDEN_PAYLOAD_KEYS:
        if key in manifest:
            reasons.append(f'payload embeds forbidden certification field: {key}')
    return reasons


def verify_digest_chain(freeze, state, attestation=None, evidences=()):
    """CF-5: payload digest in evidence == freeze digest == state digest == attestation digest."""
    reasons = []
    artefacts = {'freeze': freeze, 'state': state}
    if attestation is not None:
        artefacts['attestation'] = attestation
    if not freeze or not state:
        return ['digest chain requires both freeze and state records']
    base = freeze.get('artifactSha256')
    for name, obj in artefacts.items():
        value = obj.get('artifactSha256')
        if value == 'UNBUILT':
            continue
        if value != base:
            reasons.append(f'{name} artifact digest mismatch')
        if obj.get('resourceId') != freeze.get('resourceId') or obj.get('resourceVersion') != freeze.get('resourceVersion'):
            reasons.append(f'{name} identity mismatch')
    if attestation is not None and freeze.get('payloadManifestSha256') \
            and attestation.get('payloadManifestSha256') \
            and freeze['payloadManifestSha256'] != attestation['payloadManifestSha256']:
        reasons.append('payload manifest digest mismatch (freeze vs attestation)')
    for e in evidences:
        if e.get('artifactSha256') in (None, 'UNBUILT'):
            continue
        if e['artifactSha256'] != base:
            reasons.append(f'evidence artifact digest mismatch: {e.get("id")}')
        if freeze.get('payloadManifestSha256') and e.get('payloadManifestSha256') \
                and e['payloadManifestSha256'] != freeze['payloadManifestSha256']:
            reasons.append(f'evidence payload manifest mismatch: {e.get("id")}')
    return reasons


def check_use_policy(decision, state):
    """CF-4: usePolicy has exactly one source of truth: the DeploymentEligibilityDecision."""
    reasons = []
    if 'usePolicy' in state:
        reasons.append('usePolicy must not be stored in resource-state (single source of truth is the decision)')
    ref = state.get('deploymentEligibilityRef')
    if ref:
        if decision is None:
            reasons.append('resource-state references a deployment eligibility decision that was not supplied')
        else:
            if decision.get('decisionId') != ref:
                reasons.append('deployment eligibility decision id mismatch')
            if decision.get('artifactSha256') not in (None, state.get('artifactSha256')):
                reasons.append('deployment eligibility decision digest mismatch')
            if decision.get('resourceId') != state.get('resourceId') or decision.get('resourceVersion') != state.get('resourceVersion'):
                reasons.append('deployment eligibility decision identity mismatch')
    if decision is not None and decision.get('usePolicy') == 'PRODUCTION_ELIGIBLE':
        if not decision.get('approvalId'):
            reasons.append('PRODUCTION_ELIGIBLE requires an approvalId')
        if decision.get('decidedByRole') != 'RELEASE_APPROVER':
            reasons.append('PRODUCTION_ELIGIBLE requires a RELEASE_APPROVER decision')
        if state.get('qualityLevel') not in ('L1', 'L2', 'L3'):
            reasons.append('PRODUCTION_ELIGIBLE requires a built (L1+) artifact digest')
    return reasons


def check_batch_plan(batch):
    """CF-2: PRODUCTION_SENSITIVE work may not run in a generic batch."""
    reasons = []
    risk = batch.get('riskClass')
    if risk == 'PRODUCTION_SENSITIVE':
        if batch.get('dedicatedRiskExecution') is not True:
            reasons.append('PRODUCTION_SENSITIVE not permitted in a generic batch (dedicatedRiskExecution must be true)')
        if (batch.get('approvalStrategy') or {}).get('mode') != 'DUAL_CONTROL':
            reasons.append('PRODUCTION_SENSITIVE requires DUAL_CONTROL approval')
        if (batch.get('auditScope') or {}).get('level') != 'FULL_ARTIFACTS':
            reasons.append('PRODUCTION_SENSITIVE requires FULL_ARTIFACTS audit scope')
    if risk in ('READ_ONLY', 'SANDBOX_CODE', 'EXTERNAL_SANDBOX_API') and batch.get('dedicatedRiskExecution') is True:
        reasons.append('dedicatedRiskExecution must only be set for PRODUCTION_SENSITIVE')
    return reasons


def check_catalog_dependency_gating(catalog, batch):
    """CF-9(a): an unresolved external dependency blocks code production but not read-only discovery."""
    reasons = []
    if batch.get('executionMode') == 'READ_ONLY':
        return reasons
    selected = set(batch.get('targetIds', []))
    for target in catalog.get('targets', []):
        if target.get('id') not in selected:
            continue
        for dep in target.get('externalDependencies', []):
            if dep.get('status') != 'VERIFIED':
                reasons.append(
                    f'unresolved external dependency blocks code production: {target.get("id")} -> {dep.get("id")} [{dep.get("status")}]'
                )
    return reasons


def check_state_transition(transition):
    """CF-7: canonical roles and no Builder self-approval."""
    reasons = []
    if transition.get('from') == transition.get('to'):
        reasons.append('no-op transition')
    if transition.get('role') not in CANONICAL_ROLES:
        reasons.append('non-canonical role: ' + str(transition.get('role')))
    if transition.get('to') in ('AWAITING_RELEASE_APPROVAL', 'PUBLISHING', 'REGISTERED') \
            and transition.get('role') == 'BUILDER_AGENT':
        reasons.append('Builder cannot self-approve release transitions')
    if transition.get('to') in ('PUBLISHING', 'REGISTERED') and transition.get('role') != 'RELEASE_APPROVER':
        reasons.append('release approval requires RELEASE_APPROVER')
    return reasons


def check_installable(state):
    """CF-9(b): WITHDRAWN / QUARANTINED resources must not be installable."""
    reasons = []
    status = state.get('publicationStatus')
    if status == 'WITHDRAWN':
        reasons.append('WITHDRAWN forbids new installs')
    if status == 'QUARANTINED':
        reasons.append('QUARANTINED forbids new installs')
    return reasons


def check_origin_strategy(manifest):
    """Task 6: per-strategy origin requirements and the cannot-auto-PASS license rule."""
    reasons = []
    os_ = manifest.get('originStrategy') or {}
    strategy = os_.get('strategy')
    if strategy == 'REUSE':
        if os_.get('licenseDistributionPermitted') is False:
            reasons.append('REUSE license does not permit the intended distribution: BLOCKED, never auto-PASS')
        if not os_.get('lockedRevision'):
            reasons.append('REUSE requires a locked upstream revision')
    elif strategy == 'INTEGRATE':
        if os_.get('externalSystemSeparate') is not True:
            reasons.append('INTEGRATE requires the external system to stay separate')
        if os_.get('deliversThirdPartySource') is not False:
            reasons.append('INTEGRATE must not pose as delivering third-party source')
    elif strategy == 'BUILD_FROM_SPEC':
        if os_.get('firstParty') is not True:
            reasons.append('BUILD_FROM_SPEC requires first-party origin')
        if os_.get('upstreamUrl'):
            reasons.append('BUILD_FROM_SPEC must not make upstream reuse claims')
    else:
        reasons.append('missing or unknown originStrategy')
    return reasons
