"""HTTP API over the factory engine.

The API is a thin projection of the engine. It adds no policy of its own: every
rule lives in ``factory.rules`` and ``factory.engine``, so a caller cannot get a
different answer through HTTP than through the CLI.

Two deliberate design choices:

* **BLOCKED is 409, not 500.** A refusal is a valid domain answer, not a server
  fault. Clients distinguish "your request was non-conformant" from "the server
  broke".
* **Every response carries the honesty note.** There is no endpoint that returns
  a bare approval.

There is no authentication here because this is a local, single-operator tool
(doc 11: file + CLI + human approval before any orchestrator). Exposing it on a
network requires adding an auth layer; that is called out in ``docs/API.md``
rather than assumed.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .. import __version__
from ..engine import BatchRunner, Factory, LeaseRegistry
from ..rules.schema import available_schemas, load_schema
from ..store import Warehouse

app = FastAPI(
    title="Template Factory",
    version=__version__,
    description=(
        "Controlled production of SaaS/AI resources. Metadata consistency only — "
        "never a commercial certification."
    ),
)

_ROOT = Path(os.environ.get("FACTORY_ROOT", ".factory"))


def set_root(root: Path | str) -> None:
    """Point the API at a factory root (used by tests and the CLI)."""
    global _ROOT
    _ROOT = Path(root).resolve()


def factory() -> Factory:
    return Factory(Warehouse.open(_ROOT))


def _respond(outcome) -> JSONResponse:
    """Map an Outcome onto HTTP. Refusal is 409, not 500."""
    return JSONResponse(
        status_code=200 if outcome.ok else 409,
        content=outcome.to_dict(),
    )


# --- health / introspection ---------------------------------------------------


@app.get("/health")
def health() -> dict[str, Any]:
    wh = Warehouse.open(_ROOT, create=False)
    return {
        "status": "ok",
        "factoryVersion": __version__,
        "root": str(wh.layout.root),
        "warehouses": {
            "candidate": wh.layout.candidate.exists(),
            "workspace": wh.layout.workspace.exists(),
            "registry": wh.layout.registry.exists(),
        },
        "note": "Directory presence is not a security or license result.",
    }


@app.get("/schemas")
def schemas() -> dict[str, Any]:
    return {"schemas": available_schemas(), "count": len(available_schemas())}


@app.get("/schemas/{name}")
def schema_detail(name: str) -> dict[str, Any]:
    try:
        return load_schema(name)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/transitions")
def transitions() -> dict[str, Any]:
    """The normative transition table, so a UI can render it without hardcoding."""
    from ..domain.state_machine import ROW_OUTCOMES, TRANSITIONS, required_roles

    out = []
    for t in TRANSITIONS:
        out.append(
            {
                "number": t.number,
                "from": t.from_state.value if t.from_state else "(any non-terminal)",
                "to": (
                    t.to_state.value if t.to_state
                    else "(recorded prior stage)" if t.number in (19, 21)
                    else " | ".join(sorted(s.value for s in ROW_OUTCOMES[t.number]))
                ),
                "roles": sorted(r.value for r in t.roles),
                "cosigners": sorted(r.value for r in t.cosigners),
                "requires": t.requires,
            }
        )
    return {"transitions": out}


# --- request models -----------------------------------------------------------


class CatalogBody(BaseModel):
    catalog: dict[str, Any]


class BatchBody(BaseModel):
    catalog: dict[str, Any]
    batch: dict[str, Any]


class JobCreateBody(BaseModel):
    jobId: str
    targetId: str
    catalogRevision: str
    riskClass: str = "READ_ONLY"
    owner: str
    ownerRole: str = "PRODUCT_OWNER"


class TransitionBody(BaseModel):
    to: str
    role: str
    actor: str
    reason: str
    evidenceIds: list[str] = Field(default_factory=list)
    idempotencyKey: Optional[str] = None
    # "ROLE:actor" pairs; the co-signer must be someone other than ``actor``.
    cosigners: list[str] = Field(default_factory=list)
    # Lease holder; required to advance a leased job (control moves may preempt).
    holder: Optional[str] = None


class FreezeBody(BaseModel):
    resourceId: str
    resourceVersion: str
    manifest: dict[str, Any]
    payloadRoot: str
    frozenBy: str
    exclude: list[str] = Field(default_factory=list)
    jobId: Optional[str] = None
    attemptId: Optional[str] = None


class AttestBody(BaseModel):
    attestation: dict[str, Any]
    profile: dict[str, Any]
    evidences: list[dict[str, Any]]
    freeze: Optional[dict[str, Any]] = None
    state: Optional[dict[str, Any]] = None
    now: Optional[str] = None
    jobId: Optional[str] = None


class DecisionBody(BaseModel):
    decision: dict[str, Any]
    state: Optional[dict[str, Any]] = None


class RegisterBody(BaseModel):
    state: dict[str, Any]
    freeze: dict[str, Any]
    decision: Optional[dict[str, Any]] = None
    actor: str
    role: str
    jobId: Optional[str] = None


class RetireBody(BaseModel):
    resourceId: str
    resourceVersion: str
    toStatus: str
    actor: str
    role: str
    reason: str


class LeaseBody(BaseModel):
    holder: str
    ttlSeconds: int = 900


# --- endpoints ----------------------------------------------------------------


@app.post("/catalog/validate")
def catalog_validate(body: CatalogBody):
    return _respond(factory().validate_catalog(body.catalog))


@app.post("/batch/validate")
def batch_validate(body: BatchBody):
    return _respond(factory().validate_batch(body.batch, body.catalog))


@app.get("/jobs")
def list_jobs() -> dict[str, Any]:
    wh = Warehouse.open(_ROOT, create=False)
    jobs = []
    for job_id in wh.workspace.list_jobs():
        job = wh.workspace.get_job(job_id)
        if job:
            jobs.append(job)
    return {"jobs": jobs, "count": len(jobs)}


@app.post("/jobs")
def create_job(body: JobCreateBody):
    return _respond(
        factory().create_job(
            job_id=body.jobId,
            target_id=body.targetId,
            catalog_revision=body.catalogRevision,
            risk_class=body.riskClass,
            owner=body.owner,
            owner_role=body.ownerRole,
        )
    )


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    wh = Warehouse.open(_ROOT, create=False)
    job = wh.workspace.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"unknown job: {job_id}")
    return job


@app.get("/jobs/{job_id}/history")
def job_history(job_id: str) -> dict[str, Any]:
    wh = Warehouse.open(_ROOT, create=False)
    events = [e for e in wh.journal.find("transition") if e.get("jobId") == job_id]
    return {"jobId": job_id, "transitions": events, "count": len(events)}


@app.get("/jobs/{job_id}/report")
def job_report(job_id: str) -> dict[str, Any]:
    """Per-job status report: stage/gate facts, never a completion percentage."""
    wh = Warehouse.open(_ROOT, create=False)
    job = wh.workspace.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"unknown job: {job_id}")
    events = [e for e in wh.journal.find("transition") if e.get("jobId") == job_id]
    return {
        "status": "OK",
        "jobId": job_id,
        "state": job["state"],
        "attemptId": job["attemptId"],
        "riskClass": job["riskClass"],
        "transitions": len(events),
        "lastTransition": events[-1] if events else None,
        "leasedBy": _leases().held_by(job_id),
        "note": (
            "Per-stage status only. Not a completion percentage, and not a "
            "commercial certification."
        ),
    }


@app.post("/jobs/{job_id}/transition")
def job_transition(job_id: str, body: TransitionBody):
    return _respond(
        factory().transition(
            job_id=job_id,
            to_state=body.to,
            role=body.role,
            actor=body.actor,
            reason=body.reason,
            evidence_ids=body.evidenceIds,
            idempotency_key=body.idempotencyKey,
            cosigners=body.cosigners,
            holder=body.holder,
        )
    )


# --- leases (doc 11: 租约 / 心跳 / 崩溃恢复) ------------------------------------


def _leases() -> LeaseRegistry:
    wh = Warehouse.open(_ROOT)
    return LeaseRegistry(wh.layout.leases)


@app.post("/jobs/{job_id}/lease")
def claim_lease(job_id: str, body: LeaseBody):
    """Claim an exclusive lease on a job. A live lease is 409, not a new claim."""
    from datetime import timedelta

    wh = Warehouse.open(_ROOT, create=False)
    if wh.workspace.get_job(job_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown job: {job_id}")
    lease = _leases().acquire(job_id, body.holder, timedelta(seconds=body.ttlSeconds))
    if lease is None:
        return JSONResponse(
            status_code=409,
            content={
                "status": "BLOCKED",
                "reasons": [f"job {job_id} is already leased by a live worker"],
            },
        )
    return {"status": "OK", "lease": lease.to_dict()}


@app.post("/jobs/{job_id}/heartbeat")
def heartbeat_lease(job_id: str, body: LeaseBody):
    """Extend a lease you hold."""
    from datetime import timedelta

    lease = _leases().heartbeat(job_id, body.holder, timedelta(seconds=body.ttlSeconds))
    if lease is None:
        return JSONResponse(
            status_code=409,
            content={
                "status": "BLOCKED",
                "reasons": [f"job {job_id} is not leased by {body.holder}"],
            },
        )
    return {"status": "OK", "lease": lease.to_dict()}


@app.delete("/jobs/{job_id}/lease")
def release_lease(job_id: str, holder: str):
    """Release your lease. Another worker's live lease is 409."""
    if not _leases().release(job_id, holder):
        return JSONResponse(
            status_code=409,
            content={"status": "BLOCKED", "reasons": [f"job {job_id} is not leased by {holder}"]},
        )
    return {"status": "OK", "released": job_id}


