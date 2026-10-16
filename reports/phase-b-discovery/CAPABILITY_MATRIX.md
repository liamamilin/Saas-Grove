# CAPABILITY_MATRIX.md — Phase B capability coverage (evidence-based)

> Coverage is asserted **only** where a real file/endpoint was read. `CLAIM` marks README-level
> statements not verified in source. `MISSING` means no evidence found. Nothing here is a quality score.

## 0. Method

| Field | Value |
|---|---|
| Retrieval date | 2026-10-16 (UTC); per-call timestamps `UNKNOWN` |
| Evidence types | license files, doc `.md` endpoints, source models (`*.php`, `*.ts`, `*.json`), `composer.json`/`pyproject.toml`, git tree listings |
| Not done | no install/build/execute; no live API/model call |

---

## 1. Pilot A — WeChat Pay required capabilities

| Capability (from `05_BILLING_CHINA_PAYMENTS.md`) | Official APIv3 support | Evidence | Route | Status |
|---|---|---|---|---|
| unified order create | **YES** | `POST /v3/pay/transactions/jsapi` → `prepay_id` (doc 4012791856) | INTEGRATE + BUILD_FROM_SPEC | `PASS` (documented) |
| order query | **YES** | `GET /v3/pay/transactions/id/{transaction_id}` (doc 4012791858) | INTEGRATE | `PASS` |
| notification signature verification | **YES** | verify via 微信支付公钥 / 平台证书 (docs 4013053249, 4013053420) | BUILD_FROM_SPEC | `PASS` |
| notification decryption | **YES** | AES-256-GCM w/ APIv3 密钥 (doc 4012071382) | BUILD_FROM_SPEC | `PASS` |
| refund | **YES** (production) | `POST` refund; ≤50 partial refunds; reuse refund no. on retry; 150 QPS (doc 4012791862) | BUILD_FROM_SPEC | `PASS` |
| refund query | **YES** | `GET /v3/refund/domestic/refunds/{out_refund_no}` (doc 4012791863) | INTEGRATE | `PASS` |
| reconciliation (trade bill) | **YES** | `GET /v3/bill/tradebill`; daily ≥10:00; ≤3 months (doc 4012791866) | BUILD_FROM_SPEC | `PASS` |
| **sandbox environment** | **YES — but V2-only** | Official 仿真测试系统: `"微信支付团队开发了一套独立的仿真测试系统"`; entry = `xdc/apiv2sandbox` path prefix (doc 4011984810) | first-party mock for APIv3 | **`PASS`** (exists) / **`FAIL`** (cannot serve APIv3) |
| sandbox refund support | **not covered** | documented sandbox cases = 付款码支付 success/exception + 查单 only | — | **`UNKNOWN`** |
| sandbox callback signature parity | **not testable for V3** | doc asserts protocol parity, but that is the **V2** (XML/MD5) protocol; V3 has no sandbox entry point | — | **`UNKNOWN`** |
| sandbox reachable without onboarding | **NO** | `sandbox_signkey` requires a real `mch_id` | — | **`BLOCKED`** (offline) |
| official **Node.js** SDK | **NO** | official org = Java/PHP/Go; doc: `"官方SDK（目前包含Java、PHP、Go三种语言版本）"` | BUILD_FROM_SPEC | `PASS` (negative confirmed) |
| official Java/PHP/Go SDK | **YES** | `wechatpay-apiv3/{wechatpay-java,wechatpay-php,wechatpay-go}` | INTEGRATE / REUSE | `PASS` |
| merchant qualification | **offline** | out of scope | — | `BLOCKED` (offline) |

**Pilot A conclusion:** API-side capabilities are fully documented and reachable. An official sandbox
**does** exist — but it is a **V2 instrument** (`xdc/apiv2sandbox`) that explicitly cannot serve
统一下单 and therefore **cannot exercise any APIv3 flow**. No WeChat-provided environment can verify
the APIv3 adapter, so a **first-party mock** is mandatory for L1 and must be labelled as such.
Access to the vendor sandbox is itself gated behind a real `mch_id` (**`BLOCKED`**, offline).

---

## 2. Pilot B — CRM required capability coverage

Required set (`12_PILOT_PLAN.md` §Pilot B): `customer.create/list`, `contact.list`,
`opportunity.list`, `opportunity.move-stage`.

