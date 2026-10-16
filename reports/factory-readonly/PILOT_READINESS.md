# PILOT_READINESS.md — Three pilots: readiness, evidence, sandbox plan, cost, blockers

**Read-only planning only. No pilot is authorised to run. Costs are rough estimates,
explicitly marked ESTIMATE, derived from spec text — not from any real execution.**

## 0. Environment / method

- macOS (darwin), Python 3.10.13, jsonschema 4.26.0, no network, read-only.
- Evidence base: Factory `00`–`20`, `examples/*`, `schemas/*`; Foundation `04/06/07/08/12`;
  local `Source/next-forge` @ `f189de79ceef7c1ef69f61f12e272f99b4cdb699` (clean).
- **Nothing was built, installed, migrated, or called.** All Live capabilities are NOT_RUN.

---

## Pilot A — WeChat Pay adapter (`saas-core-module`, target L1, `usePolicy=SANDBOX_ONLY`)

| Item | Finding |
|---|---|
| Candidate & version | **No reviewable local source.** next-forge `packages/payments` = Stripe only (`stripe`, `@stripe/agent-toolkit`); keys are `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`. SHA not applicable. |
| License & code/asset limits | **UNKNOWN** for any WeChat SDK/wrapper (offline). next-forge parts: MIT + REVIEW_REQUIRED. |
| Missing capabilities | `payment.create`, `payment.query`, `payment.verify-webhook`, `payment.idempotency`; also the catalog's external dep `saas.billing-core` is `UNSELECTED`/`UNVERIFIED`. |
| Selection advice | `INTEGRATION` first-party adapter over an **audited mock/sandbox server**; treat real collection as a separate future task. Not `FORK` of an unvetted wrapper. |
| Required evidence — L1 | `G-ORIGIN`, `G-LICENSE`, `G-BUILD`, `G-CORE`, `G-SECURITY`, `G-SCOPE`, `G-ISOLATION` + `P-SIGN`, `P-IDEMPOTENCY`, `P-LEDGER` on sandbox. `P-REFUND` only if the sandbox supports it, else BLOCKED. |
| Required evidence — L2/L3 | As §A plus channel-capability matrix; L3 would need `G-REUSE` etc. **Not targeted now.** Real-collection gates `P-LIVE-QUALIFICATION`/`P-LIVE-TEST`/`P-RECONCILE` remain **HUMAN + real channel**, never derived from L3. |
| Minimal sandbox plan | Isolated container, **no host keys**, no real DB, outbound default-deny + allowlist to a local mock; synthetic orders; forge-signature / duplicate-notification / cross-tenant / refunded-again / out-of-order / network-retry negatives; 4-layer guard; checkpoint + rollback rehearsal. |
| Estimated cost | **ESTIMATE**: engineering days ≈ 5–10 (≈$0 cash) for mock-only L1; **real** channel qualification cost/licence = **UNKNOWN** (merchant qualification obtainable only off-repo). |
| Blockers | (1) no reviewable source offline → **BLOCKED**; (2) authoritative WeChat Pay API docs unverifiable offline → **BLOCKED**; (3) unresolved external dep `saas.billing-core`. |

**Pilot A status: BLOCKED (pre-discovery).** Do not claim any payment capability.

---

## Pilot B — CRM template (`business-saas-template`, target L2, ≥2 candidates required)

| Item | Finding |
|---|---|
| Candidate & version | **Only one local source (next-forge)** and it has **no CRM domain**; not a CRM candidate. Multi-candidate requirement **FAIL**. |
| License & code/asset limits | next-forge MIT + REVIEW_REQUIRED sub-issues (per-package SPDX absent, no NOTICE, brand-asset + font risk). CRM candidate #2: UNKNOWN. |
| Missing capabilities | Local: no `customer.*`, `contact.list`, `opportunity.list`, `opportunity.move-stage`. next-forge supplies auth/tenancy/db/UI only. |
| Selection advice | `NATIVE` first-party CRM domain on an audited baseline, **or** `FORK` an externally discovered MIT/Apache CRM **after** License Reviewer sign-off. `INTEGRATION` rejected as default. |
| Required evidence — L1 | L0→L1 gates + first small closed loop (`customer.create`/`list`). |
| Required evidence — L2 | `G-DOMAIN-COMPLETE`, `G-AUTHZ`, `G-FAILURES`, `G-INSTALL`, `G-MIGRATION`, `G-OPERATIONS`; `B-ROLE-ACL`, `B-DATA-INTEGRITY`, `B-DEPLOY`. Plus for the 2 declared `integrated` prototypes: `U-BINDING`, `U-LIVE-ACTION`, `U-PERMISSION`, `U-ASSET-LICENSE`, with two variants on **one locked template version** sharing comparable coverage (`12_PROTOTYPE_RESOURCE_SPEC.md` §6). |
| Required evidence — L3 | `G-REUSE` (≥2 real, distinct integrations), `G-UPGRADE`, `G-RESILIENCE`, `G-UX`, `G-MAINTENANCE`. |
| Minimal sandbox plan | Isolated test instance, temp DB, synthetic tenants; two prototypes on common coverage; negative authz (role escalation, cross-tenant), migration + rollback rehearsal, prototype-switch data-invariance regression. |
| Estimated cost | **ESTIMATE**: engineering days ≈ 15–30 for L1→L2 first-party CRM (≈$0 cash, excluding optional SaaS services); projections deliberately withheld (no real data). |
| Blockers | (1) **no second CRM candidate offline** → selection mechanism UNTESTED; (2) domain must be built first-party or sourced under a cleared license; (3) prototype asset licensing unverified. |

