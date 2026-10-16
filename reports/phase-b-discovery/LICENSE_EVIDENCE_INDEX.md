# LICENSE_EVIDENCE_INDEX.md — Phase B consolidated license evidence

> Every row was produced by **reading the actual license file text** via `raw.githubusercontent.com`
> (or the official doc endpoint). **No row was derived from a README badge, GitHub sidebar, or
> star count.** Byte length is recorded so the reader can see the file was really retrieved.
>
> Retrieval date: **2026-10-16 (UTC)** · session-scoped · per-call timestamps **not captured** (`UNKNOWN`).
> Status flags: `PASS` / `FAIL` / `BLOCKED` / `NOT_RUN` / `UNKNOWN` / `REVIEW_REQUIRED`.
> **Attempt-2 correction:** the `SHA / tag` column below now holds the **commit the tag points to**
> (resolved with `commits?sha={tag}`). Attempt-1 values for B-1…B-4 and C-1…C-4 were **branch HEADs**
> and have been replaced; see **§C.1** for the verification log and the defect record.

## A. Retrieval environment

| Field | Value |
|---|---|
| Method | read-only `fetch` (allowlisted), GitHub REST API (unauthenticated), `raw.githubusercontent.com`, WeChat doc `.md` endpoints, `registry.npmjs.org` |
| Host | macOS (darwin) |
| Write scope | `reports/phase-b-discovery/**` only |
| Executed third-party code | **NO** |

## B. License evidence table

