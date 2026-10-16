"""Regression tests for the findings of the 4th-session independent review (V-*).

Each finding gets the refusal the earlier code did not produce, and where it
matters the legitimate path that must still work. All fixtures are SYNTHETIC:
passing here is metadata consistency, never a certification.
"""

from __future__ import annotations

import pytest

from conftest import (
    FIXED_NOW,
    attestation_for,
    drive_to_publishing,
    drive_to_staging,
    freeze_for_job,
    load_example,
    new_job,
)
from factory.domain import JobState, Role, recorded_stage


def _move(factory, to, role, actor=None, job_id="job-1", **kw):
    return factory.transition(
        job_id=job_id, to_state=to, role=role, actor=actor or role.lower(),
        reason="test", **kw,
    )


# --- V-1: nothing reaches the Certified Registry without an evaluated attestation


def test_register_without_a_job_is_refused(factory, frozen, attestation_context):
    ctx = attestation_context
    outcome = factory.register(
        state=ctx["state"], freeze=frozen["freeze"], decision=None,
        actor="ra", role="RELEASE_APPROVER",
    )
    assert outcome.blocked
    assert any("through a job in PUBLISHING" in r for r in outcome.reasons)
    assert factory.wh.registry.get(
        ctx["state"]["resourceId"], ctx["state"]["resourceVersion"], "resource-state"
    ) is None


def test_validator_cannot_pass_validating_without_an_evaluated_attestation(factory, payload):
    new_job(factory)
    drive_to_staging(factory)
    freeze_for_job(factory, payload)
    assert _move(factory, "VALIDATING", "BUILDER_AGENT").ok

    outcome = _move(factory, "AWAITING_RELEASE_APPROVAL", "VALIDATOR")
    assert outcome.blocked
    assert any("no attestation evaluated" in r for r in outcome.reasons)


def test_attestation_for_a_job_needs_validating_and_its_own_freeze(factory, payload):
    new_job(factory)
    drive_to_staging(factory)
    freeze = freeze_for_job(factory, payload)
    ctx = attestation_for(freeze)
    early = factory.attest(
        attestation=ctx["attestation"], profile=ctx["profile"], evidences=ctx["evidences"],
        freeze=freeze, state=ctx["state"], now=FIXED_NOW, job_id="job-1",
    )
    assert early.blocked  # still STAGING_ARTIFACT
    assert any("VALIDATING" in r for r in early.reasons)


def test_state_may_not_claim_more_than_was_evaluated(factory, publishing):
    ctx = publishing
    for overrides, expected in (
        ({"evidenceIds": ctx["state"]["evidenceIds"] + ["never-evaluated"]}, "never evaluated"),
        ({"attestationRefs": ["some-other-attestation"]}, "must reference the evaluated"),
        ({"qualityLevel": "L3"}, "exceeds the attested level"),
    ):
        outcome = factory.register(
            state={**ctx["state"], **overrides}, freeze=ctx["freeze"], decision=None,
            actor="ra", role="RELEASE_APPROVER", job_id=ctx["jobId"],
        )
        assert outcome.blocked, overrides
        assert any(expected in r for r in outcome.reasons), (overrides, outcome.reasons)


def test_registered_requires_the_payload_in_the_registry(factory, publishing):
    early = _move(factory, "REGISTERED", "RELEASE_APPROVER")
    assert early.blocked
    assert any("not registered" in r for r in early.reasons)

    assert factory.register(
        state=publishing["state"], freeze=publishing["freeze"], decision=None,
        actor="ra", role="RELEASE_APPROVER", job_id="job-1",
    ).ok
    assert _move(factory, "REGISTERED", "RELEASE_APPROVER").ok


def test_unrecorded_decision_is_refused_at_registration(factory, publishing):
    ctx = publishing
    decision = {
        **load_example("deployment_eligibility_decision"),
        "decisionId": "d-unrecorded",
        "resourceId": ctx["state"]["resourceId"],
        "resourceVersion": ctx["state"]["resourceVersion"],
        "artifactSha256": ctx["freeze"]["artifactSha256"],
    }
    outcome = factory.register(
        state={**ctx["state"], "deploymentEligibilityRef": "d-unrecorded"},
        freeze=ctx["freeze"], decision=decision,
        actor="ra", role="RELEASE_APPROVER", job_id=ctx["jobId"],
    )
    assert outcome.blocked
    assert any("not on record" in r for r in outcome.reasons)

    assert factory.record_decision(decision=decision).ok
    recorded = factory.register(
        state={**ctx["state"], "deploymentEligibilityRef": "d-unrecorded"},
        freeze=ctx["freeze"], decision=decision,
        actor="ra", role="RELEASE_APPROVER", job_id=ctx["jobId"],
    )
    assert recorded.ok, recorded.reasons