@app.post("/artifacts/freeze")
def freeze(body: FreezeBody):
    return _respond(
        factory().freeze(
            resource_id=body.resourceId,
            resource_version=body.resourceVersion,
            manifest=body.manifest,
            payload_root=Path(body.payloadRoot),
            frozen_by=body.frozenBy,
            exclude=tuple(body.exclude),
            job_id=body.jobId,
            attempt_id=body.attemptId,
        )
    )


@app.post("/attestations/evaluate")
def attest(body: AttestBody):
    from datetime import datetime

    now = datetime.fromisoformat(body.now) if body.now else None
    return _respond(
        factory().attest(
            attestation=body.attestation,
            profile=body.profile,
            evidences=body.evidences,
            freeze=body.freeze,
            state=body.state,
            now=now,
            job_id=body.jobId,
        )
    )


@app.post("/decisions")
def record_decision(body: DecisionBody):
    return _respond(factory().record_decision(decision=body.decision, state=body.state))


@app.get("/registry")
def list_registry() -> dict[str, Any]:
    wh = Warehouse.open(_ROOT, create=False)
    out = []
    if wh.layout.registry.is_dir():
        for entry in sorted(wh.layout.registry.iterdir()):
            if not entry.is_dir():
                continue
            state = wh.registry.get(
                *entry.name.rsplit("@", 1), "resource-state"
            ) if "@" in entry.name else None
            out.append({"key": entry.name, "state": state})
    return {"resources": out, "count": len(out)}


