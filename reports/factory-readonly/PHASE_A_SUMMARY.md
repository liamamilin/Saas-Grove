# PHASE_A_SUMMARY.md — Template Factory Read-Only Audit (Phase A)

**Audit status: COMPLETE (read-only). Stopped before any sandbox production. Awaiting human approval.**

## 1. What was done

- Fully read Factory `00_README.md`…`20_V1_1_AUDIT_REPORT.md`, `schemas/` (6), `examples/` (6),
  `scripts/` (2), `tests/` (1), `FILE_MANIFEST.json`, `CHANGELOG.md`.
- Cross-checked Foundation `04_MODULE_TEMPLATE_CONTRACT.md`, `06_OSS_IP_POLICY.md`,
  `07_QUALITY_ACCEPTANCE.md`, `08_ROADMAP.md`, `12_PROTOTYPE_RESOURCE_SPEC.md`.
- Inspected candidate base `Source/next-forge` read-only (git SHA, license, structure, assets).
- Executed the two reference validators and recorded raw output + exit codes.
- Wrote 7 audit reports into `reports/factory-readonly/` only. **No file outside this directory
  was created or modified; `Source/**` untouched; no installs/builds/network/payments.**

## 2. Execution environment

macOS (darwin) · Python 3.10.13 · jsonschema 4.26.0 · project root **not** a git repo ·
audit time 2026-10-16 (Asia/Shanghai) · network: **not used**.

## 3. Verifiable results

| Check | Command / method | Result |
|---|---|---|
| Example validation | `python3 scripts/validate_examples.py` | **PASS, exit 0** (schema shape + synthetic cross-object invariants) |
| Policy unit tests | `python3 -m unittest discover -s tests -v` | **PASS, exit 0** — 19/19 incl. negative cases |
| Factory manifest hash sample | `shasum -a 256` ×8 | **PASS 8/8** |
| Foundation manifest hash sample | `shasum -a 256` ×5 | **PASS 5/5** |
| next-forge identity | `git rev-parse HEAD` / `status` | `f189de79ceef7c1ef69f61f12e272f99b4cdb699`, tree **clean** |
| Real resource capability / license / security / payment | — | **NOT_RUN** |

> The two PASS lines prove **spec/sample self-consistency only**. They are **not** evidence that
> any WeChat / CRM / AI resource is usable, licensed, or production-ready.

## 4. Per-pilot conclusion

| Pilot | `resourceType` | Candidate | Status | Key blocker |
|---|---|---|---|---|
| A WeChat Pay adapter | `saas-core-module` | none reviewable (next-forge `payments` = Stripe only) | **BLOCKED** | no local source + authoritative docs unverifiable offline; `saas.billing-core` = UNVERIFIED |
| B CRM template | `business-saas-template` | only next-forge (not a CRM) | **BLOCKED / INSUFFICIENT** | ≥2-candidate rule unmet; CRM domain must be first-party or sourced under cleared license |
| C AI Workflow | `ai-native-template` | next-forge `packages/ai` (adapter only) | **PARTIAL** | no durable queue/workflow engine; real model terms UNKNOWN |

## 5. Highest-priority spec findings (details in `CONFLICT_AND_UNKNOWN.md`)

1. **CF-5 freeze/envelope inconsistency (High):** `attestationRefs`/`evidenceIds` live *inside*
   the manifest, but the payload must be frozen *before* validation — a circular-hash conflict in
   the exact property V1.1 was written to protect.
2. **CF-1/CF-2 schema gaps (High):** documented `CatalogTarget.constraints`/`batchTags`/
   `maxCandidates`/`selectionPolicy` and BatchPlan risk/retry/approval fields are absent from
   schemas that use `additionalProperties:false` → doc-conformant data fails validation.
3. **CF-3 `GateProfile` drift (High):** `conditional[]`/`validationMethod`/`expiryPolicy`/`owner`
   absent → conditional (payment/AI/prototype) gates cannot be encoded.
4. **CF-4 `usePolicy` source-of-truth ambiguity (Med-High):** duplicated between manifest and the
   unschematised `DeploymentEligibilityDecision`.
5. **CF-6/CF-7 terminology & role drift (Medium):** `L1–L4` product-line vs `L0–L3` quality
   collision; controller role names differ from the governed six.
6. **Dangling objects (Medium-High):** `AcceptanceReport`, `ScopeDefinition`,
   `DeploymentEligibilityDecision`, `ChangeImpactRecord`, `ProductionJob`, `STOPPED_FOR_REVIEW`,
   `RECHECK`, `REVIEW_DUE` — named but unschematised/undefined.
7. **Fourth line not exercised:** `saas-ai-module` stays scheme-only → "four-line factory" **not** claimable.

**No license, security, tenant, or payment gate was lowered.**

## 6. BLOCKED / UNKNOWN register (consolidated)

**BLOCKED:** B-1 all pilot discoveries (no network/no source) · B-2 Pilots A & B release (contract)
· B-3 any `PRODUCTION_ELIGIBLE` decision · B-4 conditional-gate enforcement (CF-3) ·
authoritative WeChat Pay API/SDK facts offline.

**UNKNOWN:** U-1 remote candidate SHA/license/security · U-2 transitive licenses in `bun.lock` ·
U-3 WeChat sandbox refund/webhook semantics · U-4 next-forge per-package SPDX/NOTICE ·
U-5 font/brand-asset redistribution · U-6 model-provider terms/costs · U-7 freeze-scope intent for
`.DS_Store`/`__pycache__`.

## 7. Reports produced

`CATALOG_VALIDATION.md` · `CANDIDATE_REGISTER.md` · `SELECTION_MATRIX.md` ·
`QUALITY_GATE_PROFILES.md` · `PILOT_READINESS.md` · `CONFLICT_AND_UNKNOWN.md` ·
`PHASE_A_SUMMARY.md` (this file). All under `reports/factory-readonly/`.

## 8. Minimal next step

Author **ADR-Factory-001** resolving CF-5 (freeze/envelope), CF-1…CF-4, and CF-7; then, if
approved, run a **discovery-only** (still read-only) sub-phase with scoped network access to make
Pilots A/B/C discoverable. **Do not begin sandbox production.**

## 9. Human approval requested

1. Confirm Phase A stopped at the read-only boundary (no build/install/network/payment).
2. Decide whether to author ADR-Factory-001 before any implementation.
3. Authorise **or** defer the discovery-only sub-phase for Pilots A/B/C.
4. Confirm the fourth line (`saas-ai-module`) remains unclaimed and no `PRODUCTION_ELIGIBLE` is granted.

**Action taken: none beyond read-only inspection and report creation. Stopping here.**
