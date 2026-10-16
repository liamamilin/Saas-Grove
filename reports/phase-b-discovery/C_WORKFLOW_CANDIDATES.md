# C_WORKFLOW_CANDIDATES.md — Pilot C: AI Workflow template (`ai-native-template`)

> **Phase B · read-only, network-scoped candidate discovery.**
> **Combining multiple open-source modules is allowed** — this report composes a candidate stack
> from durable-execution engines + queues + AI SDKs. Nothing is approved or integrated.

## 0. Retrieval environment & method

| Field | Value |
|---|---|
| Agent | `factory-discoverer` (Phase B) |
| Host | macOS (darwin) |
| Method | read-only `fetch` + GitHub REST API (unauthenticated) + `raw.githubusercontent.com` |
| Network scope | `github.com` / `api.github.com` / `raw.githubusercontent.com` — allowlist; `registry.npmjs.org` (not used here) |
| Retrieval time | **2026-10-16 (UTC)**, single session |
| Evidence gap | per-call second-resolution timestamps **not captured** → `UNKNOWN` |
| Not done | no install / build / execute; no model API key; no real model call |
| **Attempt-2 re-verification** | 2026-10-16 (UTC), second independent pass via the **domain-allowlisted `webfetch`** tool: hatchet + vercel/ai LICENSE texts re-read (both **CONFIRMED**), and C-1…C-4 **tag → commit** SHAs re-resolved. C-1…C-4 SHAs in §2 are the verified tag commits; **attempt-1 values were branch HEADs**. |

**Baseline carried from Phase A:** local `Source/next-forge` `packages/ai`
@ `f189de79ceef7c1ef69f61f12e272f99b4cdb699` = **provider-adapter layer only**
(`ai ^6.0.116`, `@ai-sdk/openai ^3.0.41`, `streamdown`, `zod`); **no durable engine**. Pilot C is
therefore a **`COMPOSE`** problem, per `03_DISCOVERY_SELECTION.md` §发现流程 6.

---

## 1. Candidate list with real source links

### 1.1 Durable execution / orchestration engines

| # | Module | Repo |
|---|---|---|
| C-1 | **Temporal** — durable execution platform | https://github.com/temporalio/temporal |
| C-2 | **Hatchet** — durable task orchestration engine | https://github.com/hatchet-dev/hatchet |
| C-3 | **Trigger.dev** — durable background tasks/AI workflows | https://github.com/triggerdotdev/trigger.dev |
| C-4 | **Restate** — resilient (durable) services runtime | https://github.com/restatedev/restate |
| C-5 | **Inngest** — durable functions/step functions | https://github.com/inngest/inngest |

### 1.2 Queues / job systems

| # | Module | Repo |
|---|---|---|
| C-6 | **BullMQ** — Redis-backed distributed queue | https://github.com/taskforcesh/bullmq |
| C-7 | **pg-boss** — Postgres-backed job queue | https://github.com/timgit/pg-boss |

### 1.3 Schedulers / pipeline runners

| # | Module | Repo |
|---|---|---|
| C-8 | **Apache Airflow** | https://github.com/apache/airflow |
| C-9 | **Prefect** | https://github.com/PrefectHQ/prefect |

### 1.4 AI provider/model frameworks

| # | Module | Repo |
|---|---|---|
| C-10 | **Vercel AI SDK** (`ai`) | https://github.com/vercel/ai |
| C-11 | **LangChain** | https://github.com/langchain-ai/langchain |
| C-12 | **LiteLLM** | https://github.com/BerriAI/litellm |
| C-13 | **openai-node** | https://github.com/openai/openai-node |
| C-14 | **DBOS Transact (TS)** — durable workflows on Postgres | https://github.com/dbos-inc/dbos-transact-ts |
| C-15 | (local) next-forge `packages/ai` provider adapters | repo `f189de7…` |

---

## 2. Version, commit SHA, license + evidence

Licence method: `raw.githubusercontent.com` file read; byte length recorded.
**Commit SHA = the commit the release tag points to**, resolved with
`GET /repos/{slug}/commits?sha={tag}&per_page=1` (attempt-2 method).

> **Correction (attempt 2).** Attempt 1 used `GET /repos/{slug}/commits?per_page=1` — the
> **default-branch HEAD** — and placed it under a **tag** column. For C-1/C-2/C-3/C-4 the tag commit
> differs, so all four SHAs were **re-resolved against the tag** and replaced below.

