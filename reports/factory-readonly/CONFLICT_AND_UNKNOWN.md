# CONFLICT_AND_UNKNOWN.md — Specification audit: conflicts, dangling concepts, schema drift, freeze/hash issues

Strictly read-only review of the Factory V1.1 spec against its own schemas, examples,
scripts, tests, and the Foundation V1.0.1 blueprint. **No gate (license/security/tenant/payment)
is lowered here.** Each item: evidence → severity → owner to resolve.

## 0. Environment / method

- Read: Factory `00`–`20`, `schemas/*` (6), `examples/*` (6), `scripts/*` , `tests/*`,
  `FILE_MANIFEST.json`; Foundation `04/06/07/08/12` + `FILE_MANIFEST.json`.
- Commands: `python3 scripts/validate_examples.py` (PASS, exit 0);
  `python3 -m unittest discover -s tests -v` (19 tests, OK, exit 0); `shasum -a 256` sampling.
- Environment: macOS, Python 3.10.13, jsonschema 4.26.0; no network; write scope
  `reports/factory-readonly/**`.

---

## 1. CONFLICTS (documented vs documented, or doc vs schema)

### CF-1 — `CatalogTarget` documented fields missing from schema (enforced `additionalProperties:false`)
- **Evidence:** `02_PRODUCTION_CATALOG.md` requires `constraints` and lists optional
  `maxCandidates`, `selectionPolicy`, `batchTags[]`. `schemas/production-catalog.schema.json`
  requires none of `constraints` and defines no `maxCandidates`/`selectionPolicy`/`batchTags`,
  while `additionalProperties:false` (line 213) **rejects** them.
- **Impact:** a spec-conformant, doc-described target can FAIL schema validation. Confusing for
  builders; the `constraints` (stack/distribution/deadline/budget) field is silently unrepresentable.
- **Severity:** High (data-model blockage). **Owner:** Factory spec author.

### CF-2 — `BatchPlan` under-specified vs `11_BATCH_ORCHESTRATION.md`
- **Evidence:** doc 11 requires retry/timeout, dependency graph, approval strategy, **risk
  classification**, effective audit scope. `batch-plan.schema.json` has `executionMode`,
  `dryRun`, `concurrency`, `budget{maxUsd,maxAttemptsPerJob,maxRuntimeMinutes}`, boolean
  `approvalRequired`, `stopConditions`, `dependencies[before,after]` — **no risk class, no
  retry/timeout policy, no approval strategy beyond a boolean, no audit-scope field**.
- **Impact:** the mandated risk tiering (`READ_ONLY`/`SANDBOX_CODE`/`EXTERNAL_SANDBOX_API`/
  `PRODUCTION_SENSITIVE`) cannot be recorded → the "no PRODUCTION_SENSITIVE in batch" rule is unenforceable.
- **Severity:** High. **Owner:** spec author.

### CF-3 — `GateProfile` model drift (doc 09 vs schema)
- **Evidence:** `09_EVIDENCE_AND_ACCEPTANCE.md` defines `GateProfile = profileId, resourceType,
  scope, mustPass[], conditional[], validationMethod, expiryPolicy, owner, version`. Schema
  `gate-profile.schema.json` instead has `profileVersion, scopeId, levels{L1,L2,L3}, reviewPolicy`.
- **Impact:** `conditional[]` is absent → `14_GATE_PROFILES.md`'s conditional gates (payments,
  AI, prototypes) cannot be encoded; `expiryPolicy`/`owner`/`validationMethod` absent.
- **Severity:** High. **Owner:** spec author.

### CF-4 — `usePolicy` duplicated/ambiguous vs `DeploymentEligibilityDecision`
- **Evidence:** doc `16` says `usePolicy` must be decided by a separate
  **DeploymentEligibilityDecision** with `approvalId`, and omits it from the attestation's
  required list. Yet `resource-manifest.schema.json` embeds `usePolicy` and couples it
  (`PRODUCTION_ELIGIBLE → RELEASE_READY`). **No `deployment-eligibility-decision` schema exists.**
- **Impact:** two sources of truth for `usePolicy`; manifest projection can diverge from the
  approval decision. Ch. `18` §6 ("usePolicy 不从等级推导") is not machine-enforced.
- **Severity:** Medium-High. **Owner:** spec author.

