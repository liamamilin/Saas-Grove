# B_CRM_CANDIDATES.md — Pilot B: CRM SaaS template (`business-saas-template`)

> **Phase B · read-only, network-scoped candidate discovery.**
> `12_PILOT_PLAN.md` §Pilot B requires **≥2 real, reviewable CRM-domain candidates**.
> This report supplies **7** candidates with **2 recorded rejections**. Nothing is approved.

## 0. Retrieval environment & method

| Field | Value |
|---|---|
| Agent | `factory-discoverer` (Phase B) |
| Host | macOS (darwin) |
| Method | read-only `fetch` + GitHub REST API (unauthenticated) + `raw.githubusercontent.com` |
| Network scope | `github.com` / `api.github.com` / `raw.githubusercontent.com` — **within allowlist** |
| Retrieval time | **2026-10-16 (UTC)**, single session |
| Evidence gap | per-call second-resolution timestamps **not captured** → `UNKNOWN` |
| Write scope | `reports/phase-b-discovery/**` |
| Not done | no clone / install / build / execute |

**Method note (doctrine):** every license below was read from the **actual license file text**
(length recorded), **never** from a README badge or the GitHub sidebar. Domain coverage was verified
by reading **real entity/model/doctype files**, not README marketing copy.

---

## 1. Candidate list with real source links

| # | Candidate | Repo | Actual CRM domain objects |
|---|---|---|---|
| B-1 | **Twenty** | https://github.com/twentyhq/twenty | Person / Company / Opportunity (standard objects) |
| B-2 | **Frappe CRM** | https://github.com/frappe/crm | CRM Deal / CRM Organization / CRM Contact / CRM Lead |
| B-3 | **EspoCRM** | https://github.com/espocrm/espocrm | Opportunity / Account / Contact / Lead |
| B-4 | **Krayin (Laravel CRM)** | https://github.com/krayin/laravel-crm | Lead / Pipeline+Stage / Person / Organization |
| B-5 | **Dolibarr** | https://github.com/Dolibarr/dolibarr | Third-party / Contact / Opportunity (ERP+CRM suite) |
| B-6 | **Odoo (Community)** | https://github.com/odoo/odoo | res.partner / crm.lead (ERP+CRM platform) |
| B-7 | **Monica** | https://github.com/monicahq/monica | personal relationship CRM (**rejected — see §5**) |

---

## 2. Version, commit SHA, license + evidence

Retrieval 2026-10-16. **Commit SHA = the commit the release tag points to**, resolved with
`GET /repos/{slug}/commits?sha={tag}&per_page=1` (attempt-2 method). Licence method:
`raw.githubusercontent.com` file read; byte length recorded.

> **Correction (attempt 2).** Attempt 1 published `GET /repos/{slug}/commits?per_page=1`, which
> returns the **default-branch HEAD**, and then placed that value in a column headed by a **tag**.
> For B-1…B-4 the two are **different commits**. All four SHAs below have been **re-resolved
> against the tag** in attempt 2 and replaced. The provenance of the superseded attempt-1 values is
> `UNKNOWN` (they were never the tag commits).

| # | Version (tag) | Commit SHA | Branch | License (SHORT-NAME from **text**) | Text len | Exact evidence snippet |
|---|---|---|---|---|---|---|
| B-1 | `twenty/v2.47.0` | `5d39928bbfdca0f14b369c6a1db33118151b1074` | main | **AGPL-3.0 + Enterprise (commercial) + MIT sub-packages** | 39,961 | `"This project is mostly licensed under the GNU Affero General Public License v3.0 (AGPLv3) … 1. Certain files are licensed under a commercial license … /* @license Enterprise */ … 2. Certain packages are licensed under the MIT license … twenty-sdk, twenty-client-sdk, create-twenty-app, twenty-shared … twenty-ui … packages/twenty-apps"` |
| B-2 | `v1.88.0` | `0baa1e8ea462b92d2920bcfdc7a532a730329b6c` | develop | **AGPL-3.0** | 34,522 | LICENSE = `"GNU AFFERO GENERAL PUBLIC LICENSE Version 3, 19 November 2007"`; `hooks.py`: `app_license = "AGPLv3"` |
| B-3 | `10.0.10` | `f990998f2173c103d36ab5b35d759f676c59502a` | master | **AGPL-3.0-or-later** | 34,522 | `composer.json`: `"license": "AGPL-3.0-or-later"`; `LICENSE.txt` AGPLv3 text |
| B-4 | `v2.2.6` | `e597417bbc537cbd9716e7f1342d65dc21ac2145` | master | **MIT** | 1,078 | `"MIT License\n\nCopyright 2010-2025, Webkul Software\n\nPermission is hereby granted, free of charge…"`; `composer.json`: `"license": "MIT"` |
| B-5 | (develop) | `cccf779516749c110268a248948e8b161a7313ed` | develop | **GPL-3.0** | 35,151 | `COPYING` = `"GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007"` |
| B-6 | (master) | not locked | master | **LGPL-3.0** (core) + separate **OEEL** Enterprise (not verified) | 43,529 | `"Odoo is published under the GNU LESSER GENERAL PUBLIC LICENSE, Version 3 (LGPLv3) … Some external libraries and contributions bundled with Odoo may be published under other GPL-compatible licenses"` |
| B-7 | (main) | not locked | main | **AGPL-3.0** | 34,153 | `LICENSE.md` = `"### GNU AFFERO GENERAL PUBLIC LICENSE\n\nVersion 3, 19 November 2007"` |

