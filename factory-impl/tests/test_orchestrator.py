"""Scheduling: dependency order, cycles, budgets, leases, failure taxonomy."""

from __future__ import annotations

from datetime import timedelta

import pytest

from factory.engine import (
    BatchRun,
    Budget,
    FailureKind,
    JobAttempt,
    LeaseRegistry,
    Orchestrator,
    StopReason,
    detect_cycle,
    topological_order,
)
from factory.engine.result import blocked


def test_topological_order_respects_edges():
    order = topological_order(["c", "b", "a"], [{"before": "a", "after": "b"}, {"before": "b", "after": "c"}])
    assert order.index("a") < order.index("b") < order.index("c")


def test_cycle_detected():
    cycle = detect_cycle([{"before": "a", "after": "b"}, {"before": "b", "after": "a"}])
    assert cycle


def test_no_cycle_returns_empty():
    assert detect_cycle([{"before": "a", "after": "b"}]) == []


def test_plan_rejects_cycle():
    outcome = Orchestrator(Budget(10, 3, 30)).plan(
        ["a", "b"], [{"before": "a", "after": "b"}, {"before": "b", "after": "a"}]
    )
    assert outcome.blocked
    assert any("cycle" in r for r in outcome.reasons)


def test_plan_returns_order():
    outcome = Orchestrator(Budget(10, 3, 30)).plan(
        ["a", "b"], [{"before": "a", "after": "b"}]
    )
    assert outcome.ok
    assert outcome.data["order"] == ["a", "b"]


def test_budget_exhaustion_stops():
    orch = Orchestrator(Budget(max_usd=5.0, max_attempts_per_job=3, max_runtime_minutes=30))
    run = BatchRun(batch_id="b1")
    attempt = JobAttempt(job_id="j1")
    assert orch.charge(run, "j1", 2.0, attempt) is None
    assert orch.charge(run, "j1", 3.5, attempt) is StopReason.BUDGET_EXHAUSTED


def test_attempts_exhaustion_stops():
    orch = Orchestrator(Budget(max_usd=1000, max_attempts_per_job=2, max_runtime_minutes=30))
    run = BatchRun(batch_id="b1")
    assert orch.charge(run, "j1", 0.1, JobAttempt(job_id="j1", attempt=3)) is StopReason.ATTEMPTS_EXHAUSTED


def test_last_allowed_attempt_is_not_exhausted_by_being_billed():
    """R-F: attempt N of N is allowed to run; only N+1 is exhausted."""
    orch = Orchestrator(Budget(max_usd=1000, max_attempts_per_job=2, max_runtime_minutes=30))
    run = BatchRun(batch_id="b1")
    assert orch.charge(run, "j1", 0.1, JobAttempt(job_id="j1", attempt=2)) is None


def test_zero_budget_zero_cost_step_does_not_stop():
    """R-F: maxUsd=0 with a zero-cost step is not a budget exhaustion."""
    orch = Orchestrator(Budget(max_usd=0, max_attempts_per_job=3, max_runtime_minutes=30))
    run = BatchRun(batch_id="b1")
    assert orch.charge(run, "j1", 0.0, JobAttempt(job_id="j1", attempt=1)) is None


def test_zero_budget_positive_cost_stops():
    """R-F positive control: with maxUsd=0 any real spend still stops."""
    orch = Orchestrator(Budget(max_usd=0, max_attempts_per_job=3, max_runtime_minutes=30))
    run = BatchRun(batch_id="b1")
    assert orch.charge(run, "j1", 0.01, JobAttempt(job_id="j1", attempt=1)) is StopReason.BUDGET_EXHAUSTED


def test_only_transient_failures_retry():
    orch = Orchestrator(Budget(100, 5, 30))
    assert orch.should_retry(JobAttempt(job_id="j", attempt=1, failure=FailureKind.TRANSIENT))
    assert not orch.should_retry(JobAttempt(job_id="j", attempt=1, failure=FailureKind.POLICY))
    assert not orch.should_retry(JobAttempt(job_id="j", attempt=1, failure=FailureKind.DETERMINISTIC))
    assert not orch.should_retry(JobAttempt(job_id="j", attempt=1, failure=FailureKind.ECONOMIC))


def test_retry_stops_at_attempt_cap():
    orch = Orchestrator(Budget(100, 3, 30))
    assert orch.should_retry(JobAttempt(job_id="j", attempt=2, failure=FailureKind.TRANSIENT))
    assert not orch.should_retry(JobAttempt(job_id="j", attempt=3, failure=FailureKind.TRANSIENT))


def test_failure_classification_maps_policy_blocks():
    orch = Orchestrator(Budget(100, 3, 30))
    outcome = blocked("x", ["REUSE license does not permit the intended distribution"])
    assert orch.classify_failure(outcome) is FailureKind.POLICY


def test_failure_classification_transient():
    orch = Orchestrator(Budget(100, 3, 30))
    assert orch.classify_failure(blocked("x", ["network timeout"])) is FailureKind.TRANSIENT


def test_lease_is_exclusive():
    reg = LeaseRegistry()
    assert reg.acquire("j1", "worker-a") is not None
    assert reg.acquire("j1", "worker-b") is None
    assert reg.held_by("j1") == "worker-a"


def test_expired_lease_is_recoverable():
    """A crashed worker's job is reclaimed, and the reclaim is flagged."""
    reg = LeaseRegistry()
    reg.acquire("j1", "worker-a", ttl=timedelta(seconds=-1))  # already expired
    lease = reg.acquire("j1", "worker-b", ttl=timedelta(minutes=5))
    assert lease is not None
    assert lease.recovered_from_crash is True
    assert reg.held_by("j1") == "worker-b"


def test_release_frees_the_lease():
    reg = LeaseRegistry()
    reg.acquire("j1", "a")
    assert reg.release("j1", "a")
    assert reg.acquire("j1", "b") is not None


def test_run_report_is_counts_not_a_percentage():
    run = BatchRun(batch_id="b1", completed=["a"], failed=["b"])
    payload = run.to_dict()
    assert "percent" not in str(payload).lower()
    assert payload["completed"] == ["a"] and payload["failed"] == ["b"]