### CF-5 — Circular freeze risk: post-approval fields inside the frozen payload
- **Evidence:** `17_IMMUTABLE_RELEASE_PROTOCOL.md` + `10_WAREHOUSE_LIFECYCLE.md` require the
  payload (which includes the manifest payload view per `04`) to be **frozen before VALIDATE**,
  with approval/registry data added via a **detached envelope that must not write back**.
  But `resource-manifest.schema.json` puts `attestationRefs` **and** `evidenceIds` inside the
  manifest and requires them for L1–L3.
- **Impact:** the frozen manifest must already contain attestation refs/evidence IDs that are
  produced **after** validation → the "freeze-then-verify" invariant is internally inconsistent;
  a naive implementation either mutates the frozen payload or cannot satisfy the schema.
- **Severity:** High (integrity of the core V1.1 fix). **Owner:** spec author / architect.

### CF-6 — Terminology collision `L1–L4`
- **Evidence:** Foundation `00_README.md` table and `12_PROTOTYPE_RESOURCE_SPEC.md` line 12 use
  `L1–L4` for **product lines**; Factory `00_README.md` §"历史兼容提醒" forbids `L1–L4`.
  Additionally Foundation `04`/`12` write `Cataloged|Verified|Release-ready` (CamelCase) while
  Factory uses `CATALOGED|VERIFIED|RELEASE_READY`.
- **Impact:** real risk of mixing product-line codes with `qualityLevel`; case mismatch is a
  machine-format hazard for any merged validator.
- **Severity:** Medium (governance). **Owner:** human + ADR (doc `15` requests ADR-Factory-001).

### CF-7 — Role-name drift
- **Evidence:** `01_GOVERNANCE_SCOPE.md` defines 6 roles. `07_STATE_MACHINE.md` additionally uses
  `Builder Controller`, `Build Controller`; `10_WAREHOUSE_LIFECYCLE.md` uses `Registry Controller`.
- **Impact:** decision authority for transition gates is ambiguous.
- **Severity:** Medium. **Owner:** spec author.

### CF-8 — Inconsistent manifest format between the two bundles
- **Evidence:** Factory `FILE_MANIFEST.json` keys files by `"path"`; Foundation
  `FILE_MANIFEST.json` keys by `"name"`. Neither bundle ships a JSON Schema for its manifest.
- **Impact:** no uniform provenance tooling; the "generatedOn" + sha model is prose.
- **Severity:** Low-Medium. **Owner:** tooling.

### CF-9 — Unenforced stated invariants
- **Evidence:** (a) `02` says unresolved external dependency "阻断代码生产及发布"; no validator
  links `externalDependencies.status` to job gating (`validate_examples.py` merely asserts one
  sample is `UNVERIFIED`). (b) `06` §C says `WITHDRAWN` forbids new installs; manifest schema
  has no coupling for that. (c) `18` §6 says quality cannot exceed profile max; the reference
  engine does not compare `attestedLevel` to `requestedLevel`.
- **Severity:** Medium. **Owner:** reference-validator maintainer (later phase).

---

## 2. DANGLING CONCEPTS (named but with no schema/example/owner)

| Concept | Referenced in | Missing artifact |
|---|---|---|
| `AcceptanceReport` | `09` §认证输出 | no schema; relation to `ScopedAttestation` undefined |
| `ScopeDefinition` | `16` (§不可混淆的键) | no schema/example though `scopeId` "must point to" it |
| `DeploymentEligibilityDecision` | `16` | no schema (see CF-4) |
| `ChangeImpactRecord` | `19` | no schema/example |
| `Batch Preview` | `11` | no schema/example |
| `ProductionJob`, `DiscoveryRun`, `Candidate`, `SelectionDecision`, `Artifact`, `EvidenceBundle`, `RegistryRelease` | `01` §核心追踪对象 | **none** have schemas; only `CatalogTarget`/`BatchPlan`/`ResourceManifest`/`Evidence`/`GateProfile`/`ScopedAttestation` do |
| `PrototypeSubJob` | `04` §原型子任务 | no schema (prototypes exist only as an array in the manifest) |
| `STOPPED_FOR_REVIEW` state | `19` §停止投入机制 | not a job state in `07` |
| `RECHECK` step | `17` §1.6 | no state in `07` |
| `REVIEW_DUE` transition | `06`/`16` | status exists; no defined transition that sets/clears it |

