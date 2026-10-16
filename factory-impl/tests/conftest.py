"""Shared fixtures.

Every fixture is synthetic. The factory's own doctrine (doc 18) is that
synthetic PASS records prove the policy engine, not a build. These fixtures are
labelled accordingly so no reader mistakes them for real acceptance.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from factory.engine import Factory
from factory.store import Warehouse

EXAMPLES = Path(__file__).resolve().parents[2] / "factory-v1.2" / "examples"

FIXED_NOW = datetime(2026, 10, 16, 1, tzinfo=timezone.utc)


def load_example(name: str) -> dict:
    return json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))


@pytest.fixture()
def repo_examples() -> Path:
    """The approved v1.2 example set, used as realistic CLI input."""
    return EXAMPLES


@pytest.fixture()
def factory_root() -> Path:
    root = Path(tempfile.mkdtemp(prefix="factory-test-"))
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture()
def factory(factory_root: Path) -> Factory:
    return Factory(Warehouse.open(factory_root / "factory"))


@pytest.fixture()
def payload(factory_root: Path) -> Path:
    """A small but real payload directory."""
    root = factory_root / "payload"
    (root / "src").mkdir(parents=True)
    (root / "README.md").write_text("# candidate resource\n", encoding="utf-8")
    (root / "src" / "index.ts").write_text("export const version = 1;\n", encoding="utf-8")
    return root


@pytest.fixture(scope="session")
def synthetic_clock() -> datetime:
    return FIXED_NOW


def new_job(factory, job_id: str = "job-1", risk_class: str = "SANDBOX_CODE") -> dict:
    """Create a job directly, asserting the creation was accepted."""
    outcome = factory.create_job(
        job_id=job_id,
        target_id="business.crm",
        catalog_revision="catalog-v0.1-sample",
        risk_class=risk_class,
        owner="po",
        owner_role="PRODUCT_OWNER",
    )
    assert outcome.ok, outcome.reasons
    return outcome.data["job"]


# The legal pipeline to STAGING_ARTIFACT. Rows 5 and 10 carry a "+" co-signer
# (SECURITY_LICENSE_REVIEWER), so those steps must supply one.
STEPS_TO_STAGING = [
    ("DISCOVERING", "PRODUCT_OWNER", ()),
    ("EVALUATING", "DISCOVERY_AGENT", ()),
    ("AWAITING_SELECTION", "DISCOVERY_AGENT", ()),
    ("PLAN_APPROVED", "PRODUCT_OWNER", ("SECURITY_LICENSE_REVIEWER:sec-reviewer",)),
    ("TRANSFORMING", "BUILDER_AGENT", ()),
    ("CALIBRATING", "BUILDER_AGENT", ()),
    ("STAGING_ARTIFACT", "BUILDER_AGENT", ("SECURITY_LICENSE_REVIEWER:sec-reviewer",)),
]


def drive_to_staging(factory, job_id: str = "job-1") -> dict:
    """Walk a job to STAGING_ARTIFACT, returning its record. Asserts each hop."""
    for state, role, cosigners in STEPS_TO_STAGING:
        outcome = factory.transition(
            job_id=job_id, to_state=state, role=role, actor=role.lower(),
            reason="step", cosigners=cosigners,
        )
        assert outcome.ok, (state, outcome.reasons)
    return factory.wh.workspace.get_job(job_id)


def freeze_for_job(factory, payload, job_id: str = "job-1", attempt_id: str = "job-1-a1",
                   version: str = "1.0.0"):
    """Freeze a payload and bind it to ``job_id``/``attempt_id`` (R-G)."""
    outcome = factory.freeze(
        resource_id="business.crm",
        resource_version=version,
        manifest=load_example("resource_manifest"),
        payload_root=payload,
        frozen_by="synthetic-builder",
        job_id=job_id,
        attempt_id=attempt_id,
    )
    assert outcome.ok, outcome.reasons
    return outcome.data["freeze"]


def build_evidence_chain(profile: dict, attestation: dict, digest: str,
                         payload_manifest: str) -> list[dict]:
    """A consistent, *synthetic* gate evidence chain for the L1 gate set.

    Deliberately labelled SYNTHETIC so a passing test is never read as a real
    verification. Uses the evidence-side role vocabulary (SC-02).
    """
    ts = lambda d: (FIXED_NOW + d).isoformat()  # noqa: E731
    out = []
    for gate in profile["levels"]["L1"]:
        role = (
            "LICENSE_REVIEWER" if gate == "G-LICENSE"
            else "SECURITY_REVIEWER" if gate == "G-SECURITY"
            else "INDEPENDENT_VALIDATOR"
        )
        kind = (
            "LICENSE" if gate == "G-LICENSE"
            else "SECURITY" if gate == "G-SECURITY"
            else "E2E"
        )
        out.append(
            {
                "schemaVersion": "1.2",
                "id": f"synthetic-{gate}",
                "subjectId": attestation["resourceId"],
                "gateId": gate,
                "result": "PASS",
                "kind": kind,
                "sourceCommit": "synthetic-revision",
                "artifactSha256": digest,
                "payloadManifestSha256": payload_manifest,
                "scopeId": attestation["scopeId"],
                "profileId": attestation["profileId"],
                "profileVersion": attestation["profileVersion"],
                "environment": {"type": "SANDBOX", "description": "SYNTHETIC DATA NOT REAL TEST"},
                "validatorVersion": "synthetic",
                "method": "SYNTHETIC NOT EXECUTED",
                "outputUri": "synthetic://fixture",
                "outputSha256": "b" * 64,
                "collectedAt": ts(timedelta(hours=-1)),
                "expiresAt": ts(timedelta(days=1)),
                "actor": f"synthetic-validator-{gate}",
                "validationRole": role,
                "scope": "synthetic only",
                "limitations": ["NOT REAL EXECUTION"],
            }
        )
    return out


@pytest.fixture()
def frozen(factory: Factory, payload: Path):
    """A frozen manifest + freeze record, plus the two digests."""
    manifest = load_example("resource_manifest")
    outcome = factory.freeze(
        resource_id="business.crm",
        resource_version="1.0.0",
        manifest=manifest,
        payload_root=payload,
        frozen_by="synthetic-builder",
    )
    assert outcome.ok, outcome.reasons
    freeze = outcome.data["freeze"]
    return {
        "manifest": manifest,
        "freeze": freeze,
        "digest": freeze["artifactSha256"],
        "payloadManifest": freeze["payloadManifestSha256"],
    }


def attestation_for(freeze: dict) -> dict:
    """A ready-to-attest synthetic attestation + profile + evidence chain for ``freeze``.

    ``resourceVersion`` is pinned to the frozen version (the shipped example
    carries a ``-demo`` suffix) so the identity checks exercise the chain rather
    than tripping over fixture drift. ``deploymentEligibilityRef`` is dropped:
    a resource with no eligibility decision registers at a restrictive policy,
    which is the honest default for a synthetic fixture.
    """
    digest, manifest_digest = freeze["artifactSha256"], freeze["payloadManifestSha256"]
    profile = load_example("gate_profile")
    att = load_example("scoped_attestation")
    att.update(
        {
            "attestationId": "synthetic-attestation",
            "resourceVersion": freeze["resourceVersion"],
            "artifactSha256": digest,
            "payloadManifestSha256": manifest_digest,
            "attestationStatus": "ACTIVE",
            "attestedLevel": "L1",
            "reviewerId": "synthetic-release-reviewer",
            "reviewDecisionId": "synthetic-review-not-real",
            "issuedAt": (FIXED_NOW - timedelta(days=1)).isoformat(),
            "expiresAt": (FIXED_NOW + timedelta(days=1)).isoformat(),
            "gateEvidenceIds": {},
        }
    )
    evidences = build_evidence_chain(profile, att, digest, manifest_digest)
    att["gateEvidenceIds"] = {e["gateId"]: e["id"] for e in evidences}
    state = load_example("resource_state")
    state.update(
        {
            "schemaVersion": "1.2",
            "resourceId": att["resourceId"],
            "resourceVersion": att["resourceVersion"],
            "artifactSha256": digest,
            "qualityLevel": "L1",
            "verificationStatus": "VERIFIED",
            "publicationStatus": "PRIVATE",
            "attestationRefs": [att["attestationId"]],
            "evidenceIds": [e["id"] for e in evidences],
            "defaultScopeId": att["scopeId"],
        }
    )
    state.pop("deploymentEligibilityRef", None)
    return {"profile": profile, "attestation": att, "evidences": evidences, "state": state}


@pytest.fixture()
def attestation_context(frozen):
    """``attestation_for`` the standalone ``frozen`` payload."""
    return attestation_for(frozen["freeze"])


def drive_to_publishing(factory, payload, job_id: str = "job-1", version: str = "1.0.0") -> dict:
    """Walk a new job through freeze, an evaluated attestation and release
    approval to PUBLISHING. Every hop is asserted; the result is SYNTHETIC."""
    new_job(factory, job_id=job_id)
    drive_to_staging(factory, job_id=job_id)
    freeze = freeze_for_job(
        factory, payload, job_id=job_id, attempt_id=f"{job_id}-a1", version=version
    )
    step = lambda to, role: factory.transition(  # noqa: E731
        job_id=job_id, to_state=to, role=role, actor=role.lower(), reason="step"
    )
    assert step("VALIDATING", "BUILDER_AGENT").ok
    ctx = attestation_for(freeze)
    evaluated = factory.attest(
        attestation=ctx["attestation"], profile=ctx["profile"], evidences=ctx["evidences"],
        freeze=freeze, state=ctx["state"], now=FIXED_NOW, job_id=job_id,
    )
    assert evaluated.ok, evaluated.reasons
    for to, role in (("AWAITING_RELEASE_APPROVAL", "VALIDATOR"), ("PUBLISHING", "RELEASE_APPROVER")):
        moved = step(to, role)
        assert moved.ok, (to, moved.reasons)
    return {**ctx, "freeze": freeze, "jobId": job_id}


@pytest.fixture()
def publishing(factory, payload) -> dict:
    """A job in PUBLISHING with its frozen payload and evaluated attestation."""
    return drive_to_publishing(factory, payload)
