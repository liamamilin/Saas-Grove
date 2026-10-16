# QUALITY_GATE_PROFILES.md — Draft Gate Profiles for the four resourceTypes

Draft, per `09_EVIDENCE_AND_ACCEPTANCE.md` + `14_GATE_PROFILES.md`. These are **baselines to
be converted into an executable verifier or a human review sheet**. Gate IDs are the *names*
only; the current reference engine (`scripts/validate_attestation.py`) checks field consistency,
**not** the truth of any gate.

Legend — **AUTO** = objectively machine-checkable in principle; **HUMAN** = requires independent
human review; **MIXED** = machine-assisted but human-signed.

## 0. Common L0→L1 gates (all types)

| Gate | Standard | Method | AUTO/HUMAN |
|---|---|---|---|
| `G-ORIGIN` | traceable origin commit/tag + modification range | locked SHA + provenance | MIXED |
| `G-LICENSE` | code+assets+deps licensed for the intended distribution | SBOM, license texts, NOTICE, review record | **HUMAN** (role `LICENSE_REVIEWER`) |
| `G-BUILD` | reproducible build from clean workspace | commands, lockfile, build log, hash | MIXED |
| `G-CORE` | minimal declared capability passes in isolated env | scenario E2E/integration | AUTO (+review) |
| `G-SECURITY` | no unmitigated critical risk; no credential/data leak | static/dep scan, negative authz tests, human risk assessment | **HUMAN** (role `SECURITY_REVIEWER`) |
| `G-SCOPE` | supported vs uncovered/mock-only documented | manifest/README/test matrix | MIXED |
| `G-ISOLATION` | process/test did not write host/production | 4-layer guard report | MIXED |

**Blocking rule (do not weaken):** any non-PASS in `G-LICENSE`, `G-SECURITY`, `G-ISOLATION`
blocks release. L0 candidates may lack these but stay in the candidate quarantine only.

## 1. `saas-core-module` (Pilot A — WeChat Pay adapter)

Inherits §0, plus:

| Gate | Applies when | AUTO/HUMAN |
|---|---|---|
| `P-SIGN` (webhook signature verification) | payment declared | AUTO (negative: forged signature rejected) |
| `P-IDEMPOTENCY` (duplicate event) | payment declared | AUTO |
| `P-LEDGER` (order/entitlement ledger, no double-grant) | payment declared | AUTO |
| `P-REFUND` (refund/out-of-order) | refund declared | AUTO if sandbox supports; else **BLOCKED** |
| `P-CHANNEL-CAPABILITY` (capability matrix) | always | MIXED |
| `P-LIVE-QUALIFICATION`, `P-LIVE-TEST`, `P-RECONCILE` | **only if real collection claimed** | **HUMAN + real channel** |
| module uninstall/upgrade impact, key isolation | always (type-specific, `05` §A) | MIXED |

**For this pilot: `usePolicy = SANDBOX_ONLY` until `P-LIVE-*` PASSes.** A L1–L3 label never
substitutes for merchant qualification (`06_QUALITY_LEVELS.md` §B; `14` §"环境生产准入").

## 2. `business-saas-template` (Pilot B — CRM) — L1→L2 / L2→L3

Inherits §0 and §1's non-payment gates (payment gates only if billing is included).

**L1→L2 increments:**

| Gate | AUTO/HUMAN |
|---|---|
| `G-DOMAIN-COMPLETE` (declared business flow closed loop) | AUTO + review |
| `G-AUTHZ` (role/object/tenant read-write authz) | AUTO |
| `G-FAILURES` (exceptions, concurrency, dup/out-of-order, recovery) | AUTO |
| `G-INSTALL` (independent install/config, precise error on missing config) | MIXED |
| `G-MIGRATION` (upgrade/migration/rollback reproduced) | AUTO + review |
| `G-OPERATIONS` (triage via logs/trace/ids; support scope) | MIXED |
| `B-ROLE-ACL`, `B-DATA-INTEGRITY`, `B-DEPLOY` (SaaS-specific) | MIXED / **HUMAN** for data integrity |

**L2→L3 increments:** `G-REUSE` (≥2 distinct real integrations), `G-UPGRADE`,
`G-RESILIENCE`, `G-UX`, `G-MAINTENANCE`.