| Candidate | `customer.create/list` | `contact.list` | `opportunity.list` | `opportunity.move-stage` | Evidence |
|---|---|---|---|---|---|
| **B-1 Twenty** | `CLAIM` (Person/Company standard objects) | `CLAIM` (Person) | `CLAIM` (Opportunity; 321 standard-application paths) | `CLAIM` (opportunity stage field referenced in app files) | git tree listing; `packages/twenty-sdk/src/sdk/define/objects/standard-object-ids.ts` |
| **B-2 Frappe CRM** | **VERIFIED** (CRM Organization doctype) | **VERIFIED** (`contacts` link field) | **VERIFIED** (CRM Deal doctype) | **VERIFIED** (`status` → Link `CRM Deal Status`) | `crm/fcrm/doctype/crm_deal/crm_deal.json` |
| **B-3 EspoCRM** | **VERIFIED** (Account entity) | **VERIFIED** (`Contact.php`) | **VERIFIED** (Opportunity entity) | **VERIFIED** (enum `stage`: Prospecting…Closed Lost) | `…/Crm/Resources/metadata/entityDefs/Opportunity.json` |
| **B-4 Krayin** | **VERIFIED** (Person/Organization models) | **VERIFIED** (`Webkul\Contact\Models\Person`) | **VERIFIED** (`Webkul\Lead\Models\Lead`) | **VERIFIED** (`Stage` @ `lead_pipeline_stages`) | `packages/Webkul/Lead/src/Models/Stage.php` |
| **B-5 Dolibarr** | `CLAIM` (third-party/contact) | `CLAIM` | `CLAIM` (opportunity) | `CLAIM` | not read at source |
| **B-6 Odoo** | `CLAIM` (res.partner) | `CLAIM` | `CLAIM` (crm.lead) | `CLAIM` | not read at source |
| **B-7 Monica** | **MISSING** | `CLAIM` (contacts) | **MISSING** | **MISSING** | rejected on domain |

**Pilot B conclusion:** the multi-candidate requirement is **satisfied** with **4 source-verified**
datasets (B-2, B-3, B-4 verified; B-1 partially via tree). B-3/B-4 have the cleanest machine-readable
stage models.

---

## 3. Pilot C — AI Workflow required capability coverage

Required set (`12_PILOT_PLAN.md` §Pilot C): queue persistence, progress, failure retry, cancel,
cost ceiling, artifact access permission, execution logs.

| Capability | Best module(s) | Verified? | Evidence |
|---|---|---|---|
| durable execution | C-1 Temporal, C-2 Hatchet, C-14 DBOS | `CLAIM` | README statements only |
| queue persistence | C-6 BullMQ (Redis), C-7 pg-boss (Postgres) | `CLAIM` + partial | README + `base-job-options.ts` fields |
| retry | C-6 BullMQ, C-3 Trigger.dev, C-2 Hatchet | **VERIFIED (BullMQ)** | `"attempts?: number"`, `"backoff?: number \| BackoffOptions"` |
| delay / scheduling | C-6 BullMQ, C-3 Trigger.dev | **VERIFIED (BullMQ)** | `"delay?: number // wait until this job can be processed"` |
| cancel / HITL pause | C-3 Trigger.dev, C-1 Temporal | `CLAIM` | Trigger.dev README `"pause your tasks until a human can approve"` |
| progress / observability | C-3 Trigger.dev, C-1 Temporal, C-2 Hatchet | `CLAIM` | Trigger.dev README `"Each run has full tracing and logs"` |
| **cost ceiling** | **none** | **MISSING** | no engine provides it → `BUILD_FROM_SPEC` |
| **artifact access permission** | **none** | **MISSING** | tenant/artifact ACL is ours → `BUILD_FROM_SPEC` |
| **execution logs (audit)** | partial (engines log, not necessarily tenant-scoped) | `CLAIM` | — |
| model provider adapters | C-10 Vercel AI SDK, C-15 local `packages/ai` | **VERIFIED (local deps)** | `ai ^6.0.116`, `@ai-sdk/openai ^3.0.41` |

**Pilot C conclusion:** a **composable permissive core** exists (C-1/C-2 MIT, C-6/C-7 MIT, C-10
Apache-2.0); **cost-ceiling** and **artifact permission** are **not** available from any engine and
must be first-party (`BUILD_FROM_SPEC`).

---

## 4. Cross-cutting: route applicability matrix

| Route | Pilot A | Pilot B | Pilot C |
|---|---|---|---|
| `REUSE` | conditional (Apache-2.0/MIT obligations) | B-4 only (MIT); AGPL/GPL `BLOCKED` | permissive modules only; BSL/SSPL `REVIEW_REQUIRED` |
| `INTEGRATE` | **primary** (official SDK/API) | not recommended as default | **primary** (engine as service) |
| `BUILD_FROM_SPEC` | **required** (Node adapter) | **required** (native CRM / MIT fork) | **required** (ACL + cost ceiling) |

## 5. What this matrix does NOT claim

- It does **not** claim any module is production-ready.
- It does **not** convert any `CLAIM` into a verified capability.
- It does **not** score candidates; scoring belongs to a later, human-approved step.