| # | Artifact | License file URL | SHA / tag | Detected license (from text) | Text len | Verbatim snippet | Status |
|---|---|---|---|---|---|---|---|
| A-1 | wechatpay-java | raw…/wechatpay-java/main/LICENSE | `1dab7be…` / 0.2.17 | **Apache-2.0** | 11,357 | `"Apache License\n Version 2.0, January 2004"` | `PASS` (permissive) |
| A-2 | wechatpay-php | raw…/wechatpay-php/main/LICENSE | `3c9f5c2…` / v1.5.0 | **Apache-2.0** | 11,357 | `"Apache License\n Version 2.0, January 2004"` | `PASS` |
| A-3 | wechatpay-go | raw…/wechatpay-go/main/LICENSE | `6dbd7ce…` / 0.2.21 | **Apache-2.0** | 11,357 | `"Apache License\n Version 2.0, January 2004"` | `PASS` |
| A-W1 | wechatpay-axios-plugin | raw…/TheNorthMemory/wechatpay-axios-plugin/master/LICENSE | npm 0.9.6 | **MIT** | 1,079 | `"Copyright (c) 2020-present James ZHANG(TheNorthMemory) … Permission is hereby granted, free of charge…"` | `PASS` (not endorsed) |
| A-W2 | wechatpay-node-v3 | not fetched | npm 2.2.1 | metadata says MIT; **text not read** | — | — | `UNKNOWN` |
| B-1 | twenty | raw…/twentyhq/twenty/main/LICENSE | `5d39928…` / twenty/v2.47.0 | **AGPL-3.0 + Enterprise (commercial) + MIT sub-pkgs** | 39,961 | `"mostly licensed under the GNU Affero General Public License v3.0 (AGPLv3) … Certain files are licensed under a commercial license … /* @license Enterprise */ … Certain packages are licensed under the MIT license …"` | `REVIEW_REQUIRED` |
| B-2 | frappe/crm | raw…/frappe/crm/develop/LICENSE | `0baa1e8…` / v1.88.0 | **AGPL-3.0** | 34,522 | `"GNU AFFERO GENERAL PUBLIC LICENSE Version 3, 19 November 2007"`; `hooks.py app_license="AGPLv3"` | `REVIEW_REQUIRED` |
| B-3 | espocrm | raw…/espocrm/espocrm/master/LICENSE.txt | `f990998…` / 10.0.10 | **AGPL-3.0-or-later** | 34,522 | AGPLv3 text; `composer.json "license":"AGPL-3.0-or-later"` | `REVIEW_REQUIRED` |
| B-4 | krayin/laravel-crm | raw…/krayin/laravel-crm/master/LICENSE | `e597417…` / v2.2.6 | **MIT** | 1,078 | `"MIT License\n\nCopyright 2010-2025, Webkul Software\n\nPermission is hereby granted, free of charge…"`; `composer.json "license":"MIT"` | `PASS` (assets/deps still `UNKNOWN`) |
| B-5 | dolibarr | raw…/Dolibarr/dolibarr/develop/COPYING | `cccf779…` | **GPL-3.0** | 35,151 | `"GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007"` | `REVIEW_REQUIRED` |
| B-6 | odoo | raw…/odoo/odoo/master/LICENSE | not locked | **LGPL-3.0** (+ GPL text; OEEL separate, unverified) | 43,529 | `"Odoo is published under the GNU LESSER GENERAL PUBLIC LICENSE, Version 3 (LGPLv3) … Some external libraries … under other GPL-compatible licenses"` | `REVIEW_REQUIRED` / `UNKNOWN` (EE) |
| B-7 | monica | raw…/monicahq/monica/main/LICENSE.md | not locked | **AGPL-3.0** | 34,153 | `"### GNU AFFERO GENERAL PUBLIC LICENSE\n\nVersion 3, 19 November 2007"` | `REVIEW_REQUIRED` — **candidate REJECTED (domain)** |
| C-1 | temporal | raw…/temporalio/temporal/main/LICENSE | `af08a5e…` / v1.32.1 | **MIT** | 1,152 | `"The MIT License\n\nCopyright (c) 2025 Temporal Technologies Inc. … Copyright (c) 2020 Uber Technologies, Inc."` | `PASS` |
| C-2 | hatchet | raw…/hatchet-dev/hatchet/main/LICENSE | `56c617e…` / v0.110.5 | **MIT** | 1,090 | `"MIT License\n\nCopyright (c) 2023-present Hatchet Technologies Inc."` | `PASS` |
| C-3 | trigger.dev | raw…/triggerdotdev/trigger.dev/main/LICENSE | `7bbcf00…` / v4.7.4 | **Apache-2.0** | 10,935 | `"Apache License\n Version 2.0, January 2004"` | `PASS` |
| C-4 | restate | raw…/restatedev/restate/main/LICENSE | `bc456b3…` / v1.8.0 | **BSL 1.1** | 6,320 | `"Business Source License 1.1 … you may not use the Licensed Work for a Public Restate Platform Service."` | `REVIEW_REQUIRED` |
| C-5 | inngest | raw…/inngest/inngest/main/LICENSE.md | `5bfb552…` | **SSPL v1.0** (+ Apache-2.0 future) | 30,473 | `"# Server Side Public License, Version 1.0, Oct 16, 2018\n# Apache 2.0 Future License"` | `REVIEW_REQUIRED` |
| C-6 | bullmq | raw…/taskforcesh/bullmq/master/LICENSE | `a75e99c…` | **MIT** | 1,092 | `"MIT License\n\nCopyright (c) 2018 BullForce Labs AB and contributors."` | `PASS` |
| C-7 | pg-boss | raw…/timgit/pg-boss/master/LICENSE | `d440085…` | **MIT** | 1,076 | `"The MIT License (MIT)\n\nCopyright (c) 2016 Tim Jones"` | `PASS` |
| C-8 | airflow | raw…/apache/airflow/main/LICENSE | not locked | **Apache-2.0** | 11,752 | `"Apache License\n Version 2.0, January 2004"` | `PASS` |
| C-9 | prefect | raw…/PrefectHQ/prefect/main/LICENSE | not locked | **Apache-2.0** | 11,357 | `"Apache License\n Version 2.0, January 2004"` | `PASS` |
| C-10 | vercel/ai | raw…/vercel/ai/main/LICENSE | `8a5233b…` | **Apache-2.0** | 552 | `"Copyright 2023 Vercel, Inc.\n\nLicensed under the Apache License, Version 2.0"` | `PASS` |
| C-11 | langchain | raw…/langchain-ai/langchain/master/LICENSE | not locked | **MIT** | 1,067 | `"MIT License\n\nCopyright (c) LangChain, Inc."` | `PASS` |
| C-12 | litellm | raw…/BerriAI/litellm/main/LICENSE | not locked | **MIT** + `enterprise/LICENSE` | 1,419 | `"All content that resides under the \"enterprise/\" directory … is licensed under the license defined in \"enterprise/LICENSE\". … available under the MIT license"` | `REVIEW_REQUIRED` (enterprise dir) |
| C-13 | openai-node | raw…/openai/openai-node/master/LICENSE | not locked | **Apache-2.0** | 11,336 | `"Apache License\n Version 2.0, January 2004"` | `PASS` |
| C-14 | dbos-transact-ts | raw…/dbos-inc/dbos-transact-ts/main/LICENSE | `8643d38…` | **MIT** | 1,067 | `"MIT License\n\nCopyright (c) 2023 DBOS, Inc."` | `PASS` |
| C-15 | next-forge `packages/ai` | local repo `f189de7…` | `f189de79…` | MIT root + `REVIEW_REQUIRED` sub-issues | — | Phase A `CANDIDATE_REGISTER.md` §C-01 | `REVIEW_REQUIRED` |
| C-X | windmill (flagged) | raw…/windmill-labs/windmill/main/LICENSE | not locked | **Apache-2.0 + AGPLv3 + proprietary** | 2,038 | `"Source code in this repository is variously licensed under the Apache License Version 2.0 … or the AGPLv3 License … and a proprietary license for certain enterprise features."` | `REVIEW_REQUIRED` — **REJECTED as base** |

