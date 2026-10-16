"""Regression tests for the gate bypasses found by the independent review.

Each defect (R-B, R-C, R-D, R-G, R-R, R-X, R-A, R-E) gets a *negative* test that
asserts the bypass is refused and a *positive* test that the legitimate path still
works. The negative tests are the ones that would have caught the bypass: with the
pre-fix code they fail, with the fix they pass.

Nothing here weakens a gate. The whole point is that the "OK" that used to come
back on a bypass is now a BLOCKED with a reason.
"""

from __future__ import annotations

from conftest import (
    drive_to_staging,
    freeze_for_job,
    load_example,
    new_job,
)


# --- R-G: freeze must bind job/attempt ----------------------------------------


def test_freeze_bound_to_job_allows_validating(factory, payload):
    """Positive: a freeze bound to this job + attempt unlocks VALIDATING."""
    new_job(factory)
    drive_to_staging(factory)
    freeze_for_job(factory, payload, job_id="job-1", attempt_id="job-1-a1")

    outcome = factory.transition(
        job_id="job-1", to_state="VALIDATING", role="BUILDER_AGENT",
        actor="b", reason="frozen payload",
    )
    assert outcome.ok, outcome.reasons


def test_second_attempt_cannot_inherit_old_freeze(factory, payload):
    """Negative: rework starts a new attempt; the old freeze must not carry over."""
    new_job(factory)
    drive_to_staging(factory)
    freeze_for_job(factory, payload, job_id="job-1", attempt_id="job-1-a1")
    assert factory.transition(
        job_id="job-1", to_state="VALIDATING", role="BUILDER_AGENT",
        actor="b", reason="first pass",
    ).ok

    # Rework: VALIDATING -> TRANSFORMING begins attempt a2.
    rework = factory.transition(
        job_id="job-1", to_state="TRANSFORMING", role="BUILDER_AGENT",
        actor="b", reason="rework",
    )
    assert rework.ok, rework.reasons
    assert rework.data["job"]["attemptId"] == "job-1-a2"

    # Walk back to STAGING_ARTIFACT without a fresh freeze.
    assert factory.transition(
        job_id="job-1", to_state="CALIBRATING", role="BUILDER_AGENT",
        actor="b", reason="fix",
    ).ok
    assert factory.transition(
        job_id="job-1", to_state="STAGING_ARTIFACT", role="BUILDER_AGENT",
        actor="b", reason="stage", cosigners=("SECURITY_LICENSE_REVIEWER:sec-reviewer",),
    ).ok

    stale = factory.transition(
        job_id="job-1", to_state="VALIDATING", role="BUILDER_AGENT",
        actor="b", reason="inherit stale freeze",
    )
    assert stale.blocked
    assert any("frozen" in r for r in stale.reasons)


def test_freeze_bound_to_another_job_does_not_unlock_this_job(factory, payload):
    """Negative: a freeze attributable to job A must not unlock job B."""
    new_job(factory, job_id="job-a")
    new_job(factory, job_id="job-b")
    drive_to_staging(factory, job_id="job-a")
    drive_to_staging(factory, job_id="job-b")
    freeze_for_job(factory, payload, job_id="job-a", attempt_id="job-a-a1")

    outcome = factory.transition(
        job_id="job-b", to_state="VALIDATING", role="BUILDER_AGENT",
        actor="b", reason="borrowed freeze",
    )
    assert outcome.blocked
    assert any("frozen" in r for r in outcome.reasons)


# --- R-B / R-C: recovery only to the recorded prior stage ---------------------