# --- V-2: a co-signature names a second person --------------------------------


def _to_calibrating(factory):
    new_job(factory)
    for to, role, cos in (
        ("DISCOVERING", "PRODUCT_OWNER", ()),
        ("EVALUATING", "DISCOVERY_AGENT", ()),
        ("AWAITING_SELECTION", "DISCOVERY_AGENT", ()),
        ("PLAN_APPROVED", "PRODUCT_OWNER", ("SECURITY_LICENSE_REVIEWER:sec-reviewer",)),
        ("TRANSFORMING", "BUILDER_AGENT", ()),
        ("CALIBRATING", "BUILDER_AGENT", ()),
    ):
        assert _move(factory, to, role, cosigners=cos).ok, to


@pytest.mark.parametrize(
    "cosigners,expected",
    [
        (("SECURITY_LICENSE_REVIEWER",), "does not name the co-signer"),
        (("SECURITY_LICENSE_REVIEWER:builder-1",), "must come from someone else"),
        (("NOT_A_ROLE:alice",), "non-canonical co-signer role"),
    ],
)
def test_cosignature_must_name_a_distinct_person(factory, cosigners, expected):
    _to_calibrating(factory)
    outcome = _move(factory, "STAGING_ARTIFACT", "BUILDER_AGENT", actor="builder-1",
                    cosigners=cosigners)
    assert outcome.blocked
    assert any(expected in r for r in outcome.reasons), outcome.reasons


def test_cosigner_identity_is_journaled(factory):
    _to_calibrating(factory)
    outcome = _move(factory, "STAGING_ARTIFACT", "BUILDER_AGENT", actor="builder-1",
                    cosigners=("SECURITY_LICENSE_REVIEWER:alice",))
    assert outcome.ok, outcome.reasons
    assert outcome.data["transition"]["cosignatures"] == [
        {"role": "SECURITY_LICENSE_REVIEWER", "actor": "alice"}
    ]


# --- V-3 / V-4: holds nest, and nothing gets stuck -----------------------------


def test_block_survives_pause_and_can_still_be_lifted(factory):
    new_job(factory)
    assert _move(factory, "DISCOVERING", "PRODUCT_OWNER").ok
    assert _move(factory, "BLOCKED", "SECURITY_LICENSE_REVIEWER").ok
    assert _move(factory, "PAUSED", "PRODUCT_OWNER").ok
    assert _move(factory, "DISCOVERING", "PRODUCT_OWNER").blocked  # no wash (R-C)
    assert _move(factory, "BLOCKED", "PRODUCT_OWNER").ok
    lifted = _move(factory, "DISCOVERING", "SECURITY_LICENSE_REVIEWER")
    assert lifted.ok, lifted.reasons  # V-3: previously deadlocked


def test_reviewer_can_block_a_paused_job(factory):
    new_job(factory)
    assert _move(factory, "DISCOVERING", "PRODUCT_OWNER").ok
    assert _move(factory, "PAUSED", "PRODUCT_OWNER").ok
    blocked = _move(factory, "BLOCKED", "VALIDATOR")
    assert blocked.ok, blocked.reasons
    # Lifting the block returns to the pause, not past it.
    assert _move(factory, "DISCOVERING", "VALIDATOR").blocked
    assert _move(factory, "PAUSED", "VALIDATOR").ok
    assert _move(factory, "DISCOVERING", "PRODUCT_OWNER").ok


def test_job_paused_in_queued_can_resume(factory):
    new_job(factory)
    assert _move(factory, "PAUSED", "PRODUCT_OWNER").ok
    assert _move(factory, "QUEUED", "PRODUCT_OWNER").ok


def test_resume_from_release_approval_revalidates(factory, payload):
    ctx = drive_to_publishing(factory, payload)
    assert _move(factory, "PAUSED", "PRODUCT_OWNER").ok
    assert _move(factory, "PUBLISHING", "PRODUCT_OWNER").blocked
    resumed = _move(factory, "VALIDATING", "PRODUCT_OWNER")
    assert resumed.ok, resumed.reasons  # SC-03: gates are re-verified in VALIDATING
    assert ctx["jobId"] == "job-1"


