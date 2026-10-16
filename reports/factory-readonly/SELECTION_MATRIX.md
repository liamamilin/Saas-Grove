# SELECTION_MATRIX.md — Multi-candidate selection (read-only draft)

Selection vocabulary per `03_DISCOVERY_SELECTION.md`: `NATIVE` / `FORK` / `INTEGRATION` /
`COMPOSE` / `BUILD_NEW` / `ABANDON`. **Hard gates precede scoring.** Scores are decision aids
only and never override a license/security/tenant/payment gate.

**All matrices below are planning drafts. No SELECT decision is final without an approved ADR
and a License Reviewer verdict. Every remote candidate is UNKNOWN (no network this phase).**

## 1. Evidence / environment

- Environment: macOS, Python 3.10.13, jsonschema 4.26.0; no network; read-only.
- Local evidence: `Source/next-forge` @ `f189de7…` (clean, MIT root license, per-package
  license fields absent); Factory + Foundation specs.
- Integrity PASS recorded in `CATALOG_VALIDATION.md` §3.3.

## 2. Hard-gate screen (applied first)

| Gate | Definition (from `03`/`06`/`14`) | Applies to |
|---|---|---|
| HG-LICENSE | Cannot be used for intended commercial distribution; assets not re-redistributable | all |
| HG-SECURITY | Unacceptable defect with no isolation mitigation | all |
| HG-CORE | Core capability absent or unverifiable | all |
| HG-TENANT/PAYMENT | Cross-tenant access / real funds without qualification | A, B |
| HG-SOURCE | No verifiable origin (SHA/license) | all |

**Screen result:** for every **remote** candidate, HG-SOURCE is not even satisfiable offline →
they are `REVIEW_REQUIRED`/UNKNOWN, not pre-approved. next-forge clears origin but **fails
HG-LICENSE as-is** (per-package SPDX absent, no NOTICE, brand assets, unverified transitive
licenses) → `REVIEW_REQUIRED`.

## 3. Pilot A — WeChat Pay adapter (`saas-core-module`, target L1, SC=10)

| Candidate | Delivery form | Fit | License | Blockers | Verdict |
|---|---|---|---|---|---|
| Official WeChat Pay APIv3 SDK (any language) | INTEGRATION (adapter over SDK) | provider-specific; matches `PaymentProvider` contract | UNKNOWN | authoritative docs/SDK unavailable offline; merchant qualification absent | **REVIEW_REQUIRED → BLOCKED** |
| Third-party Node wrapper | FORK/COMPOSE | unknown | UNKNOWN | license/security/maintenance unverifiable offline | **BLOCKED** |
| next-forge `packages/payments` as scaffold | BUILD_NEW (first-party adapter) | Stripe-only; no WeChat | MIT (Stripe terms for Stripe parts) | no WeChat capability; needs first-party adapter + mock server | **partial basis only** |

**Local capability gap (evidence):** `Source/next-forge/packages/payments/` contains only
`stripe` + `@stripe/agent-toolkit`; `packages/payments/keys.ts` declares only
`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`. → **No WeChat Pay code exists locally.**

**Recommended form (draft, not approved):** `INTEGRATION` — a first-party `PaymentProvider`
adapter behind an audited mock/sandbox server, targeting **L1 + `usePolicy=SANDBOX_ONLY`** only.
Real collection is a **separate future task** (foundation `08_ROADMAP.md` Phase 2;
Factory `05_PRODUCTION_PROTOCOLS.md` §A, `14_GATE_PROFILES.md` §"真正收款上线").

## 4. Pilot B — CRM template (`business-saas-template`, target L2, requires ≥2 candidates)

| Candidate | Delivery form | CRM domain? | License | Notes |
|---|---|---|---|---|
| next-forge | NATIVE base + **BUILD_NEW domain** | **NO** (foundation only) | MIT + REVIEW_REQUIRED issues | supplies auth/tenancy/db/UI; produces **no CRM** without first-party business code |
| Candidate #2 | — | UNKNOWN | UNKNOWN | **not available locally; network required** |