def test_paused_resume_only_to_recorded_stage(factory):
    """Negative: pause from DISCOVERING, then resume to PLAN_APPROVED → refused."""
    new_job(factory)
    assert factory.transition(
        job_id="job-1", to_state="DISCOVERING", role="PRODUCT_OWNER",
        actor="po", reason="go",
    ).ok
    assert factory.transition(
        job_id="job-1", to_state="PAUSED", role="PRODUCT_OWNER",
        actor="po", reason="pause",
    ).ok

    sneak = factory.transition(
        job_id="job-1", to_state="PLAN_APPROVED", role="PRODUCT_OWNER",
        actor="po", reason="sneak past the pause",
        cosigners=("SECURITY_LICENSE_REVIEWER:sec-reviewer",),
    )
    assert sneak.blocked
    assert any("recorded prior stage" in r for r in sneak.reasons)

    # Positive: resuming to the recorded stage works.
    resume = factory.transition(
        job_id="job-1", to_state="DISCOVERING", role="PRODUCT_OWNER",
        actor="po", reason="resume",
    )
    assert resume.ok, resume.reasons
    assert factory.wh.workspace.get_job("job-1")["state"] == "DISCOVERING"


def test_po_cannot_wash_an_slr_block_via_pause_resume(factory):
    """R-C: pause/resume must not erase a SECURITY_LICENSE_REVIEWER block."""
    new_job(factory)
    assert factory.transition(
        job_id="job-1", to_state="DISCOVERING", role="PRODUCT_OWNER",
        actor="po", reason="go",
    ).ok

    block = factory.transition(
        job_id="job-1", to_state="BLOCKED", role="SECURITY_LICENSE_REVIEWER",
        actor="sec", reason="license risk",
    )
    assert block.ok, block.reasons

    assert factory.transition(
        job_id="job-1", to_state="PAUSED", role="PRODUCT_OWNER",
        actor="po", reason="pause the blocked job",
    ).ok

    wash = factory.transition(
        job_id="job-1", to_state="DISCOVERING", role="PRODUCT_OWNER",
        actor="po", reason="resume to wash the block",
    )
    assert wash.blocked
    assert any("BLOCKED" in r for r in wash.reasons)

    # The only legal resume restores the block, intact.
    restore = factory.transition(
        job_id="job-1", to_state="BLOCKED", role="PRODUCT_OWNER",
        actor="po", reason="restore blocked state",
    )
    assert restore.ok, restore.reasons
    assert factory.wh.workspace.get_job("job-1")["state"] == "BLOCKED"


# --- R-D: row 20 must not be shadowed by a specific row -----------------------


def test_security_reviewer_can_block_from_validating(factory, payload):
    """Positive: SLR blocks a job that is being validated (row 20, not row 13)."""
    new_job(factory)
    drive_to_staging(factory)
    freeze_for_job(factory, payload)
    assert factory.transition(
        job_id="job-1", to_state="VALIDATING", role="BUILDER_AGENT",
        actor="b", reason="freeze",
    ).ok

    block = factory.transition(
        job_id="job-1", to_state="BLOCKED", role="SECURITY_LICENSE_REVIEWER",
        actor="sec", reason="vulnerability disclosed",
    )
    assert block.ok, block.reasons
    assert factory.wh.workspace.get_job("job-1")["state"] == "BLOCKED"


def test_validator_can_block_from_validating(factory, payload):
    """Positive: the row-13 role still blocks as before."""
    new_job(factory)
    drive_to_staging(factory)
    freeze_for_job(factory, payload)
    assert factory.transition(
        job_id="job-1", to_state="VALIDATING", role="BUILDER_AGENT",
        actor="b", reason="freeze",
    ).ok
    block = factory.transition(
        job_id="job-1", to_state="BLOCKED", role="VALIDATOR",
        actor="v", reason="gate failed",
    )
    assert block.ok, block.reasons


def test_builder_cannot_block_from_validating(factory, payload):
    """Negative: widening row 20 must not let the builder block its own work."""
    new_job(factory)
    drive_to_staging(factory)
    freeze_for_job(factory, payload)
    assert factory.transition(
        job_id="job-1", to_state="VALIDATING", role="BUILDER_AGENT",
        actor="b", reason="freeze",
    ).ok
    block = factory.transition(
        job_id="job-1", to_state="BLOCKED", role="BUILDER_AGENT",
        actor="b", reason="self-serve block",
    )
    assert block.blocked