## C. Non-license authoritative evidence (WeChat Pay docs)

| Doc | URL | Text len | Snippet | Status |
|---|---|---|---|---|
| 签名与验签 | pay.weixin.qq.com/doc/v3/merchant/4012365342.md | 2,825 | `"商户调用微信支付接口的时候需要用到商户API证书…构造请求签名"` | `PASS` (retrieved) |
| 退款申请 | …/4012791862.md | 11,556 | `"在申请退款失败后进行重试时，请务必使用原商户退款单号…"` | `PASS` |
| 证书密钥概览 | …/4024350132.md | 3,537 | `"因微信支付公钥无过期时间，维护更简单，推荐使用"` | `PASS` |
| 商户文档索引 (V3) | …/llms.txt | 42,365 | 沙箱 occurrences: **0** | `PASS` (measurement) / **`FAIL` as an inference** |
| 商户文档索引 (V2) | pay.weixin.qq.com/doc/v2/merchant/llms.txt | 14,615 | 沙箱 occurrences: **0** — yet this index **links 支付验收指引**, which documents a sandbox | `PASS` (measurement) / see row below |
| **支付验收指引 — 仿真测试系统** | **pay.weixin.qq.com/doc/v2/merchant/4011984810.md** | retrieved 2026-10-16 | `"微信支付团队开发了一套独立的仿真测试系统"`; `"增加一层 xdc/apiv2sandbox 路径"`; `"下单接口…目前暂不支持使用"` | **`PASS`** — official sandbox confirmed, **V2-only** |

## C.1 Attempt-2 verification log (2026-10-16, allowlisted `webfetch`)

| # | Item | Method | Result |
|---|---|---|---|
| V-1 | twenty LICENSE text | `raw…/twentyhq/twenty/main/LICENSE` | **CONFIRMED** AGPLv3 + `/* @license Enterprise */` + MIT packages; **additionally found** the Section-7 *Twenty Application Exception* (unreported by attempt 1) |
| V-2 | krayin LICENSE text | `raw…/krayin/laravel-crm/master/LICENSE` | **CONFIRMED** MIT, `"Copyright 2010-2025, Webkul Software"` |
| V-3 | wechatpay-java LICENSE text | `raw…/wechatpay-apiv3/wechatpay-java/main/LICENSE` | **CONFIRMED** full Apache-2.0 |
| V-4 | hatchet LICENSE text | `raw…/hatchet-dev/hatchet/main/LICENSE` | **CONFIRMED** MIT, `"Copyright (c) 2023-present Hatchet Technologies Inc."` |
| V-5 | vercel/ai LICENSE text | `raw…/vercel/ai/main/LICENSE` | **CONFIRMED** Apache-2.0 (short form, `"Copyright 2023 Vercel, Inc."`) |
| V-6 | A-1/A-2/A-3 tag→commit | `GET /repos/{o}/{r}/tags?per_page=3` | **CONFIRMED** unchanged |
| V-7 | B-1/B-2/B-3/B-4 tag→commit | `GET /repos/{o}/{r}/commits?sha={tag}&per_page=1` | **CORRECTED** — all four differ from attempt 1 |
| V-8 | C-1/C-2/C-3/C-4 tag→commit | same | **CORRECTED** — all four differ from attempt 1 |
| V-9 | "no official Node SDK" | `GET /repos/wechatpay-apiv3/wechatpay-nodejs` | **CONFIRMED** — HTTP **404** |
| V-10 | WeChat Pay sandbox | `pay.weixin.qq.com/doc/v2/merchant/4011984810.md` | **CONTRADICTED attempt 1** — an official V2 sandbox exists |

