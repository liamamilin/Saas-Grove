# API — Template Factory HTTP surface

The API is a **thin projection of the engine**. It adds no policy of its own:
every rule lives in `factory.rules` and `factory.engine`, so a caller cannot get
a different answer over HTTP than through the CLI.

Two deliberate choices:

- **A refusal is `409`, not `500`.** `BLOCKED` is a valid domain answer ("your
  request was non-conformant"), not a server fault. Only genuine bugs are `5xx`.
- **Every response carries the honesty note.** There is no endpoint that returns
  a bare approval. `note` always states that this is metadata consistency only.

> **No authentication.** This is a local, single-operator tool (doc 11: file +
> CLI + human approval before any orchestrator). Exposing it on a network
> **requires** adding an auth layer — that is called out here rather than
> assumed. Do not bind it to `0.0.0.0` without one.

## Starting the server

```sh
cd factory-impl
PYTHONPATH=src python -m factory.cli --root /path/to/.factory serve --port 8780
# then open http://127.0.0.1:8780/ui/
```

`serve` only binds loopback addresses (`127.0.0.1`, `localhost`, `::1`) and
refuses anything else, because the API has no authentication.

Running uvicorn directly also works; the root then comes from `FACTORY_ROOT`
(default `.factory`):

```sh
FACTORY_ROOT=/path/to/.factory PYTHONPATH=src uvicorn factory.api.app:app
```

`set_root(path)` exists for tests and embedders.

## Conventions

| Outcome | HTTP | Body |
|---|---|---|
| `OK` | 200 | `{"status":"OK","operation":…,"data":…,"note":…}` |
| `BLOCKED` | 409 | `{"status":"BLOCKED","reasons":[…],"note":…}` |
| unknown resource/schema | 404 | `{"detail": …}` (FastAPI) |
| lease conflict / not holder | 409 | `{"status":"BLOCKED","reasons":[…]} `|

`note` is always `Metadata consistency only. This is not a build, security,
license or signature verification, and not a commercial certification.`

## Read-only / introspection

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | version + which warehouse directories exist. Directory presence is **not** a security/license result. |
| GET | `/schemas` | list the 15 shipped schemas. |
| GET | `/schemas/{name}` | one schema. 404 if unknown. |
| GET | `/transitions` | the normative doc-07 transition table, incl. `roles` and `cosigners`. Lets a UI render it without hardcoding. |
| GET | `/ui/` | the read-only web console (static). |

## Catalog & batch planning

| Method | Path | Body |
|---|---|---|
| POST | `/catalog/validate` | `{"catalog": {…}}` |
| POST | `/batch/validate` | `{"catalog": {…}, "batch": {…}}` |

## Jobs

| Method | Path | Body / params |
|---|---|---|
| GET | `/jobs` | list job records. |
| POST | `/jobs` | `{"jobId","targetId","catalogRevision","riskClass"?,"owner","ownerRole"?}` → job in `QUEUED`. |
| GET | `/jobs/{job_id}` | one job. 404 if unknown. |
| GET | `/jobs/{job_id}/history` | the job's transitions in order. |
| POST | `/jobs/{job_id}/transition` | see below. |

`transition` body:

```json
{
  "to": "PLAN_APPROVED",
  "role": "PRODUCT_OWNER",
  "actor": "alice",
  "reason": "ADR + license plan reviewed",
  "evidenceIds": [],
  "idempotencyKey": "optional-explicit-key",
  "cosigners": ["SECURITY_LICENSE_REVIEWER:bob"],
  "holder": "worker-1"
}
```

Gates enforced by the engine (all documented in `PROGRESS.md`):

- the role must be permitted by the normative row;
- rows marked `"+"` in doc 07 (`AWAITING_SELECTION→PLAN_APPROVED`,
  `CALIBRATING→STAGING_ARTIFACT`, `EVALUATING→REJECTED`) **require** a
  co-signature `ROLE:actor` from that role, by someone other than `actor`;
  a bare role name or a self-co-signature is a `409`. Without authentication
  the co-signer's name is still asserted by the caller — what is enforced is
  that a second, named person is on record;
- a leased job (see Leases) is advanced only by its `holder`; moves into
  `PAUSED` / `BLOCKED` / `CANCELED` / `STOPPED_FOR_REVIEW` may preempt a lease
  and are journaled with `preemptedLease`;
- entering `VALIDATING` requires an `ArtifactFreeze` bound to this job **and its
  current attempt**;
- entering `AWAITING_RELEASE_APPROVAL` or `PUBLISHING` requires an attestation
  evaluated for this job against that frozen digest (`attestations/evaluate`
  with `jobId`); entering `REGISTERED` requires the payload to be registered at
  that digest by this job;
- a `READ_ONLY` job may not enter `TRANSFORMING` or later (doc 08);
- a `PAUSED`/`BLOCKED` job may only return to the stage it was parked from.
  Holds nest: a job blocked, then paused, resumes to `BLOCKED`. A job parked
  from `AWAITING_RELEASE_APPROVAL`/`PUBLISHING` resumes to `VALIDATING`
  (SPEC_CONFLICTS SC-03);
- replaying an `idempotencyKey` returns the original result only if the request
  is identical; a reused key with a different request is refused.

## Leases (doc 11: 租约 / 心跳 / 崩溃恢复)

Leases are **files** under `workspace/leases/`, created by an atomic exclusive
link, so a crash leaves the lease behind and a second worker cannot
double-claim a job. The engine enforces them: only the holder advances a leased
job.

| Method | Path | Body |
|---|---|---|
| POST | `/jobs/{job_id}/lease` | `{"holder": "worker-1", "ttlSeconds": 900}`. 409 if already held by a live worker. Reclaiming an **expired** lease succeeds and returns `recoveredFromCrash: true`. |
| POST | `/jobs/{job_id}/heartbeat` | `{"holder": "worker-1"}`. Extends a lease you hold; 409 otherwise. |
| DELETE | `/jobs/{job_id}/lease?holder=worker-1` | release your own lease; another worker's live lease is 409. |
| GET | `/jobs/{job_id}/report` | the job's state, attempt, transition count and current lease holder. |

## Batches (doc 11)

A batch run is a persisted queue. There is no background scheduler (doc 11
stages toward `catalog.json + CLI/任务文件 + Agent Harness + 测试脚本 + 人工批准`
first): workers claim, work the job through ordinary transitions while holding
its lease, and report.

| Method | Path | Body |
|---|---|---|
| POST | `/batches` | `{"batch","catalog","actor","role","approvers"?,"approvalRef"?}`. `dryRun: true` returns the Batch Preview and writes nothing; otherwise `PRODUCT_OWNER` starts it and one job per target is created (`<batchId>.<targetId>`). `DUAL_CONTROL` needs a second approver `ROLE:actor`. |
| GET | `/batches` | list batch runs. |
| GET | `/batches/{id}` | counts per status, per-job detail, spend, stop reason. Read-only. |
| POST | `/batches/{id}/claim` | `{"holder","ttlSeconds"?,"estimateUsd"?}` → the next ready job in dependency order, leased; `job: null` (+ `waiting`) when nothing is claimable. |
| POST | `/batches/{id}/report` | `{"jobId","holder","usd","outcome":"OK"\|"FAILED","failureKind"?,"reason"?}`. |
| POST | `/batches/{id}/stop` | `{"actor","role":"PRODUCT_OWNER","reason"}`. |

Limits enforced at claim/report: concurrency; `maxUsd` (overspend stops the
batch); attempts `min(budget.maxAttemptsPerJob, retryPolicy.maxAttempts)`;
per-job runtime `min(budget.maxRuntimeMinutes, timeout.perJobMinutes)`; batch
runtime `timeout.totalMinutes`. A lease that lapses without a report counts as a
`TRANSIENT` failure and is retried with backoff. Only `TRANSIENT` failures are
retried; `POLICY`/`DETERMINISTIC` are held for a human, `ECONOMIC` stops the job.
When a limit is hit, the orchestrator moves the affected jobs to
`STOPPED_FOR_REVIEW` under the starting `PRODUCT_OWNER`'s authority (actor
`orchestrator:<batchId>`); it never moves a job forward. A batch's work ends at
`AWAITING_SELECTION` (READ_ONLY) or `AWAITING_RELEASE_APPROVAL` (build) — it
never publishes.