**License scope notes (mandatory):**
- **B-1 is the only candidate with a *mixed* license surface**: root AGPLv3 + per-file
  `/* @license Enterprise */` (commercial) + MIT for named packages. A repo tree scan found
  **136 paths** matching `/enterprise/i`. The README #1-Open-Source-CRM claim is **a claim**; the
  license file is the authority.
- **B-1 also carries a Section-7 *additional permission*** that attempt 1 did not report. The
  licence text grants the "**Twenty Application Exception**":
  `"Developing an Application, conveying it, or making it available for interaction over a network does not, by itself, cause the Application to be governed by the AGPLv3. You may license your Application under terms of your choice, including proprietary terms."`
  with `"Application"` = a work that "**does not otherwise incorporate or modify the source code of Twenty**".
  **Implication:** this materially helps the **`INTEGRATE`** route (build on Twenty's APIs) and does
  **not** help **`REUSE`** — clause 4 states `"if you modify Twenty, the AGPLv3, including section 13, applies to your modified version in full."`
- **B-1 Enterprise files are subscription-gated, not merely "commercial"**: the bundled commercial
  licence requires production use only where you "**have a valid Twenty Enterprise Edition subscription
  for the correct number of hosts and seats**", and forbids copying/distributing them otherwise.
  Any Enterprise-marked file is therefore **unusable in a distributed closed-source template**.
- **B-6**: the LGPL applies to the core repo. **Odoo Enterprise Edition (OEEL) is a separate
  repository/proprietary license and was NOT verified** → `UNKNOWN`.

---

## 3. Feature coverage, architecture, maintenance

### 3.1 Required-capability coverage (evidence = real domain files)

| Capability | B-1 Twenty | B-2 Frappe CRM | B-3 EspoCRM | B-4 Krayin |
|---|---|---|---|---|
| `customer.create` / `list` | Person/Company standard objects (evidence: 321 `twenty-standard-application` paths; object-metadata modules) | CRM Organization (JSON doctype) | Account entity | Organization + Person models |
| `contact.list` | Person standard object | CRM Contact + `contacts` link field on Deal | Contact entity (`Contact.php` read) | `Webkul\Contact\Models\Person` |
| `opportunity.list` | Opportunity standard object (fields referenced e.g. `opportunity-buyer-stage.field.ts`) | CRM Deal doctype (fields: `organization`, `lead`, `deal_owner`, `probability`, `annual_revenue`, `status`) | Opportunity entity | Lead entity (`Webkul\Lead\Models\Lead`) |
| `opportunity.move-stage` | Opportunity stage field present | `status` field → **Link → `CRM Deal Status`** (configurable pipeline) | **`stage` enum: `["Prospecting","Qualification","Proposal","Negotiation","Closed Won","Closed Lost"]`** | `Stage` model on table `lead_pipeline_stages` (`code,name,probability,sort_order,lead_pipeline_id`) |

**EspoCRM evidence (strongest native fit)** — `application/Espo/Modules/Crm/Resources/metadata/entityDefs/Opportunity.json`:
> `"stage": { "type": "enum", "options": ["Prospecting","Qualification","Proposal","Negotiation","Closed Won","Closed Lost"] }`
> `"amount": { "type": "currency", "required": true, "min": 0, "audited": true }`
> Opportunity fields include `account`, `contacts`, `probability`, `closeDate`, `assignedUser`, `teams`.

**Krayin evidence** — `packages/Webkul/Lead/src/Models/Stage.php`:
> `protected $table = 'lead_pipeline_stages'; protected $fillable = ['code','name','probability','sort_order','lead_pipeline_id'];`

**Frappe evidence** — `crm/fcrm/doctype/crm_deal/crm_deal.json`:
> `{"fieldname":"status","label":"Status","fieldtype":"Link","options":"CRM Deal Status"}`

### 3.2 Architecture / stack

| # | Stack evidence | Architecture |
|---|---|---|
| B-1 | root `package.json`: Nx 22 monorepo, React 19, TypeScript; server = NestJS + GraphQL; metadata-driven "standard objects" | TS monorepo, workspace-metadata object model |
| B-2 | `pyproject.toml` (`requires-python >=3.10`, deps `twilio`, `requests`; `frappe` managed by `bench`); DocType JSON model | Frappe (Python) framework app |
| B-3 | `composer.json` (`php >=8.3.0 <8.6.0`; ext-openssl/json/zip/gd/mbstring/xml/dom/curl/exif) | PHP MVC, metadata entityDefs |
| B-4 | `composer.json` `"name":"krayin/laravel-crm"`, `php ^8.3`, `laravel/framework ^12.0`, `konekt/concord` (modular packages) | Laravel 12, package-per-module |

### 3.3 Maintenance activity (recency evidence)

| # | Last commit | Latest release | Reads as |
|---|---|---|---|
| B-1 | 2026-10-15 | `twenty/v2.47.0` (2026-10-15) | very active |
| B-2 | 2026-10-15 | `v1.88.0` (2026-10-15) | very active |
| B-3 | 2026-10-15 | `10.0.10` (2026-10-14) | very active |
| B-4 | 2026-10-15 | `v2.2.6` (2026-09-10) | active |
| B-5 | 2026-10-16 | — | very active |
| B-6 | — | — | active (SHA not locked) |

> Recency is **not** a license or quality conclusion; it is context for maintenance risk only.

---

## 4. `REUSE` / `INTEGRATE` / `BUILD_FROM_SPEC` applicability

| # | REUSE (fork/redistribute) | INTEGRATE (keep separate) | BUILD_FROM_SPEC |
|---|---|---|---|
| B-1 Twenty | **BLOCKED for closed-source redistribution** — AGPLv3 §13 network-copyleft + Enterprise files under commercial terms. Permissible only if our whole derived service is AGPL and Enterprise files excluded. | Permissible as a *separate* deployed system reached via API — and the licence's **Section-7 "Twenty Application Exception"** explicitly allows a proprietary Application that only *interacts* via the APIs/SDKs. It still ships its own full product; not a "template". Must not pose as Twenty. | N/A (we would not re-author Twenty) |
| B-2 Frappe CRM | **BLOCKED for closed-source redistribution** — AGPLv3. | Possible via API, but drags the Frappe framework + its own license surface. | N/A |
| B-3 EspoCRM | **BLOCKED for closed-source redistribution** — AGPLv3. **Best *domain* reference** (native stage enum). | Possible via API; still AGPL on the deployed server (network-copyleft affects *modifications*). | **Its entity model is a citable *reference* for our native CRM domain** |
| B-4 Krayin | **Permissible (MIT)** subject to dependency-tree scan + Webkul **trademark/asset** separation and its paid editions. | Permissible. | Feasible — MIT fork is the only candidate where `REUSE` is not blocked by copyleft. |
| B-5 Dolibarr | **REVIEW_REQUIRED** — GPL-3.0; strong copyleft blocks closed-source packaging. | Possible; ERP-scale. | N/A |
| B-6 Odoo | **REVIEW_REQUIRED** — LGPL core is linkable but **OEEL Enterprise** + brand/platform complexity; not verified. | Possible but heavyweight. | N/A |

**Doctrine reminder:** a copyleft classification is **usage-mode dependent**. AGPL does **not**
automatically forbid a separate-service `INTEGRATE`; it **does** block vendoring into a
closed-source distributed template.

---

## 5. Rejection reasons & `UNKNOWN` items

**Rejections recorded (required by `12_PILOT_PLAN.md` cross-pilot criterion #5):**
1. **B-7 `monicahq/monica` — REJECTED.** Reason: **domain mismatch** — Monica is a *personal
   relationship* CRM (contacts/reminders), **not a B2B sales CRM**; it has no
   `opportunity`/pipeline/stage domain, so it cannot satisfy `opportunity.list` /
   `opportunity.move-stage`. Secondary: AGPL-3.0. Evidence: `LICENSE.md` AGPL-3.0 (34,153 B).
2. **B-6 `odoo/odoo` — REJECTED as a *template base*.** Reason: **licensing/brand complexity at
   platform scale** — LGPL-3.0 core plus a **separate Enterprise Edition (OEEL)** whose terms were
   **not verified**; redistributing a branded Odoo derivative for closed-source sale raises
   trademark + dual-license risk disproportionate to a template. Retained as `REVIEW_REQUIRED`
   reference only.

**`UNKNOWN` items**
| ID | Unknown | Why |
|---|---|---|
| B-U1 | Transitive dependency licenses for all candidates | no SBOM/lockfile scan performed |
| B-U2 | Brand assets / fonts / demo data / images licensing | not audited; known risk (esp. B-1, B-4 Webkul, B-3) |
| B-U3 | Odoo **EE/OEEL** terms | separate repo not fetched |
| B-U4 | Krayin paid-edition boundary (what is MIT vs commercially licensed) | not verified |
| B-U5 | Twenty per-package license map (which of 47,668 paths are Enterprise) | only 136-path count known |
| B-U6 | Security posture / CVE history | not queried |
| B-U7 | B-5, B-6, B-7 commit SHAs | not locked (deprioritised after rejection) |
| B-U8 | Prototype/UI-kit asset licenses | out of scope of code discovery |
| B-U9 | Provenance of the **superseded attempt-1 SHAs** | they were branch HEADs placed under a tag column; the values themselves were never independently attributed |

---

## 6. Recommended route, estimated cost, risks

**Inputs (not a decision):**
- **Least-license-risk candidate:** **B-4 Krayin (MIT)** — the only candidate where a closed-source
  fork is not blocked by copyleft. Caveat: dependency-tree scan + Webkul trademark/asset review.
- **Best domain reference:** **B-3 EspoCRM** — an explicit `stage` enum and currency-audited
  `amount` translate directly to `opportunity.move-stage`.
- **Richest product:** **B-1 Twenty** — but **AGPLv3 + Enterprise-file split** makes `REUSE`
  `BLOCKED` and forces a careful scope decision.

**Recommended route (input only):** `BUILD_FROM_SPEC` a first-party CRM domain on the audited
baseline, **optionally `FORK`-derived from B-4 (MIT)** after License Reviewer sign-off; use B-3/B-2
domain models as citable *references*, not as copied code. `INTEGRATE` is **not** recommended as
the default (it does not produce a distributable template).

**Estimated cost — `ESTIMATE`:** ≈ **15–30 engineering days** for an L1→L2 first-party CRM
(≈ $0 cash, excluding optional SaaS services).

**Risks:** copyleft contamination if any AGPL/GPL code is copied; Webkul/Odoo **trademark** misuse;
per-asset (font/logo/demo-data) licensing debt; brand-rename obligations.

---

## 7. Ready to enter sandbox production?

**NO.** All candidates are unbuilt and un-reviewed; AGPL/GPL candidates require a license-reviewer
decision on usage mode; B-4 needs a dependency/asset scan. Pilot B advances from
`BLOCKED/INSUFFICIENT` (Phase A) to **`CATALOGED` with ≥2 candidates satisfied**, still **not**
sandbox-ready.

## 8. Minimal next step

1. Product Owner picks the *licensing posture* (`BUILD_FROM_SPEC` native vs `FORK` MIT).
2. License Reviewer adjudicates B-1 (AGPL+Enterprise), B-4 (MIT + assets), B-2/B-3/B-5 (AGPL/GPL).
3. Author the Pilot B ADR; **no source modification from this report.**

## 9. Approval request

Confirm: (a) the 7-candidate set + **the corrected tag SHAs**; (b) the two recorded rejections;
(c) that the multi-candidate requirement is now **satisfied** (`12_PILOT_PLAN.md` §Pilot B);
(d) that no gate is lowered and no copyleft candidate is auto-approved; (e) that the newly-reported
**B-1 "Twenty Application Exception"** (helps `INTEGRATE`, not `REUSE`) is recorded as a licence-review
input. No transformation requested.
