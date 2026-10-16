"""The pipeline: catalog -> batch -> job -> freeze -> attest -> register.

The point of these tests is not that things succeed — it is that the *ordering*
cannot be violated. Freeze precedes validation; nothing publishes without a
freeze, a matching digest and a RELEASE_APPROVER.
"""

from __future__ import annotations

import copy

import pytest

from conftest import FIXED_NOW, drive_to_staging, load_example, new_job


# --- SPECIFY / batch ----------------------------------------------------------


def test_catalog_validates(factory):
    assert factory.validate_catalog(load_example("production_catalog")).ok


def test_duplicate_target_id_blocked(factory):
    catalog = load_example("production_catalog")
    diluted = copy.deepcopy(catalog)
    diluted["targets"].append(copy.deepcopy(diluted["targets"][0]))
    outcome = factory.validate_catalog(diluted)
    assert outcome.blocked
    assert any("duplicate target id" in r for r in outcome.reasons)


def test_unknown_internal_dependency_blocked(factory):
    catalog = copy.deepcopy(load_example("production_catalog"))
    catalog["targets"][0].setdefault("dependencies", []).append("does.not.exist")
    outcome = factory.validate_catalog(catalog)
    assert outcome.blocked
    assert any("unknown target" in r for r in outcome.reasons)


def test_batch_validates(factory):
    outcome = factory.validate_batch(load_example("batch_plan"), load_example("production_catalog"))
    assert outcome.ok, outcome.reasons


def test_production_sensitive_in_generic_batch_blocked(factory):
    batch = copy.deepcopy(load_example("batch_plan"))
    batch.update({"riskClass": "PRODUCTION_SENSITIVE", "dedicatedRiskExecution": False})
    outcome = factory.validate_batch(batch, load_example("production_catalog"))
    assert outcome.blocked
    assert any("PRODUCTION_SENSITIVE" in r for r in outcome.reasons)


def test_production_sensitive_allowed_when_dedicated(factory):
    batch = copy.deepcopy(load_example("batch_plan"))
    batch.update(
        {
            "riskClass": "PRODUCTION_SENSITIVE",
            "dedicatedRiskExecution": True,
            "approvalStrategy": {"mode": "DUAL_CONTROL"},
            "auditScope": {"level": "FULL_ARTIFACTS", "retentionDays": 365},
        }
    )
    outcome = factory.validate_batch(batch, load_example("production_catalog"))
    assert outcome.ok, outcome.reasons


def test_unresolved_external_dependency_blocks_code_production(factory):
    batch = copy.deepcopy(load_example("batch_plan"))
    batch["executionMode"] = "SANDBOX_BUILD"
    outcome = factory.validate_batch(batch, load_example("production_catalog"))
    assert outcome.blocked
    assert any("external dependency" in r for r in outcome.reasons)


def test_unresolved_external_dependency_allows_read_only(factory):
    """CF-9(a): reading is fine; producing code is not."""
    batch = load_example("batch_plan")
    assert batch["executionMode"] == "READ_ONLY"
    assert factory.validate_batch(batch, load_example("production_catalog")).ok


# --- jobs ---------------------------------------------------------------------


def _new_job(factory, job_id="job-1", risk_class="SANDBOX_CODE"):
    outcome = factory.create_job(
        job_id=job_id,
        target_id="business.crm",
        catalog_revision="catalog-v0.1-sample",
        risk_class=risk_class,
        owner="po",
        owner_role="PRODUCT_OWNER",
    )
    assert outcome.ok, outcome.reasons
    return outcome


def test_job_created_in_queued(factory):
    assert _new_job(factory).data["job"]["state"] == "QUEUED"


def test_duplicate_job_id_refused(factory):
    _new_job(factory)
    assert factory.create_job(
        job_id="job-1",
        target_id="business.crm",
        catalog_revision="catalog-v0.1-sample",
        risk_class="READ_ONLY",
        owner="po",
        owner_role="PRODUCT_OWNER",
    ).blocked


def test_transition_wrong_role_blocked(factory):
    _new_job(factory)
    outcome = factory.transition(
        job_id="job-1", to_state="DISCOVERING", role="BUILDER_AGENT",
        actor="b", reason="nope",
    )
    assert outcome.blocked


