"""The normative transition table (doc 07) and its two structural invariants."""

from __future__ import annotations

import pytest

from factory.domain import JobState, Role, TERMINAL_STATES
from factory.domain.state_machine import (
    POST_TERMINAL_VERIFICATION,
    is_legal,
    required_roles,
)

LEGAL = [
    (JobState.QUEUED, JobState.DISCOVERING, Role.PRODUCT_OWNER),
    (JobState.DISCOVERING, JobState.EVALUATING, Role.DISCOVERY_AGENT),
    (JobState.EVALUATING, JobState.AWAITING_SELECTION, Role.DISCOVERY_AGENT),
    (JobState.AWAITING_SELECTION, JobState.PLAN_APPROVED, Role.PRODUCT_OWNER),
    (JobState.PLAN_APPROVED, JobState.TRANSFORMING, Role.BUILDER_AGENT),
    (JobState.TRANSFORMING, JobState.CALIBRATING, Role.BUILDER_AGENT),
    (JobState.CALIBRATING, JobState.TRANSFORMING, Role.BUILDER_AGENT),
    (JobState.CALIBRATING, JobState.STAGING_ARTIFACT, Role.BUILDER_AGENT),
    (JobState.STAGING_ARTIFACT, JobState.VALIDATING, Role.BUILDER_AGENT),
    (JobState.VALIDATING, JobState.AWAITING_RELEASE_APPROVAL, Role.VALIDATOR),
    (JobState.VALIDATING, JobState.BLOCKED, Role.VALIDATOR),
    (JobState.VALIDATING, JobState.TRANSFORMING, Role.BUILDER_AGENT),
    (JobState.AWAITING_RELEASE_APPROVAL, JobState.PUBLISHING, Role.RELEASE_APPROVER),
    (JobState.PUBLISHING, JobState.REGISTERED, Role.RELEASE_APPROVER),
    (JobState.PUBLISHING, JobState.BLOCKED, Role.RELEASE_APPROVER),
    (JobState.EVALUATING, JobState.REJECTED, Role.DISCOVERY_AGENT),
    (JobState.AWAITING_SELECTION, JobState.REJECTED, Role.PRODUCT_OWNER),
]

ILLEGAL = [
    # A builder never signs off a release.
    (JobState.VALIDATING, JobState.AWAITING_RELEASE_APPROVAL, Role.BUILDER_AGENT),
    (JobState.AWAITING_RELEASE_APPROVAL, JobState.PUBLISHING, Role.BUILDER_AGENT),
    (JobState.PUBLISHING, JobState.REGISTERED, Role.BUILDER_AGENT),
    # Wrong role for a step.
    (JobState.QUEUED, JobState.DISCOVERING, Role.BUILDER_AGENT),
    (JobState.DISCOVERING, JobState.EVALUATING, Role.PRODUCT_OWNER),
    # Transitions that do not exist in the table.
    (JobState.QUEUED, JobState.PUBLISHING, Role.RELEASE_APPROVER),
    (JobState.QUEUED, JobState.VALIDATING, Role.VALIDATOR),
    (JobState.DISCOVERING, JobState.REGISTERED, Role.RELEASE_APPROVER),
    # BLOCKED may never jump straight to publishing.
    (JobState.BLOCKED, JobState.PUBLISHING, Role.RELEASE_APPROVER),
    (JobState.BLOCKED, JobState.REGISTERED, Role.RELEASE_APPROVER),
    # RECHECK cannot publish.
    (JobState.RECHECK, JobState.PUBLISHING, Role.RELEASE_APPROVER),
    # STOPPED_FOR_REVIEW has enumerated outcomes only.
    (JobState.STOPPED_FOR_REVIEW, JobState.VALIDATING, Role.PRODUCT_OWNER),
]


@pytest.mark.parametrize("frm,to,role", LEGAL)
def test_legal_transitions(frm, to, role):
    legal, _ = is_legal(frm, to, role)
    assert legal, f"{frm} -> {to} by {role} should be legal"


@pytest.mark.parametrize("frm,to,role", ILLEGAL)
def test_illegal_transitions(frm, to, role):
    legal, reason = is_legal(frm, to, role)
    assert not legal, f"{frm} -> {to} by {role} should be illegal"
    assert reason, "an illegal transition must explain itself"


def test_no_op_is_not_a_transition():
    legal, reason = is_legal(JobState.QUEUED, JobState.QUEUED, Role.PRODUCT_OWNER)
    assert not legal and "no-op" in reason


@pytest.mark.parametrize("state", sorted(TERMINAL_STATES, key=str))
def test_terminal_states_have_no_outgoing_edges(state):
    """A terminal job opens a new job; only the documented recheck edge remains."""
    for target in JobState:
        if (state, target) in POST_TERMINAL_VERIFICATION:
            continue
        legal, _ = is_legal(state, target, Role.PRODUCT_OWNER)
        assert not legal, f"terminal {state} must not transition to {target}"


def test_blocked_recovery_lands_on_a_recorded_stage():
    legal, _ = is_legal(JobState.BLOCKED, JobState.VALIDATING, Role.VALIDATOR)
    assert legal
    legal, _ = is_legal(JobState.BLOCKED, JobState.CALIBRATING, Role.SECURITY_LICENSE_REVIEWER)
    assert legal


def test_registered_recheck_is_the_only_registered_edge():
    assert (JobState.REGISTERED, JobState.RECHECK) in POST_TERMINAL_VERIFICATION
    legal, _ = is_legal(JobState.REGISTERED, JobState.RECHECK, Role.RELEASE_APPROVER)
    assert legal


def test_flagged_transitions_require_cosignature():
    """Doc 07 rows 5 and 10 name an extra reviewer alongside the primary role."""
    assert Role.SECURITY_LICENSE_REVIEWER in required_roles(
        JobState.AWAITING_SELECTION, JobState.PLAN_APPROVED
    )
    assert Role.SECURITY_LICENSE_REVIEWER in required_roles(
        JobState.CALIBRATING, JobState.STAGING_ARTIFACT
    )


def test_vocabulary_has_no_legacy_names():
    """CF-7: the canonical enum contains exactly six names."""
    assert {r.value for r in Role} == {
        "PRODUCT_OWNER",
        "DISCOVERY_AGENT",
        "BUILDER_AGENT",
        "VALIDATOR",
        "SECURITY_LICENSE_REVIEWER",
        "RELEASE_APPROVER",
    }