**Multi-candidate status: FAIL.** `12_PILOT_PLAN.md` §Pilot B requires two reviewable
candidates or an explicit statement of insufficiency. Only one local source exists and it is
not a CRM → per the spec's own allowance ("若不足则明确") this is recorded as
**INSUFFICIENT — selection capability UNTESTED for Pilot B.**

**Recommended form (draft):** `NATIVE` (first-party CRM domain on an audited next-forge
baseline) **or** `FORK` of an externally discovered MIT/Apache CRM **only after** network
discovery + License Reviewer sign-off. `INTEGRATION` is rejected as a *default* because a
CRM template must own its domain model/tenant boundary, and `INTEGRATION` "must not pose as
delivering a third-party SaaS's source" (`04_RESOURCE_CONTRACT.md`).

## 5. Pilot C — AI Workflow template (`ai-native-template`, target L2)

| Candidate | Delivery form | Workflow capability | License | Blockers |
|---|---|---|---|---|
| next-forge `packages/ai` | COMPOSE (adapter + BUILD_NEW orchestration) | model adapter only; **no durable queue/workflow** | MIT + REVIEW_REQUIRED | needs first-party workflow/queue/persistence, cost caps, artifact ACL |
| External workflow engine (e.g. durable-execution libs) | COMPOSE | UNKNOWN | UNKNOWN | unverifiable offline; may carry AGPL/BSL — needs use-mode assessment |

**Local capability gap (evidence):** repo-wide search for `queue|workflow|job|inngest|trigger|temporal|bullmq`
tracked files yields only `.github/workflows/release.yml` and `packages/notifications/components/trigger.tsx`
→ **no execution engine**. `05_PRODUCTION_PROTOCOLS.md` §C requires persistent queue,
retry/cancel, cost ceiling, artifact permissions — all **MISSING**.

**Recommended form (draft):** `COMPOSE` — next-forge `packages/ai` for provider adapters +
**first-party** durable job layer, OR an externally-audited workflow engine (License Reviewer
must classify copyleft before any closed-source distribution).

## 6. Cross-pilot scoring (illustrative, do NOT treat as approval)

Weights are placeholders pending an approved `selectionPolicy`. Only the local candidate can be
scored at all; remote candidates are UNKNOWN and left unscored (no fabricated scores).

| Dimension (weight placeholder) | User capability | All local work is UNKNOWN/unscored | Notes |
|---|---|---|---|
| Business coverage | — | next-forge: 0 for CRM/WeChat/workflow domain | foundation ≠ domain product |
| Architecture fit | — | high for Next.js/Turborepo targets | matches Foundation stack |
| Quality & tests | — | next-forge tests exist (`vitest`) but not run this phase → NOT_RUN | |
| Maintenance sustainability | — | upstream active (v6.0.2, May 2026) | |
| Rework cost | — | high (must BUILD_NEW CRM/WeChat/workflow layers) | |
| Dependency/geo cost | — | China availability of Clerk/Stripe/Upstash = UNKNOWN | |

## 7. Verification status

| Item | Status |
|---|---|
| Hard-gate screen on local candidate | PASS (screen applied) → verdict REVIEW_REQUIRED |
| Pilot A selection | **BLOCKED** (no reviewable source offline) |
| Pilot B multi-candidate selection | **FAIL / BLOCKED** (only 1 source, not a CRM) |
| Pilot C selection | **PARTIAL** (adapter layer present, engine MISSING) |
| Any SELECT/ADR produced | **NOT_RUN** (deferred to approved phase) |

## 8. Main risks

- Selecting a CRM/AI/WeChat source on cosmetic signals (stars, README, "MIT badge") is
  explicitly prohibited (`03_DISCOVERY_SELECTION.md` §"不合理选择示例").
- Treating next-forge as a CRM would violate the "no fifth product line / foundation ≠ product" rule.

## 9. Minimal next step

Run an approved network-scoped **discovery-only** pass to produce ≥2 real CRM candidates and
the WeChat/workflow leads with SHAs + license texts; then convene a License Reviewer and
Product Owner to author `SelectionDecision`s.

## 10. Approval request

Approve or reject: (a) accepting the REVIEW_REQUIRED/BLOCKED verdicts above; (b) authorising
the discovery-only pass. No build, fork, install, or payment action is requested.
