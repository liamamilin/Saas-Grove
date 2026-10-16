# CANDIDATE_REGISTER.md — Candidate source register (read-only)

**All entries are CANDIDATES (`qualityLevel=L0`-equivalent, `verificationStatus=CATALOGED`).
Nothing here is VERIFIED, licensed-for-redistribution, or usable.**

## 0. Evidence method / execution environment

| Field | Value |
|---|---|
| Method | read-only: `git rev-parse`, `git log`, `git status --porcelain`, `git ls-files`, `ls`, `grep`, `wc`, `shasum` |
| Host | macOS (darwin); Python 3.10.13; jsonschema 4.26.0 |
| Network | **not available / not used** — no `curl`/`wget`/fetch; all remote candidates are UNKNOWN |
| Timestamp | 2026-10-16 (Asia/Shanghai) |
| Write scope | `reports/factory-readonly/**` only |

## 1. Locally present & reviewable source

### C-01 — `vercel/next-forge` (local clone)

| Field | Value | Evidence |
|---|---|---|
| Path | `Source/next-forge/` | `ls` |
| Remote | `https://github.com/vercel/next-forge.git` | `git remote -v` |
| HEAD SHA | `f189de79ceef7c1ef69f61f12e272f99b4cdb699` | `git rev-parse HEAD` |
| Describe | `v6.0.2-1-gf189de7` | `git describe --tags` |
| Latest version tag | `v6.0.2` (`package.json` version `6.0.2`) | `git tag`, `package.json` |
| HEAD subject | `Remove docs tweet wall (#751)` — Anthony Shew, Thu May 28 08:33:08 2026 -0600 | `git log -1` |
| Branch | `main` | `git branch --show-current` |
| Working tree | **clean** (`git status --porcelain` → 0 lines) | `git status` |
| Tracked files | 680 | `git ls-files | wc -l` |
| Declared license | `license.md`: **MIT**, `Copyright (c) 2025 Vercel` | `cat license.md` |
| SPDX field in package manifests | **absent in every `package.json`** (root and all workspaces show no `license` key) | parsed all `package.json` |

**Structure observed (read-only):**
- Apps: `api`, `app`, `docs`, `email`, `storybook`, `studio`, `web`
- Packages: `ai`, `analytics`, `auth`, `cms`, `collaboration`, `database`, `design-system`,
  `email`, `feature-flags`, `internationalization`, `next-config`, `notifications`,
  `observability`, `payments`, `rate-limit`, `security`, `seo`, `storage`,
  `typescript-config`, `webhooks`
- Toolchain: bun `1.3.10`, node `>=18`, turbo, tsup, biome/ultracite, vitest, Prisma 7.

**License status = `REVIEW_REQUIRED`.** Reasons (per `Foundation 06_OSS_IP_POLICY.md` §4/§5,
which explicitly forbids trusting a single top-of-page badge):
1. Root `license.md` is MIT for the repository, but **no per-package SPDX `license` field**
   exists in any workspace manifest → per-package attribution is unresolved.
2. **No `THIRD_PARTY_NOTICES` file and no other LICENSE files are tracked**
   (`git ls-files | grep -iE 'licen[cs]e|notices?'` → only `license.md`).
3. Font/asset risk present: `docs/app/[lang]/og/[...slug]/geist-sans-regular.ttf` and
   `geist-sans-semibold.ttf` (Geist fonts), plus 27 `.png` and 29 `.svg` assets,
   including **third-party brand logos** (`docs/.../features/clerk.svg`, `stripe.svg`,
   `vercel.svg`, `neon.svg`, `posthog.svg`, `sentry.svg`, `liveblocks.svg`, etc.).
   These are trademark/brand assets and must be audited or removed before redistribution.
4. **Commercial-service integrations embedded** (service terms, not code license):
   Stripe (`packages/payments`: `stripe`, `@stripe/agent-toolkit`), Clerk (auth),
   BaseHub (cms), Resend (email), Upstash (rate-limit), Arcjet (security),
   Liveblocks (collaboration), Sentry, PostHog, Neon, Google Analytics.
5. No `SBOM` present; `bun.lock` (5,286 lines) unresolved dep-tree appears clean of
   literal `AGPL/GPL/SSPL/BSL` markers in a naive grep, but **lockfiles carry no license
   text** → transitive license status = **UNKNOWN**.

**Traceability: PASS** (HEAD SHA fixed, tree clean, remote known).
**Redistribution legality: `REVIEW_REQUIRED` → effectively BLOCKED for any closed-source
commercial packaging until §1 items 1–4 are closed by a License Reviewer.**

