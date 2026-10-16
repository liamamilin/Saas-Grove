# A_WECHAT_CANDIDATES.md — Pilot A: WeChat Pay adapter (`saas-core-module`)

> **Phase B · read-only, network-scoped candidate discovery.**
> Nothing here is approved, built, installed, integrated, or certified.
> All candidates are `CATALOGED` only. Merchant qualification is **offline and out of scope**.

## 0. Retrieval environment & method

| Field | Value |
|---|---|
| Agent | `factory-discoverer` (Phase B, discovery-only) |
| Host | macOS (darwin) |
| Method | read-only HTTP `fetch` (domain-allowlisted) + GitHub REST API (unauthenticated) + `raw.githubusercontent.com` + WeChat Pay doc `.md` endpoints + `registry.npmjs.org` |
| Network scope | WeChat Pay official docs (`pay.wechatpay.cn`, `pay.weixin.qq.com`), `github.com`/`api.github.com`/`raw.githubusercontent.com`, `registry.npmjs.org` — **all within the approved allowlist** |
| Retrieval time | **2026-10-16 (UTC)**, single discovery session |
| Evidence gap | Per-call second-resolution timestamps were **not captured** → recorded as `UNKNOWN` (evidence-integrity gap). All fetches occurred within one session on the date above. |
| Write scope | `reports/phase-b-discovery/**` only |
| Not done | No code executed/installed/cloned/built. No credentials. No real payment call. |
| **Attempt-2 re-verification** | A second, independent pass on **2026-10-16 (UTC)** re-fetched the load-bearing evidence through the **domain-allowlisted `webfetch` tool** (see §0.1). Result: **2 material corrections** — (i) the "no official WeChat Pay sandbox" conclusion was **wrong**; (ii) the SDK tag SHAs were **confirmed correct**. | `PASS` / `FAIL` as marked below |

### 0.1 Attempt-2 independent verification (what was re-checked and how)

| # | Claim re-checked | Method (allowlisted) | Outcome |
|---|---|---|---|
| V-1 | `wechatpay-java` LICENSE = Apache-2.0 | `raw.githubusercontent.com/wechatpay-apiv3/wechatpay-java/main/LICENSE` | **CONFIRMED** — full Apache-2.0 text, `"Apache License\n Version 2.0, January 2004"` |
| V-2 | A-1/A-2/A-3 **tag → commit** pairing | `GET /repos/{o}/{r}/tags?per_page=3` | **CONFIRMED** — `v0.2.17`→`1dab7be…`, `v1.5.0`→`3c9f5c2…`, `v0.2.21`→`6dbd7ce…` (exact match with §2.1) |
| V-3 | "**No official Node.js SDK**" | `GET /repos/wechatpay-apiv3/wechatpay-nodejs` → **`404`**; plus official doc statement | **CONFIRMED** (negative) |
| V-4 | **Sandbox existence** | Official doc `https://pay.weixin.qq.com/doc/v2/merchant/4011984810.md` | **FAIL → CORRECTED.** A sandbox **is** officially documented (仿真测试系统). See §3.3 — the attempt-1 conclusion is withdrawn. |

> **Withdrawn:** attempt 1's statement "No official WeChat Pay sandbox is documented in the current
> official corpus". The *measurement* behind it (0 × `沙箱` in two index files) was accurate, but the
> **inference** from an index file to a capability claim was not sound. This is recorded as a
> methodology defect, not silently edited away.

---

## 1. Candidate list with real source links

### 1.1 Official WeChat Pay APIv3 SDKs (organisation `wechatpay-apiv3`)

| # | Repo | Lang | Role |
|---|---|---|---|
| A-1 | https://github.com/wechatpay-apiv3/wechatpay-java | Java | Official APIv3 server Library |
| A-2 | https://github.com/wechatpay-apiv3/wechatpay-php | PHP | Official APIv3 Library (+ APIv2) |
| A-3 | https://github.com/wechatpay-apiv3/wechatpay-go | Go | Official APIv3 Library |
| A-4 | https://github.com/wechatpay-apiv3/wechatpay-apache-httpclient | Java | APIv3 Apache HttpClient decorator |
| A-5 | https://github.com/wechatpay-apiv3/wechatpay-guzzle-middleware | PHP | APIv3 Guzzle middleware |
| A-6 | https://github.com/wechatpay-apiv3/wechatpay-postman-script | JS | APIv3 debug tool |
| A-7 | https://github.com/wechatpay-apiv3/CertificateDownloader | Java | Platform-cert download CLI |

