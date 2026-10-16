#!/usr/bin/env python3
"""Reference metadata consistency checker (V1.2). Never grants deployment or release permission.

Changes vs V1.1 (see ADR-Factory-001):
  * CF-3: enforces the GateProfile max level and activated conditional gates.
  * CF-5: optional digest-chain check across freeze / state / attestation / evidence.

The positive result METADATA_CONSISTENT only means the supplied untrusted JSON has
internally matching fields; it is NOT evidence authenticity verification.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent.parent
LEVELS = ('L1', 'L2', 'L3')


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def verify_shape(data, filename):
    schema = read_json(ROOT / 'schemas' / filename)
    Draft202012Validator.check_schema(schema)
    errors = list(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(data))
    return [f'schema: {list(e.path)} {e.message}' for e in errors]


def when(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)


def check_attestation(a, profile, evidence, now=None, freeze=None, state=None):
    """Return (METADATA_CONSISTENT | BLOCKED, reasons). Not a true quality certification."""
    now = now or datetime.now(timezone.utc)
    reasons = verify_shape(a, 'scoped-attestation.schema.json') + verify_shape(profile, 'gate-profile.schema.json')
    evidences = {}
    for e in evidence:
        reasons.extend(verify_shape(e, 'evidence.schema.json'))
        if e.get('id') in evidences:
            reasons.append('duplicate evidence ID')
        evidences[e.get('id')] = e
    if reasons:
        return 'BLOCKED', reasons

    if a['attestationStatus'] != 'ACTIVE':
        reasons.append('not ACTIVE')
    if a['attestedLevel'] not in LEVELS:
        reasons.append('missing attested quality level')
    if a['artifactSha256'] == 'UNBUILT':
        reasons.append('unbuilt artifact')
    if not a['reviewerId'] or not a['reviewDecisionId']:
        reasons.append('missing independent review decision')
    if a['scopeId'] != profile['scopeId']:
        reasons.append('scope mismatch')
    if a['profileId'] != profile['profileId'] or a['profileVersion'] != profile['profileVersion']:
        reasons.append('profile mismatch')
    if when(a['issuedAt']) > now:
        reasons.append('attestation issued in future')
    if when(a['expiresAt']) <= now:
        reasons.append('attestation expired')
    if when(a['issuedAt']) >= when(a['expiresAt']):
        reasons.append('invalid attestation time window')

    # CF-3: never attest above the profile's declared maximum.
    max_level = profile.get('maxAttestableLevel')
    if a['attestedLevel'] in LEVELS and max_level in LEVELS:
        if LEVELS.index(a['attestedLevel']) > LEVELS.index(max_level):
            reasons.append(f'attested level {a["attestedLevel"]} exceeds profile max {max_level}')

    # CF-3: activated conditional gates must be present and PASS.
    active = set(a.get('activeConditionalTriggers', []))
    for cond in profile.get('conditional', []):
        if cond.get('requiredWhenActivated') and cond.get('trigger') in active:
            gate = cond.get('gateId')
            if a['gateEvidenceIds'].get(gate) is None:
                reasons.append('activated conditional gate not PASS ' + str(gate))

    required = []
    if a['attestedLevel'] in LEVELS:
        upto = LEVELS.index(a['attestedLevel']) + 1
        required.extend(g for level in LEVELS[:upto] for g in profile['levels'][level])
    for cond in profile.get('conditional', []):
        if cond.get('requiredWhenActivated') and cond.get('trigger') in active and cond.get('gateId') not in required:
            required.append(cond['gateId'])

    checked = set()
    for gate in required:
        if gate in checked:
            continue
        checked.add(gate)
        evidence_id = a['gateEvidenceIds'].get(gate)
        if evidence_id is None:
            reasons.append('missing required gate ' + gate)
            continue
        e = evidences.get(evidence_id)
        if e is None:
            reasons.append('missing evidence record ' + evidence_id)
            continue
        if e['gateId'] != gate:
            reasons.append('wrong gate for evidence ' + evidence_id)
        if e['result'] != 'PASS':
            reasons.append('non-PASS ' + gate)
        if e['artifactSha256'] != a['artifactSha256']:
            reasons.append('artifact digest mismatch ' + gate)
        if e['scopeId'] != a['scopeId']:
            reasons.append('evidence scope mismatch ' + gate)
        if e['profileId'] != a['profileId'] or e['profileVersion'] != a['profileVersion']:
            reasons.append('evidence profile mismatch ' + gate)
        if e['subjectId'] != a['resourceId']:
            reasons.append('evidence resource mismatch ' + gate)
        if e.get('freezeId') and a.get('freezeId') and e['freezeId'] != a['freezeId']:
            reasons.append('evidence freeze mismatch ' + gate)
        if e.get('payloadManifestSha256') and a.get('payloadManifestSha256') \
                and e['payloadManifestSha256'] != a['payloadManifestSha256']:
            reasons.append('evidence payload manifest mismatch ' + gate)
        if e['validationRole'] == 'BUILDER':
            reasons.append('Builder self-certification ' + gate)
        if profile['reviewPolicy']['independentValidatorRequired'] and e['actor'] == a['reviewerId']:
            reasons.append('reviewer not independent ' + gate)
        if not e.get('expiresAt') or when(e['expiresAt']) <= now:
            reasons.append('expired evidence ' + gate)
        if when(e['collectedAt']) > now:
            reasons.append('future evidence ' + gate)
        if gate == 'G-LICENSE' and e['validationRole'] != 'LICENSE_REVIEWER':
            reasons.append('license gate wrong role')
        if gate == 'G-SECURITY' and e['validationRole'] != 'SECURITY_REVIEWER':
            reasons.append('security gate wrong role')

    # CF-5 digest chain: payload digest must be identical everywhere it appears.
    if freeze is not None:
        if freeze.get('artifactSha256') != a['artifactSha256']:
            reasons.append('freeze digest mismatch')
        if freeze.get('resourceId') != a['resourceId'] or freeze.get('resourceVersion') != a['resourceVersion']:
            reasons.append('freeze identity mismatch')
        if a.get('payloadManifestSha256') and freeze.get('payloadManifestSha256') != a['payloadManifestSha256']:
            reasons.append('payload manifest digest mismatch')
    if state is not None:
        if state.get('artifactSha256') != a['artifactSha256']:
            reasons.append('state digest mismatch')
        if state.get('resourceId') != a['resourceId'] or state.get('resourceVersion') != a['resourceVersion']:
            reasons.append('state identity mismatch')

    return ('BLOCKED', reasons) if reasons else ('METADATA_CONSISTENT', [])


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('attestation')
    p.add_argument('gate_profile')
    p.add_argument('evidence', nargs='+')
    args = p.parse_args()
    state, reasons = check_attestation(read_json(args.attestation), read_json(args.gate_profile), [read_json(x) for x in args.evidence])
    print(json.dumps({'metadataCheck': state, 'issues': reasons, 'note': 'Metadata consistency only; no deployment authorization'}, ensure_ascii=False, indent=2))
    raise SystemExit(0 if state == 'METADATA_CONSISTENT' else 1)