**Prototype sub-resources (0..N):** `U-BINDING`, `U-LIVE-ACTION`, `U-PERMISSION`,
`U-ASSET-LICENSE` — required only when a prototype's `implementationLevel=integrated`.
`U-ASSET-LICENSE` is **HUMAN**. `design-only`/`interactive-mock` may not claim real business
execution (`12_PROTOTYPE_RESOURCE_SPEC.md` §3, §6).

## 3. `ai-native-template` (Pilot C — AI Workflow) — L1→L2

Inherits §0, plus type-specific:

| Gate | Standard | AUTO/HUMAN |
|---|---|---|
| `A-LIVE-MOCK-LABEL` | mock vs Live labelled truthfully | AUTO (record inspection) + review |
| `A-JOB-RECOVERY` | timeout/cancel/retry/persistence | AUTO |
| `A-COST-LIMIT` | budget ceiling enforced; cost per tenant/artifact | AUTO |
| `A-ARTIFACT-ACL` | artifact access permission per tenant | AUTO |
| tenant isolation / untrusted model output / audit + security approval | always | MIXED; **HUMAN** for security approval |

**Gate for this pilot also inherits `G-DOMAIN-COMPLETE`-equivalent** ("input → multi-stage →
artifact" closed loop), `G-FAILURES`, `G-INSTALL`, `G-MIGRATION` (job-state durability).

## 4. `saas-ai-module` (read-only scheme only — fourth line, NOT exercised)

Inherits §0, plus:

| Gate | Standard | AUTO/HUMAN |
|---|---|---|
| `X-ADAPTER-AUTH` | each integration's authority decided by the SaaS server | AUTO (negative) |
| `X-APPROVAL` | tool actions require approval token; replay-prevented; expiry | AUTO |
| `X-PROMPT-INJECTION` | retrieved malicious instructions cannot change authz | AUTO (negative) |
| `X-TRACE` | full action traceability | AUTO |

**L3 precondition (do not waive):** ≥2 real integrations across **different business
boundaries**, and proof the 2nd integration adds only adapter/config without changing the
generic AI core (`05_PRODUCTION_PROTOCOLS.md` §D).

### Declared as scheme-only this phase

Per `12_PILOT_PLAN.md` §跨试点 7: if the 4th line has not been exercised,
**"four-line generic factory" must NOT be claimed complete.** This report implements that
restriction: type 4 remains a **read-only draft**.

## 5. Environment production eligibility (independent of L level)

`PRODUCTION_ELIGIBLE` requires all Foundation GA/security/license gates AND a locked artifact
hash + deployment scope + key/recovery plan + operational rehearsal + human release approval
(`14_GATE_PROFILES.md` §环境生产准入). Even at L3, if `P-LIVE-TEST` is not PASS, the payment
resource stays `SANDBOX_ONLY`.

## 6. What the reference engine actually automates today (honest boundary)

| Capability | Status |
|---|---|
| Schema shape validation | PASS (implemented) |
| L0-not-publishable, digest/scope/profile matching, expiry, missing gate, builder self-cert, license/security role checks | PASS (implemented, `tests/`) |
| Truth of any log/scan/license text, real sandbox isolation, real payment, real model call | **NOT_RUN / impossible with current engine** |
| Content-addressed storage, evidence signatures, authorization system | **NOT_RUN** |

## 7. Verification status

| Item | Status |
|---|---|
| Four draft profiles produced | PASS (draft) |
| Profile executable / linked to real validator | **NOT_RUN** |
| Any gate actually evaluated on a real resource | **NOT_RUN** |
| Human-review gates assigned an accountable role | defined (roles exist in `01_GOVERNANCE_SCOPE.md`) |

## 8. Main risks

- Draft gate lists could be mistaken for an implemented acceptance suite.
- `GateProfile` schema currently lacks `conditional[]`, `validationMethod`, `expiryPolicy`,
  `owner` (see `CONFLICT_AND_UNKNOWN.md`) → cannot yet encode conditional activation.

## 9. Minimal next step

Convert §1–§4 into versioned `profileId@version` JSON per resourceType, then map each gate to
an AUTO verifier or a HUMAN review sheet. Do not claim any gate PASS before that mapping runs
on a frozen artifact digest.

## 10. Approval request

Approve the four draft profiles as the acceptance **baseline** (not as evidence), and note that
the 4th type remains scheme-only and unverified.