**Impact:** the majority of the "core tracked objects" chain is prose-only; cross-object
validation cannot be completed. **Severity:** Medium-High. **Owner:** spec author.

---

## 3. STATE-MACHINE / TRANSITION GAPS

- `07` admits "图只给主路径，实际以转移表为准" **but ships no full transition table** —
  `PAUSED` is said to be reachable "from any non-terminal" yet its exit edges are undefined;
  `BLOCKED` recovery "only back to the previously recorded stage" is stated but no per-stage
  map is given.
- Three names for one stage: `CALIBRATING→STAGING_ARTIFACT` (`07`) = `PACKAGE_CANDIDATE` (`05`)
  = payload freeze (`17`). Naming inconsistency → reviewer confusion.
- `PUBLISHING` digest conflict → `BLOCKED` (`07` §V1.1) with no defined resumption path vs
  `17`'s "version conflict must not silently overwrite".
- `REVIEW_DUE` / `STOPPED_FOR_REVIEW` / `RECHECK` have no home (see §2).

**Severity:** Medium-High. **Owner:** spec author.

---

## 4. SCHEMA-CONSISTENCY NOTES (non-blocking but relevant)

- `evidence.schema.json` permits `result=NOT_RUN` with `artifactSha256=UNBUILT` (used by the
  sample) — good, prevents fake-PASS, and the test suite asserts it.
- `scoped-attestation.schema.json` uses `additionalProperties:false`; since `usePolicy` is
  intentionally external (CF-4), a future `DeploymentEligibilityDecision` field added here would
  be rejected — plan the schema first.
- `gate-profile.schema.json` requires non-empty `L1/L2/L3` arrays; a type with no L3 gates yet
  cannot be represented.
- No dependency-pinning file for the Python reference engine (`jsonschema>=4` is prose only) —
  reproducibility depends on the ambient interpreter (here 4.26.0, PASS).

---

## 5. UNKNOWN items (cannot be resolved in this read-only, offline phase)

| ID | Unknown | Why |
|---|---|---|
| U-1 | Any remote candidate's SHA, license text, security/CI posture | no network |
| U-2 | Transitive dependency licenses inside `bun.lock` | lockfile carries no license text |
| U-3 | Whether the WeChat Pay sandbox supports refund / real webhook semantics | authoritative docs unverifiable offline |
| U-4 | next-forge per-package SPDX + NOTICE completeness | files absent; upstream intent unknown |
| U-5 | Font (Geist) and brand-logo redistribution terms | not audited; offline |
| U-6 | Real model-provider terms/costs for Pilot C | offline |
| U-7 | Whether `.DS_Store`/`__pycache__` presence alters intended freeze scope | packaging intent unclear |

## 6. BLOCKED items

| ID | Blocked | Reason |
|---|---|---|
| B-1 | All three pilot discoveries | no network + no reviewable local CRM/WeChat/workflow source (see `PILOT_READINESS.md`) |
| B-2 | Pilots A & B release-readiness | no source + merchant qualification (A) / no 2nd candidate (B) |
| B-3 | Any `PRODUCTION_ELIGIBLE` decision | no GA gates run; no merchant qualification; no real model verification |
| B-4 | Enforcing conditional gates | `GateProfile` cannot encode `conditional[]` (CF-3) |

## 7. Main risks

- **Hard-gate integrity:** CF-5 (freeze/envelope) undermines the exact property V1.1 was written
  to fix; do not ship an implementation before it is resolved.
- **Enforceability:** CF-1–CF-3 + §2 mean the reference validator cannot yet verify most stated
  invariants → risk of "schema PASS = certified" over-reading.
- **Governance:** CF-6/CF-7 ambiguity could let a Builder role self-approve.

## 8. Minimal next step

Author **ADR-Factory-001** (as `15_COMPATIBILITY_NOTES.md` already requests) that fixes:
(1) the freeze/envelope field ownership (CF-5), (2) the `GateProfile` model (CF-3),
(3) `CatalogTarget`/`BatchPlan` schema gaps (CF-1/CF-2), (4) the `usePolicy` source of truth
(CF-4), and (5) canonical role names (CF-7) — **without weakening any license/security/tenant/payment gate.**

## 9. Approval request

Approve or amend the conflict/UNKNOWN/BLOCKED classification above. Explicitly confirm that no
gate is being lowered and that CF-5 must be resolved before any implementation phase.
