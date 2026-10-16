# CATALOG_VALIDATION.md — Static validation of Production Catalog V1.1 examples

**Report status: READ-ONLY audit artifact. Not a business-resource certification.**

## 1. Scope and sources

| Item | Value |
|---|---|
| Factory spec root | `Source/SaaS_AI_Foundation_with_Template_Factory_V1_1/Template_Factory_V1_1/` |
| Foundation blueprint (read-only) | `Source/SaaS_AI_Foundation_with_Template_Factory_V1_1/SaaS_AI_Foundation_V1_0_1/` |
| Candidate base (read-only) | `Source/next-forge/` |
| Documents read in full | `00_README.md` … `20_V1_1_AUDIT_REPORT.md`, `CHANGELOG.md`, `FILE_MANIFEST.json`, `examples/*.json` (6), `schemas/*.json` (6) + `schemas/README.md`, `scripts/validate_examples.py`, `scripts/validate_attestation.py`, `tests/test_factory_policy.py` |
| Foundation docs cross-checked | `04_MODULE_TEMPLATE_CONTRACT.md`, `06_OSS_IP_POLICY.md`, `07_QUALITY_ACCEPTANCE.md`, `08_ROADMAP.md`, `12_PROTOTYPE_RESOURCE_SPEC.md` |
| Inaccessible requested files | none (all listed paths readable) |

## 2. Execution environment (recorded)

| Field | Value |
|---|---|
| Host | macOS (darwin), working dir `/Users/milin/2026/软件开发/Saas_foundation_template` |
| Project root VCS | NOT a git repository (`git rev-parse` → `fatal: not a git repository`) |
| Python | 3.10.13 |
| jsonschema | 4.26.0 (deprecated `__version__` access warning only) |
| Audit timestamp | 2026-10-16 (Asia/Shanghai) |
| Write scope used | `reports/factory-readonly/**` only |

## 3. Commands executed and RAW results

### 3.1 `python3 scripts/validate_examples.py` (cwd = Factory dir)

```
PASS shape production_catalog
PASS shape resource_manifest
PASS shape evidence
PASS shape batch_plan
PASS shape gate_profile
PASS shape scoped_attestation
PASS cross-object sample invariants (no real source/build verified)
PASS negative: DRAFT/unbuilt sample attestation is blocked
Only metadata and synthetic policy tested. NO build, security, or legal claim is certified.
EXIT_CODE=0
```

**Result: PASS (exit 0) — schema shape + synthetic cross-object invariants only.**

### 3.2 `python3 -m unittest discover -s tests -v` (cwd = Factory dir)

```
Ran 19 tests in 0.666s
OK
EXIT_CODE=0
```

All 19 policy tests pass, including the intentional negatives: `test_bad_digest`,
`test_cross_scope`, `test_cross_profile`, `test_missing_gate`, `test_fake_pass`,
`test_expired_evidence`, `test_expired_attestation`, `test_builder_self_review`,
`test_reviewer_not_independent`, `test_wrong_license_reviewer`, `test_quality_overclaim`,
`test_revoked`, `test_duplicate_evidence`, `test_missing_review`,
`test_fifth_product_line_invalid`, `test_l0_manifest_not_publishable`.

**Result: PASS (exit 0).**

### 3.3 Artifact-hash integrity sampling (read-only `shasum -a 256`)

Factory `FILE_MANIFEST.json` declares sha256 per file. Sampled recomputation:

| File | Manifest sha256 | On-disk sha256 | Match |
|---|---|---|---|
| `00_README.md` | `36e500a9…d3120` | `36e500a9…d3120` | PASS |
| `17_IMMUTABLE_RELEASE_PROTOCOL.md` | `93744fa9…d152` | `93744fa9…d152` | PASS |
| `20_V1_1_AUDIT_REPORT.md` | `1389743a…6732` | `1389743a…6732` | PASS |
| `examples/production_catalog.json` | `d9f05d6c…eed4` | `d9f05d6c…eed4` | PASS |
| `scripts/validate_examples.py` | `bc2e09d7…1fe2` | `bc2e09d7…1fe2` | PASS |
| `scripts/validate_attestation.py` | `27ef7cf0…f004` | `27ef7cf0…f004` | PASS |
| `tests/test_factory_policy.py` | `5d244f8d…9fb` | `5d244f8d…9fb` | PASS |
| `schemas/production-catalog.schema.json` | `781408ca…c04` | `781408ca…c04` | PASS |

