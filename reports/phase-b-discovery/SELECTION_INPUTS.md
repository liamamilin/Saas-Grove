# SELECTION_INPUTS.md — Inputs for a human `SelectionDecision` (NOT a decision)

> **This document does not select anything.** Per `03_DISCOVERY_SELECTION.md` §SelectionDecision and
> `06_OSS_IP_POLICY.md`, a `SelectionDecision` requires a **human Product Owner + License Reviewer**.
> This file packages the inputs they need, with every unresolved item marked `UNKNOWN`/`REVIEW_REQUIRED`.

## 0. Decision metadata (blank — to be completed by humans)

| Field | Value |
|---|---|
| `decisionId` | _TBD_ |
| `targetId` | Pilot A `saas-core-module` / Pilot B `business-saas-template` / Pilot C `ai-native-template` |
| `decidedBy` / `decidedByRole` | _TBD (Product Owner)_ |
| License reviewer | _TBD (License Reviewer)_ |
| Date | _TBD_ |
| Decision status | **`NOT_STARTED`** (discovery complete only) |
| Payload frozen? | **NO** — nothing built, so no payload/`artifactSha256` exists |

---

## 1. Pilot A — `saas-core-module`

### 1.1 Candidate list (with rejection reasons)

| Option | Source | License | Route | Note |
|---|---|---|---|---|
| A-1 integrate official Java SDK | `wechatpay-apiv3/wechatpay-java` `1dab7be…` | Apache-2.0 | INTEGRATE | only if host language = Java |
| A-2 integrate official PHP SDK | `wechatpay-apiv3/wechatpay-php` `3c9f5c2…` | Apache-2.0 | INTEGRATE | most recently maintained |
| A-3 integrate official Go SDK | `wechatpay-apiv3/wechatpay-go` `6dbd7ce…` | Apache-2.0 | INTEGRATE | only if host language = Go |
| A-X build first-party TS adapter | official doc set (11 pages) | our code | **BUILD_FROM_SPEC** | **required — no official Node SDK** |
| A-W2 fork third-party Node wrapper | npm `wechatpay-node-v3` | `UNKNOWN` (text) | — | **REJECTED** (stale ~2y, no review) |

### 1.2 Trade-offs / needed new capability / risks / TCO

- **Best & alternative (input):** `INTEGRATE`(official SDK) **+** `BUILD_FROM_SPEC`(adapter). Alternative: pure direct-HTTPS `INTEGRATE` with our own crypto (more first-party code).
- **Capabilities to add:** signing/verification, AES-GCM decrypt, idempotency keys, refund state machine, reconciliation import, mock server.
- **TCO — `ESTIMATE`:** 5–10 eng-days mock-only L1; real-channel cost/licence `UNKNOWN` (offline).
- **Core risks:** no vendor sandbox; no official Node SDK; secret/cert handling; mock≠production divergence.
- **UNKNOWNs to close:** A-U1…A-U8.

---

## 2. Pilot B — `business-saas-template`

### 2.1 Candidate list (with rejection reasons)

| Option | Source | License | SHA / tag | Route | Note |
|---|---|---|---|---|---|
| B-4 Krayin | `krayin/laravel-crm` | **MIT** | `e597417…` / v2.2.6 | **FORK** (only copyleft-free) | needs dep + Webkul-asset scan |
| B-3 EspoCRM | `espocrm/espocrm` | AGPL-3.0 | `f990998…` / 10.0.10 | reference only | best native `stage` model |
| B-2 Frappe CRM | `frappe/crm` | AGPL-3.0 | `0baa1e8…` / v1.88.0 | reference only | Python/Frappe |
| B-1 Twenty | `twentyhq/twenty` | AGPL + Enterprise + MIT | `5d39928…` / v2.47.0 | **not REUSE** | richest; §7 "Application Exception" helps INTEGRATE only |
| B-5 Dolibarr | `Dolibarr/dolibarr` | GPL-3.0 | `cccf779…` | _REVIEW_REQUIRED_ | ERP-scale |
| B-6 Odoo | `odoo/odoo` | LGPL (+OEEL) | _not locked_ | **REJECTED as base** | brand/dual-license complexity |
| B-7 Monica | `monicahq/monica` | AGPL-3.0 | _not locked_ | **REJECTED (domain)** | personal CRM, no opportunity |
| _Build native_ | — | our code | — | **BUILD_FROM_SPEC** | lowest license risk |

### 2.2 Trade-offs / needed new capability / risks / TCO

