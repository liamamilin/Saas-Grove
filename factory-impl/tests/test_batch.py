"""Batch runs (P8 / V-5): a persisted queue with budget, attempts and recovery.

Time is passed explicitly so lease expiry and runtime limits are deterministic.
All data is SYNTHETIC; a finished batch is not a release of anything.
"""

from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone

import pytest

from conftest import load_example
from factory.engine import BatchRunner

T0 = datetime(2026, 10, 16, 2, tzinfo=timezone.utc)
PO = dict(actor="po", role="PRODUCT_OWNER")


def _batch(**overrides) -> dict:
    batch = load_example("batch_plan")
    batch.update({"dryRun": False, **overrides})
    return batch


def _build_batch(**overrides) -> dict:
    """A code-production batch over the two targets with no unverified externals."""
    fields = {
        "batchId": "build-1",
        "targetIds": ["business.crm", "ai.workflow"],
        "riskClass": "SANDBOX_CODE",
        "executionMode": "SANDBOX_BUILD",
        "budget": {"maxUsd": 5, "maxAttemptsPerJob": 3, "maxRuntimeMinutes": 30},
        "retryPolicy": {"maxAttempts": 3, "backoff": "EXPONENTIAL", "maxBackoffSeconds": 60},
        "timeout": {"perJobMinutes": 30, "totalMinutes": 120},
        "concurrency": {"discovery": 2, "build": 2},
    }
    fields.update(overrides)
    return _batch(**fields)


@pytest.fixture()
def runner(factory) -> BatchRunner:
    return BatchRunner(factory)


@pytest.fixture()
def catalog() -> dict:
    return load_example("production_catalog")


def _start(runner, catalog, batch, **kw):
    started = runner.start(batch=batch, catalog=catalog, now=T0, **{**PO, **kw})
    assert started.ok, started.reasons
    return started


def _discover(factory, job_id, holder):
    """What a discovery worker does with a claimed job: walk it to selection."""
    for to, role in (
        ("DISCOVERING", "PRODUCT_OWNER"),
        ("EVALUATING", "DISCOVERY_AGENT"),
        ("AWAITING_SELECTION", "DISCOVERY_AGENT"),
    ):
        moved = factory.transition(job_id=job_id, to_state=to, role=role,
                                   actor=role.lower(), reason="work", holder=holder)
        assert moved.ok, (to, moved.reasons)


# --- start --------------------------------------------------------------------


def test_dry_run_is_a_preview_and_creates_nothing(runner, catalog, factory):
    preview = runner.start(batch=_batch(dryRun=True), catalog=catalog, now=T0, **PO)
    assert preview.ok, preview.reasons
    assert preview.data["dryRun"] is True
    assert [t["targetId"] for t in preview.data["targets"]] == preview.data["order"]
    assert factory.wh.workspace.list_jobs() == []
    assert runner.list() == []


def test_start_needs_the_product_owner(runner, catalog):
    refused = runner.start(batch=_batch(), catalog=catalog, now=T0,
                           actor="b", role="BUILDER_AGENT")
    assert refused.blocked
    assert any("PRODUCT_OWNER" in r for r in refused.reasons)


def test_start_creates_one_job_per_target_once(runner, catalog, factory):
    started = _start(runner, catalog, _batch())
    jobs = [j["jobId"] for j in started.data["batch"]["jobs"]]
    assert sorted(factory.wh.workspace.list_jobs()) == sorted(jobs)
    again = runner.start(batch=_batch(), catalog=catalog, now=T0, **PO)
    assert again.blocked
    assert any("already started" in r for r in again.reasons)


def test_dual_control_needs_a_second_named_approver(runner, catalog):
    dual = _batch(approvalStrategy={"mode": "DUAL_CONTROL", "approverRole": "SECURITY_LICENSE_REVIEWER"})
    alone = runner.start(batch=dual, catalog=catalog, now=T0, **PO)
    assert alone.blocked
    self_approved = runner.start(batch=dual, catalog=catalog, now=T0,
                                 approvers=["SECURITY_LICENSE_REVIEWER:po"], **PO)
    assert self_approved.blocked
    assert runner.start(batch=dual, catalog=catalog, now=T0,
                        approvers=["SECURITY_LICENSE_REVIEWER:alice"], **PO).ok


def test_dependency_outside_the_batch_is_refused(runner, catalog):
    batch = _batch(dependencies=[{"before": "not.in.batch", "after": "business.crm"}])
    refused = runner.start(batch=batch, catalog=catalog, now=T0, **PO)
    assert refused.blocked
    assert any("outside this batch" in r for r in refused.reasons)


# --- the queue ------------------------------------------------------------------


