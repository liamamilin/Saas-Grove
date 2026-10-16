"""Batch runs: the persisted queue a CLI- or API-driven worker pulls from (doc 11).

There is no scheduler daemon (D-E): doc 11 puts a persistent orchestrator after
the three pilots. A batch is a file under ``workspace/batches``; workers call
``claim`` to get the next ready job, advance it through the normal engine
transitions while holding its lease, and ``report`` what it cost and how it
ended. Every limit in the BatchPlan is enforced at those two calls:

* **order** — a job is offered only after every job it depends on is done;
* **concurrency** — no more live leases than the plan allows;
* **budget** — spend is charged per report; exhausting ``maxUsd`` stops the batch;
* **attempts** — failures count against ``min(maxAttemptsPerJob, retryPolicy.maxAttempts)``;
* **runtime** — ``min(budget.maxRuntimeMinutes, timeout.perJobMinutes)`` per job
  and ``timeout.totalMinutes`` per batch;
* **crash recovery** — a lease that expires without a report is a TRANSIENT
  failure, retried with backoff.

A batch never publishes. Its work ends where humans take over: selection for a
READ_ONLY batch, release approval for a build batch (doc 07 rows 5 and 15).
When a limit is hit the orchestrator moves the affected jobs to
STOPPED_FOR_REVIEW (row 23) under the authority of the PRODUCT_OWNER who
started the batch; it never moves a job forward (SC-05).

Progress is reported as counts per status, never as a percentage.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Sequence

from ..domain import JobState, Role
from ..domain.enums import TERMINAL_STATES
from ..store import StoreError
from ..store.jsonstore import file_lock, list_json, read_json, read_json_optional, write_json
from ..store.paths import check_id
from .factory import Factory
from .orchestrator import (
    RETRYABLE,
    FailureKind,
    LeaseRegistry,
    StopReason,
    budget_exhausted,
    detect_cycle,
    topological_order,
)
from .result import Outcome, blocked, ok

# Where a batch's work on a job ends and people take over.
DONE_STATES: dict[str, frozenset[JobState]] = {
    "READ_ONLY": frozenset({JobState.AWAITING_SELECTION, JobState.PLAN_APPROVED}),
    "BUILD": frozenset(
        {
            JobState.AWAITING_RELEASE_APPROVAL,
            JobState.PUBLISHING,
            JobState.REGISTERED,
            JobState.RECHECK,
        }
    ),
}

# Entry statuses inside a batch run.
READY, LEASED, DONE, FAILED, STOPPED, CLOSED = (
    "READY", "LEASED", "DONE", "FAILED", "STOPPED", "CLOSED",
)
_SETTLED = frozenset({DONE, FAILED, STOPPED, CLOSED})


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _parse(value: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(value) if value else None


class BatchRunner:
    """Start, claim from, report to, stop and inspect persisted batch runs."""

    def __init__(self, factory: Factory):
        self.factory = factory
        self.wh = factory.wh
        self.leases = LeaseRegistry(self.wh.layout.leases)

    # -- persistence ---------------------------------------------------------

    def _path(self, batch_id: str):
        return self.wh.layout.batches / f"{check_id(batch_id, 'batchId')}.json"

    def _lock(self, batch_id: str):
        return file_lock(self.wh.layout.batches / f".{check_id(batch_id, 'batchId')}.lock")

    def get(self, batch_id: str) -> Optional[dict[str, Any]]:
        return read_json_optional(self._path(batch_id))

    def list(self) -> list[dict[str, Any]]:
        return [read_json(p) for p in list_json(self.wh.layout.batches)]

    # -- start -----------------------------------------------------------------

    def start(
        self,
        *,
        batch: dict[str, Any],
        catalog: dict[str, Any],
        actor: str,
        role: str,
        approvers: Sequence[str] = (),
        approval_ref: Optional[str] = None,
        now: Optional[datetime] = None,
    ) -> Outcome:
        """Validate and plan a batch; with ``dryRun=false``, create its jobs.

        A dry run (the default in doc 11) returns the Batch Preview and writes
        nothing. A real start needs the PRODUCT_OWNER (row 1) and, under
        DUAL_CONTROL, a second named approver.
        """
        now = now or datetime.now(timezone.utc)
        checked = self.factory.validate_batch(batch, catalog)
        if checked.blocked:
            return blocked("batch.start", checked.reasons)

        targets = list(batch["targetIds"])
        deps = list(batch.get("dependencies", []))
        outside = sorted(
            {n for e in deps for n in (e["before"], e["after"]) if n not in targets}
        )
        if outside:
            return blocked(
                "batch.start",
                [f"dependency edges name targets outside this batch: {outside}"],
            )
        cycle = detect_cycle(deps)
        if cycle:
            return blocked("batch.start", [f"dependency cycle: {' -> '.join(cycle)}"])
        order = topological_order(targets, deps)

        try:
            batch_id = check_id(batch["batchId"], "batchId")
            job_ids = {t: check_id(f"{batch_id}.{t}", "jobId") for t in targets}
        except StoreError as exc:
            return blocked("batch.start", [str(exc)])

        by_id = {t.get("id"): t for t in catalog.get("targets", [])}
        preview = [
            {
                "targetId": t,
                "jobId": job_ids[t],
                "dependsOn": sorted(e["before"] for e in deps if e["after"] == t),
                "resourceType": by_id[t].get("resourceType"),
                "licensePolicy": by_id[t].get("licensePolicy"),
                "targetQualityLevel": by_id[t].get("targetQualityLevel"),
                "externalDependencies": [
                    {"id": d.get("id"), "status": d.get("status")}
                    for d in by_id[t].get("externalDependencies", [])
                ],
                "catalogBudget": by_id[t].get("budget"),
            }
            for t in order
        ]
        limits = self._limits(batch)
        if batch.get("dryRun", True):
            return ok(
                "batch.preview",
                batchId=batch_id,
                order=order,
                targets=preview,
                limits=limits,
                riskClass=batch["riskClass"],
                executionMode=batch["executionMode"],
                dryRun=True,
                detail="dryRun=true: nothing was created. Approve a copy with "
                "dryRun=false to start it (doc 11).",
            )

        reasons: list[str] = []
        if role != Role.PRODUCT_OWNER:
            reasons.append(f"starting a batch needs PRODUCT_OWNER (doc 07 row 1), got {role}")
        approvals, problems = Factory._parse_cosignatures(approvers)
        reasons += problems
        strategy = batch.get("approvalStrategy") or {}
        if strategy.get("mode") == "DUAL_CONTROL":
            wanted = strategy.get("approverRole")
            second = [
                a for a in approvals
                if a["actor"] != actor and (wanted is None or a["role"] == wanted)
            ]
            if not second:
                reasons.append(
                    "DUAL_CONTROL needs a second approver other than the starter"
                    + (f" with role {wanted}" if wanted else "")
                    + " (pass ROLE:actor)"
                )
        if reasons:
            return blocked("batch.start", reasons)

        with self._lock(batch_id):
            if self.get(batch_id) is not None:
                return blocked("batch.start", [f"batch {batch_id} was already started"])
            for t, job_id in job_ids.items():
                if self.wh.workspace.get_job(job_id) is not None:
                    return blocked("batch.start", [f"job already exists: {job_id}"])
            for t in order:
                created = self.factory.create_job(
                    job_id=job_ids[t],
                    target_id=t,
                    catalog_revision=batch["catalogRevision"],
                    risk_class=batch["riskClass"],
                    owner=actor,
                    owner_role=Role.PRODUCT_OWNER.value,
                )
                if created.blocked:
                    return blocked("batch.start", created.reasons)
            run = {
                "batchId": batch_id,
                "catalogRevision": batch["catalogRevision"],
                "riskClass": batch["riskClass"],
                "executionMode": batch["executionMode"],
                "startedAt": _iso(now),
                "startedBy": actor,
                "approvals": approvals,
                "approvalRef": approval_ref,
                "limits": limits,
                "order": order,
                "dependencies": deps,
                "jobs": {
                    t: {
                        "jobId": job_ids[t],
                        "status": READY,
                        "failedAttempts": 0,
                        "usd": 0.0,
                        "holder": None,
                        "firstClaimedAt": None,
                        "notBefore": None,
                        "failures": [],
                    }
                    for t in order
                },
                "usdSpent": 0.0,
                "stopReason": None,
            }
            write_json(self._path(batch_id), run)
        self.wh.journal.append(
            "batch.start",
            {"batchId": batch_id, "actor": actor, "role": role, "approvals": approvals,
             "approvalRef": approval_ref, "jobs": list(job_ids.values())},
        )
        return ok("batch.start", batch=self._view(run, now))

    @staticmethod
    def _limits(batch: dict[str, Any]) -> dict[str, Any]:
        budget, retry, timeout = batch["budget"], batch["retryPolicy"], batch["timeout"]
        conc = batch["concurrency"]
        return {
            "maxUsd": budget["maxUsd"],
            # Two fields bound attempts and two bound per-job runtime (SC-06):
            # the tighter one wins.
            "maxAttempts": min(budget["maxAttemptsPerJob"], retry["maxAttempts"]),
            "perJobMinutes": min(budget["maxRuntimeMinutes"], timeout["perJobMinutes"]),
            "totalMinutes": timeout["totalMinutes"],
            "concurrency": conc["discovery"] if batch["executionMode"] == "READ_ONLY" else conc["build"],
            "backoff": retry["backoff"],
            "maxBackoffSeconds": retry.get("maxBackoffSeconds", 60),
        }

    # -- the queue ---------------------------------------------------------------

    def claim(
        self,
        batch_id: str,
        holder: str,
        *,
        ttl_seconds: int = 900,
        estimate_usd: float = 0.0,
        now: Optional[datetime] = None,
    ) -> Outcome:
        """Lease the next job that is ready, in dependency order.

        ``OK`` with ``job: null`` means nothing is claimable right now; the
        ``waiting`` list says why for each unsettled job.
        """
        now = now or datetime.now(timezone.utc)
        if not isinstance(holder, str) or not holder.strip():
            return blocked("batch.claim", ["a claim needs a named holder"])
        try:
            lock = self._lock(batch_id)
        except StoreError as exc:
            return blocked("batch.claim", [str(exc)])
        with lock:
            run = self.get(batch_id)
            if run is None:
                return blocked("batch.claim", [f"unknown batch: {batch_id}"])
            self._refresh(run, now)
            limits = run["limits"]
            if run["stopReason"]:
                write_json(self._path(batch_id), run)
                return blocked("batch.claim", [f"batch is stopped: {run['stopReason']}"])
            if estimate_usd > 0 and run["usdSpent"] + estimate_usd > limits["maxUsd"]:
                write_json(self._path(batch_id), run)
                return blocked(
                    "batch.claim",
                    [f"estimated ${estimate_usd} would exceed the batch budget "
                     f"(${run['usdSpent']} of ${limits['maxUsd']} spent)"],
                )
            live = sum(1 for e in run["jobs"].values() if e["status"] == LEASED)
            if live >= limits["concurrency"]:
                write_json(self._path(batch_id), run)
                return ok("batch.claim", job=None,
                          waiting=[f"concurrency limit reached ({live}/{limits['concurrency']})"])

            waiting: list[str] = []
            chosen = None
            for target in run["order"]:
                entry = run["jobs"][target]
                if entry["status"] != READY:
                    continue
                pending = [
                    e["before"] for e in run["dependencies"]
                    if e["after"] == target and run["jobs"].get(e["before"], {}).get("status") != DONE
                ]
                if pending:
                    waiting.append(f"{target}: waiting on {', '.join(sorted(pending))}")
                    continue
                not_before = _parse(entry["notBefore"])
                if not_before and not_before > now:
                    waiting.append(f"{target}: backing off until {entry['notBefore']}")
                    continue
                lease = self.leases.acquire(
                    entry["jobId"], holder, timedelta(seconds=ttl_seconds), now=now
                )
                if lease is None:
                    waiting.append(f"{target}: leased outside this batch")
                    continue
                entry.update(
                    status=LEASED, holder=holder, notBefore=None,
                    firstClaimedAt=entry["firstClaimedAt"] or _iso(now),
                )
                chosen = (target, entry, lease)
                break
            write_json(self._path(batch_id), run)

        if chosen is None:
            settled = all(e["status"] in _SETTLED for e in run["jobs"].values())
            return ok("batch.claim", job=None, finished=settled, waiting=waiting)
        target, entry, lease = chosen
        self.wh.journal.append(
            "batch.claim",
            {"batchId": batch_id, "jobId": entry["jobId"], "holder": holder,
             "attempt": entry["failedAttempts"] + 1},
        )
        return ok(
            "batch.claim",
            job=self.wh.workspace.get_job(entry["jobId"]),
            targetId=target,
            lease=lease.to_dict(),
            attempt=entry["failedAttempts"] + 1,
            maxAttempts=run["limits"]["maxAttempts"],
        )

    def report(
        self,
        batch_id: str,
        job_id: str,
        holder: str,
        *,
        usd: float,
        outcome: str,
        failure_kind: Optional[str] = None,
        reason: str = "",
        now: Optional[datetime] = None,
    ) -> Outcome:
        """Record what a claimed unit of work cost and how it ended, then release it.

        ``outcome`` is ``OK`` or ``FAILED``. A failure is classified (doc 19):
        only TRANSIENT failures are retried; the attempt cap stops the job; any
        overspend stops the whole batch.
        """
        now = now or datetime.now(timezone.utc)
        if outcome not in ("OK", "FAILED"):
            return blocked("batch.report", [f"outcome must be OK or FAILED, got {outcome!r}"])
        if usd is None or usd < 0:
            return blocked("batch.report", ["usd must be a non-negative amount"])
        kind = None
        if outcome == "FAILED":
            try:
                kind = FailureKind(failure_kind or "DETERMINISTIC")
            except ValueError:
                return blocked("batch.report", [f"unknown failure kind {failure_kind!r}"])
        try:
            lock = self._lock(batch_id)
        except StoreError as exc:
            return blocked("batch.report", [str(exc)])
        with lock:
            run = self.get(batch_id)
            if run is None:
                return blocked("batch.report", [f"unknown batch: {batch_id}"])
            target = next((t for t, e in run["jobs"].items() if e["jobId"] == job_id), None)
            if target is None:
                return blocked("batch.report", [f"job {job_id} is not in batch {batch_id}"])
            entry = run["jobs"][target]
            # Settle this report before any expiry recovery, so a worker that
            # reports just after its lease lapsed is still credited.
            if entry["status"] != LEASED or entry["holder"] != holder:
                return blocked(
                    "batch.report",
                    [f"job {job_id} is not leased to {holder!r} in this batch "
                     f"(status {entry['status']}, holder {entry['holder']!r})"],
                )
            entry["usd"] += usd
            run["usdSpent"] += usd
            self.leases.release(job_id, holder, force=True)
            entry["holder"] = None
            if outcome == "OK":
                entry["status"] = DONE if self._is_done(run, job_id) else READY
            else:
                self._failure(run, target, kind, reason or "reported failure", now)
            if not run["stopReason"] and budget_exhausted(
                run["usdSpent"], usd, run["limits"]["maxUsd"]
            ):
                self._stop_batch(run, StopReason.BUDGET_EXHAUSTED, now)
            self._refresh(run, now)
            write_json(self._path(batch_id), run)
        self.wh.journal.append(
            "batch.report",
            {"batchId": batch_id, "jobId": job_id, "holder": holder, "usd": usd,
             "outcome": outcome, "failureKind": kind.value if kind else None,
             "reason": reason},
        )
        return ok("batch.report", entry=entry, usdSpent=run["usdSpent"],
                  stopReason=run["stopReason"])

    def stop(
        self, batch_id: str, *, actor: str, role: str, reason: str,
        now: Optional[datetime] = None,
    ) -> Outcome:
        """Stop a batch by hand. Its unsettled jobs go to STOPPED_FOR_REVIEW."""
        now = now or datetime.now(timezone.utc)
        if role != Role.PRODUCT_OWNER:
            return blocked("batch.stop", [f"stopping a batch needs PRODUCT_OWNER, got {role}"])
        try:
            lock = self._lock(batch_id)
        except StoreError as exc:
            return blocked("batch.stop", [str(exc)])
        with lock:
            run = self.get(batch_id)
            if run is None:
                return blocked("batch.stop", [f"unknown batch: {batch_id}"])
            if run["stopReason"]:
                return blocked("batch.stop", [f"batch already stopped: {run['stopReason']}"])
            self._stop_batch(run, StopReason.MANUAL_STOP, now, detail=f"{actor}: {reason}")
            write_json(self._path(batch_id), run)
        self.wh.journal.append(
            "batch.stop", {"batchId": batch_id, "actor": actor, "role": role, "reason": reason}
        )
        return ok("batch.stop", batch=self._view(run, now))

    def status(self, batch_id: str, now: Optional[datetime] = None) -> Outcome:
        """A read-only view: counts per status, per-job detail, spend. No writes."""
        now = now or datetime.now(timezone.utc)
        try:
            run = self.get(batch_id)
        except StoreError as exc:
            return blocked("batch.status", [str(exc)])
        if run is None:
            return blocked("batch.status", [f"unknown batch: {batch_id}"])
        return ok("batch.status", batch=self._view(run, now))

    # -- internals -------------------------------------------------------------------

    def _done_states(self, run: dict[str, Any]) -> frozenset[JobState]:
        return DONE_STATES["READ_ONLY" if run["executionMode"] == "READ_ONLY" else "BUILD"]

    def _is_done(self, run: dict[str, Any], job_id: str) -> bool:
        job = self.wh.workspace.get_job(job_id)
        return job is not None and JobState(job["state"]) in self._done_states(run)

    def _refresh(self, run: dict[str, Any], now: datetime) -> None:
        """Fold job states, lost leases and runtime limits into the run."""
        limits = run["limits"]
        for target, entry in run["jobs"].items():
            if entry["status"] in _SETTLED:
                continue
            job = self.wh.workspace.get_job(entry["jobId"])
            state = JobState(job["state"]) if job else None
            if state in (JobState.REJECTED, JobState.CANCELED):
                if entry["status"] == LEASED:
                    self.leases.release(entry["jobId"], entry["holder"], force=True)
                entry.update(status=CLOSED, holder=None)
                continue
            if entry["status"] == READY and state in self._done_states(run):
                entry["status"] = DONE
                continue
            if entry["status"] == LEASED:
                lease = self.leases.current(entry["jobId"], now=now)
                if lease is None or lease.holder != entry["holder"]:
                    lost = entry["holder"]
                    if lease is None:
                        self.leases.release(entry["jobId"], lost, force=True)
                    entry["holder"] = None
                    self.wh.journal.append(
                        "batch.lease_recovered",
                        {"batchId": run["batchId"], "jobId": entry["jobId"], "holder": lost},
                    )
                    self._failure(
                        run, target, FailureKind.TRANSIENT,
                        f"lease of {lost!r} expired without a report (worker lost)", now,
                    )
                    if entry["status"] in _SETTLED:
                        continue
            first = _parse(entry["firstClaimedAt"])
            if first and now - first > timedelta(minutes=limits["perJobMinutes"]):
                self._stop_job(run, target, StopReason.RUNTIME_EXHAUSTED, now)
        started = _parse(run["startedAt"])
        if (
            not run["stopReason"]
            and started
            and now - started > timedelta(minutes=limits["totalMinutes"])
        ):
            self._stop_batch(run, StopReason.RUNTIME_EXHAUSTED, now)

    def _failure(
        self, run: dict[str, Any], target: str, kind: FailureKind, reason: str, now: datetime
    ) -> None:
        entry, limits = run["jobs"][target], run["limits"]
        entry["failedAttempts"] += 1
        entry["failures"].append({"kind": kind.value, "reason": reason, "at": _iso(now)})
        if entry["failedAttempts"] >= limits["maxAttempts"]:
            self._stop_job(run, target, StopReason.ATTEMPTS_EXHAUSTED, now)
        elif kind in RETRYABLE:
            entry["status"] = READY
            entry["notBefore"] = _iso(now + self._backoff(limits, entry["failedAttempts"]))
        elif kind is FailureKind.ECONOMIC:
            self._stop_job(run, target, StopReason.NON_RETRYABLE_FAILURE, now)
        else:
            # DETERMINISTIC must be fixed first; POLICY needs a reviewer to BLOCK
            # the job (row 20). Neither is retried by the batch.
            entry["status"] = FAILED

    @staticmethod
    def _backoff(limits: dict[str, Any], failures: int) -> timedelta:
        cap = limits.get("maxBackoffSeconds", 60)
        mode = limits.get("backoff", "NONE")
        seconds = 0 if mode == "NONE" else failures if mode == "LINEAR" else 2 ** (failures - 1)
        return timedelta(seconds=min(seconds, cap))

    def _stop_job(
        self, run: dict[str, Any], target: str, reason: StopReason, now: datetime,
        detail: str = "",
    ) -> None:
        """Settle a job as STOPPED and park it in STOPPED_FOR_REVIEW (row 23)."""
        entry = run["jobs"][target]
        if entry["status"] == LEASED and entry["holder"]:
            self.leases.release(entry["jobId"], entry["holder"], force=True)
        entry.update(status=STOPPED, holder=None, stopReason=reason.value)
        job = self.wh.workspace.get_job(entry["jobId"])
        if job is None:
            return
        state = JobState(job["state"])
        if state in TERMINAL_STATES or state is JobState.STOPPED_FOR_REVIEW or state in self._done_states(run):
            return
        moved = self.factory.transition(
            job_id=entry["jobId"],
            to_state=JobState.STOPPED_FOR_REVIEW.value,
            role=Role.PRODUCT_OWNER.value,
            actor=f"orchestrator:{run['batchId']}",
            reason=(
                f"{reason.value}{': ' + detail if detail else ''}; stop pre-authorized "
                f"by the batch approval of {run['startedBy']}"
            ),
        )
        entry["stopTransition"] = "OK" if moved.ok else moved.reasons

    def _stop_batch(
        self, run: dict[str, Any], reason: StopReason, now: datetime, detail: str = ""
    ) -> None:
        run["stopReason"] = reason.value
        run["stoppedAt"] = _iso(now)
        for target, entry in run["jobs"].items():
            if entry["status"] in (READY, LEASED):
                self._stop_job(run, target, reason, now, detail)

    def _view(self, run: dict[str, Any], now: datetime) -> dict[str, Any]:
        counts: dict[str, int] = {}
        jobs = []
        for target in run["order"]:
            entry = run["jobs"][target]
            counts[entry["status"]] = counts.get(entry["status"], 0) + 1
            job = self.wh.workspace.get_job(entry["jobId"])
            lease = self.leases.current(entry["jobId"], now=now)
            jobs.append(
                {
                    "targetId": target,
                    **entry,
                    "jobState": job["state"] if job else None,
                    "leaseLive": lease is not None and lease.holder == entry["holder"],
                }
            )
        return {
            "batchId": run["batchId"],
            "riskClass": run["riskClass"],
            "executionMode": run["executionMode"],
            "startedAt": run["startedAt"],
            "startedBy": run["startedBy"],
            "limits": run["limits"],
            "usdSpent": run["usdSpent"],
            "stopReason": run["stopReason"],
            "counts": counts,
            "jobs": jobs,
            "note": "Counts per status only; never a completion percentage (doc 11).",
        }