# --- R-R: READ_ONLY never transforms ------------------------------------------


def _walk_to_plan_approved(factory, job_id="job-1"):
    for state, role, cosigners in (
        ("DISCOVERING", "PRODUCT_OWNER", ()),
        ("EVALUATING", "DISCOVERY_AGENT", ()),
        ("AWAITING_SELECTION", "DISCOVERY_AGENT", ()),
        ("PLAN_APPROVED", "PRODUCT_OWNER", ("SECURITY_LICENSE_REVIEWER:sec-reviewer",)),
    ):
        outcome = factory.transition(
            job_id=job_id, to_state=state, role=role, actor=role.lower(),
            reason="step", cosigners=cosigners,
        )
        assert outcome.ok, (state, outcome.reasons)


def test_read_only_job_cannot_transform(factory):
    """Negative: a READ_ONLY job may not enter TRANSFORMING (doc 08)."""
    new_job(factory, risk_class="READ_ONLY")
    _walk_to_plan_approved(factory)

    outcome = factory.transition(
        job_id="job-1", to_state="TRANSFORMING", role="BUILDER_AGENT",
        actor="b", reason="transform",
    )
    assert outcome.blocked
    assert any("READ_ONLY" in r for r in outcome.reasons)


def test_sandbox_code_job_can_transform(factory):
    """Positive: a non-READ_ONLY risk class is unaffected."""
    new_job(factory, risk_class="SANDBOX_CODE")
    _walk_to_plan_approved(factory)
    outcome = factory.transition(
        job_id="job-1", to_state="TRANSFORMING", role="BUILDER_AGENT",
        actor="b", reason="transform",
    )
    assert outcome.ok, outcome.reasons


# --- R-X: co-signature ("+") is enforced, not just echoed ---------------------


def _walk_to_awaiting_selection(factory, job_id="job-1"):
    for state, role in (
        ("DISCOVERING", "PRODUCT_OWNER"),
        ("EVALUATING", "DISCOVERY_AGENT"),
        ("AWAITING_SELECTION", "DISCOVERY_AGENT"),
    ):
        outcome = factory.transition(
            job_id=job_id, to_state=state, role=role, actor=role.lower(),
            reason="step",
        )
        assert outcome.ok, (state, outcome.reasons)


def test_row5_cosignature_required(factory):
    """Negative then positive: AWAITING_SELECTION -> PLAN_APPROVED needs SLR."""
    new_job(factory)
    _walk_to_awaiting_selection(factory)

    missing = factory.transition(
        job_id="job-1", to_state="PLAN_APPROVED", role="PRODUCT_OWNER",
        actor="po", reason="approve without the reviewer",
    )
    assert missing.blocked
    assert any("co-signature" in r for r in missing.reasons)

    wrong = factory.transition(
        job_id="job-1", to_state="PLAN_APPROVED", role="PRODUCT_OWNER",
        actor="po", reason="wrong co-signer", cosigners=("VALIDATOR:val-1",),
    )
    assert wrong.blocked
    assert any("co-signature" in r for r in wrong.reasons)

    good = factory.transition(
        job_id="job-1", to_state="PLAN_APPROVED", role="PRODUCT_OWNER",
        actor="po", reason="approved", cosigners=("SECURITY_LICENSE_REVIEWER:sec-reviewer",),
    )
    assert good.ok, good.reasons
    assert "SECURITY_LICENSE_REVIEWER" in good.data["cosigners_required"]