def test_transition_is_idempotent(factory):
    _new_job(factory)
    factory.transition(job_id="job-1", to_state="DISCOVERING", role="PRODUCT_OWNER",
                       actor="po", reason="go", idempotency_key="K1")
    replay = factory.transition(job_id="job-1", to_state="DISCOVERING", role="PRODUCT_OWNER",
                                actor="po", reason="go", idempotency_key="K1")
    assert replay.ok and replay.data["idempotent_replay"] is True


# The legal pipeline up to STAGING_ARTIFACT. Rows 5 and 10 carry a "+" co-signer
# (SECURITY_LICENSE_REVIEWER), so they must be supplied.
_PIPELINE_TO_STAGING = [
    ("DISCOVERING", "PRODUCT_OWNER", ()),
    ("EVALUATING", "DISCOVERY_AGENT", ()),
    ("AWAITING_SELECTION", "DISCOVERY_AGENT", ()),
    ("PLAN_APPROVED", "PRODUCT_OWNER", ("SECURITY_LICENSE_REVIEWER:sec-reviewer",)),
    ("TRANSFORMING", "BUILDER_AGENT", ()),
    ("CALIBRATING", "BUILDER_AGENT", ()),
    ("STAGING_ARTIFACT", "BUILDER_AGENT", ("SECURITY_LICENSE_REVIEWER:sec-reviewer",)),
]


def _advance_to_staging(factory, job_id="job-1"):
    for state, role, cosigners in _PIPELINE_TO_STAGING:
        outcome = factory.transition(
            job_id=job_id, to_state=state, role=role, actor=role.lower(),
            reason="step", cosigners=cosigners,
        )
        assert outcome.ok, (state, outcome.reasons)
    return factory.wh.workspace.get_job(job_id)


def test_validating_without_freeze_blocked(factory):
    """Gate 11: a payload must be frozen before it can be validated."""
    _new_job(factory)
    _advance_to_staging(factory)
    outcome = factory.transition(job_id="job-1", to_state="VALIDATING",
                                 role="BUILDER_AGENT", actor="b", reason="premature")
    assert outcome.blocked
    assert any("frozen" in r for r in outcome.reasons)


# --- freeze -------------------------------------------------------------------


def test_freeze_produces_a_digest(factory, payload):
    outcome = factory.freeze(
        resource_id="business.crm", resource_version="1.0.0",
        manifest=load_example("resource_manifest"), payload_root=payload,
        frozen_by="b",
    )
    assert outcome.ok, outcome.reasons
    freeze = outcome.data["freeze"]
    assert len(freeze["artifactSha256"]) == 64
    assert freeze["immutable"] is True
    assert outcome.data["fileCount"] == 2


@pytest.mark.parametrize(
    "key",
    ["qualityLevel", "verificationStatus", "usePolicy", "publicationStatus",
     "evidenceIds", "attestationRefs", "artifactSha256", "defaultScopeId"],
)
def test_freeze_refuses_impure_payload(factory, payload, key):
    """CF-5: the freeze/envelope split depends on this refusal."""
    impure = {**load_example("resource_manifest"), key: "x"}
    outcome = factory.freeze(
        resource_id="r", resource_version="1", manifest=impure,
        payload_root=payload, frozen_by="b",
    )
    assert outcome.blocked
    assert any(key in r for r in outcome.reasons)


def test_freeze_refuses_empty_payload(factory, factory_root):
    empty = factory_root / "empty"
    empty.mkdir()
    outcome = factory.freeze(
        resource_id="r", resource_version="1",
        manifest=load_example("resource_manifest"), payload_root=empty, frozen_by="b",
    )
    assert outcome.blocked


def test_refreeze_same_version_is_a_conflict(factory, payload):
    """Published payloads are immutable; a change must become a new version."""
    args = dict(resource_id="r", resource_version="1",
                manifest=load_example("resource_manifest"),
                payload_root=payload, frozen_by="b")
    assert factory.freeze(**args).ok
    assert factory.freeze(**args).blocked


