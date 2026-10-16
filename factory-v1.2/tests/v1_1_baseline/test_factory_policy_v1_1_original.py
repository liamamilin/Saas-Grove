"""Synthetic tests: invented PASS evidence tests only the policy engine, not a real build."""
import sys
import unittest
import copy
from datetime import datetime, timedelta, timezone
from pathlib import Path
P=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(P/'scripts'))
from validate_attestation import check_attestation,read_json,verify_shape

NOW=datetime(2026,10,16,1,tzinfo=timezone.utc)
TS=lambda x:x.isoformat()
HEX='a'*64

def fixtures():
    profile=read_json(P/'examples/gate_profile.json')
    att=read_json(P/'examples/scoped_attestation.json')
    att.update({'artifactSha256':HEX,'attestationStatus':'ACTIVE','attestedLevel':'L1','reviewerId':'release-reviewer','reviewDecisionId':'synthetic-review-not-real','issuedAt':TS(NOW-timedelta(days=1)),'expiresAt':TS(NOW+timedelta(days=1))})
    evidences=[]
    for gate in profile['levels']['L1']:
        role='LICENSE_REVIEWER' if gate=='G-LICENSE' else 'SECURITY_REVIEWER' if gate=='G-SECURITY' else 'INDEPENDENT_VALIDATOR'
        ev={
          'schemaVersion':'1.1','id':'synthetic-'+gate,'subjectId':att['resourceId'],'gateId':gate,
          'result':'PASS','kind':'LICENSE' if gate=='G-LICENSE' else 'SECURITY' if gate=='G-SECURITY' else 'E2E',
          'sourceCommit':'synthetic-revision','artifactSha256':HEX,'scopeId':att['scopeId'],
          'profileId':att['profileId'],'profileVersion':att['profileVersion'],
          'environment':{'type':'SANDBOX','description':'SYNTHETIC DATA NOT REAL TEST'},
          'validatorVersion':'synthetic-test','method':'SYNTHETIC NOT EXECUTED','outputUri':'synthetic://fixture',
          'outputSha256':'b'*64,'collectedAt':TS(NOW-timedelta(hours=1)),
          'expiresAt':TS(NOW+timedelta(days=1)),'actor':'synthetic-validator-'+gate,
          'validationRole':role,'scope':'synthetic only','limitations':['NOT REAL EXECUTION']}
        evidences.append(ev);att['gateEvidenceIds'][gate]=ev['id']
    return att,profile,evidences

class TestPolicy(unittest.TestCase):
    def assert_blocked(self, mutator, expected):
        a,p,e=fixtures();mutator(a,p,e)
        status,problems=check_attestation(a,p,e,now=NOW)
        self.assertEqual(status,'BLOCKED',problems)
        self.assertIn(expected,' | '.join(problems))

    def test_synthetic_consistent_metadata_only(self):
        a,p,e=fixtures()
        state,errs=check_attestation(a,p,e,now=NOW)
        self.assertEqual((state,errs),('METADATA_CONSISTENT',[]))
    def test_unbuilt_draft_is_not_attested(self):
        a=read_json(P/'examples/scoped_attestation.json')
        p=read_json(P/'examples/gate_profile.json')
        state,_=check_attestation(a,p,[],now=NOW)
        self.assertEqual(state,'BLOCKED')
    def test_bad_digest(self):
        self.assert_blocked(lambda a,p,e:e[0].update(artifactSha256='c'*64),'artifact digest mismatch')
    def test_cross_scope(self):
        self.assert_blocked(lambda a,p,e:e[0].update(scopeId='scope.other'),'evidence scope mismatch')
    def test_cross_profile(self):
        self.assert_blocked(lambda a,p,e:e[0].update(profileVersion='0.1'),'evidence profile mismatch')
    def test_missing_gate(self):
        self.assert_blocked(lambda a,p,e:a['gateEvidenceIds'].pop('G-CORE'),'missing required gate')
    def test_fake_pass(self):
        self.assert_blocked(lambda a,p,e:e[0].update(result='NOT_RUN'),'non-PASS')
    def test_expired_evidence(self):
        self.assert_blocked(lambda a,p,e:e[0].update(expiresAt=TS(NOW-timedelta(seconds=1))),'expired evidence')
    def test_expired_attestation(self):
        self.assert_blocked(lambda a,p,e:a.update(expiresAt=TS(NOW-timedelta(seconds=1))),'attestation expired')
    def test_builder_self_review(self):
        self.assert_blocked(lambda a,p,e:e[0].update(validationRole='BUILDER'),'Builder self-certification')
    def test_reviewer_not_independent(self):
        self.assert_blocked(lambda a,p,e:e[0].update(actor='release-reviewer'),'reviewer not independent')
    def test_wrong_license_reviewer(self):
        self.assert_blocked(lambda a,p,e:next(x for x in e if x['gateId']=='G-LICENSE').update(validationRole='INDEPENDENT_VALIDATOR'),'license gate wrong role')
    def test_quality_overclaim(self):
        self.assert_blocked(lambda a,p,e:a.update(attestedLevel='L3'),'missing required gate')
    def test_revoked(self):
        self.assert_blocked(lambda a,p,e:a.update(attestationStatus='REVOKED'),'not ACTIVE')
    def test_duplicate_evidence(self):
        self.assert_blocked(lambda a,p,e:e.append(copy.deepcopy(e[0])),'duplicate evidence ID')
    def test_missing_review(self):
        self.assert_blocked(lambda a,p,e:a.update(reviewDecisionId=''),'reviewDecisionId')
    def test_fifth_product_line_invalid(self):
        catalog=read_json(P/'examples/production_catalog.json');catalog['targets'][0]['resourceType']='prototype-resource'
        self.assertTrue(verify_shape(catalog,'production-catalog.schema.json'))
    def test_l0_manifest_not_publishable(self):
        m=read_json(P/'examples/resource_manifest.json');m['publicationStatus']='LISTED'
        self.assertTrue(verify_shape(m,'resource-manifest.schema.json'))
    def test_external_dep_unverified_blocker(self):
        c=read_json(P/'examples/production_catalog.json')
        self.assertEqual(c['targets'][0]['externalDependencies'][0]['status'],'UNVERIFIED')

if __name__=='__main__':unittest.main()
