# REVISION_MANIFEST — factory-v1.2 patch bundle

Proposed V1.2 bundle that patches *around* the frozen V1.1 baseline. **`Source/**` was never modified.**
All work is written only under `factory-v1.2/`.

- Baseline copied into `factory-v1.2/baseline_v1_1/` (verbatim V1.1 docs, schemas, examples, scripts, tests) for reader comparison.
- Working tree (`schemas/ examples/ scripts/ tests/ docs/`) holds the fixed V1.2 artifacts.

## 1. Bundle layout

```
factory-v1.2/
  ADR-Factory-001.md            # decision record
  REVISION_MANIFEST.md          # this file
  COMPATIBILITY_IMPACT.md       # migration / compatibility
  TEST_REPORT.md                # real command output + exit codes
  FILE_MANIFEST.json            # canonical 'path'-keyed hash list (CF-8)
  schemas/                      # 15 schemas (9 pre-existing: 6 updated + 3 new CF-5; +6 CF-7/CF-8)
  examples/                     # updated + new specimens (incl. frozen-chain demo)
  scripts/                      # reference engine + rules + example validator + manifest generator
  tests/                        # adapted V1.1 suite + new V1.2 fix suite; tests/v1_1_baseline/ = pristine copy
  docs/                         # proposed V1.2 text for 02/04/07/09/10/14/16/17 + schemas README
  baseline_v1_1/                # verbatim V1.1 baseline (untouched reference)
```

## 2. File-by-file change list

### 2.1 Schemas

| File | Change | CF |
|---|---|---|
| `schemas/resource-manifest.schema.json` | **Rewritten**: payload-content only; `originStrategy` added (task 6); certification/digest fields removed; `additionalProperties:false` kept | CF-5, task 6 |
| `schemas/artifact-freeze.schema.json` | **New**: freezeId/resourceId/resourceVersion/artifactSha256/payloadManifestSha256/frozenAt/frozenBy/fileList/immutable | CF-5 |
| `schemas/resource-state.schema.json` | **New**: post-freeze projection; no `usePolicy`; L0/listed/attestation conditionals | CF-4, CF-5 |
| `schemas/deployment-eligibility-decision.schema.json` | **New**: `usePolicy` single source; `approvalId` + `decidedByRole` | CF-4 |
| `schemas/gate-profile.schema.json` | **Updated**: kept `levels`/`reviewPolicy`; added `conditional[]`/`validationMethod`/`expiryPolicy`/`owner`/`maxAttestableLevel` | CF-3 |
| `schemas/scoped-attestation.schema.json` | **Updated**: added `freezeId`/`payloadManifestSha256`/`activeConditionalTriggers`; `schemaVersion` 1.2 | CF-3, CF-5 |
| `schemas/evidence.schema.json` | **Updated**: added `freezeId`/`payloadManifestSha256`/`actorRole`; `schemaVersion` 1.2 | CF-5, CF-7 |
| `schemas/production-catalog.schema.json` | **Updated**: added `constraints`(required)/`maxCandidates`/`selectionPolicy`/`batchTags`; `additionalProperties:false` kept | CF-1 |
| `schemas/batch-plan.schema.json` | **Updated**: added `riskClass`/`retryPolicy`/`timeout`/`approvalStrategy`/`auditScope`/`dedicatedRiskExecution` + PRODUCTION_SENSITIVE conditional | CF-2 |
| `schemas/state-transition.schema.json` | **New**: canonical role enum + single job-state vocabulary | CF-7 |
| `schemas/production-job.schema.json` | **New** | CF-8 |
| `schemas/scope-definition.schema.json` | **New** | CF-8 |
| `schemas/change-impact-record.schema.json` | **New** | CF-8 |
| `schemas/acceptance-report.schema.json` | **New** (no embedded `usePolicy`; uses `deploymentEligibilityRef`) | CF-4, CF-8 |
| `schemas/file-manifest.schema.json` | **New**: canonical `path`-keyed manifest | CF-8 |

### 2.2 Examples

| File | Change |
|---|---|
| `examples/production_catalog.json` | Added `constraints` to every target; `maxCandidates`/`selectionPolicy`/`batchTags` where documented; `schemaVersion` 1.2 |
| `examples/batch_plan.json` | Added `riskClass`/`retryPolicy`/`timeout`/`approvalStrategy`/`auditScope`/`dedicatedRiskExecution` |
| `examples/gate_profile.json` | Added `owner`/`validationMethod`/`expiryPolicy`/`maxAttestableLevel`/`conditional[]` |
| `examples/resource_manifest.json` | Rewritten payload-only (removed certification/digest fields; added `originStrategy: REUSE`) |
| `examples/evidence.json` | `schemaVersion` 1.2 + `actorRole` (NOT_RUN negative demo kept) |
| `examples/scoped_attestation.json` | `schemaVersion`/`profileVersion` 1.2 + `activeConditionalTriggers` (DRAFT negative demo kept) |
| `examples/artifact_freeze.json` | **New** (frozen-chain demo) |
| `examples/resource_state.json` | **New** (L1 projection, no `usePolicy`) |
| `examples/deployment_eligibility_decision.json` | **New** (SANDBOX_ONLY) |
| `examples/scoped_attestation_active.json` | **New** (ACTIVE L1 demo over the frozen chain) |
| `examples/evidence_chain_l1.json` | **New** (7 synthetic PASS records for the demo chain) |
| `examples/state_transition.json` | **New** |
| `examples/production_job.json` | **New** |
| `examples/scope_definition.json` | **New** |
| `examples/change_impact_record.json` | **New** |
| `examples/acceptance_report.json` | **New** |