> **Ordinal (`wechatpay-apiv3`) org listing retrieved via `GET /orgs/wechatpay-apiv3/repos`**
> (2026-10-16). The org exposes **Java / PHP / Go** server libraries plus tooling.
> **There is no official Node.js SDK.**

### 1.2 Official APIv3 documentation (authoritative, `.md` source)

| Doc | URL | Topic |
|---|---|---|
| 签名与验签 | https://pay.weixin.qq.com/doc/v3/merchant/4012365342.md | request signing / response+callback verification |
| JSAPI 下单 | https://pay.weixin.qq.com/doc/v3/merchant/4012791856.md | order create |
| 查订单 | https://pay.weixin.qq.com/doc/v3/merchant/4012791858.md | order query |
| 支付成功回调通知 | https://pay.weixin.qq.com/doc/v3/merchant/4012791861.md | payment notification |
| 退款申请 | https://pay.weixin.qq.com/doc/v3/merchant/4012791862.md | refund create |
| 查询单笔退款 | https://pay.weixin.qq.com/doc/v3/merchant/4012791863.md | refund query |
| 申请交易账单 | https://pay.weixin.qq.com/doc/v3/merchant/4012791866.md | reconciliation (trade bill) |
| 微信支付公钥验签 | https://pay.weixin.qq.com/doc/v3/merchant/4013053249.md | public-key verification |
| 解密回调报文和平台证书 | https://pay.weixin.qq.com/doc/v3/merchant/4012071382.md | AES-GCM callback decryption |
| 证书密钥概览 | https://pay.weixin.qq.com/doc/v3/merchant/4024350132.md | full cert/key model |
| 商户文档索引 | https://pay.weixin.qq.com/doc/v3/merchant/llms.txt | complete doc index |
| **支付验收指引（仿真测试系统）** | **https://pay.weixin.qq.com/doc/v2/merchant/4011984810.md** | **official sandbox (V2) — see §3.3** |

### 1.3 Third-party Node wrappers — **REGISTERED ONLY, NOT ENDORSED**

| # | Package | Source | Status |
|---|---|---|---|
| A-W1 | `wechatpay-axios-plugin` | https://github.com/TheNorthMemory/wechatpay-axios-plugin · npm `wechatpay-axios-plugin@0.9.6` | registered only |
| A-W2 | `wechatpay-node-v3` | npm `wechatpay-node-v3@2.2.1` | registered only; stagnant |

---

## 2. Version, commit SHA, license + evidence

### 2.1 Official SDKs — **license text read, not a badge**

| Repo | License (LICENSE text, method `raw`) | Byte len | Latest commit SHA (method: `GET /repos/{o}/{r}/commits?per_page=1`) | Commit date | Version |
|---|---|---|---|---|---|
| A-1 `wechatpay-java` | **Apache-2.0** — `"Apache License Version 2.0, January 2004"` | 11,357 | `1dab7bec717989e4a4f006d2469c3eebe9eabba7` | 2025-04-11 | `0.2.17` (commit msg) |
| A-2 `wechatpay-php` | **Apache-2.0** | 11,357 | `3c9f5c2b71d181e9c244494f695cf5abb53cadc4` | 2026-09-18 | `v1.5.0` (commit msg) |
| A-3 `wechatpay-go` | **Apache-2.0** | 11,357 | `6dbd7ce2ec5967ac2de5fa053479b411967b9c29` | 2025-07-07 | `0.2.21` (commit msg) |
| A-4 `wechatpay-apache-httpclient` | Apache-2.0 (SPDX via GitHub API) | — | not locked | pushed 2025-02-11 | — |
| A-5 `wechatpay-guzzle-middleware` | Apache-2.0 (SPDX via API) | — | not locked | pushed 2026-09-23 | — |
| A-6 `wechatpay-postman-script` | Apache-2.0 (SPDX via API) | — | not locked | pushed 2025-05-27 | — |
| A-7 `CertificateDownloader` | MIT (SPDX via API) | — | not locked | pushed 2023-08-30 | — |

Evidence snippet (A-1 LICENSE, `raw.githubusercontent.com/wechatpay-apiv3/wechatpay-java/main/LICENSE`, 2026-10-16):
> `"                                 Apache License\n                           Version 2.0, January 2004"`