def test_freeze_digest_is_deterministic(factory, factory_root):
    """The same bytes must always produce the same digest."""
    manifest = load_example("resource_manifest")
    digests = []
    for version in ("1", "2"):
        root = factory_root / f"p{version}"
        (root / "sub").mkdir(parents=True)
        (root / "a.txt").write_text("same", encoding="utf-8")
        (root / "sub" / "b.txt").write_text("content", encoding="utf-8")
        outcome = factory.freeze(resource_id="r", resource_version=version,
                                 manifest=manifest, payload_root=root, frozen_by="b")
        assert outcome.ok, outcome.reasons
        digests.append(outcome.data["artifactSha256"])
    assert digests[0] == digests[1]


def test_digest_changes_when_content_changes(factory, factory_root):
    manifest = load_example("resource_manifest")
    digests = []
    for version, text in (("1", "one"), ("2", "two")):
        root = factory_root / f"p{version}"
        root.mkdir()
        (root / "a.txt").write_text(text, encoding="utf-8")
        outcome = factory.freeze(resource_id="r", resource_version=version,
                                 manifest=manifest, payload_root=root, frozen_by="b")
        digests.append(outcome.data["artifactSha256"])
    assert digests[0] != digests[1]


# --- attest -------------------------------------------------------------------


def test_consistent_chain_reports_metadata_consistency(factory, frozen, attestation_context):
    ctx = attestation_context
    outcome = factory.attest(
        attestation=ctx["attestation"], profile=ctx["profile"],
        evidences=ctx["evidences"], freeze=frozen["freeze"], state=ctx["state"],
        now=FIXED_NOW,
    )
    assert outcome.ok, outcome.reasons
    assert outcome.data["metadataConsistency"] == "METADATA_CONSISTENT"
    # The result must never read as a certification.
    assert "not a" in outcome.note.lower()


def test_attest_requires_a_freeze(factory, frozen, attestation_context):
    ctx = attestation_context
    outcome = factory.attest(
        attestation=ctx["attestation"], profile=ctx["profile"],
        evidences=ctx["evidences"], freeze=None, state=ctx["state"], now=FIXED_NOW,
    )
    assert outcome.blocked
    assert any("frozen before validation" in r for r in outcome.reasons)


def test_attest_digest_mismatch_blocked(factory, frozen, attestation_context):
    ctx = attestation_context
    tampered = copy.deepcopy(ctx["evidences"])
    tampered[0]["artifactSha256"] = "c" * 64
    outcome = factory.attest(
        attestation=ctx["attestation"], profile=ctx["profile"],
        evidences=tampered, freeze=frozen["freeze"], state=ctx["state"], now=FIXED_NOW,
    )
    assert outcome.blocked
    assert any("digest mismatch" in r for r in outcome.reasons)


def test_attest_missing_gate_blocked(factory, frozen, attestation_context):
    ctx = attestation_context
    att = copy.deepcopy(ctx["attestation"])
    att["gateEvidenceIds"].pop("G-CORE")
    outcome = factory.attest(
        attestation=att, profile=ctx["profile"], evidences=ctx["evidences"],
        freeze=frozen["freeze"], state=ctx["state"], now=FIXED_NOW,
    )
    assert outcome.blocked
    assert any("missing required gate" in r for r in outcome.reasons)


def test_attest_builder_self_certification_blocked(factory, frozen, attestation_context):
    ctx = attestation_context
    evs = copy.deepcopy(ctx["evidences"])
    evs[0]["validationRole"] = "BUILDER"
    outcome = factory.attest(
        attestation=ctx["attestation"], profile=ctx["profile"], evidences=evs,
        freeze=frozen["freeze"], state=ctx["state"], now=FIXED_NOW,
    )
    assert outcome.blocked
    assert any("self-certification" in r for r in outcome.reasons)


def test_attest_license_gate_requires_license_reviewer(factory, frozen, attestation_context):
    """SC-02: evidence roles use the evidence vocabulary, not the governance one."""
    ctx = attestation_context
    evs = copy.deepcopy(ctx["evidences"])
    for ev in evs:
        if ev["gateId"] == "G-LICENSE":
            ev["validationRole"] = "INDEPENDENT_VALIDATOR"
    outcome = factory.attest(
        attestation=ctx["attestation"], profile=ctx["profile"], evidences=evs,
        freeze=frozen["freeze"], state=ctx["state"], now=FIXED_NOW,
    )
    assert outcome.blocked
    assert any("license gate wrong role" in r for r in outcome.reasons)


