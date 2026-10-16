"""Publication lifecycle and usePolicy single-source-of-truth (CF-4, doc 10)."""

from __future__ import annotations

import copy

from conftest import load_example


def _registered(factory, ctx, **state_overrides):
    """Register the PUBLISHING job's payload (doc 07 row 16)."""
    state = {**ctx["state"], **state_overrides}
    outcome = factory.register(
        state=state, freeze=ctx["freeze"], decision=None,
        actor="ra", role="RELEASE_APPROVER", job_id=ctx["jobId"],
    )
    assert outcome.ok, outcome.reasons
    return state


def test_quarantine_disables_installs(factory, publishing):
    state = _registered(factory, publishing)
    assert factory.installable(state).ok

    outcome = factory.retire(
        resource_id=state["resourceId"], resource_version=state["resourceVersion"],
        to_status="QUARANTINED", actor="sec", role="SECURITY_LICENSE_REVIEWER",
        reason="upstream vulnerability disclosed",
    )
    assert outcome.ok, outcome.reasons

    current = factory.wh.registry.get(
        state["resourceId"], state["resourceVersion"], "resource-state"
    )
    assert current["publicationStatus"] == "QUARANTINED"
    assert factory.installable(current).blocked


def test_withdrawn_is_terminal(factory, publishing):
    state = _registered(factory, publishing)
    for target, role in [("DEPRECATED", "RELEASE_APPROVER"), ("WITHDRAWN", "RELEASE_APPROVER")]:
        outcome = factory.retire(
            resource_id=state["resourceId"], resource_version=state["resourceVersion"],
            to_status=target, actor="po", role=role, reason="retire",
        )
        assert outcome.ok, (target, outcome.reasons)

    outcome = factory.retire(
        resource_id=state["resourceId"], resource_version=state["resourceVersion"],
        to_status="LISTED", actor="po", role="RELEASE_APPROVER", reason="resurrect",
    )
    assert outcome.blocked


def test_illegal_publication_jump_refused(factory, publishing):
    """A quarantine cannot be hidden by going back to PRIVATE."""
    state = _registered(factory, publishing)
    factory.retire(resource_id=state["resourceId"], resource_version=state["resourceVersion"],
                   to_status="QUARANTINED", actor="sec",
                   role="SECURITY_LICENSE_REVIEWER", reason="vuln")
    outcome = factory.retire(
        resource_id=state["resourceId"], resource_version=state["resourceVersion"],
        to_status="PRIVATE", actor="po", role="RELEASE_APPROVER", reason="hide it",
    )
    assert outcome.blocked
    assert any("illegal publication transition" in r for r in outcome.reasons)


def test_builder_cannot_retire(factory, publishing):
    state = _registered(factory, publishing)
    outcome = factory.retire(
        resource_id=state["resourceId"], resource_version=state["resourceVersion"],
        to_status="QUARANTINED", actor="b", role="BUILDER_AGENT", reason="nope",
    )
    assert outcome.blocked


def test_retirement_does_not_touch_the_freeze_digest(factory, publishing):
    state = _registered(factory, publishing)
    before = factory.wh.registry.digest_recorded(state["resourceId"], state["resourceVersion"])
    factory.retire(resource_id=state["resourceId"], resource_version=state["resourceVersion"],
                   to_status="QUARANTINED", actor="sec",
                   role="SECURITY_LICENSE_REVIEWER", reason="vuln")
    after = factory.wh.registry.digest_recorded(state["resourceId"], state["resourceVersion"])
    assert before == after == publishing["freeze"]["artifactSha256"]


def test_listing_requires_release_ready_and_a_decision(factory, publishing):
    """LISTED is not a cosmetic flag: it demands evidence of readiness."""
    state = _registered(factory, publishing)  # VERIFIED, PRIVATE
    outcome = factory.retire(
        resource_id=state["resourceId"], resource_version=state["resourceVersion"],
        to_status="LISTED", actor="po", role="RELEASE_APPROVER", reason="publish",
    )
    assert outcome.blocked


def test_use_policy_cannot_live_on_the_state(factory, publishing):
    """CF-4: usePolicy has exactly one home, and it is not resource-state."""
    state = {**publishing["state"], "usePolicy": "SANDBOX_ONLY"}
    outcome = factory.register(
        state=state, freeze=publishing["freeze"], decision=None,
        actor="ra", role="RELEASE_APPROVER", job_id=publishing["jobId"],
    )
    assert outcome.blocked
    assert any("must not be stored" in r for r in outcome.reasons)


def test_production_eligible_requires_approval_and_approver(factory, publishing):
    state = copy.deepcopy(publishing["state"])
    base = {
        "schemaVersion": "1.2",
        "decisionId": "d1",
        "resourceId": state["resourceId"],
        "resourceVersion": state["resourceVersion"],
        "artifactSha256": publishing["freeze"]["artifactSha256"],
        "scopeId": state["defaultScopeId"],
        "usePolicy": "PRODUCTION_ELIGIBLE",
        "approvalId": "",
        "decidedBy": "po",
        "decidedByRole": "RELEASE_APPROVER",
        "decidedAt": "2026-10-16T00:00:00+00:00",
        "rationale": "synthetic",
    }

    no_approval = factory.register(
        state={**state, "deploymentEligibilityRef": "d1"},
        freeze=publishing["freeze"], decision=base,
        actor="ra", role="RELEASE_APPROVER", job_id=publishing["jobId"],
    )
    assert no_approval.blocked
    assert any("approvalId" in r for r in no_approval.reasons)

    wrong_role = factory.register(
        state={**state, "deploymentEligibilityRef": "d1"},
        freeze=publishing["freeze"],
        decision={**base, "approvalId": "ap-1", "decidedByRole": "VALIDATOR"},
        actor="ra", role="RELEASE_APPROVER", job_id=publishing["jobId"],
    )
    assert wrong_role.blocked
    assert any("RELEASE_APPROVER decision" in r for r in wrong_role.reasons)