def test_claims_follow_dependency_order(runner, catalog, factory):
    batch = _batch(
        targetIds=["business.crm", "ai.workflow"],
        dependencies=[{"before": "business.crm", "after": "ai.workflow"}],
    )
    _start(runner, catalog, batch)
    first = runner.claim(batch["batchId"], "w1", now=T0)
    assert first.data["targetId"] == "business.crm"
    blocked_by_dep = runner.claim(batch["batchId"], "w2", now=T0)
    assert blocked_by_dep.data["job"] is None
    assert any("waiting on business.crm" in w for w in blocked_by_dep.data["waiting"])

    job_id = first.data["job"]["jobId"]
    _discover(factory, job_id, "w1")
    done = runner.report(batch["batchId"], job_id, "w1", usd=0, outcome="OK", now=T0)
    assert done.data["entry"]["status"] == "DONE"
    second = runner.claim(batch["batchId"], "w2", now=T0)
    assert second.data["targetId"] == "ai.workflow"


def test_concurrency_limit_holds(runner, catalog):
    batch = _batch(concurrency={"discovery": 1, "build": 1})
    _start(runner, catalog, batch)
    assert runner.claim(batch["batchId"], "w1", now=T0).data["job"] is not None
    second = runner.claim(batch["batchId"], "w2", now=T0)
    assert second.data["job"] is None
    assert any("concurrency limit" in w for w in second.data["waiting"])


def test_only_the_holder_reports(runner, catalog):
    batch = _batch()
    _start(runner, catalog, batch)
    job_id = runner.claim(batch["batchId"], "w1", now=T0).data["job"]["jobId"]
    stranger = runner.report(batch["batchId"], job_id, "w2", usd=0, outcome="OK", now=T0)
    assert stranger.blocked


def test_zero_budget_batch_runs_zero_cost_work(runner, catalog, factory):
    """The shipped READ_ONLY example has maxUsd=0; free work must not stop it (R-F)."""
    batch = _batch()
    _start(runner, catalog, batch)
    claim = runner.claim(batch["batchId"], "w1", now=T0)
    job_id = claim.data["job"]["jobId"]
    _discover(factory, job_id, "w1")
    report = runner.report(batch["batchId"], job_id, "w1", usd=0, outcome="OK", now=T0)
    assert report.data["stopReason"] is None
    assert runner.claim(batch["batchId"], "w1", now=T0).data["job"] is not None


# --- failures, recovery, limits -----------------------------------------------------


def test_transient_failure_backs_off_then_retries(runner, catalog):
    batch = _build_batch(concurrency={"discovery": 1, "build": 1})
    _start(runner, catalog, batch)
    job_id = runner.claim(batch["batchId"], "w1", now=T0).data["job"]["jobId"]
    failed = runner.report(batch["batchId"], job_id, "w1", usd=0.5, outcome="FAILED",
                           failure_kind="TRANSIENT", reason="network", now=T0)
    assert failed.data["entry"]["status"] == "READY"
    # The other target is claimable meanwhile; this one is backing off.
    other = runner.claim(batch["batchId"], "w2", now=T0)
    assert other.data["job"]["jobId"] != job_id
    runner.report(batch["batchId"], other.data["job"]["jobId"], "w2", usd=0,
                  outcome="FAILED", failure_kind="POLICY", reason="license unknown", now=T0)
    retried = runner.claim(batch["batchId"], "w1", now=T0 + timedelta(seconds=2))
    assert retried.data["job"]["jobId"] == job_id
    assert retried.data["attempt"] == 2


def test_policy_failure_is_not_retried(runner, catalog):
    batch = _build_batch()
    _start(runner, catalog, batch)
    job_id = runner.claim(batch["batchId"], "w1", now=T0).data["job"]["jobId"]
    out = runner.report(batch["batchId"], job_id, "w1", usd=0, outcome="FAILED",
                        failure_kind="POLICY", reason="license unknown", now=T0)
    assert out.data["entry"]["status"] == "FAILED"


def test_attempt_cap_stops_the_job_for_review(runner, catalog, factory):
    batch = _build_batch(retryPolicy={"maxAttempts": 2, "backoff": "NONE"})
    _start(runner, catalog, batch)
    claim = runner.claim(batch["batchId"], "w1", now=T0)
    job_id = claim.data["job"]["jobId"]
    for _ in range(2):
        runner.report(batch["batchId"], job_id, "w1", usd=0, outcome="FAILED",
                      failure_kind="TRANSIENT", reason="flaky", now=T0)
        nxt = runner.claim(batch["batchId"], "w1", now=T0)
        if nxt.data["job"] is None or nxt.data["job"]["jobId"] != job_id:
            break
    status = runner.status(batch["batchId"], now=T0).data["batch"]
    entry = next(j for j in status["jobs"] if j["jobId"] == job_id)
    assert entry["status"] == "STOPPED"
    assert entry["stopReason"] == "ATTEMPTS_EXHAUSTED"
    assert factory.wh.workspace.get_job(job_id)["state"] == "STOPPED_FOR_REVIEW"