| # | Version (tag) | Commit SHA | License (**from text**) | Text len | Evidence snippet |
|---|---|---|---|---|---|
| C-1 Temporal | `v1.32.1` | `af08a5e5f2dd40f545f2afac7780daaa6987001e` | **MIT** | 1,152 | `"The MIT License\n\nCopyright (c) 2025 Temporal Technologies Inc.  All rights reserved.\n\nCopyright (c) 2020 Uber Technologies, Inc."` |
| C-2 Hatchet | `v0.110.5` | `56c617e0da399bc9d8a10d2ba74b4950f8a950b8` | **MIT** | 1,090 | `"MIT License\n\nCopyright (c) 2023-present Hatchet Technologies Inc."` |
| C-3 Trigger.dev | `v4.7.4` | `7bbcf0073ef3d32f0306ffbb4622cf5b5314ad43` | **Apache-2.0** | 10,935 | `"Apache License\n Version 2.0, January 2004"` |
| C-4 Restate | `v1.8.0` | `bc456b30db5316ba34dc78c07bc9878cc9ffa31d` | **BSL 1.1** | 6,320 | `"Business Source License 1.1 … Additional Use Grant: You may make use of the Licensed Work, provided that you may not use the Licensed Work for a Public Restate Platform Service."` |
| C-5 Inngest | (main) | `5bfb55256528292076c5d04bbe46d6fcc3ae764a` | **SSPL v1.0** (+ Apache-2.0 future license) | 30,473 | `"# Server Side Public License, Version 1.0, Oct 16, 2018\n# Apache 2.0 Future License\n## Notice\nCopyright © 2022 Inngest, Inc."` |
| C-6 BullMQ | (`vpy3.4.0`) | `a75e99cec72ac45803e27da84ba2b932d55e077c` | **MIT** | 1,092 | `"MIT License\n\nCopyright (c) 2018 BullForce Labs AB and contributors."` |
| C-7 pg-boss | (master) | `d4400859eed280b58c346f5289a0312913d558bd` | **MIT** | 1,076 | `"The MIT License (MIT)\n\nCopyright (c) 2016 Tim Jones"` |
| C-8 Airflow | (main) | not locked | **Apache-2.0** | 11,752 | `"Apache License\n Version 2.0, January 2004"` |
| C-9 Prefect | (main) | not locked | **Apache-2.0** | 11,357 | `"Apache License\n Version 2.0, January 2004"` |
| C-10 Vercel AI SDK | (main) | `8a5233b15b1e69573d63faee6cd0014559252ee4` | **Apache-2.0** | 552 | `"Copyright 2023 Vercel, Inc.\n\nLicensed under the Apache License, Version 2.0"` |
| C-11 LangChain | (master) | not locked | **MIT** | 1,067 | `"MIT License\n\nCopyright (c) LangChain, Inc."` |
| C-12 LiteLLM | (main) | not locked | **MIT** + separate `enterprise/LICENSE` | 1,419 | `"All content that resides under the \"enterprise/\" directory … is licensed under the license defined in \"enterprise/LICENSE\". … available under the MIT license"` |
| C-13 openai-node | (master) | not locked | **Apache-2.0** | 11,336 | `"Apache License\n Version 2.0, January 2004"` |
| C-14 DBOS Transact TS | (main) | `8643d389db64351f2acfce45e96e9747b4be8465` | **MIT** | 1,067 | `"MIT License\n\nCopyright (c) 2023 DBOS, Inc."` |
| C-15 next-forge `packages/ai` | `v6.0.2` line | `f189de79ceef7c1ef69f61f12e272f99b4cdb699` | MIT root + `REVIEW_REQUIRED` sub-issues | — | Phase A `CANDIDATE_REGISTER.md` §C-01 |

**Also observed (not a separate candidate, flagged):** `windmill-labs/windmill` LICENSE =
`"Source code in this repository is variously licensed under the Apache License Version 2.0 … or the AGPLv3 License … and a proprietary license for certain enterprise features."` → **REVIEW_REQUIRED** if ever considered.

---

## 3. Feature coverage, architecture, maintenance

### 3.1 Capability coverage vs `12_PILOT_PLAN.md` §Pilot C requirements