def test_recorded_stage_replay():
    S = JobState
    assert recorded_stage([]) is None
    assert recorded_stage([(S.DISCOVERING, S.BLOCKED), (S.BLOCKED, S.PAUSED)]) is S.BLOCKED
    assert recorded_stage(
        [(S.DISCOVERING, S.BLOCKED), (S.BLOCKED, S.PAUSED), (S.PAUSED, S.BLOCKED)]
    ) is S.DISCOVERING
    # A review that parks a stopped job keeps the stage the job was stopped in.
    assert recorded_stage(
        [(S.CALIBRATING, S.STOPPED_FOR_REVIEW), (S.STOPPED_FOR_REVIEW, S.PAUSED)]
    ) is S.CALIBRATING


# --- V-6: a job-bound freeze happens at STAGING_ARTIFACT, once per attempt -----


def test_freeze_for_a_job_outside_staging_is_refused(factory, payload):
    new_job(factory)
    outcome = factory.freeze(
        resource_id="business.crm", resource_version="1.0.0",
        manifest=load_example("resource_manifest"), payload_root=payload,
        frozen_by="b", job_id="job-1",
    )
    assert outcome.blocked
    assert any("STAGING_ARTIFACT" in r for r in outcome.reasons)


def test_freeze_cannot_target_another_attempt_or_repeat(factory, payload):
    new_job(factory)
    drive_to_staging(factory)
    future = factory.freeze(
        resource_id="business.crm", resource_version="1.0.0",
        manifest=load_example("resource_manifest"), payload_root=payload,
        frozen_by="b", job_id="job-1", attempt_id="job-1-a9",
    )
    assert future.blocked
    freeze_for_job(factory, payload)
    again = factory.freeze(
        resource_id="business.crm", resource_version="1.0.1",
        manifest=load_example("resource_manifest"), payload_root=payload,
        frozen_by="b", job_id="job-1",
    )
    assert again.blocked
    assert any("already has a freeze" in r for r in again.reasons)


# --- V-8: ids cannot climb out of their warehouse -------------------------------


@pytest.mark.parametrize("bad", ["../../registry/evil@1", "a/b", ".hidden", "..", ""])
def test_unsafe_job_ids_are_refused(factory, bad):
    outcome = factory.create_job(
        job_id=bad, target_id="t", catalog_revision="r", risk_class="READ_ONLY",
        owner="po", owner_role="PRODUCT_OWNER",
    )
    assert outcome.blocked
    assert not list((factory.wh.layout.root / "registry").rglob("job.json"))


# --- V-5: a lease is enforced by the engine, not just recorded -----------------


def test_only_the_lease_holder_advances_a_leased_job(factory):
    from factory.engine import LeaseRegistry

    new_job(factory)
    LeaseRegistry(factory.wh.layout.leases).acquire("job-1", "worker-a")

    stranger = _move(factory, "DISCOVERING", "PRODUCT_OWNER")
    assert stranger.blocked
    assert any("leased by 'worker-a'" in r for r in stranger.reasons)

    holder = _move(factory, "DISCOVERING", "PRODUCT_OWNER", holder="worker-a")
    assert holder.ok, holder.reasons


def test_control_moves_preempt_a_lease_and_say_so(factory):
    from factory.engine import LeaseRegistry

    new_job(factory)
    LeaseRegistry(factory.wh.layout.leases).acquire("job-1", "worker-a")
    paused = _move(factory, "PAUSED", "PRODUCT_OWNER")
    assert paused.ok, paused.reasons
    assert paused.data["transition"]["preemptedLease"] == "worker-a"


def test_cli_refuses_a_missing_required_option(tmp_path):
    """typer 0.16 on click 8.5 passes None for missing required options."""
    import json as _json

    from typer.testing import CliRunner

    from factory.cli import app

    result = CliRunner().invoke(
        app, ["--root", str(tmp_path / "f"), "job", "release", "--id", "j1"]
    )
    assert result.exit_code == 2
    payload = _json.loads(result.stdout)
    assert payload["status"] == "BLOCKED"
    assert "--holder" in payload["reasons"][0]
