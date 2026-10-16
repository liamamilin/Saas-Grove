# DISCOVERY_SUMMARY.md — Phase B (read-only, network-scoped) — ≤2 pages

**Date:** 2026-10-16 (UTC) · **Agent:** `factory-discoverer` · **Writes:** `reports/phase-b-discovery/**` only
**Executed/installed/cloned/built third-party code:** NO · **Real payment/model credentials:** none used
**Retrieval timestamps:** per-call seconds **`UNKNOWN`** (evidence gap, noted for next run)
**Revision:** **attempt 2** — an independent re-verification pass. It **confirmed** the licence texts
and the official-SDK SHAs, and **corrected three defects** in attempt 1: (i) the "no WeChat Pay
sandbox" conclusion was wrong; (ii) tag SHAs for B-1…B-4 / C-1…C-4 were branch HEADs, now re-resolved
against the tags; (iii) attempt 1 bypassed the domain-allowlisted `webfetch` control. Full record:
`LICENSE_EVIDENCE_INDEX.md` §C.1.

---

## 1. Mission outcome

Phase A left A/B/C **BLOCKED / PARTIAL / INSUFFICIENT** because *no legitimately reusable sources
existed locally*. Phase B converts that into **real candidates with tag-pinned SHAs and license text read
from source** (attempt-1 SHA values were re-resolved against their tags — §C.1). Discovery is complete;
**no selection is made** (that needs Product Owner + License Reviewer).

| Pilot | Phase A | Phase B outcome | Candidates found |
|---|---|---|---|
| **A** WeChat Pay | BLOCKED | **CATALOGED** — official SDKs + full APIv3 doc set | 3 official server SDKs (Java/PHP/Go) + 4 official tools + 2 third-party Node wrappers (registered only) + 11 authoritative doc pages |
| **B** CRM | BLOCKED / INSUFFICIENT | **CATALOGED** — multi-candidate requirement **satisfied** | **7** CRM-domain candidates, **2 recorded rejections** |
| **C** AI Workflow | PARTIAL | **CATALOGED** — composable permissive core identified | 14 external modules + local `packages/ai` |

---

## 2. Key findings that change the plan

1. **WeChat Pay sandbox: corrected in attempt 2.** An official sandbox **does** exist — the
   **仿真测试系统 (V2, `xdc/apiv2sandbox`)** — but it **cannot serve APIv3** (下单接口 explicitly
   unsupported) and needs a real `mch_id`. `12_PILOT_PLAN.md`'s "sandbox" verification must therefore
   still be a **first-party mock**, explicitly labelled — and the mock must not be confused with the
   V2 vendor sandbox. (**A-U1 `UNKNOWN`**)
2. **WeChat Pay has NO official Node.js SDK** — official = **Java/PHP/Go only** (doc-confirmed).
   The `saas-core-module` adapter is therefore **`BUILD_FROM_SPEC`**.
3. **Pilot B license reality is mostly copyleft.** Only **Krayin (MIT)** is closed-source-forkable;
   Twenty (AGPL + `/* @license Enterprise */` + MIT sub-pkgs), Frappe CRM/EspoCRM (AGPL), Dolibarr
   (GPL) are **`REVIEW_REQUIRED`**. EspoCRM supplies the cleanest `stage` enum to *reference*.
4. **Pilot C is a `COMPOSE` problem, and two requirements have no engine supplier:** a **cost ceiling**
   and a **tenant-scoped artifact ACL** must be **`BUILD_FROM_SPEC`** (first-party). Permissive cores
   (Temporal/Hatchet/BullMQ/pg-boss MIT; Vercel AI SDK Apache-2.0) exist.
5. **All protocol evidence is now citable**: order create/query, notify verify+decrypt (AES-256-GCM),
   refund (≤50 partial, reuse refund-no. on retry), reconciliation, and the full cert/key model
   (商户API证书 / 平台证书 / 微信支付公钥 / APIv3 密钥).

---

## 3. Recommended routes (inputs, not decisions)

| Pilot | Recommended route | Rationale |
|---|---|---|
| A | **`INTEGRATE` (official SDK/API) + `BUILD_FROM_SPEC` (TS adapter)** | no Node SDK; the vendor sandbox is **V2-only** and cannot serve APIv3 |
| B | **`BUILD_FROM_SPEC` native CRM**, optionally seeded by **`FORK` of B-4 (MIT)** | only copyleft-free fork; AGPL/GPL block closed-source vendoring |
| C | **`COMPOSE` = `INTEGRATE` (MIT engine) + `REUSE` (Apache-2.0 AI SDK) + `BUILD_FROM_SPEC` (ACL/cost)** | no single project covers the required set |