## Freeze / attest / decision

| Method | Path | Purpose |
|---|---|---|
| POST | `/artifacts/freeze` | freeze a candidate payload. Refuses impure manifests (CF-5) and placeholder content. |
| POST | `/attestations/evaluate` | evaluate a ScopedAttestation. Returns `METADATA_CONSISTENT` at best — **never a certification**. With `"jobId"` (job in `VALIDATING`) the result is evaluated against that job's frozen payload and recorded; release steps require that record. |
| POST | `/decisions` | record a DeploymentEligibilityDecision (the sole source of `usePolicy`). |

## Registry

| Method | Path | Purpose |
|---|---|---|
| GET | `/registry` | registry index. |
| POST | `/registry/register` | publish a job's frozen payload. Requires `"role": "RELEASE_APPROVER"` and `"jobId"` of a job in `PUBLISHING`; the freeze must be that job's, an attestation must have been evaluated against it, and the state may not cite more (attestations, evidence, level) than was evaluated. A supplied decision must be the one on record. |
| POST | `/registry/retire` | move `publicationStatus` (DEPRECATED / QUARANTINED / WITHDRAWN). |
| GET | `/registry/{id}/{version}/install-check` | whether installation is permitted. Reports without raising. |

## What the API deliberately cannot do

- It has **no endpoint that certifies, approves for production, or verifies a
  signature**. `METADATA_CONSISTENT` is not a release.
- `UNKNOWN` / `NOT_RUN` evidence can never be surfaced as `PASS`.
- Release requires `RELEASE_APPROVER` **and** a non-empty `approvalId` on a
  `PRODUCTION_ELIGIBLE` decision.