**Tag verification (attempt 2, 2026-10-16):** the version column is a real **tag**, not a commit
message, and the SHA **is that tag's commit** — confirmed via `GET /repos/{o}/{r}/tags?per_page=3`:
`v0.2.17`→`1dab7be…`, `v1.5.0`→`3c9f5c2…`, `v0.2.21`→`6dbd7ce…`. (These are the **only** candidates
whose tag/SHA pairing survived re-verification unchanged.)

**License scope note:** the `LICENSE` file is at repo **root** and covers the repository. No per-directory license split was observed for A-1/A-2/A-3. **Transitive dependency licenses were NOT scanned** → `UNKNOWN`.

### 2.2 Third-party wrappers

| Package | License text evidence (method `raw`) | Byte len | npm metadata (method `registry.npmjs.org`) |
|---|---|---|---|
| A-W1 | `"Copyright (c) 2020-present James ZHANG(TheNorthMemory) … Permission is hereby granted, free of charge…"` → **MIT** | 1,079 | `wechatpay-axios-plugin@0.9.6`, license `MIT`, modified **2026-02-10** |
| A-W2 | license text **not fetched** → `UNKNOWN` | — | `wechatpay-node-v3@2.2.1`, license field `MIT`, modified **2024-08-19** |

> Wrapper npm `license` fields are **package metadata, not license text**. A-W1 text was read and is MIT; A-W2 remains `UNKNOWN` for text-level confirmation.

---

## 3. Feature coverage, architecture, maintenance maturity

### 3.1 APIv3 capability matrix — official endpoints (evidence: doc `.md`)

| Capability | Endpoint / rule | Evidence snippet |
|---|---|---|
| **order create** | `POST /v3/pay/transactions/jsapi` → `prepay_id` | `"请求方式：【POST】/v3/pay/transactions/jsapi … 生成用于调起支付的预支付交易会话标识(prepay_id)"` |
| **order query** | `GET /v3/pay/transactions/id/{transaction_id}` | `"请求方式：【GET】 /v3/pay/transactions/id/{transaction_id}"` |
| **notification** | POST to merchant `notify_url` | `"微信支付会通过POST的请求方式，向商户预先设置的回调地址…下单接口传入的notify_url…发送回调通知"` |
| **notification verify+decrypt** | verify sig with 微信支付公钥/平台证书; decrypt with **APIv3 密钥 (AES-256-GCM)** | `"微信支付在回调通知和平台证书下载接口中，对关键信息进行了AES-256-GCM加密…APIv3密钥是解密时使用的对称密钥"` |
| **refund** | `POST` refund; retry must reuse original refund no. | `"在申请退款失败后进行重试时，请务必使用原商户退款单号，以避免因重复退款而导致的资金损失"`; `"一笔订单最多支持50次部分退款"`; `"此接口调用成功的频率限制为150QPS"` |
| **refund query** | `GET /v3/refund/domestic/refunds/{out_refund_no}` | `"请求方式：【GET】 /v3/refund/domestic/refunds/{out_refund_no}"` |
| **reconciliation** | `GET /v3/bill/tradebill` (daily ≥10:00, ≤3 months) | `"微信支付在每日10点后生成昨日交易账单文件…此接口仅可下载三个月内的账单"` |

### 3.2 Certificate / key model (evidence: 4024350132)

| Artifact | Format | Validity | Use |
|---|---|---|---|
| 商户 API 证书 | `apiclient_cert.pem` + `apiclient_key.pem` + `.p12` | 5 y | V3 request **signing** |
| 平台证书 | `wechatpay_cert.pem` | 5 y (needs smooth rotation) | verify responses/callbacks, encrypt sensitive fields |
| **微信支付公钥** | `pub_key.pem` | **no expiry (recommended)** | verify responses/callbacks, encrypt |
| **APIv3 密钥** | 32-char string | no expiry | decrypt V3 callbacks + platform certs |

Snippet: `"微信支付公钥…因微信支付公钥无过期时间，维护更简单，推荐使用"`.

### 3.3 Sandbox semantics — **CORRECTED in attempt 2: a sandbox exists, but it is V2-only**

**Evidence (allowlisted `webfetch`, 2026-10-16):** `https://pay.weixin.qq.com/doc/v2/merchant/4011984810.md`
— *支付验收指引* (更新时间 2025.03.21), reachable from the official V2 商户 doc index
(`/doc/v2/merchant/llms.txt`) under *最佳实践 → 支付验收指引*.

