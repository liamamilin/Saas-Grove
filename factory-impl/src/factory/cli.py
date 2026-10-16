"""Command line interface.

Every command prints a JSON ``Outcome`` and exits non-zero when the operation is
BLOCKED. That exit code is the interface contract: a blocked operation is a
normal, expected result, and scripting around it must be possible without
parsing prose.

Nothing here grants a release. The CLI's most dangerous verb is ``register``,
and it requires an explicit ``--role RELEASE_APPROVER``.
"""

from __future__ import annotations

import functools
import inspect
import json
import sys
from datetime import timedelta
from pathlib import Path
from typing import Optional

import typer
from typer.models import ArgumentInfo, OptionInfo

from .engine import BatchRunner, Factory, LeaseRegistry
from .rules.schema import available_schemas, load_schema
from .store import Warehouse

app = typer.Typer(
    add_completion=False,
    help="Template Factory — controlled production of SaaS/AI resources.",
    no_args_is_help=True,
)
schema_app = typer.Typer(help="Inspect the schema set.", no_args_is_help=True)
job_app = typer.Typer(help="ProductionJob operations.", no_args_is_help=True)
registry_app = typer.Typer(help="Certified Registry operations.", no_args_is_help=True)
batch_app = typer.Typer(
    help="Batch runs: a persisted queue workers claim from (doc 11).", no_args_is_help=True
)
app.add_typer(schema_app, name="schema")
app.add_typer(job_app, name="job")
app.add_typer(registry_app, name="registry")
app.add_typer(batch_app, name="batch")

_STATE = {"root": Path(".factory")}


def _open() -> Factory:
    return Factory(Warehouse.open(_STATE["root"]))


def _emit(outcome, *, soft: bool = False) -> None:
    """Print an Outcome and exit non-zero if blocked.

    ``soft`` prints the result without a failing exit code — used where a BLOCKED
    result is itself the thing being inspected (e.g. an install check).
    """
    typer.echo(json.dumps(outcome.to_dict(), ensure_ascii=False, indent=2))
    if outcome.blocked and not soft:
        raise typer.Exit(code=1)