- **Best & alternative (input):** `BUILD_FROM_SPEC` native domain, optionally seeded by an **MIT `FORK` (B-4)**. Alternative: none that is closed-source-clean (all others AGPL/GPL).
- **Capabilities to add:** `customer/contact/opportunity` CRUD, stage transitions, role/permission model, migrations, deployment.
- **TCO — `ESTIMATE`:** 15–30 eng-days to L1→L2.
- **Core risks:** copyleft contamination; trademark misuse (Webkul/Odoo); asset/font/demo-data licensing debt.
- **UNKNOWNs to close:** B-U1…B-U8.

---

## 3. Pilot C — `ai-native-template`

### 3.1 Candidate list (with rejection reasons)

| Option | Source | License | SHA / tag | Route |
|---|---|---|---|---|
| C-2 Hatchet | `hatchet-dev/hatchet` | MIT | `56c617e…` / v0.110.5 | INTEGRATE |
| C-1 Temporal | `temporalio/temporal` | MIT | `af08a5e…` / v1.32.1 | INTEGRATE |
| C-6 BullMQ | `taskforcesh/bullmq` | MIT | `a75e99c…` | REUSE/INTEGRATE (library) |
| C-7 pg-boss | `timgit/pg-boss` | MIT | `d440085…` | INTEGRATE |
| C-10 Vercel AI SDK | `vercel/ai` | Apache-2.0 | `8a5233b…` | REUSE/dependency |
| C-15 next-forge `packages/ai` | local `f189de7…` | MIT + REVIEW_REQUIRED | — | REUSE (existing baseline) |
| C-4 Restate | `restatedev/restate` | BSL 1.1 | `bc456b3…` / v1.8.0 | `REVIEW_REQUIRED` |
| C-5 Inngest | `inngest/inngest` | SSPL v1.0 | `5bfb552…` | **REJECTED (REUSE)** |
| C-X windmill | `windmill-labs/windmill` | Apache+AGPL+proprietary | — | **REJECTED as base** |
| C-12 LiteLLM | `BerriAI/litellm` | MIT + `enterprise/` | — | `REVIEW_REQUIRED` (enterprise dir) |

### 3.2 Trade-offs / needed new capability / risks / TCO

- **Best & alternative (input):** `COMPOSE` = INTEGRATE (MIT engine) + REUSE (Apache-2.0 AI SDK) + **BUILD_FROM_SPEC** (artifact ACL, cost ceiling). Alternative: BullMQ/pg-boss embedded (lighter), losing managed durability.
- **Capabilities to add:** job persistence wiring, progress/cancel, retry policy, **cost ceiling**, **artifact tenant ACL**, execution audit.
- **TCO — `ESTIMATE`:** 10–20 eng-days for the first-party layer.
- **Core risks:** vendoring BSL/SSPL; trusting durability CLAIMs; mock/sandbox/Live labeling; engine becoming an authority for tenant-scoped artifacts.
- **UNKNOWNs to close:** C-U1…C-U6.

---

## 4. Cross-pilot unresolved items the reviewers must adjudicate

| ID | Item | Blocks |
|---|---|---|
| P-1 | Official WeChat Pay sandbox is **V2-only** and cannot serve APIv3; its own access requires a real `mch_id` | Pilot A L1 plan |
| P-2 | No official WeChat Pay Node SDK | Pilot A adapter scope |
| P-3 | AGPL/GPL usage-mode decisions (B-1/B-2/B-3/B-5/B-7) | Pilot B `REUSE` |
| P-4 | Webkul/Odoo trademark + asset terms | Pilot B distributable template |
| P-5 | BSL/SSPL adjudication (C-4/C-5) | Pilot C engine choice |
| P-6 | Model-provider service terms (C-U1) | any real model call |
| P-7 | Transitive dependency (SBOM) licenses — all pilots | every `PASS` above is root-file only |
| P-8 | Per-call evidence timestamps | evidence integrity (should be tightened next run) |
| P-9 | **Tag-vs-HEAD SHA ambiguity** in the candidate register (attempt-1 defect) | pinning discipline; all candidates must be re-pinned to a tag commit or an explicit `branch@sha` |

## 5. What is explicitly NOT provided here

- No `bestSolution` / `alternativeSolution` is *declared*; only candidate trade-offs.
- No approval, no signature, no `PRODUCTION_ELIGIBLE` verdict.
- No authorisation to transform, fork, vendor, or integrate any source.