**Pilot B status: BLOCKED / INSUFFICIENT candidates.**

---

## Pilot C — AI Workflow template (`ai-native-template`, target L2)

| Item | Finding |
|---|---|
| Candidate & version | next-forge `packages/ai` @ `f189de7…`: `ai ^6.0.116`, `@ai-sdk/openai ^3.0.41`, `streamdown`, `zod`. Provider-adapter layer only. |
| License & code/asset limits | MIT root + REVIEW_REQUIRED sub-issues; model-provider **service terms** unverified (UNKNOWN). |
| Missing capabilities | Durable queue/persistence, progress, retry/cancel, cost ceiling, artifact ACL — **none present** (repo search: no queue/workflow engine). |
| Selection advice | `COMPOSE`: next-forge `packages/ai` for provider adapters + **first-party durable job layer**; or an externally-audited workflow engine after copyleft classification. Never a raw model call. |
| Required evidence — L1 | L0→L1 gates + one multi-stage path with `A-LIVE-MOCK-LABEL` truthful (mock vs sandbox/Live clearly separated). |
| Required evidence — L2 | multi-stage success path + `A-JOB-RECOVERY`, `A-COST-LIMIT`, `A-ARTIFACT-ACL`, tenant isolation, untrusted-output handling, audit; negatives: network interruption, model timeout, concurrent cancel, budget exhaustion, cross-tenant artifact access, resume-rerun. |
| Required evidence — L3 | `G-REUSE`, `G-UPGRADE`, `G-RESILIENCE`, `G-UX`, `G-MAINTENANCE` — not targeted now. |
| Minimal sandbox plan | Isolated runtime; **mock model first**, then optional restricted test key under an approved budget cap; no production PII; execution logs + cost per run; cancel/retry/recovery drills. |
| Estimated cost | **ESTIMATE**: engineering days ≈ 10–20 for first-party job layer (≈$0 cash on mock; small, capped model spend only if a later phase approves a test key — amount **UNKNOWN**). |
| Blockers | (1) no durable workflow engine locally; (2) real model terms/costs UNKNOWN; (3) any real call requires a separate budget approval. |

**Pilot C status: PARTIAL — adapter layer present, execution engine MISSING.**

---

## Cross-pilot Factory acceptance (from `12_PILOT_PLAN.md` §跨试点)

| Criterion | Status |
|---|---|
| One schema set expresses all three types without one-off fields | PARTIAL (schema covers 3 targets; conflicts exist — see `CONFLICT_AND_UNKNOWN.md`) |
| Real reproducible discovery→selection→L1 evidence | **NOT_RUN** (BLOCKED for all three) |
| Verification ≠ production eligibility not conflated | PASS (discipline enforced in these reports) |
| Negative isolation test blocks production paths | **NOT_RUN** |
| Cost/rework reason recorded | PARTIAL (estimates only; one rejection recorded: Pilot B candidate #2 absent) |
| Registry lookup (version/license/hash/origin/tests/install/withdraw) | **NOT_RUN** |
| 4th line claimable | **NO** — scheme only |

## Main risks

- Any attempt to start a sandbox from this state would breach the read-only boundary and could
  touch Stripe/Clerk/Neon-adjacent credentials → must remain stopped.
- Estimation uncertainty is high; treat all $ figures as planning placeholders.

## Minimal next step

Approve a discovery-only sub-phase to make Pilots A/B/C **discoverable**, then author the three
ADRs. Do not begin sandbox production.

## Approval request

Request human decision on: (a) acknowledge all three pilots are BLOCKED/NOT-RUN; (b) authorise
or defer the discovery-only sub-phase; (c) confirm no sandbox production is authorised.