| Required capability | Best candidates | Evidence |
|---|---|---|
| **durable execution** (survive restart) | C-1 Temporal, C-2 Hatchet, C-14 DBOS, C-4 Restate, C-5 Inngest | Temporal README: `"# Temporal—durable execution platform"`; Hatchet README: `"An orchestration engine for background tasks, AI agents, and durable workflows"` |
| **queue persistence** | C-6 BullMQ (Redis), C-7 pg-boss (Postgres), C-2 Hatchet (Postgres), C-14 DBOS (Postgres) | BullMQ README: `"Redis-based distributed queue"` |
| **retry / backoff** | C-6 BullMQ (field-level), C-3 Trigger.dev, C-2 Hatchet | BullMQ `src/interfaces/base-job-options.ts`: `"attempts?: number; // The total number of attempts to try the job until it completes"` + `"backoff?: number \| BackoffOptions"` |
| **delay / scheduling** | C-6 BullMQ (`delay`), C-3 Trigger.dev (durable cron) | BullMQ: `"delay?: number // An amount of milliseconds to wait until this job can be processed"`; Trigger.dev README: `"Durable cron schedules … recurring schedules of up to a year"` |
| **cancel / human-in-the-loop** | C-3 Trigger.dev, C-1 Temporal | Trigger.dev README: `"Human-in-the-loop: Programmatically pause your tasks until a human can approve, reject or give feedback."` |
| **progress / observability** | C-3 Trigger.dev, C-2 Hatchet, C-1 Temporal | Trigger.dev README: `"Observability & monitoring: Each run has full tracing and logs."` |
| **cost ceiling** | **not provided by any engine** | → `BUILD_FROM_SPEC` (first-party budget guard) |
| **artifact access permission / tenant isolation** | **not provided by any engine** | → `BUILD_FROM_SPEC`; ACL is ours; the engine must not be the authority for tenant-scoped artifact access |
| **model provider adapters** | C-10 Vercel AI SDK, C-15 next-forge `packages/ai`, C-11, C-12, C-13 | local `packages/ai` deps `ai ^6.0.116`, `@ai-sdk/openai ^3.0.41` |

> **Doctrine note:** README statements above are `CLAIMS`. The BullMQ `attempts/backoff/delay`
> semantics were **verified in source**; the Temporal/Hatchet/Trigger.dev durability statements are
> **README claims** and are `CLAIM (unverified at source)`.

### 3.2 Architecture / stack

| # | Language | Architecture note |
|---|---|---|
| C-1 | Go | server + separate client SDKs (TS/Java/Python/Go) |
| C-2 | Go (+ TS/Python SDKs) | single-binary engine + Postgres/Redis |
| C-3 | TypeScript | self-hostable platform + TS SDK |
| C-6 | TypeScript | library (Redis-backed), embeds in our process |
| C-7 | TypeScript | library (Postgres-backed), embeds in our process |
| C-10 | TypeScript | library; framework-agnostic model abstraction |
| C-14 | TypeScript | library (Postgres-backed) |

### 3.3 Maintenance activity (recency evidence)

| # | Last commit | Latest release |
|---|---|---|
| C-1 Temporal | 2026-10-16 | `v1.32.1` (2026-10-08) |
| C-2 Hatchet | 2026-10-15 | `v0.110.5` (2026-10-06) |
| C-3 Trigger.dev | 2026-10-15 | `v4.7.4` (2026-10-14) |
| C-4 Restate | 2026-10-15 | `v1.8.0` (2026-10-14) |
| C-5 Inngest | 2026-10-14 | — |
| C-6 BullMQ | 2026-10-16 | `vpy3.4.0` (monorepo tag) |
| C-7 pg-boss | 2026-10-15 | — |
| C-10 Vercel AI SDK | 2026-10-15 | — |
| C-14 DBOS TS | 2026-10-14 | — |

All active. Recency ≠ license quality.

---

## 4. `REUSE` / `INTEGRATE` / `BUILD_FROM_SPEC` applicability

| Module | REUSE (vendor/fork) | INTEGRATE (separate service) | BUILD_FROM_SPEC |
|---|---|---|---|
| C-1 Temporal (MIT) | **Permitted** (keep notice) | **Recommended** — run as a separate service | — |
| C-2 Hatchet (MIT) | Permitted | **Recommended** — separate service | — |
| C-3 Trigger.dev (Apache-2.0) | Permitted (NOTICE) | Permitted | — |
| C-4 Restate (BSL 1.1) | **`REVIEW_REQUIRED`** — BSL restricts production use; converts to Apache-2.0 only after the change date | `REVIEW_REQUIRED` | — |
| C-5 Inngest (SSPL) | **`REVIEW_REQUIRED`** — SSPL is not OSI-approved; network-service copyleft obligations | `REVIEW_REQUIRED` | — |
| C-6 BullMQ (MIT) | Permitted | **Recommended** — library dependency | — |
| C-7 pg-boss (MIT) | Permitted | **Recommended** — library dependency | — |
| C-8/C-9 Airflow/Prefect (Apache-2.0) | Permitted | Permitted (heavyweight) | — |
| C-10 Vercel AI SDK (Apache-2.0) | Permitted | **Recommended** — dependency | — |
| C-11 LangChain (MIT) | Permitted | Permitted | — |
| C-12 LiteLLM (MIT + `enterprise/`) | **`REVIEW_REQUIRED`** — exclude `enterprise/` | Permitted | — |
| C-13 openai-node (Apache-2.0) | Permitted | Permitted | — |
| C-14 DBOS TS (MIT) | Permitted | Permitted | — |
| **Artifact ACL / cost ceiling / tenant binding** | — | — | **`BUILD_FROM_SPEC` (required)** — authoritative spec = Factory `04_RESOURCE_CONTRACT` / `16_SCOPE_ATTESTATION_MODEL` + Foundation `05` §5 |

