#!/usr/bin/env python3
"""Reference metadata consistency checker. Never grants deployment or release permission.

The positive result METADATA_CONSISTENT only means the supplied untrusted JSON
has internally matching fields; it is NOT evidence authenticity verification.
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
    schema=read_json(ROOT/'schemas'/filename)
    Draft202012Validator.check_schema(schema)
    errors=list(Draft202012Validator(schema,format_checker=FormatChecker()).iter_errors(data))
    return [f'schema: {list(e.path)} {e.message}' for e in errors]

def when(value):
    return datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(timezone.utc)

def check_attestation(a, profile, evidence, now=None):
    """Return (METADATA_CONSISTENT | BLOCKED, reasons). Not a true quality certification."""
    now = now or datetime.now(timezone.utc)
    reasons = verify_shape(a,'scoped-attestation.schema.json') + verify_shape(profile,'gate-profile.schema.json')
    evidences={}
    for e in evidence:
        reasons.extend(verify_shape(e,'evidence.schema.json'))
        if e.get('id') in evidences: reasons.append('duplicate evidence ID')
        evidences[e.get('id')] = e
    if reasons: return 'BLOCKED',reasons

    if a['attestationStatus'] != 'ACTIVE': reasons.append('not ACTIVE')
    if a['attestedLevel'] not in LEVELS: reasons.append('missing attested quality level')
    if a['artifactSha256']=='UNBUILT': reasons.append('unbuilt artifact')
    if not a['reviewerId'] or not a['reviewDecisionId']: reasons.append('missing independent review decision')
    if a['scopeId']!=profile['scopeId']: reasons.append('scope mismatch')
    if a['profileId']!=profile['profileId'] or a['profileVersion']!=profile['profileVersion']: reasons.append('profile mismatch')
    if when(a['issuedAt'])>now: reasons.append('attestation issued in future')
    if when(a['expiresAt'])<=now: reasons.append('attestation expired')
    if when(a['issuedAt'])>=when(a['expiresAt']): reasons.append('invalid attestation time window')

    if a['attestedLevel'] in LEVELS:
        upto=LEVELS.index(a['attestedLevel'])+1
        required=list(dict.fromkeys(g for level in LEVELS[:upto] for g in profile['levels'][level]))
        for gate in required:
            evidence_id=a['gateEvidenceIds'].get(gate)
            if evidence_id is None:
                reasons.append('missing required gate '+gate)
                continue
            e=evidences.get(evidence_id)
            if e is None:
                reasons.append('missing evidence record '+evidence_id)
                continue
            if e['gateId']!=gate: reasons.append('wrong gate for evidence '+evidence_id)
            if e['result']!='PASS': reasons.append('non-PASS '+gate)
            if e['artifactSha256']!=a['artifactSha256']: reasons.append('artifact digest mismatch '+gate)
            if e['scopeId']!=a['scopeId']: reasons.append('evidence scope mismatch '+gate)
            if e['profileId']!=a['profileId'] or e['profileVersion']!=a['profileVersion']: reasons.append('evidence profile mismatch '+gate)
            if e['subjectId']!=a['resourceId']: reasons.append('evidence resource mismatch '+gate)
            if e['validationRole']=='BUILDER': reasons.append('Builder self-certification '+gate)
            if profile['reviewPolicy']['independentValidatorRequired'] and e['actor']==a['reviewerId']: reasons.append('reviewer not independent '+gate)
            if not e.get('expiresAt') or when(e['expiresAt'])<=now: reasons.append('expired evidence '+gate)
            if when(e['collectedAt'])>now: reasons.append('future evidence '+gate)
            if gate=='G-LICENSE' and e['validationRole']!='LICENSE_REVIEWER': reasons.append('license gate wrong role')
            if gate=='G-SECURITY' and e['validationRole']!='SECURITY_REVIEWER': reasons.append('security gate wrong role')
    return ('BLOCKED',reasons) if reasons else ('METADATA_CONSISTENT',[])

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('attestation');p.add_argument('gate_profile');p.add_argument('evidence',nargs='+')
    args=p.parse_args()
    state,reasons=check_attestation(read_json(args.attestation), read_json(args.gate_profile), [read_json(x) for x in args.evidence])
    print(json.dumps({'metadataCheck':state,'issues':reasons,'note':'Metadata consistency only; no deployment authorization'},ensure_ascii=False,indent=2))
    raise SystemExit(0 if state=='METADATA_CONSISTENT' else 1)