## 2. Offline-only candidate leads (NOT verified — UNKNOWN)

No network is permitted in this phase. The following are **named leads only**, entered to
scope future discovery. **No SHA, no license conclusion, and no usability claim is made.**
Every field is `UNKNOWN` until verified by the Phase-B discovery method below.

### Pilot A — WeChat Pay adapter (`saas-core-module`)
| Lead class | Status | Why UNKNOWN |
|---|---|---|
| Local next-forge `packages/payments` | **reviewed** | Stripe-only (`stripe`, `@stripe/agent-toolkit`); **no WeChat/Alipay adapter present** |
| Official WeChat Pay APIv3 server SDKs (Java/PHP/Go/Node) | **UNKNOWN** | not present locally; cannot fetch authoritative docs/SDK offline |
| Third-party Node WeChat Pay wrappers | **UNKNOWN** | license/security/maintenance unverifiable offline |

**Pilot A external source conclusion: BLOCKED (no legally-reviewable local source; authoritative
API documentation unverifiable offline).** Do not fabricate availability.

### Pilot B — CRM template (`business-saas-template`) — multi-candidate requirement
| Lead class | Status | Note |
|---|---|---|
| Local next-forge | **reviewed** | It is a **SaaS foundation**, not a CRM — it has **no CRM domain** (`git ls-files | grep -iE 'crm|customer|opportunit|contact'` returns only a marketing "contact form"). |
| Any other CRM candidate | **UNKNOWN / not present** | `ls Source` shows only the spec dirs + next-forge. |

**Pilot B multi-candidate conclusion: FAIL on the "≥2 reviewable candidates" requirement.**
Only **one** locally reviewable source exists (next-forge) and it is not a CRM. `12_PILOT_PLAN.md`
§Pilot B requires "至少两个实际可审候选（若不足则明确）" — the "insufficient" branch is the
honest state: **INSUFFICIENT / BLOCKED pending network discovery in an approved later phase.**
CRM candidate names are deliberately NOT asserted here (no fabrication).

### Pilot C — AI Workflow template (`ai-native-template`)
| Lead class | Status | Note |
|---|---|---|
| Local next-forge `packages/ai` | **reviewed (partial)** | Deps: `ai ^6.0.116`, `@ai-sdk/openai ^3.0.41`, `streamdown`, `zod`. Provides a model-adapter layer; **no durable workflow/queue engine** (`git ls-files | grep -iE 'queue|workflow|job|inngest|trigger|temporal|bullmq'` → only `.github/workflows/release.yml` and a UI `trigger.tsx`). |
| Workflow engine (durable execution) | **UNKNOWN** | not present locally |

**Pilot C source conclusion: PARTIAL — model-provider adapter layer available (next-forge
`packages/ai`); workflow persistence/queue layer = MISSING (must be first-party or UNKNOWN).**

## 3. Register summary

| Candidate | Type | Source SHA / status | License | Usable? |
|---|---|---|---|---|
| C-01 next-forge | foundation base (all 4 types potentially) | `f189de7…` fixed, clean | MIT (root) + `REVIEW_REQUIRED` sub-issues | **No** — REVIEW_REQUIRED |
| C-A WeChat SDKs | saas-core-module | UNKNOWN | UNKNOWN | **No** — BLOCKED |
| C-B CRM candidate #2 | business-saas-template | UNKNOWN | UNKNOWN | **No** — BLOCKED/insufficient |
| C-C workflow engine | ai-native-template | MISSING | n/a | **No** — MISSING |

## 4. Main risks

- **Single-source concentration**: only one local base; multi-candidate selection cannot be
  exercised for Pilot B, so the Factory's selection mechanism is **UNTESTED** this phase.
- **License metadata absence** in next-forge workspaces is a distribution blocker
  (foundation `06_OSS_IP_POLICY.md` §4 requires per-asset registration).
- **Brand assets** (logos) and **fonts** are latent IP/trademark issues.
- Acting on any UNKNOWN lead without approved network discovery risks fabricated availability.

## 5. Minimal next step

In an approved Phase B (still read-only + network-scoped discovery, no installs): lock SHAs,
read each candidate's license text, and complete the `06_OSS_IP_POLICY.md` §4 asset row
(`name | URL | commit | SPDX | author | usage | files | modification | redistribution | trademark | security | reviewer | date`) for C-01 and each Pilot A/B/C candidate. Until then every
remote candidate stays UNKNOWN.

## 6. Approval request

Request approval to (a) record C-01 as `CATALOGED` only, and (b) authorise a future
network-enabled **discovery-only** sub-phase for Pilots A/B/C, or explicitly defer.
No source modification, install, or monetisation is requested.