**License-compatibility summary for closed-source distribution:**
- **Compatible (permissive, obligations satisfiable):** C-1, C-2, C-3, C-6, C-7, C-8, C-9, C-10,
  C-11, C-13, C-14 — **subject to NOTICE/attribution obligations**.
- **`REVIEW_REQUIRED`:** C-4 (BSL), C-5 (SSPL), C-12 (LiteLLM `enterprise/`), and windmill (Apache+AGPL+proprietary).

---

## 5. Rejection reasons & `UNKNOWN` items

**Rejections recorded**
- **Windmill** — **REJECT**: mixed **Apache-2.0 + AGPLv3 + proprietary enterprise** licensing across
  one repo; unverifiable per-file boundary → `REVIEW_REQUIRED`, rejected as a default base.
- **C-5 Inngest as a *vendored* base** — **REJECT for `REUSE`**: SSPL v1.0 imposes network-service
  copyleft that is incompatible with a closed-source distributable template.
- **`INTEGRATE`-only for C-4/C-5** — **REJECT as default now**: BSL/SSPL obligations must be
  adjudicated by a License Reviewer before any deployment model is chosen.

**`UNKNOWN` items**
| ID | Unknown | Why |
|---|---|---|
| C-U1 | Model-provider **service terms / data & training policies** (OpenAI/Anthropic) | not fetched (contract, not code-license) |
| C-U2 | Transitive dependency licenses for every module | no SBOM scan |
| C-U3 | Whether engine "durability" claims survive our negative tests | `NOT_RUN` — no execution allowed |
| C-U4 | BSL "change date" / SSPL practical impact for our use | requires legal review |
| C-U5 | Airflow/Prefect/LangChain/DBOS/bullmq/vercel-ai/pg-boss/inngest commit SHAs | Airflow/Prefect/LangChain/DBOS were never locked; bullmq/vercel-ai/pg-boss/inngest values from attempt 1 were taken from the **default branch**, and (given the B/C pattern above) were **not re-resolved against any tag** in attempt 2 |
| C-U6 | Per-call retrieval timestamps | not captured |

---

## 6. Recommended route, estimated cost, risks

**Recommended route (input only): `COMPOSE` = `INTEGRATE` + `REUSE` + `BUILD_FROM_SPEC`**
1. **`INTEGRATE`** one **MIT/Apache-2.0** durable engine as a separate service —
   **C-2 Hatchet** or **C-1 Temporal** (both MIT), or embed **C-6 BullMQ**/**C-7 pg-boss** if a
   lighter footprint is preferred.
2. **`REUSE`/dependency** the **Vercel AI SDK (Apache-2.0, C-10)** — optionally continuing to use
   the local next-forge `packages/ai` adapter (C-15).
3. **`BUILD_FROM_SPEC`** the artifact ACL, tenant binding, and **cost-ceiling** layer as first-party
   code — no engine supplies these.

**Estimated cost — `ESTIMATE`:** ≈ **10–20 engineering days** for the first-party job/ACL layer
(≈ $0 on mock; a later approved test key would add small capped model spend — amount `UNKNOWN`).

**Risks:** accidentally vendoring a BSL/SSPL component; treating an engine's durability claim as
proof; conflating `mock` vs `sandbox` vs `Live` model calls (`A-LIVE-MOCK-LABEL` must be truthful);
letting the engine become an authority for tenant-scoped artifact access.

---

## 7. Ready to enter sandbox production?

**NO.** No module is integrated; no negative test (`network interruption`, `model timeout`,
`concurrent cancel`, `budget exhaustion`, `cross-tenant artifact access`, `resume-rerun`) has been
run; BSL/SSPL items are unresolved. Pilot C advances from `PARTIAL` (Phase A) to
**`CATALOGED` with a composable permissive core identified**, still **not** sandbox-ready.

## 8. Minimal next step

1. License Reviewer adjudicates C-4/C-5/C-12/windmill and confirms the permissive core.
2. Product Owner confirms engine choice envelope (separate service vs embedded library).
3. Read provider service terms (C-U1) before any real model call. **No integration from this report.**

## 9. Approval request

Confirm: (a) the composable candidate stack + the **corrected tag SHAs** for C-1…C-4; (b) the three
recorded rejections; (c) that `REVIEW_REQUIRED` items stay unapproved; (d) that no source modification
or model call is authorised.