def test_not_run_never_becomes_pass(factory, frozen, attestation_context):
    ctx = attestation_context
    evs = copy.deepcopy(ctx["evidences"])
    evs[0]["result"] = "NOT_RUN"
    outcome = factory.attest(
        attestation=ctx["attestation"], profile=ctx["profile"], evidences=evs,
        freeze=frozen["freeze"], state=ctx["state"], now=FIXED_NOW,
    )
    assert outcome.blocked
    assert any("non-PASS" in r for r in outcome.reasons)


def test_expired_attestation_blocked(factory, frozen, attestation_context):
    ctx = attestation_context
    att = copy.deepcopy(ctx["attestation"])
    att["expiresAt"] = "2026-10-15T00:00:00+00:00"
    outcome = factory.attest(
        attestation=att, profile=ctx["profile"], evidences=ctx["evidences"],
        freeze=frozen["freeze"], state=ctx["state"], now=FIXED_NOW,
    )
    assert outcome.blocked
    assert any("expired" in r for r in outcome.reasons)


def test_draft_attestation_not_attested(factory, frozen, attestation_context):
    ctx = attestation_context
    att = copy.deepcopy(ctx["attestation"])
    att["attestationStatus"] = "DRAFT"
    outcome = factory.attest(
        attestation=att, profile=ctx["profile"], evidences=ctx["evidences"],
        freeze=frozen["freeze"], state=ctx["state"], now=FIXED_NOW,
    )
    assert outcome.blocked


# --- registry -----------------------------------------------------------------


def test_builder_cannot_register(factory, frozen, attestation_context):
    ctx = attestation_context
    outcome = factory.register(
        state=ctx["state"], freeze=frozen["freeze"], decision=None,
        actor="b", role="BUILDER_AGENT",
    )
    assert outcome.blocked
    assert any("RELEASE_APPROVER" in r for r in outcome.reasons)


def test_release_approver_registers(factory, publishing):
    ctx = publishing
    outcome = factory.register(
        state=ctx["state"], freeze=ctx["freeze"], decision=None,
        actor="ra", role="RELEASE_APPROVER", job_id=ctx["jobId"],
    )
    assert outcome.ok, outcome.reasons
    done = factory.transition(job_id=ctx["jobId"], to_state="REGISTERED",
                              role="RELEASE_APPROVER", actor="ra", reason="published")
    assert done.ok, done.reasons


def test_register_blocks_on_digest_conflict(factory, publishing, factory_root):
    """Same id@version with different bytes is a conflict, never an overwrite.

    The conflict is caught when the second payload is frozen (the registry's
    ArtifactFreeze is immutable), and a forged freeze carrying another digest is
    refused at registration.
    """
    ctx = publishing
    assert factory.register(state=ctx["state"], freeze=ctx["freeze"], decision=None,
                            actor="ra", role="RELEASE_APPROVER", job_id=ctx["jobId"]).ok

    other = factory_root / "other-payload"
    other.mkdir()
    (other / "a.txt").write_text("different bytes", encoding="utf-8")
    new_job(factory, job_id="job-2")
    drive_to_staging(factory, job_id="job-2")
    refrozen = factory.freeze(
        resource_id=ctx["freeze"]["resourceId"],
        resource_version=ctx["freeze"]["resourceVersion"],
        manifest=load_example("resource_manifest"), payload_root=other,
        frozen_by="b", job_id="job-2",
    )
    assert refrozen.blocked
    assert any("immutable" in r for r in refrozen.reasons), refrozen.reasons

    forged = copy.deepcopy(ctx["freeze"])
    forged["artifactSha256"] = "d" * 64
    state = {**ctx["state"], "artifactSha256": "d" * 64}
    outcome = factory.register(state=state, freeze=forged, decision=None,
                               actor="ra", role="RELEASE_APPROVER", job_id=ctx["jobId"])
    assert outcome.blocked
    assert any("not the payload frozen" in r for r in outcome.reasons), outcome.reasons