def test_lost_worker_lease_is_recovered_as_a_transient_failure(runner, catalog, factory):
    batch = _build_batch(concurrency={"discovery": 1, "build": 1})
    _start(runner, catalog, batch)
    first = runner.claim(batch["batchId"], "w1", ttl_seconds=60, now=T0)
    job_id = first.data["job"]["jobId"]
    later = T0 + timedelta(minutes=5)  # w1 never reported; its lease lapsed
    again = runner.claim(batch["batchId"], "w2", now=later)
    status = runner.status(batch["batchId"], now=later).data["batch"]
    entry = next(j for j in status["jobs"] if j["jobId"] == job_id)
    assert entry["failedAttempts"] == 1
    assert "worker lost" in entry["failures"][0]["reason"]
    assert any(e.get("event") == "batch.lease_recovered" for e in factory.wh.journal.entries())
    assert again.ok


def test_overspend_stops_the_batch_and_parks_its_jobs(runner, catalog, factory):
    batch = _build_batch()
    _start(runner, catalog, batch)
    job_id = runner.claim(batch["batchId"], "w1", now=T0).data["job"]["jobId"]
    out = runner.report(batch["batchId"], job_id, "w1", usd=6.0, outcome="OK", now=T0)
    assert out.data["stopReason"] == "BUDGET_EXHAUSTED"
    refused = runner.claim(batch["batchId"], "w1", now=T0)
    assert refused.blocked
    states = {factory.wh.workspace.get_job(j)["state"] for j in factory.wh.workspace.list_jobs()}
    assert states == {"STOPPED_FOR_REVIEW"}
    stop = [e for e in factory.wh.journal.find("transition") if e["to"] == "STOPPED_FOR_REVIEW"]
    assert stop and all(e["actor"] == "orchestrator:build-1" for e in stop)
    assert all("pre-authorized" in e["reason"] for e in stop)


def test_estimated_cost_over_budget_is_not_claimed(runner, catalog):
    batch = _build_batch()
    _start(runner, catalog, batch)
    refused = runner.claim(batch["batchId"], "w1", estimate_usd=10, now=T0)
    assert refused.blocked
    assert any("exceed the batch budget" in r for r in refused.reasons)


def test_total_runtime_stops_the_batch(runner, catalog):
    batch = _build_batch()
    _start(runner, catalog, batch)
    late = runner.claim(batch["batchId"], "w1", now=T0 + timedelta(minutes=121))
    assert late.blocked
    assert any("RUNTIME_EXHAUSTED" in r for r in late.reasons)


def test_manual_stop_needs_the_product_owner(runner, catalog, factory):
    batch = _build_batch()
    _start(runner, catalog, batch)
    assert runner.stop(batch["batchId"], actor="b", role="BUILDER_AGENT", reason="x", now=T0).blocked
    stopped = runner.stop(batch["batchId"], reason="scope changed", now=T0, **PO)
    assert stopped.ok
    assert stopped.data["batch"]["stopReason"] == "MANUAL_STOP"


def test_status_is_counts_never_a_percentage(runner, catalog):
    batch = _batch()
    _start(runner, catalog, batch)
    view = runner.status(batch["batchId"], now=T0).data["batch"]
    assert view["counts"] == {"READY": 3}
    # Counts and stage facts only: no field reports a completion fraction.
    assert not any("percent" in k.lower() or "progress" in k.lower() for k in view)
    assert all(isinstance(n, int) for n in view["counts"].values())


def test_the_orchestrator_only_ever_parks_jobs(runner, catalog, factory):
    """A batch never moves work forward on its own, let alone publishes: every
    transition it makes is a stop into STOPPED_FOR_REVIEW (row 23, SC-05)."""
    batch = _build_batch(retryPolicy={"maxAttempts": 1, "backoff": "NONE"})
    _start(runner, catalog, batch)
    job_id = runner.claim(batch["batchId"], "w1", now=T0).data["job"]["jobId"]
    runner.report(batch["batchId"], job_id, "w1", usd=0, outcome="FAILED",
                  failure_kind="TRANSIENT", reason="flaky", now=T0)  # cap -> stop
    other = runner.claim(batch["batchId"], "w2", now=T0).data["job"]["jobId"]
    runner.report(batch["batchId"], other, "w2", usd=9, outcome="OK", now=T0)  # overspend
    by_orchestrator = {
        e["to"] for e in factory.wh.journal.find("transition")
        if e["actor"].startswith("orchestrator:")
    }
    assert by_orchestrator == {"STOPPED_FOR_REVIEW"}
