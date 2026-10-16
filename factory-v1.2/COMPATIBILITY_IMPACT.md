# COMPATIBILITY_IMPACT — V1.1 → V1.2

Scope: the specification bundle only. This document describes what changes for
readers/tools that consumed the V1.1 schemas. It does **not** authorise any
implementation, pilot or product work.

## 1. Compatibility summary

| Area | V1.1 | V1.2 | Breaking? |
|---|---|---|---|
| Payload manifest | carried `qualityLevel/verificationStatus/usePolicy/publicationStatus/evidenceIds/attestationRefs/artifactSha256/defaultScopeId` | payload-content only; those fields rejected | **Yes (intentional)** |
| Certification/registry data | split ambiguously (some in manifest) | detached: `artifact-freeze`, `resource-state`, `deployment-eligibility-decision`, `scoped-attestation` | **Yes (intentional)** |
| CatalogTarget | doc fields absent | `constraints`(required)/`maxCandidates`/`selectionPolicy`/`batchTags` added | No (additive; but `constraints` is now required) |
| BatchPlan | minimal | `riskClass`(required)/`retryPolicy`/`timeout`/`approvalStrategy`/`auditScope`/`dedicatedRiskExecution` | Partly (new required fields) |
| GateProfile | `levels`/`reviewPolicy` | + `conditional[]`/`validationMethod`/`expiryPolicy`/`owner`(**required**)`/maxAttestableLevel` | Partly (new required fields) |
| Roles | drifted (`Builder/Build/Registry Controller`) | one canonical enum | No (rename) |
| `schemaVersion` | `1.0`/`1.1` accepted | `1.2` only | **Yes** |
| Diff/semantics of gates | — | unchanged or stricter | No gate lowered |

## 2. Field migration map (manifest → detached objects)

| V1.1 manifest field | V1.2 destination |
|---|---|
| `qualityLevel` | `resource-state.qualityLevel` (+ `scoped-attestation.attestedLevel`) |
| `verificationStatus` | `resource-state.verificationStatus` |
| `publicationStatus` | `resource-state.publicationStatus` |
| `usePolicy` | **only** `deployment-eligibility-decision.usePolicy` (referenced by `resource-state.deploymentEligibilityRef`) |
| `evidenceIds` | `resource-state.evidenceIds` |
| `attestationRefs` | `resource-state.attestationRefs` |
| `artifactSha256` | `artifact-freeze.artifactSha256` (and bound everywhere) |
| `defaultScopeId` | `resource-state.defaultScopeId` |
| *(new)* | `artifact-freeze.payloadManifestSha256` |

Payload keeps: identity, `capabilitiesProvided[]`, `deliveryForm`, `origins[]`,
**`originStrategy`**, `prototypeResources[]`, `dependencies[]`,
`knownLimitations[]`, `licenseReport`, `installGuide`, `testPlan`.

## 3. Migration steps for an existing V1.1 bundle

1. Split each V1.1 `resource-manifest.json`: keep payload fields; move
   certification fields into a new `resource-state.json`; create one
   `deployment-eligibility-decision.json` for the `usePolicy` value.
2. Add `originStrategy` to every payload manifest (choose `REUSE` / `INTEGRATE` /
   `BUILD_FROM_SPEC` and supply its required fields).
3. Create an `artifact-freeze.json` for every frozen payload; compute
   `payloadManifestSha256` from the payload manifest view.
4. Add the new required `constraints` to every catalog target; add
   `riskClass`/`retryPolicy`/`timeout`/`approvalStrategy`/`auditScope` to every
   batch plan.
5. Add `owner`/`validationMethod`/`expiryPolicy` (and `conditional[]` where
   applicable) to every gate profile.
6. Rename roles to the canonical enum in transition/approval records.
7. Bump `schemaVersion` to `1.2`.
8. **Do not** invent digests: an unmigrated field stays `UNBUILT`/`NOT_RUN` rather
   than being filled to satisfy a schema.

## 4. What does NOT change (doctrine preserved)

- `resourceType` (what) stays orthogonal to `qualityLevel` (maturity),
  `verificationStatus`, `usePolicy`, `publicationStatus`, `implementationLevel`.
- Legacy `L1–L4` remain **product lines**, never a resource type or quality level.
- A schema PASS is **never** a commercial certification.
- No license / security / tenant / payment / release-approval / L0–L3 gate is lowered.

## 5. Foundation V1.0.1 merge notes

| Foundation doc | V1.2 note |
|---|---|
| `00_README` / `02_PRODUCT_LINES_SCOPE` | product lines `L1–L4` still exist in the frozen Foundation text; the factory rejects them as `resourceType`. A future human change should adopt semantic product-line names. **Not done here** (`Source/**` frozen). |
| `04_MODULE_TEMPLATE_CONTRACT` | adopt the detached-object model (`resource-state` / `deployment-eligibility-decision`) instead of manifest-embedded keys. |
| `06_OSS_IP_POLICY` | unchanged; `originStrategy` adds a machine-checkable license-distribution flag for `REUSE`. |
| `07_QUALITY_ACCEPTANCE` | original commercial GA hard gates retained; V1.2 only makes L0–L3 and `usePolicy` machine-checkable. |
| `12_PROTOTYPE_RESOURCE_SPEC` | prototype 1:N and `design-only/interactive-mock/integrated` unchanged; `PROTOTYPE_INTEGRATED` is now a conditional-gate trigger. |

**Case convention** (CF-6): Foundation wrote `Cataloged|Verified|Release-ready`;
the factory canonical form is `CATALOGED|VERIFIED|RELEASE_READY`. Any merged
validator must normalise to the upper snake form.

## 6. Residual compatibility risks

- Downstream tools that read `qualityLevel` from the manifest will silently miss
  it; they must read `resource-state` instead. This is **intended** but must be
  announced before merge.
- `constraints`, `owner`, `riskClass`, several batch/gate fields became required;
  old examples will fail until migrated (see §3).
- CF-9 remains PARTIAL; some stated invariants are still prose-only (see
  `REVISION_MANIFEST.md` §3).