**Result: PASS (8/8 sampled).** `FILE_MANIFEST.json` declares 39 files; the on-disk tree
additionally contains `.DS_Store`, `scripts/__pycache__/`, `tests/__pycache__/` (build
byproducts, not declared). This is a **cosmetic provenance gap**, not a hash mismatch.

Foundation `FILE_MANIFEST.json` sampled recomputation for the 5 requested docs:

| File | Match |
|---|---|
| `04_MODULE_TEMPLATE_CONTRACT.md` | PASS |
| `06_OSS_IP_POLICY.md` | PASS |
| `07_QUALITY_ACCEPTANCE.md` | PASS |
| `08_ROADMAP.md` | PASS |
| `12_PROTOTYPE_RESOURCE_SPEC.md` | PASS |

## 4. Per-target static validation (3 catalog targets)

Source file: `examples/production_catalog.json` (sha256 `d9f05d6c…eed4`), 3 targets.

| # | Target id | `resourceType` | `targetQualityLevel` | `acceptanceProfileId` | Schema validity | Unresolved external dep |
|---|---|---|---|---|---|---|
| 1 | `saas.payments.wechat` | `saas-core-module` | L1 | `profile.billing.sandbox.v1` | PASS | `saas.billing-core` = `UNSELECTED` / **UNVERIFIED** |
| 2 | `business.crm` | `business-saas-template` | L2 | `profile.business.crm.v1` | PASS | none declared |
| 3 | `ai.workflow` | `ai-native-template` | L2 | `profile.ai.workflow.v1` | PASS | none declared |

Checks that actually ran (from `validate_examples.py`, synthetic sample data only):

- `resourceType` enum restricted to the 4 legal types — **PASS** (target 0 typed
  `prototype-resource` is rejected by schema; proven by `test_fifth_product_line_invalid`).
- Target ids unique — PASS. Batch `targetIds` ⊆ catalog ids — PASS.
- `batch.catalogRevision == catalog.catalogRevision` — PASS.
- `batch.executionMode == READ_ONLY && batch.dryRun == true` — PASS.
- Internal `dependencies[]` resolve within catalog — PASS.
- `manifest` L0 → `CATALOGED`/`RESEARCH_ONLY`/`PRIVATE` enforced — PASS
  (`test_l0_manifest_not_publishable` shows `LISTED` under L0 is rejected).
- Sample evidence is `NOT_RUN` + `UNBUILT`; sample attestation `DRAFT` is blocked — PASS.

### Interpretation guard (mandatory)

These PASS results prove the **schema skeletons and the reference policy engine are
self-consistent**. They are **not** evidence that any WeChat/CRM/AI resource is usable,
safe, licensed, or production-ready. `scripts/README`-level language and §"明确不能自动宣称"
in `09_EVIDENCE_AND_ACCEPTANCE.md` are authoritative: schema PASS ≠ commercial certification.

## 5. Verification status

| Check | Status |
|---|---|
| All 25 requested spec/example/schema/script/test files readable | PASS |
| `validate_examples.py` | **PASS (synthetic metadata only)** |
| `unittest discover` | **PASS (synthetic policy only)** |
| Factory manifest hash sample | PASS (8/8) |
| Foundation manifest hash sample | PASS (5/5) |
| Three catalog targets | structurally valid as *declarations* — **CATALOGED / L0-equivalent, not verified** |
| Any real resource capability, license, or security claim | **NOT_RUN** |
| Authoritative WeChat Pay / CRM / workflow upstream verification (no network) | **BLOCKED** |

## 6. Main risks

1. **Sample-PASS over-reading** — the printed "PASS" lines can be misquoted as resource
   PASS. Mitigation: this report states the limitation explicitly; downstream reports repeat it.
2. **Manifest drift** — `__pycache__` artifacts exist outside `FILE_MANIFEST.json`; future
   auditors could mistake the manifest for a complete freeze manifest.
3. **Schema-vs-prose drift** — see `CONFLICT_AND_UNKNOWN.md` (documented fields not in schema).

## 7. Minimal next step

Freeze this validation as-is (no re-run required for Phase A). In a later, separately
approved phase, add the documented-but-missing schema fields (see conflicts) and re-run
both validators; do **not** treat the current PASS as a resource gate.

## 8. Approval request

Approve acknowledging items §5–§7 and authorise (or refuse) the minimal next step.
No write to `Source/**` or any business project is requested.