> **All example digests and PASS records are synthetic demo constants.** They are labelled `SYNTHETIC DEMO` and prove metadata consistency only.

### 2.3 Scripts

| File | Change |
|---|---|
| `scripts/validate_attestation.py` | Added `maxAttestableLevel` cap check, activated-conditional-gate block, evidence↔freeze payload-manifest binding, optional freeze/state digest-chain check |
| `scripts/factory_rules.py` | **New**: `verify_payload_purity`, `verify_digest_chain`, `check_use_policy`, `check_batch_plan`, `check_catalog_dependency_gating`, `check_state_transition`, `check_installable`, `check_origin_strategy` |
| `scripts/validate_examples.py` | **Rewritten**: validates all 15 schema specimens + evidence array + file manifest + cross-object invariants + digest chain + usePolicy + batch rules + positive/negative attestation |
| `scripts/generate_file_manifest.py` | **New**: generates `FILE_MANIFEST.json` with `sha256` |

### 2.4 Tests

| File | Change |
|---|---|
| `tests/test_factory_policy.py` | **Adapted V1.1 suite**: all 19 original tests kept; evidence `schemaVersion` 1.2; `test_l0_manifest_not_publishable` retargeted to `resource-state.schema.json` (fields moved off the payload by CF-5) |
| `tests/test_v1_2_fixes.py` | **New suite**: 10 positives + 12 negatives (see CF closure table) |
| `tests/v1_1_baseline/test_factory_policy_v1_1_original.py` | **Pristine copy** of the V1.1 test file (not discovered/run; kept for comparison) |
| `tests/v1_1_baseline/README.md` | Explains why the pristine suite is not run |

### 2.5 Docs

| File | Change |
|---|---|
| `docs/02_PRODUCTION_CATALOG.v1.2.md` | CF-1 fields, CF-6 terminology, CF-9a dependency gate |
| `docs/04_RESOURCE_CONTRACT.v1.2.md` | CF-5 payload/certification split, task-6 origin strategy, detached envelope table |
| `docs/07_STATE_MACHINE.v1.2.md` | CF-7 canonical roles + **full transition table** + naming unification |
| `docs/09_EVIDENCE_AND_ACCEPTANCE.v1.2.md` | CF-3 GateProfile model, CF-5 freeze chain, CF-4 acceptance report |
| `docs/10_WAREHOUSE_LIFECYCLE.v1.2.md` | CF-4/CF-5 data ownership table, resource-state index, CF-9b |
| `docs/14_GATE_PROFILES.v1.2.md` | CF-3 conditional-gate encoding + max level |
| `docs/16_SCOPE_ATTESTATION_MODEL.v1.2.md` | CF-4 usePolicy single source, CF-5 freeze-first, updated decision formula |
| `docs/17_IMMUTABLE_RELEASE_PROTOCOL.v1.2.md` | CF-5 ArtifactFreeze schema, digest chain |
| `docs/schemas_README.v1.2.md` | schema inventory, CF-6 case convention, capability limits |

## 3. CF closure table

| CF | Topic | Status | Exercising test(s) |
|---|---|---|---|
| CF-1 | CatalogTarget schema gap | **CLOSED** | `test_cf1_target_with_constraints_batchtags_selectionpolicy`, `test_n7_catalog_target_missing_constraints_or_extra_field` |
| CF-2 | BatchPlan gap / risk class | **CLOSED** | `test_cf2_batchplan_full_fields`, `test_n5_production_sensitive_in_generic_batch` |
| CF-3 | GateProfile model drift | **CLOSED** | `test_cf3_gateprofile_with_public_conditional_gate`, `test_n3_attested_level_exceeds_profile_max`, `test_n4_activated_conditional_gate_without_pass` |
| CF-4 | usePolicy single source | **CLOSED** | `test_cf4_use_policy_only_in_decision`, `test_n6_production_eligible_without_decision_or_approval`, `test_production_eligible_with_decision_is_accepted` |
| CF-5 | freeze/envelope circular hash | **CLOSED** | `test_cf5_frozen_payload_and_digest_chain`, `test_n1_payload_manifest_embedding_certification_refs`, `test_n2_state_digest_not_equal_freeze` |
| CF-6 | terminology / case | **CLOSED** | `test_n8_legacy_product_line_codes_rejected_as_resource_type` + documented case convention |
| CF-7 | canonical roles + transitions | **CLOSED** | `test_cf7_canonical_roles_and_transition`, `test_n9_non_canonical_role_and_builder_self_approval` |
| CF-8 | dangling objects + manifest format | **CLOSED** | `test_cf8_dangling_objects_have_schemas`, `test_cf8_file_manifest_convention` |
| CF-9 | unenforced stated invariants (extra) | **PARTIAL** | `test_n11_unresolved_dependency_blocks_code_production`, `test_n12_withdrawn_or_quarantined_not_installable`, `test_n3_attested_level_exceeds_profile_max` |
| Task 6 | origin strategy | **CLOSED** | `test_origin_strategies_all_valid`, `test_n10_reuse_license_not_permitted_never_auto_pass` |

## 4. Gate-integrity statement

No license, security, tenant-isolation, payment, release-approval or L0–L3 gate was weakened. All new fields are additive or additively-stricter; `additionalProperties:false` was retained everywhere it already existed. Where a defect could only be "closed" by relaxing a gate, it was left open/partial (CF-9) and said so.