**Defects found in attempt 1 (recorded, not hidden):**
1. **Evidence-method defect (severity: high).** `commits?per_page=1` returns the **default-branch
   HEAD**; attempt 1 published those values under a **tag** column for B-1…B-4 and C-1…C-4. Any
   "locked SHA" consumer would have pinned a different commit than the stated release.
2. **Inference defect (severity: high).** "0 × `沙箱` in an index file" was treated as
   "no sandbox documented". The index is a link list, not the corpus. An official sandbox exists.
3. **Control-enforcement gap (severity: medium).** Attempt 1 retrieved pages with code-mode `fetch`.
   The authorised control is the **domain-allowlisted `webfetch`**; code-mode `fetch` is not
   domain-scoped, so the allowlist was not the actual enforcement point. Hosts reached were still
   inside the approved set, but the control did not *guarantee* that. Attempt 2 used `webfetch` only.
4. **Timestamp gap (unchanged).** Per-call retrieval timestamps are still not captured; attempt 2
   records the session date but not per-call seconds. `UNKNOWN`.

> `websearch` was used once (to generate the sandbox lead) and returned a **non-allowlisted** host
> (`weixinzhifu.apifox.cn`). That host was **not fetched**; the lead was confirmed on the official
> WeChat domain instead. Consistent with `AUTHORIZATION_RECORD.md` §4 (search results = leads only).

## D. SPDX / license-authority references (method: read-only fetch)

| Source | URL | Purpose |
|---|---|---|
| SPDX MIT | https://spdx.org/licenses/MIT.html | license identifier authority (13,451 B retrieved) |
| OSI MIT | https://opensource.org/license/mit | OSI approval (referenced by Foundation `06`) |
| next-forge license.md | https://github.com/vercel/next-forge/blob/main/license.md | Foundation baseline (Phase A) |

## E. Scope / obligation summary (what a License Reviewer must still decide)

| License class | Candidates | Closed-source distribution implication |
|---|---|---|
| **MIT** | A-W1, B-4, C-1, C-2, C-6, C-7, C-11, C-14 | Permissive: keep copyright + permission notice. |
| **Apache-2.0** | A-1, A-2, A-3, C-3, C-8, C-9, C-10, C-13 | Permissive: keep notices, ship license text, state changes, reproduce `NOTICE` if present. |
| **AGPL-3.0** | B-1, B-2, B-3, B-7 | **Network-copyleft.** Blocks vendoring into a closed-source distributed template; separate-service use is usage-mode dependent. |
| **GPL-3.0** | B-5 | Strong copyleft. |
| **LGPL-3.0** | B-6 | Linkable, but platform + separate EE (OEEL) unverified. |
| **BSL 1.1** | C-4 | Source-available; production-use restriction; time-delayed conversion. |
| **SSPL** | C-5 | Not OSI-approved; network-service copyleft. |
| **Mixed** | B-1, C-12, C-15, C-X | Per-file/per-dir boundary must be resolved before any reuse. |

**UNKNOWN (never upgraded to PASS):** A-U2, A-U3, A-U4, A-U5, A-W2, B-U1–B-U8, C-U1–C-U6 — see
each pilot report for the full list. All per-call retrieval timestamps: `UNKNOWN`.