def _read(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


@app.callback()
def main(
    root: Path = typer.Option(
        Path(".factory"), "--root", "-r", help="Factory root directory (the three warehouses)."
    ),
) -> None:
    """Set the factory root for this invocation."""
    _STATE["root"] = Path(root).resolve()


@app.command("init")
def init(root: Optional[Path] = typer.Option(None, "--root", "-r")) -> None:
    """Create the three warehouse directories."""
    if root is not None:
        _STATE["root"] = Path(root).resolve()
    wh = Warehouse.open(_STATE["root"])
    typer.echo(f"initialised factory at {wh.layout.root}")
    for d in wh.layout.all():
        typer.echo(f"  {d.relative_to(wh.layout.root)}/")


@app.command("doctor")
def doctor() -> None:
    """Report environment and schema health."""
    from . import __version__

    wh = Warehouse.open(_STATE["root"], create=False)
    info = {
        "factoryVersion": __version__,
        "root": str(wh.layout.root),
        "warehouses": {
            "candidate": wh.layout.candidate.exists(),
            "workspace": wh.layout.workspace.exists(),
            "registry": wh.layout.registry.exists(),
        },
        "schemas": len(available_schemas()),
        "note": "Presence of a directory is not a security or license result.",
    }
    typer.echo(json.dumps(info, ensure_ascii=False, indent=2))


_LOOPBACK = ("127.0.0.1", "localhost", "::1")


@app.command("serve")
def serve(
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(8780, "--port"),
) -> None:
    """Serve the HTTP API and the read-only console (/ui/) on this machine.

    The API has no authentication (docs/API.md), so only loopback addresses are
    accepted; putting it on a network needs an auth layer first.
    """
    if host not in _LOOPBACK:
        typer.echo(json.dumps({"status": "BLOCKED", "reasons": [
            f"refusing to bind {host}: the API has no authentication; "
            "serve on a loopback address or add an auth layer first"]}, indent=2))
        raise typer.Exit(code=1)
    import uvicorn

    from .api import set_root

    set_root(_STATE["root"])
    uvicorn.run("factory.api.app:app", host=host, port=port)


# --- schema -------------------------------------------------------------------


@schema_app.command("list")
def schema_list() -> None:
    """List the schema set."""
    for name in available_schemas():
        typer.echo(name)


@schema_app.command("show")
def schema_show(name: str) -> None:
    """Print one schema."""
    typer.echo(json.dumps(load_schema(name), ensure_ascii=False, indent=2))


@schema_app.command("check")
def schema_check() -> None:
    """Verify every shipped schema is itself valid."""
    from jsonschema import Draft202012Validator

    bad = []
    for name in available_schemas():
        try:
            Draft202012Validator.check_schema(load_schema(name))
        except Exception as exc:  # noqa: BLE001 - report, do not crash
            bad.append({"schema": name, "error": str(exc)})
    if bad:
        typer.echo(json.dumps({"status": "BLOCKED", "invalid": bad}, indent=2))
        raise typer.Exit(code=1)
    typer.echo(json.dumps({"status": "OK", "schemasChecked": len(available_schemas())}, indent=2))


# --- catalog / batch ----------------------------------------------------------


@app.command("catalog-validate")
def catalog_validate(catalog: Path) -> None:
    """Validate a Production Catalog."""
    _emit(_open().validate_catalog(_read(catalog)))


@app.command("batch-validate")
def batch_validate(catalog: Path, batch: Path) -> None:
    """Validate a BatchPlan against its catalog."""
    _emit(_open().validate_batch(_read(batch), _read(catalog)))


# --- jobs ---------------------------------------------------------------------


@job_app.command("create")
def job_create(
    job_id: str = typer.Option(..., "--id"),
    target_id: str = typer.Option(..., "--target"),
    catalog_revision: str = typer.Option(..., "--revision"),
    risk_class: str = typer.Option("READ_ONLY", "--risk"),
    owner: str = typer.Option(..., "--owner"),
    owner_role: str = typer.Option("PRODUCT_OWNER", "--owner-role"),
) -> None:
    """Create a ProductionJob in QUEUED."""
    _emit(
        _open().create_job(
            job_id=job_id,
            target_id=target_id,
            catalog_revision=catalog_revision,
            risk_class=risk_class,
            owner=owner,
            owner_role=owner_role,
        )
    )


@job_app.command("transition")
def job_transition(
    job_id: str = typer.Option(..., "--id"),
    to_state: str = typer.Option(..., "--to"),
    role: str = typer.Option(..., "--role"),
    actor: str = typer.Option(..., "--actor"),
    reason: str = typer.Option(..., "--reason"),
    evidence: list[str] = typer.Option([], "--evidence"),
    idempotency_key: Optional[str] = typer.Option(None, "--idempotency-key"),
    cosigner: list[str] = typer.Option(
        [], "--cosigner",
        help="Co-signature as ROLE:actor, e.g. SECURITY_LICENSE_REVIEWER:alice "
        "(required where doc 07 marks '+'; the co-signer must not be --actor).",
    ),
    holder: Optional[str] = typer.Option(
        None, "--holder", help="Lease holder; required to advance a leased job."
    ),
) -> None:
    """Move a job one step (enforces the normative transition table)."""
    _emit(
        _open().transition(
            job_id=job_id,
            to_state=to_state,
            role=role,
            actor=actor,
            reason=reason,
            evidence_ids=evidence,
            idempotency_key=idempotency_key,
            cosigners=cosigner,
            holder=holder,
        )
    )


@job_app.command("show")
def job_show(job_id: str) -> None:
    """Print a job record."""
    wh = Warehouse.open(_STATE["root"])
    job = wh.workspace.get_job(job_id)
    if job is None:
        typer.echo(json.dumps({"status": "BLOCKED", "reasons": [f"unknown job: {job_id}"]}, indent=2))
        raise typer.Exit(code=1)
    typer.echo(json.dumps(job, ensure_ascii=False, indent=2))


@job_app.command("history")
def job_history(job_id: str) -> None:
    """Print a job's transitions in order."""
    wh = Warehouse.open(_STATE["root"])
    events = [e for e in wh.journal.find("transition") if e.get("jobId") == job_id]
    typer.echo(json.dumps(events, ensure_ascii=False, indent=2))


# --- leases (doc 11: 租约 / 心跳 / claim-report) --------------------------------


def _leases() -> LeaseRegistry:
    wh = Warehouse.open(_STATE["root"])
    return LeaseRegistry(wh.layout.leases)


def _lease_blocked(msg: str) -> None:
    typer.echo(json.dumps({"status": "BLOCKED", "reasons": [msg]}, indent=2))
    raise typer.Exit(code=1)


@job_app.command("claim")
def job_claim(
    job_id: str = typer.Option(..., "--id"),
    holder: str = typer.Option(..., "--holder", help="Worker id taking the lease."),
    ttl_seconds: int = typer.Option(900, "--ttl-seconds"),
) -> None:
    """Claim an exclusive lease on a job. A live lease is refused."""
    wh = Warehouse.open(_STATE["root"])
    if wh.workspace.get_job(job_id) is None:
        _lease_blocked(f"unknown job: {job_id}")
    lease = _leases().acquire(job_id, holder, timedelta(seconds=ttl_seconds))
    if lease is None:
        _lease_blocked(f"job {job_id} is already leased by a live worker")
    typer.echo(json.dumps({"status": "OK", "lease": lease.to_dict()}, indent=2))


@job_app.command("heartbeat")
def job_heartbeat(
    job_id: str = typer.Option(..., "--id"),
    holder: str = typer.Option(..., "--holder"),
    ttl_seconds: int = typer.Option(900, "--ttl-seconds"),
) -> None:
    """Extend a lease you hold. Refuses if you are not the holder."""
    lease = _leases().heartbeat(job_id, holder, timedelta(seconds=ttl_seconds))
    if lease is None:
        _lease_blocked(f"job {job_id} is not leased by {holder}")
    typer.echo(json.dumps({"status": "OK", "lease": lease.to_dict()}, indent=2))


@job_app.command("release")
def job_release(
    job_id: str = typer.Option(..., "--id"),
    holder: str = typer.Option(..., "--holder", help="Only the holder may release a live lease."),
) -> None:
    """Release your lease so another worker may claim the job."""
    if not _leases().release(job_id, holder):
        _lease_blocked(f"job {job_id} is not leased by {holder}")
    typer.echo(json.dumps({"status": "OK", "released": job_id}, indent=2))


@job_app.command("report")
def job_report(job_id: str = typer.Option(..., "--id")) -> None:
    """A worker's per-job status report: state, attempt, lease, history counts.

    Per doc 11 this is a stage/gate report, never a completion percentage.
    """
    wh = Warehouse.open(_STATE["root"])
    job = wh.workspace.get_job(job_id)
    if job is None:
        _lease_blocked(f"unknown job: {job_id}")
    events = [e for e in wh.journal.find("transition") if e.get("jobId") == job_id]
    holder = _leases().held_by(job_id)
    report = {
        "status": "OK",
        "jobId": job_id,
        "state": job["state"],
        "attemptId": job["attemptId"],
        "riskClass": job["riskClass"],
        "transitions": len(events),
        "lastTransition": events[-1] if events else None,
        "leasedBy": holder,
        "note": (
            "Per-stage status only. Not a completion percentage, and not a "
            "commercial certification."
        ),
    }
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


# --- freeze / attest / decision -----------------------------------------------


@app.command("freeze")
def freeze(
    resource_id: str = typer.Option(..., "--id"),
    resource_version: str = typer.Option(..., "--version"),
    manifest: Path = typer.Option(..., "--manifest", help="Payload manifest JSON."),
    payload: Path = typer.Option(..., "--payload", help="Directory holding the payload."),
    frozen_by: str = typer.Option(..., "--by"),
    exclude: list[str] = typer.Option([], "--exclude", help="Relative path prefixes to skip."),
    job_id: Optional[str] = typer.Option(
        None, "--job-id", help="Bind the freeze to this job (required before VALIDATING)."
    ),
    attempt_id: Optional[str] = typer.Option(
        None, "--attempt-id", help="Bind the freeze to this attempt (defaults to the job's current attempt)."
    ),
) -> None:
    """Freeze a candidate payload and produce its ArtifactFreeze."""
    _emit(
        _open().freeze(
            resource_id=resource_id,
            resource_version=resource_version,
            manifest=_read(manifest),
            payload_root=payload,
            frozen_by=frozen_by,
            exclude=tuple(exclude),
            job_id=job_id,
            attempt_id=attempt_id,
        )
    )


@app.command("attest")
def attest(
    attestation: Path,
    profile: Path,
    evidence: list[Path] = typer.Option(..., "--evidence"),
    freeze_file: Path = typer.Option(..., "--freeze"),
    state_file: Optional[Path] = typer.Option(None, "--state"),
    job_id: Optional[str] = typer.Option(
        None, "--job-id", help="Record the result for this VALIDATING job (rows 12/15 need it)."
    ),
) -> None:
    """Evaluate a ScopedAttestation. Returns metadata consistency, never a certification."""
    _emit(
        _open().attest(
            attestation=_read(attestation),
            profile=_read(profile),
            evidences=[_read(p) for p in evidence],
            freeze=_read(freeze_file),
            state=_read(state_file) if state_file else None,
            job_id=job_id,
        )
    )


@app.command("decide")
def decide(
    decision: Path,
    state_file: Optional[Path] = typer.Option(None, "--state"),
) -> None:
    """Record a DeploymentEligibilityDecision (the sole source of usePolicy)."""
    _emit(_open().record_decision(decision=_read(decision), state=_read(state_file) if state_file else None))


# --- registry -----------------------------------------------------------------


@registry_app.command("register")
def registry_register(
    state_file: Path = typer.Option(..., "--state"),
    freeze_file: Path = typer.Option(..., "--freeze"),
    decision_file: Optional[Path] = typer.Option(None, "--decision"),
    actor: str = typer.Option(..., "--actor"),
    role: str = typer.Option(..., "--role", help="Must be RELEASE_APPROVER."),
    job_id: str = typer.Option(..., "--job-id", help="The job in PUBLISHING that carries this payload."),
) -> None:
    """Publish a job's frozen, attested payload into the Certified Registry."""
    _emit(
        _open().register(
            state=_read(state_file),
            freeze=_read(freeze_file),
            decision=_read(decision_file) if decision_file else None,
            actor=actor,
            role=role,
            job_id=job_id,
        )
    )


@registry_app.command("retire")
def registry_retire(
    resource_id: str = typer.Option(..., "--id"),
    resource_version: str = typer.Option(..., "--version"),
    to_status: str = typer.Option(..., "--to"),
    actor: str = typer.Option(..., "--actor"),
    role: str = typer.Option(..., "--role"),
    reason: str = typer.Option(..., "--reason"),
) -> None:
    """Change publication status (DEPRECATED / QUARANTINED / WITHDRAWN)."""
    _emit(
        _open().retire(
            resource_id=resource_id,
            resource_version=resource_version,
            to_status=to_status,
            actor=actor,
            role=role,
            reason=reason,
        )
    )


@registry_app.command("install-check")
def registry_install_check(
    resource_id: str = typer.Option(..., "--id"),
    resource_version: str = typer.Option(..., "--version"),
) -> None:
    """Whether a registry entry may be installed. Exits 0 even when blocked."""
    wh = Warehouse.open(_STATE["root"])
    state = wh.registry.get(resource_id, resource_version, "resource-state")
    if state is None:
        typer.echo(json.dumps({"status": "BLOCKED", "reasons": [f"not in registry: {resource_id}@{resource_version}"]}, indent=2))
        raise typer.Exit(code=1)
    _emit(Factory(wh).installable(state), soft=True)


# --- batch runs -----------------------------------------------------------------


def _runner() -> BatchRunner:
    return BatchRunner(_open())


@batch_app.command("start")
def batch_start(
    catalog: Path,
    batch: Path,
    actor: str = typer.Option(..., "--actor"),
    role: str = typer.Option(..., "--role", help="Must be PRODUCT_OWNER (doc 07 row 1)."),
    approver: list[str] = typer.Option(
        [], "--approver", help="Second approval as ROLE:actor (DUAL_CONTROL)."
    ),
    approval_ref: Optional[str] = typer.Option(None, "--approval-ref"),
) -> None:
    """Preview (dryRun=true) or start a batch, creating one job per target."""
    _emit(
        _runner().start(
            batch=_read(batch), catalog=_read(catalog), actor=actor, role=role,
            approvers=approver, approval_ref=approval_ref,
        )
    )


@batch_app.command("claim")
def batch_claim(
    batch_id: str = typer.Option(..., "--batch-id"),
    holder: str = typer.Option(..., "--holder"),
    ttl_seconds: int = typer.Option(900, "--ttl-seconds"),
    estimate_usd: float = typer.Option(0.0, "--estimate-usd"),
) -> None:
    """Lease the next ready job. ``job: null`` means nothing is claimable now."""
    _emit(
        _runner().claim(batch_id, holder, ttl_seconds=ttl_seconds, estimate_usd=estimate_usd)
    )


@batch_app.command("report")
def batch_report(
    batch_id: str = typer.Option(..., "--batch-id"),
    job_id: str = typer.Option(..., "--job"),
    holder: str = typer.Option(..., "--holder"),
    usd: float = typer.Option(..., "--usd", help="Actual cost of this unit of work."),
    outcome: str = typer.Option(..., "--outcome", help="OK or FAILED."),
    kind: Optional[str] = typer.Option(
        None, "--kind", help="TRANSIENT / DETERMINISTIC / POLICY / ECONOMIC (doc 19)."
    ),
    reason: str = typer.Option("", "--reason"),
) -> None:
    """Report a claimed job's cost and result, releasing its lease."""
    _emit(
        _runner().report(
            batch_id, job_id, holder, usd=usd, outcome=outcome.upper(),
            failure_kind=kind, reason=reason,
        )
    )


@batch_app.command("stop")
def batch_stop(
    batch_id: str = typer.Option(..., "--batch-id"),
    actor: str = typer.Option(..., "--actor"),
    role: str = typer.Option(..., "--role"),
    reason: str = typer.Option(..., "--reason"),
) -> None:
    """Stop a batch; its unsettled jobs go to STOPPED_FOR_REVIEW."""
    _emit(_runner().stop(batch_id, actor=actor, role=role, reason=reason))


@batch_app.command("status")
def batch_status(batch_id: str = typer.Option(..., "--batch-id")) -> None:
    """Counts per status, per-job detail and spend. Never a percentage."""
    _emit(_runner().status(batch_id))


@batch_app.command("list")
def batch_list() -> None:
    """Every batch run under this root."""
    runs = _runner().list()
    typer.echo(json.dumps(
        [{"batchId": r["batchId"], "stopReason": r["stopReason"], "usdSpent": r["usdSpent"]}
         for r in runs],
        ensure_ascii=False, indent=2,
    ))


def _enforce_required(fn):
    """Refuse a command whose required option or argument was not supplied.

    typer 0.16 on click 8.5 passes ``None`` for a missing required option
    instead of failing, so a forgotten ``--holder`` would silently mean "no
    holder". Every required parameter is checked here, before the command runs.
    """
    sig = inspect.signature(fn)
    required = {}
    for name, param in sig.parameters.items():
        info = param.default
        if isinstance(info, (OptionInfo, ArgumentInfo)) and info.default is ...:
            decls = getattr(info, "param_decls", None) or ()
            required[name] = next((d for d in decls if d.startswith("--")), name)
        elif param.default is inspect.Parameter.empty:
            required[name] = name.upper()

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        missing = [flag for name, flag in required.items() if kwargs.get(name) is None]
        if missing:
            typer.echo(json.dumps(
                {"status": "BLOCKED", "reasons": [f"missing required: {', '.join(missing)}"]},
                indent=2,
            ))
            raise typer.Exit(code=2)
        return fn(*args, **kwargs)

    return wrapper


for _typer_app in (app, schema_app, job_app, registry_app, batch_app):
    for _command in _typer_app.registered_commands:
        _command.callback = _enforce_required(_command.callback)


def entrypoint() -> None:  # pragma: no cover - process entry
    app()


if __name__ == "__main__":  # pragma: no cover
    app()