| Question | Finding | Status |
|---|---|---|
| Is there an **official** WeChat Pay sandbox? | **YES** — 仿真测试系统 | **`PASS`** (documented) |
| Which protocol does it speak? | **V2**: path prefix `xdc/apiv2sandbox` (and `sandboxnew` in the flow diagram), XML bodies, `sandbox_signkey`. **Not APIv3.** | **`PASS`** (V2 only) |
| Does it cover APIv3 order create (JSAPI/统一下单)? | **NO** — "目前只支持付款码支付成功用例…与付款码支付异常用例…中的接口调用，下单接口：https://api.mch.weixin.qq.com/pay/unifiedorder 等目前暂不支持使用" | **`FAIL`** for Pilot A's APIv3 path |
| Does the sandbox support refund? | Not among the documented sandbox cases (付款码支付 success/exception + 查单 only) | **`UNKNOWN`** |
| Do sandbox callback signatures match production? | The doc asserts "仿真系统的API协议与正式API完全相同", **but that is the V2 protocol (MD5/HMAC + XML)**; for V3 (RSA-SHA256 + AES-256-GCM) there is no sandbox entry point at all | **`UNKNOWN`** (and untestable for V3) |
| Is it reachable without merchant qualification? | **NO** — 验签密钥 comes from `POST https://api.mch.weixin.qq.com/xdc/apiv2getsignkey/sign/getsignkey` with a real `mch_id` | **`BLOCKED`** (offline) |

Verbatim snippets (doc `4011984810.md`, retrieved 2026-10-16):
> `"为降低商户测试门槛，微信支付团队开发了一套独立的仿真测试系统。"`
> `"商户开发者只需将正式API的调用URL增加一层 xdc/apiv2sandbox 路径，即可对接到仿真系统。"`
> `"仿真系统与生产环境完全独立，包括存储层。商户在仿真系统所做的所有交易（如下单、支付、查询）均为无资金流的假数据"`
> `"沙箱密钥 | sandbox_signkey"` · flow step `"4.1、替换微信支付 API 的 URL，对接沙箱测试（如：https://api.mch.weixin.qq.com/sandboxnew/pay/micropay）"`

**Corrected conclusion.** Attempt 1 reported "no official sandbox". The accurate finding is:
**an official sandbox exists but is a V2 instrument that cannot exercise any APIv3 flow.** The
V3 商户 doc corpus still exposes no `沙箱` entry point, so Pilot A's APIv3 path must still be
verified against a **first-party mock/simulator**. Two consequences that *increase* risk relative
to attempt 1's framing:
1. The mock (APIv3-shaped) and the vendor sandbox (V2-shaped) are **different systems**; a green
   run against one proves nothing about the other. The `A-LIVE-MOCK-LABEL` discipline matters more,
   not less.
2. Even the vendor sandbox is **gated behind a real `mch_id`**, i.e. behind the same offline
   merchant qualification that is out of scope here — so no sandbox route is available in Phase B.

> The Foundation `05_BILLING_CHINA_PAYMENTS.md` §6 requirement ("关键支付流程在 sandbox/test mode 验证")
> therefore remains **unsatisfiable from any WeChat-provided environment at this scope**.

### 3.4 Maintenance maturity (commit recency evidence)

| Repo | Last commit | Reads as |
|---|---|---|
| wechatpay-php | 2026-09-18 | active |
| wechatpay-go | 2025-07-07 | ~15 months idle |
| wechatpay-java | 2025-04-11 | ~18 months idle |
| A-W2 npm | 2024-08-19 | ~2 years idle |

---

## 4. `REUSE` vs `INTEGRATE` vs `BUILD_FROM_SPEC`

| Route | Applies to | Assessment |
|---|---|---|
| **REUSE** (redistribute/fork upstream) | A-1/A-2/A-3 source, W1 source | **Conditionally permissible.** Apache-2.0 permits closed-source redistribution **with obligations**: retain copyright/permission notices, ship the license text, state changes, and reproduce any `NOTICE`. MIT (W1) similarly. **Not auto-PASS**: transitive deps + NOTICE completeness unverified. |
| **INTEGRATE** (external system stays separate via API/SDK) | A-1/A-2/A-3 as a separate dependency/service; official HTTPS API | **Best fit.** Using the official SDK as an unmodified dependency does not trigger a redistribution claim on our source; the audited surface is the SDK + the WeChat Pay API terms. |
| **BUILD_FROM_SPEC** (first-party from authoritative spec) | the **TypeScript/Node adapter** in `saas-core-module` | **Required for the adapter layer**, because **no official Node SDK exists** (docs: official SDK = Java/PHP/Go only). The authoritative spec is the official APIv3 doc set (§1.2) + the internal Billing Core contract (`05_BILLING_CHINA_PAYMENTS.md`). |