---

## 4. Rejections recorded (required)

- **Monica** — domain mismatch (personal, no `opportunity.*`) + AGPL-3.0.
- **Odoo** — LGPL core + unverified Enterprise (OEEL); brand/dual-license complexity.
- **Windmill** — mixed Apache-2.0 + AGPLv3 + proprietary in one repo.
- **Inngest for `REUSE`** — SSPL v1.0 network-service copyleft.
- **npm `wechatpay-node-v3`** — stale (~2 y), license text `UNKNOWN`.

---

## 5. Complete BLOCKED / UNKNOWN register

| Pilot | `BLOCKED` | `UNKNOWN` |
|---|---|---|
| A | merchant qualification (offline, out of scope); vendor sandbox access (requires a real `mch_id`) | A-U1 **APIv3** sandbox semantics (vendor sandbox is V2-only); A-U2 transitive deps; A-U3 NOTICE; A-U4 tool SHAs; A-U5 CVE posture; A-U6 wrapper safety; A-U7 API service terms; A-U8 timestamps |
| B | `REUSE` of AGPL/GPL candidates | B-U1 deps; B-U2 brand/font/demo assets; B-U3 Odoo EE; B-U4 Krayin paid-edition boundary; B-U5 Twenty Enterprise file map; B-U6 CVE posture; B-U7 B-5/B-6/B-7 SHAs; B-U8 prototype assets; B-U9 provenance of superseded attempt-1 SHAs |
| C | `REUSE` of BSL/SSPL; cost-ceiling & artifact ACL (no supplier) | C-U1 model-provider terms; C-U2 deps; C-U3 durability claims unverified; C-U4 BSL/SSPL impact; C-U5 some SHAs (incl. unre-resolved branch-head values); C-U6 timestamps |

**Never upgraded:** every `UNKNOWN` above stays `UNKNOWN`; every copyleft/mixed license stays `REVIEW_REQUIRED`.

---

## 6. Sandbox-production readiness

**A: NO · B: NO · C: NO.** No candidate is built, integrated, or negatively tested. Phase B does not
authorise Transformation, Calibration, or Certification.

---

## 7. Network scope & allowlist

- **Hosts used (all inside the approved scope):** `github.com`, `api.github.com`,
  `raw.githubusercontent.com`, `pay.wechatpay.cn`, `pay.weixin.qq.com`, `registry.npmjs.org`, `spdx.org`.
- **Hosts denied by the allowlist:** **NONE encountered** — no workaround was attempted or needed.
- **Attempt-2 note:** a single `websearch` call returned a **non-allowlisted** host
  (`weixinzhifu.apifox.cn`, a third-party mirror of the 支付验收指引). That host was **not fetched**;
  the lead was confirmed on `pay.weixin.qq.com`. Per `AUTHORIZATION_RECORD.md` §4, search output is a
  **lead source only**.
- **Control-enforcement finding:** attempt 1 retrieved pages via code-mode `fetch`, which is **not**
  domain-scoped — i.e. the domain allowlist on `webfetch` was **not** the enforcing control for that
  session. All hosts reached were nevertheless inside the approved set. Attempt 2 used `webfetch` only
  and `edit` only inside `reports/**`. Recommend recording this as a harness gap.

---

## 8. Minimal next steps (human)

1. **License Reviewer** adjudicates: B-1/B-2/B-3/B-5/B-7 (AGPL/GPL), B-4 (MIT + assets), C-4 (BSL),
   C-5 (SSPL), C-12 (LiteLLM `enterprise/`), windmill; and records the **B-1 §7 Application Exception**
   as an `INTEGRATE`-only input.
2. **Product Owner** confirms routes (A: INTEGRATE+build; B: build/native vs MIT fork; C: engine envelope).
3. Confirm the **sandbox = first-party mock** scope for A — noting the vendor sandbox is **V2-only** —
   and the **mock/sandbox/Live label discipline** for C.
4. **Re-pin every candidate to a tag commit** (or explicitly label `branch@sha`) before any ADR cites a
   SHA; the attempt-1 register mixed branch HEADs with tag names (defect #2, §C.1).
5. Author the three ADRs from these inputs. **No source modification begins from this report.**

## 9. Approval request

Approve or amend: (a) the candidate sets and the **re-pinned** SHAs; (b) the recommended routes as
*inputs*; (c) the rejections and the full UNKNOWN register; (d) that merchant qualification and
model-provider terms remain out-of-scope/offline; (e) that the three attempt-1 defects recorded in
§C.1 are accepted as **evidence-integrity findings**, not silently corrected; (f) that **no gate is
lowered** and **no selection is finalised** by the discovery agent.