@app.post("/registry/register")
def registry_register(body: RegisterBody):
    return _respond(
        factory().register(
            state=body.state,
            freeze=body.freeze,
            decision=body.decision,
            actor=body.actor,
            role=body.role,
            job_id=body.jobId,
        )
    )


@app.post("/registry/retire")
def registry_retire(body: RetireBody):
    return _respond(
        factory().retire(
            resource_id=body.resourceId,
            resource_version=body.resourceVersion,
            to_status=body.toStatus,
            actor=body.actor,
            role=body.role,
            reason=body.reason,
        )
    )


@app.get("/registry/{resource_id}/{resource_version}/install-check")
def install_check(resource_id: str, resource_version: str):
    wh = Warehouse.open(_ROOT, create=False)
    state = wh.registry.get(resource_id, resource_version, "resource-state")
    if state is None:
        raise HTTPException(
            status_code=404,
            detail=f"not in registry: {resource_id}@{resource_version}",
        )
    # Report rather than fail: the answer is the payload here.
    outcome = Factory(wh).installable(state)
    return outcome.to_dict()


# --- batch runs (doc 11) ---------------------------------------------------------


class BatchStartBody(BaseModel):
    batch: dict[str, Any]
    catalog: dict[str, Any]
    actor: str
    role: str
    approvers: list[str] = Field(default_factory=list)
    approvalRef: Optional[str] = None


class BatchClaimBody(BaseModel):
    holder: str
    ttlSeconds: int = 900
    estimateUsd: float = 0.0


class BatchReportBody(BaseModel):
    jobId: str
    holder: str
    usd: float
    outcome: str
    failureKind: Optional[str] = None
    reason: str = ""


class BatchStopBody(BaseModel):
    actor: str
    role: str
    reason: str


def _runner() -> BatchRunner:
    return BatchRunner(factory())


@app.post("/batches")
def batch_start(body: BatchStartBody):
    """Preview (dryRun=true) or start a batch."""
    return _respond(
        _runner().start(
            batch=body.batch, catalog=body.catalog, actor=body.actor, role=body.role,
            approvers=body.approvers, approval_ref=body.approvalRef,
        )
    )


@app.get("/batches")
def batch_list() -> dict[str, Any]:
    runs = _runner().list()
    return {
        "batches": [
            {"batchId": r["batchId"], "stopReason": r["stopReason"], "usdSpent": r["usdSpent"],
             "executionMode": r["executionMode"], "startedAt": r["startedAt"]}
            for r in runs
        ],
        "count": len(runs),
    }


@app.get("/batches/{batch_id}")
def batch_status(batch_id: str):
    outcome = _runner().status(batch_id)
    if outcome.blocked:
        raise HTTPException(status_code=404, detail=outcome.reasons[0])
    return outcome.to_dict()


@app.post("/batches/{batch_id}/claim")
def batch_claim(batch_id: str, body: BatchClaimBody):
    return _respond(
        _runner().claim(batch_id, body.holder, ttl_seconds=body.ttlSeconds,
                        estimate_usd=body.estimateUsd)
    )


@app.post("/batches/{batch_id}/report")
def batch_report(batch_id: str, body: BatchReportBody):
    return _respond(
        _runner().report(
            batch_id, body.jobId, body.holder, usd=body.usd, outcome=body.outcome.upper(),
            failure_kind=body.failureKind, reason=body.reason,
        )
    )


@app.post("/batches/{batch_id}/stop")
def batch_stop(batch_id: str, body: BatchStopBody):
    return _respond(_runner().stop(batch_id, actor=body.actor, role=body.role, reason=body.reason))


# --- static UI -----------------------------------------------------------------


def mount_ui(web_dir: Path | None = None) -> None:
    """Serve the read-only UI, if the directory exists."""
    from fastapi.staticfiles import StaticFiles

    directory = web_dir or (Path(__file__).resolve().parents[3] / "web")
    if directory.is_dir():
        app.mount("/ui", StaticFiles(directory=str(directory), html=True), name="ui")


# Mount at import time so uvicorn / TestClient both serve the console.
mount_ui()
