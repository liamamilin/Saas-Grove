# TEST_REPORT — factory-v1.2 proof suite (ADR-Factory-001)

Run from `factory-v1.2/`. Output below is the **real** terminal output, pasted verbatim.

## 0. Environment

| Item | Value |
|---|---|
| Platform | macOS (darwin) |
| Python | 3.10.13 |
| jsonschema | 4.26.0 |
| Network | not used |
| Installs | none |
| Write scope | `factory-v1.2/` only (plus `reports/` pre-existing); **`Source/**` untouched** |
| Date | 2026-10-16 |

## 1. `python3 scripts/validate_examples.py`

Exit code: **0**

```
PASS shape production_catalog
PASS shape resource_manifest
PASS shape evidence
PASS shape batch_plan
PASS shape gate_profile
PASS shape scoped_attestation
PASS shape artifact_freeze
PASS shape resource_state
PASS shape deployment_eligibility_decision
PASS shape state_transition
PASS shape production_job
PASS shape scope_definition
PASS shape change_impact_record
PASS shape acceptance_report
PASS shape scoped_attestation_active
PASS shape evidence_chain_l1 (7 records)
PASS shape FILE_MANIFEST (canonical path keys)
PASS cross-object sample invariants (no real source/build verified)
PASS CF-1 target with constraints/batchTags/selectionPolicy validates
PASS CF-2 batch plan risk/retry/approval/audit fields valid (READ_ONLY)
PASS CF-3 GateProfile with conditional[]/validationMethod/expiryPolicy/owner validates
PASS CF-5 payload manifest embeds no certification refs; digest chain consistent
PASS CF-4 resource-state carries no usePolicy; decision binds to the same digest
PASS CF-7 state-transition uses canonical roles
PASS negative: DRAFT/unbuilt sample attestation is blocked
PASS positive: demo L1 digest-chain attestation is METADATA_CONSISTENT (synthetic only)
Only metadata and synthetic policy tested. NO build, security, legal or signature claim is certified.
```

## 2. `python3 -m unittest discover -s tests -v`

Exit code: **0** — `Ran 41 tests ... OK`

```
test_bad_digest (test_factory_policy.TestPolicy) ... ok
test_builder_self_review (test_factory_policy.TestPolicy) ... ok
test_cross_profile (test_factory_policy.TestPolicy) ... ok
test_cross_scope (test_factory_policy.TestPolicy) ... ok
test_duplicate_evidence (test_factory_policy.TestPolicy) ... ok
test_expired_attestation (test_factory_policy.TestPolicy) ... ok
test_expired_evidence (test_factory_policy.TestPolicy) ... ok
test_external_dep_unverified_blocker (test_factory_policy.TestPolicy) ... ok
test_fake_pass (test_factory_policy.TestPolicy) ... ok
test_fifth_product_line_invalid (test_factory_policy.TestPolicy) ... ok
test_l0_state_not_publishable (test_factory_policy.TestPolicy) ... ok
test_missing_gate (test_factory_policy.TestPolicy) ... ok
test_missing_review (test_factory_policy.TestPolicy) ... ok
test_quality_overclaim (test_factory_policy.TestPolicy) ... ok
test_reviewer_not_independent (test_factory_policy.TestPolicy) ... ok
test_revoked (test_factory_policy.TestPolicy) ... ok
test_synthetic_consistent_metadata_only (test_factory_policy.TestPolicy) ... ok
test_unbuilt_draft_is_not_attested (test_factory_policy.TestPolicy) ... ok
test_wrong_license_reviewer (test_factory_policy.TestPolicy) ... ok
test_n10_reuse_license_not_permitted_never_auto_pass (test_v1_2_fixes.Negatives) ... ok
test_n11_unresolved_dependency_blocks_code_production (test_v1_2_fixes.Negatives) ... ok
test_n12_withdrawn_or_quarantined_not_installable (test_v1_2_fixes.Negatives) ... ok
test_n1_payload_manifest_embedding_certification_refs (test_v1_2_fixes.Negatives) ... ok
test_n2_state_digest_not_equal_freeze (test_v1_2_fixes.Negatives) ... ok
test_n3_attested_level_exceeds_profile_max (test_v1_2_fixes.Negatives) ... ok
test_n4_activated_conditional_gate_without_pass (test_v1_2_fixes.Negatives) ... ok
test_n5_production_sensitive_in_generic_batch (test_v1_2_fixes.Negatives) ... ok
test_n6_production_eligible_without_decision_or_approval (test_v1_2_fixes.Negatives) ... ok
test_n7_catalog_target_missing_constraints_or_extra_field (test_v1_2_fixes.Negatives) ... ok
test_n8_legacy_product_line_codes_rejected_as_resource_type (test_v1_2_fixes.Negatives) ... ok
test_n9_non_canonical_role_and_builder_self_approval (test_v1_2_fixes.Negatives) ... ok
test_cf1_target_with_constraints_batchtags_selectionpolicy (test_v1_2_fixes.Positives) ... ok
test_cf2_batchplan_full_fields (test_v1_2_fixes.Positives) ... ok
test_cf3_gateprofile_with_public_conditional_gate (test_v1_2_fixes.Positives) ... ok
test_cf4_use_policy_only_in_decision (test_v1_2_fixes.Positives) ... ok
test_cf5_frozen_payload_and_digest_chain (test_v1_2_fixes.Positives) ... ok
test_cf7_canonical_roles_and_transition (test_v1_2_fixes.Positives) ... ok
test_cf8_dangling_objects_have_schemas (test_v1_2_fixes.Positives) ... ok
test_cf8_file_manifest_convention (test_v1_2_fixes.Positives) ... ok
test_origin_strategies_all_valid (test_v1_2_fixes.Positives) ... ok
test_production_eligible_with_decision_is_accepted (test_v1_2_fixes.Positives) ... ok

----------------------------------------------------------------------
Ran 41 tests in 1.125s

OK
```