def test_row10_cosignature_required(factory):
    """Negative then positive: CALIBRATING -> STAGING_ARTIFACT needs SLR."""
    new_job(factory)
    _walk_to_plan_approved(factory)
    for state, role in (("TRANSFORMING", "BUILDER_AGENT"), ("CALIBRATING", "BUILDER_AGENT")):
        assert factory.transition(
            job_id="job-1", to_state=state, role=role, actor=role.lower(),
            reason="step",
        ).ok, state

    missing = factory.transition(
        job_id="job-1", to_state="STAGING_ARTIFACT", role="BUILDER_AGENT",
        actor="b", reason="stage without the reviewer",
    )
    assert missing.blocked
    assert any("co-signature" in r for r in missing.reasons)

    good = factory.transition(
        job_id="job-1", to_state="STAGING_ARTIFACT", role="BUILDER_AGENT",
        actor="b", reason="staged", cosigners=("SECURITY_LICENSE_REVIEWER:sec-reviewer",),
    )
    assert good.ok, good.reasons


# --- R-A: default idempotency key must not collide across rounds --------------


def test_default_idempotency_key_does_not_collide(factory):
    """A second CALIBRATING<->TRANSFORMING round must actually move the job."""
    new_job(factory)
    _walk_to_plan_approved(factory)
    assert factory.transition(
        job_id="job-1", to_state="TRANSFORMING", role="BUILDER_AGENT",
        actor="b", reason="build",
    ).ok
    assert factory.transition(
        job_id="job-1", to_state="CALIBRATING", role="BUILDER_AGENT",
        actor="b", reason="calibrate",
    ).ok
    # Round two, no explicit key: previously this collided with round one and
    # silently returned OK without moving the job.
    second = factory.transition(
        job_id="job-1", to_state="TRANSFORMING", role="BUILDER_AGENT",
        actor="b", reason="second fix",
    )
    assert second.ok, second.reasons
    assert second.data.get("idempotent_replay") is not True
    assert factory.transition(
        job_id="job-1", to_state="CALIBRATING", role="BUILDER_AGENT",
        actor="b", reason="recalibrate",
    ).ok
    assert factory.wh.workspace.get_job("job-1")["state"] == "CALIBRATING"


# --- R-E: an explicit key reused for a different request must be refused ------


def test_idempotency_key_reuse_for_different_request_refused(factory):
    """Negative: same key, different target → refuse, do not return the old OK."""
    new_job(factory)
    first = factory.transition(
        job_id="job-1", to_state="DISCOVERING", role="PRODUCT_OWNER",
        actor="po", reason="go", idempotency_key="K",
    )
    assert first.ok

    reused = factory.transition(
        job_id="job-1", to_state="EVALUATING", role="DISCOVERY_AGENT",
        actor="d", reason="different request", idempotency_key="K",
    )
    assert reused.blocked
    assert any("different" in r for r in reused.reasons)
    # The job did not move on the refused reuse.
    assert factory.wh.workspace.get_job("job-1")["state"] == "DISCOVERING"

    # Positive: the identical request still replays as idempotent.
    replay = factory.transition(
        job_id="job-1", to_state="DISCOVERING", role="PRODUCT_OWNER",
        actor="po", reason="go", idempotency_key="K",
    )
    assert replay.ok and replay.data["idempotent_replay"] is True


def test_replay_with_changed_cosignature_is_a_different_request(factory):
    """A keyed row-5 transition cannot be replayed with the reviewer dropped."""
    new_job(factory)
    _walk_to_awaiting_selection(factory)

    first = factory.transition(
        job_id="job-1", to_state="PLAN_APPROVED", role="PRODUCT_OWNER",
        actor="po", reason="approve", cosigners=("SECURITY_LICENSE_REVIEWER:sec-reviewer",),
        idempotency_key="K",
    )
    assert first.ok, first.reasons

    replay = factory.transition(
        job_id="job-1", to_state="PLAN_APPROVED", role="PRODUCT_OWNER",
        actor="po", reason="approve", cosigners=("SECURITY_LICENSE_REVIEWER:sec-reviewer",),
        idempotency_key="K",
    )
    assert replay.ok and replay.data["idempotent_replay"] is True

    weakened = factory.transition(
        job_id="job-1", to_state="PLAN_APPROVED", role="PRODUCT_OWNER",
        actor="po", reason="approve", cosigners=(), idempotency_key="K",
    )
    assert weakened.blocked
    assert any("different" in r for r in weakened.reasons)