**Doctrine note:** the WeChat Pay *service/API* is a commercial service relationship, not an OSS
grant. Any `INTEGRATE` route must be assessed against the merchant/API terms — out of scope here
(qualification is offline).

---

## 5. Rejection reasons & `UNKNOWN` items

**Rejections recorded**
- **A-W2 `wechatpay-node-v3`** — **REJECT as a reuse base**: last publish 2024-08-19 (~2 years idle), license **text** not confirmed (`UNKNOWN`), no independent security review. Registered only.
- **Forking any SDK to build the adapter** — **REJECTED as the default**: forking Apache-2.0 SDKs into a closed-source bundle adds perpetual merge/NOTICE debt with no functional gain over `INTEGRATE`.

**`UNKNOWN` items**
| ID | Unknown | Why |
|---|---|---|
| A-U1 | **APIv3** sandbox semantics (order create / refund / callback parity) | An official sandbox **does** exist but is **V2-only** and cannot reach any APIv3 flow (§3.3). Sandbox refund support and callback-signature parity remain unverified. |
| A-U2 | Transitive dependency licenses of A-1/A-2/A-3 | no manifest scan performed |
| A-U3 | `NOTICE` file presence/contents for Apache-2.0 SDKs | not fetched |
| A-U4 | A-4/A-5/A-6/A-7 commit SHAs | not locked (SPDX mirrors only) |
| A-U5 | Security posture / CVE history of all candidates | not queried |
| A-U6 | Whether third-party Node wrappers are safe under WeChat ChangeLogs | unverified |
| A-U7 | WeChat Pay merchant/API **service terms** for `INTEGRATE` | commercial contract, not fetched |
| A-U8 | Per-call retrieval timestamps | not captured |

---

## 6. Recommended route, estimated cost, risks

**Recommended route (input only — not a decision):** **`INTEGRATE` + `BUILD_FROM_SPEC`.**
- `INTEGRATE` the official SDK (Java/PHP/Go — whichever matches the adapter host language) as an
  unmodified dependency, **or** call the official HTTPS API directly.
- `BUILD_FROM_SPEC` the `saas-core-module` adapter (signing, verification, AES-GCM decrypt,
  idempotency, refund state machine, reconciliation import) against the official doc set.
- `REUSE` is *available* only for a future explicit vendoring decision with a completed
  Apache-2.0/MIT notice pass — **not recommended now**.

**Estimated cost — `ESTIMATE` (planning placeholder, not measured):**
- Engineering ≈ **5–10 days** for a mock-only L1 adapter (≈ $0 cash).
- Real channel qualification cost/licence = **`UNKNOWN`** (offline).

**Main risks**
1. No **APIv3-capable** sandbox (the official one is V2-only — §3.3) → all APIv3 verification must use
   a **first-party mock**; the vendor sandbox is a *different* system, so a green run against it proves
   nothing about the APIv3 adapter. Mock/production divergence is a real risk and must be labelled
   truthfully (`A-LIVE-MOCK-LABEL`).
2. **No official Node SDK** → the adapter is first-party code carrying the full crypto burden.
3. Key/secret handling (商户私钥, APIv3 密钥) must never be logged or entered into a sandbox with real keys.
4. Certification-driven hard-coding of stage semantics is implicitly present (`CRM`-style concerns N/A here).

---

## 7. Ready to enter sandbox production?

**NO.** Reasons: no locked adapter implementation; no license-reviewer sign-off for any vendoring;
no **APIv3-capable** sandbox (the official sandbox is V2-only); `A-U1..A-U8` open; merchant
qualification offline and unscheduled.
Pilot A remains **`BLOCKED`** for any production use and **`NOT_RUN`** for live capabilities.

## 8. Minimal next step

1. Human/License Reviewer confirms `INTEGRATE + BUILD_FROM_SPEC` and closes A-U2/A-U3/A-U5.
2. Product Owner confirms "sandbox = first-party mock, explicitly labelled".
3. Only then author the Pilot A ADR; **do not begin source modification from this report.**

## 9. Approval request

Approve or amend: (a) official SDK set + SHAs as the evidence baseline; (b) `INTEGRATE +
BUILD_FROM_SPEC` as the **candidate** route; (c) the corrected sandbox finding — an official
**V2-only** sandbox exists and the APIv3 path still requires a first-party mock, explicitly labelled;
(d) that merchant qualification stays an offline, separate task. No transformation is authorised by
this report.