Composition: **19** adapted V1.1 tests + **10** new V1.2 positives + **12** new V1.2 negatives = 41.

## 3. CF closure table (each status backed by a test)

| CF | Topic | Status | Test(s) that exercise it |
|---|---|---|---|
| CF-1 | CatalogTarget schema gap | **CLOSED** | `test_cf1_target_with_constraints_batchtags_selectionpolicy`, `test_n7_catalog_target_missing_constraints_or_extra_field` |
| CF-2 | BatchPlan gap / risk class | **CLOSED** | `test_cf2_batchplan_full_fields`, `test_n5_production_sensitive_in_generic_batch` |
| CF-3 | GateProfile model drift | **CLOSED** | `test_cf3_gateprofile_with_public_conditional_gate`, `test_n3_attested_level_exceeds_profile_max`, `test_n4_activated_conditional_gate_without_pass` |
| CF-4 | `usePolicy` single source | **CLOSED** | `test_cf4_use_policy_only_in_decision`, `test_n6_production_eligible_without_decision_or_approval`, `test_production_eligible_with_decision_is_accepted` |
| CF-5 | freeze/envelope circular hash | **CLOSED** | `test_cf5_frozen_payload_and_digest_chain`, `test_n1_payload_manifest_embedding_certification_refs`, `test_n2_state_digest_not_equal_freeze` |
| CF-6 | terminology / case | **CLOSED** | `test_n8_legacy_product_line_codes_rejected_as_resource_type` + documented convention |
| CF-7 | canonical roles + transition table | **CLOSED** | `test_cf7_canonical_roles_and_transition`, `test_n9_non_canonical_role_and_builder_self_approval` |
| CF-8 | dangling objects + manifest format | **CLOSED** | `test_cf8_dangling_objects_have_schemas`, `test_cf8_file_manifest_convention` |
| CF-9 | unenforced stated invariants (extra) | **PARTIAL** | `test_n11_unresolved_dependency_blocks_code_production`, `test_n12_withdrawn_or_quarantined_not_installable`, `test_n3_attested_level_exceeds_profile_max` |
| Task 6 | origin strategy | **CLOSED** | `test_origin_strategies_all_valid`, `test_n10_reuse_license_not_permitted_never_auto_pass` |

### Why CF-9 is PARTIAL (not CLOSED)

Only the machine-checkable parts of the audit's §CF-9 invariants are enforced:
(a) an unresolved external dependency blocks non-read-only batches;
(b) `WITHDRAWN`/`QUARANTINED` forbid new installs;
(c) an attested level may not exceed the profile maximum.
**Not** enforced: real registry download gating, real engine deployment refusal,
and all prose-level business contracts — these need a real runtime, which this
task forbids. CF-9 is therefore reported **PARTIAL**, not CLOSED.

## 4. V1.1 regression coverage

Requirement: pre-existing V1.1 tests must still pass and their negatives must
still reject. `tests/test_factory_policy.py` keeps all 19 original test methods.
The only meaning-changing adaptation is:

- `test_l0_manifest_not_publishable` → `test_l0_state_not_publishable`: the L0 /
  publication / verification fields moved off the payload manifest onto
  `resource-state` (CF-5), so the identical "L0 must not be LISTED" negative is
  now asserted against `resource-state.schema.json`.

The pristine V1.1 suite is preserved (not run) at
`tests/v1_1_baseline/test_factory_policy_v1_1_original.py` and
`baseline_v1_1/tests/test_factory_policy.py`.

## 5. What these PASS lines DO NOT prove (honesty)

- They prove **spec/specimen self-consistency and reference-rule behaviour only**.
- They do **not** prove any real signature, log integrity, license permission,
  sandbox isolation, payment/AI success, build reproducibility, or human approval.
- **A schema PASS is never a commercial certification.**
- All example digests and PASS records are synthetic demo constants labelled
  `SYNTHETIC DEMO`; nothing here is a real acceptance.
- The reference engine returns `METADATA_CONSISTENT`, never "certified".

## 6. Residual risks / still UNKNOWN

- **UNKNOWN (unchanged from Phase A)**: U-1 remote candidate SHA/license/security,
  U-2 transitive licenses in lockfiles, U-3 WeChat Pay sandbox semantics,
  U-4 next-forge per-package SPDX/NOTICE, U-5 font/brand redistribution,
  U-6 model-provider terms/costs, U-7 freeze-scope intent for housekeeping files.
  Resolving these requires real sources and network, both out of scope here.
- **CF-9** remains PARTIAL (see §3).
- `Source/**` (V1.1 + Foundation) still contains legacy `L1–L4` product-line
  labels and CamelCase `Cataloged|Verified|Release-ready`; a human merge must
  decide on renaming. This bundle cannot modify `Source/**`.
- No pilot, product implementation, install, payment, model API or network action
  was performed.

## 7. Reproduce

```bash
cd factory-v1.2
python3 scripts/validate_examples.py          # exit 0
python3 -m unittest discover -s tests -v      # exit 0, Ran 41 tests
```
