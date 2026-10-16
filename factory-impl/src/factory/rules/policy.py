"""Cross-object policy rules.

A single JSON Schema cannot express invariants that span objects — "this
evidence's digest must equal that freeze's digest", "this manifest must not
embed certification data", "only a RELEASE_APPROVER may publish". Those live
here.

Ported from ``factory-v1.2/scripts/factory_rules.py`` (the approved v1.2
reference engine) and extended with the normative state machine. Semantics are
preserved: a function returns a list of reasons, and an empty list means "no
metadata violation detected".

Honesty note: passing every rule here is NOT a commercial certification, a
license decision, a security result, or a signature verification. It means the
supplied metadata is internally consistent. Nothing more.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional, Sequence

from ..domain.enums import (
    BLOCKING_RESULTS,
    EvidenceResult,
    EvidenceValidationRole,
    JobState,
    RiskClass,
    Role,
)
from ..domain.state_machine import is_legal, required_roles

# CF-5: a payload object must not embed certification/registry data, nor its own
# digest. The freeze/envelope split depends on this list being complete.
FORBIDDEN_PAYLOAD_KEYS: tuple[str, ...] = (
    "qualityLevel",
    "verificationStatus",
    "usePolicy",
    "publicationStatus",
    "evidenceIds",
    "attestationRefs",
    "artifactSha256",
    "deploymentEligibilityRef",
    "defaultScopeId",
)

# Roles that may never act as the independent reviewer on a gate record.
NON_INDEPENDENT_ROLES = (Role.BUILDER_AGENT,)


_Reason = str


# --- CF-5: payload purity and the digest chain --------------------------------


def verify_payload_purity(manifest: dict[str, Any]) -> list[_Reason]:
    """No payload object may embed certification refs or its own digest."""
    reasons = []
    for key in FORBIDDEN_PAYLOAD_KEYS:
        if key in manifest:
            reasons.append(f"payload embeds forbidden certification field: {key}")
    return reasons


def verify_digest_chain(
    freeze: Optional[dict[str, Any]],
    state: Optional[dict[str, Any]],
    attestation: Optional[dict[str, Any]] = None,
    evidences: Sequence[dict[str, Any]] = (),
) -> list[_Reason]:
    """The frozen digest must be the same digest everywhere it is asserted.

    Invariant (ADR D1):
        evidence.artifactSha256 == freeze.artifactSha256
                                 == state.artifactSha256
                                 == attestation.artifactSha256
    and likewise for ``payloadManifestSha256``.

    ``UNBUILT`` is a declared placeholder, not a digest, and is skipped — but a
    record that is UNBUILT can never satisfy a mandatory gate elsewhere.
    """
    reasons: list[_Reason] = []
    if not freeze or not state:
        return ["digest chain requires both freeze and state records"]

    base = freeze.get("artifactSha256")
    artefacts: dict[str, dict[str, Any]] = {"freeze": freeze, "state": state}
    if attestation is not None:
        artefacts["attestation"] = attestation

    for name, obj in artefacts.items():
        value = obj.get("artifactSha256")
        if value == "UNBUILT":
            continue
        if value != base:
            reasons.append(f"{name} artifact digest mismatch")
        if (
            obj.get("resourceId") != freeze.get("resourceId")
            or obj.get("resourceVersion") != freeze.get("resourceVersion")
        ):
            reasons.append(f"{name} identity mismatch")

    freeze_pm = freeze.get("payloadManifestSha256")
    if attestation is not None:
        att_pm = attestation.get("payloadManifestSha256")
        if freeze_pm and att_pm and freeze_pm != att_pm:
            reasons.append("payload manifest digest mismatch (freeze vs attestation)")

    for e in evidences:
        if e.get("artifactSha256") in (None, "UNBUILT"):
            continue
        if e["artifactSha256"] != base:
            reasons.append(f"evidence artifact digest mismatch: {e.get('id')}")
        e_pm = e.get("payloadManifestSha256")
        if freeze_pm and e_pm and e_pm != freeze_pm:
            reasons.append(f"evidence payload manifest mismatch: {e.get('id')}")

    return reasons


# --- CF-4: usePolicy has exactly one source of truth --------------------------


def check_use_policy(
    decision: Optional[dict[str, Any]],
    state: dict[str, Any],
) -> list[_Reason]:
    """`usePolicy` lives only in the DeploymentEligibilityDecision.

    It must never be stored on state, and must never be derived from
    qualityLevel. `PRODUCTION_ELIGIBLE` additionally requires a non-empty
    approvalId and a RELEASE_APPROVER decision over a built (L1+) artifact.
    """
    reasons: list[_Reason] = []

    if "usePolicy" in state:
        reasons.append(
            "usePolicy must not be stored in resource-state "
            "(single source of truth is the decision)"
        )

    ref = state.get("deploymentEligibilityRef")
    if ref:
        if decision is None:
            reasons.append(
                "resource-state references a deployment eligibility decision "
                "that was not supplied"
            )
        else:
            if decision.get("decisionId") != ref:
                reasons.append("deployment eligibility decision id mismatch")
            if decision.get("artifactSha256") not in (None, state.get("artifactSha256")):
                reasons.append("deployment eligibility decision digest mismatch")
            if (
                decision.get("resourceId") != state.get("resourceId")
                or decision.get("resourceVersion") != state.get("resourceVersion")
            ):
                reasons.append("deployment eligibility decision identity mismatch")

    # A state that binds a decision must not be PRODUCTION_ELIGIBLE without the
    # approvals that only a real human decision can carry. A state with no
    # decision reference is registered at whatever restrictive policy applies
    # (typically SANDBOX_ONLY / RESEARCH_ONLY); that is a legitimate state, not
    # an error — the block belongs on the *eligibility claim*, not on existence.
    if decision is not None and decision.get("usePolicy") == "PRODUCTION_ELIGIBLE":
        if not decision.get("approvalId"):
            reasons.append("PRODUCTION_ELIGIBLE requires an approvalId")
        if decision.get("decidedByRole") != Role.RELEASE_APPROVER:
            reasons.append("PRODUCTION_ELIGIBLE requires a RELEASE_APPROVER decision")
        if state.get("qualityLevel") not in ("L1", "L2", "L3"):
            reasons.append(
                "PRODUCTION_ELIGIBLE requires a built (L1+) artifact digest"
            )

    return reasons


# --- CF-2 / doc 08: risk class decides whether a job may transform ------------


# A job whose risk class is READ_ONLY performs metadata reads, static analysis,
# hashing and license review only (doc 08). It never mutates a payload, so it may
# not enter the transformation half of the pipeline. R-R: this was previously
# unenforced, letting a READ_ONLY job reach TRANSFORMING and beyond.
READ_ONLY_FORBIDDEN_STATES: frozenset[JobState] = frozenset(
    {
        JobState.TRANSFORMING,
        JobState.CALIBRATING,
        JobState.STAGING_ARTIFACT,
        JobState.VALIDATING,
        JobState.AWAITING_RELEASE_APPROVAL,
        JobState.PUBLISHING,
        JobState.REGISTERED,
        JobState.RECHECK,
    }
)


def check_risk_class_transition(
    risk_class: Any,
    from_state: JobState,
    to_state: JobState,
) -> list[_Reason]:
    """A READ_ONLY job may never enter the transforming half of the pipeline.

    Doc 08: READ_ONLY = "拉取元数据、静态读取、哈希和许可分析"; it forbids any
    install/migration/user-project write. A job cannot therefore transform. This
    is a hard block, not a warning.
    """
    if risk_class == RiskClass.READ_ONLY and to_state in READ_ONLY_FORBIDDEN_STATES:
        return [
            f"READ_ONLY risk class may not enter {to_state}: read-only work does "
            "metadata reads, hashing and license review only, never transform "
            "(doc 08 / 11)"
        ]
    return []


# --- CF-2: batch risk classification ------------------------------------------


def check_batch_plan(batch: dict[str, Any]) -> list[_Reason]:
    """PRODUCTION_SENSITIVE work may not run in a generic batch."""
    reasons: list[_Reason] = []
    risk = batch.get("riskClass")

    if risk == "PRODUCTION_SENSITIVE":
        if batch.get("dedicatedRiskExecution") is not True:
            reasons.append(
                "PRODUCTION_SENSITIVE not permitted in a generic batch "
                "(dedicatedRiskExecution must be true)"
            )
        if (batch.get("approvalStrategy") or {}).get("mode") != "DUAL_CONTROL":
            reasons.append("PRODUCTION_SENSITIVE requires DUAL_CONTROL approval")
        if (batch.get("auditScope") or {}).get("level") != "FULL_ARTIFACTS":
            reasons.append("PRODUCTION_SENSITIVE requires FULL_ARTIFACTS audit scope")

    if risk in ("READ_ONLY", "SANDBOX_CODE", "EXTERNAL_SANDBOX_API") and (
        batch.get("dedicatedRiskExecution") is True
    ):
        reasons.append(
            "dedicatedRiskExecution must only be set for PRODUCTION_SENSITIVE"
        )

    return reasons


# --- CF-9(a): unresolved external dependency gating ---------------------------


def check_catalog_dependency_gating(
    catalog: dict[str, Any],
    batch: dict[str, Any],
) -> list[_Reason]:
    """An unresolved external dependency blocks code production, not discovery."""
    reasons: list[_Reason] = []
    if batch.get("executionMode") == "READ_ONLY":
        return reasons

    selected = set(batch.get("targetIds", []))
    for target in catalog.get("targets", []):
        if target.get("id") not in selected:
            continue
        for dep in target.get("externalDependencies", []):
            if dep.get("status") != "VERIFIED":
                reasons.append(
                    "unresolved external dependency blocks code production: "
                    f"{target.get('id')} -> {dep.get('id')} [{dep.get('status')}]"
                )
    return reasons


# --- CF-7: transitions, canonical roles, no builder self-approval -------------


def check_state_transition(transition: dict[str, Any]) -> list[_Reason]:
    """Validate one transition record against the normative table.

    This is the enforcement point for two structural invariants: the role enum
    is canonical, and the Builder never signs off its own release.
    """
    reasons: list[_Reason] = []

    raw_from, raw_to, raw_role = (
        transition.get("from"),
        transition.get("to"),
        transition.get("role"),
    )

    # Canonical vocabulary checks first, so an unknown value is reported as such
    # rather than as a mysterious "no transition".
    try:
        from_state = JobState(raw_from)
        to_state = JobState(raw_to)
    except ValueError as exc:
        return [f"non-canonical state value: {exc}"]

    try:
        role = Role(raw_role)
    except ValueError:
        return [f"non-canonical role: {raw_role!r}"]

    if from_state == to_state:
        return ["no-op transition"]

    legal, detail = is_legal(from_state, to_state, role)
    if not legal:
        reasons.append(detail)

    return reasons


def check_transition_cosigners(transition: dict[str, Any]) -> frozenset[Role]:
    """Roles that must additionally co-sign this transition (may be empty).

    Doc 07 lists these as "+" on rows such as `AWAITING_SELECTION ->
    PLAN_APPROVED` (needs SECURITY_LICENSE_REVIEWER alongside PRODUCT_OWNER).
    The engine records them; whether a co-signature is *present* is a human
    approval fact the engine cannot verify.
    """
    try:
        return required_roles(JobState(transition["from"]), JobState(transition["to"]))
    except (KeyError, ValueError):
        return frozenset()


# --- CF-9(b): installability --------------------------------------------------


def check_installable(state: dict[str, Any]) -> list[_Reason]:
    """WITHDRAWN / QUARANTINED resources must not be installed."""
    reasons: list[_Reason] = []
    status = state.get("publicationStatus")
    if status == "WITHDRAWN":
        reasons.append("WITHDRAWN forbids new installs")
    if status == "QUARANTINED":
        reasons.append("QUARANTINED forbids new installs")
    return reasons


# --- D9: origin strategy ------------------------------------------------------


def check_origin_strategy(manifest: dict[str, Any]) -> list[_Reason]:
    """Per-strategy origin requirements, including the never-auto-PASS rule.

    ``REUSE`` with a license that does not permit the intended distribution is
    BLOCKED outright — it never becomes a PASS by scoring well on anything else.
    ``INTEGRATE`` must keep the external system separate and must not claim to
    deliver third-party source. ``BUILD_FROM_SPEC`` must be first-party with no
    upstream reuse claim.
    """
    reasons: list[_Reason] = []
    os_ = manifest.get("originStrategy") or {}
    strategy = os_.get("strategy")

    if strategy == "REUSE":
        if os_.get("licenseDistributionPermitted") is False:
            reasons.append(
                "REUSE license does not permit the intended distribution: "
                "BLOCKED, never auto-PASS"
            )
        if not os_.get("lockedRevision"):
            reasons.append("REUSE requires a locked upstream revision")
    elif strategy == "INTEGRATE":
        if os_.get("externalSystemSeparate") is not True:
            reasons.append("INTEGRATE requires the external system to stay separate")
        if os_.get("deliversThirdPartySource") is not False:
            reasons.append(
                "INTEGRATE must not pose as delivering third-party source"
            )
    elif strategy == "BUILD_FROM_SPEC":
        if os_.get("firstParty") is not True:
            reasons.append("BUILD_FROM_SPEC requires first-party origin")
        if os_.get("upstreamUrl"):
            reasons.append("BUILD_FROM_SPEC must not make upstream reuse claims")
    else:
        reasons.append("missing or unknown originStrategy")

    return reasons


# --- Attestation gate evaluation ----------------------------------------------


def check_gate_evidence(
    evidence: dict[str, Any],
    *,
    attestation: dict[str, Any],
    gate: str,
    profile: dict[str, Any],
    expected_digest: Optional[str],
    now: Any,
) -> list[_Reason]:
    """Validate one gate's evidence record against the attestation.

    Every check here is a *metadata* check. A PASS record asserting a real test
    that never ran is indistinguishable from a real one at this layer; that is
    precisely why doc 18 requires Layer 3 (signed evidence) and Layer 4
    (independent human review) before any release.
    """
    from datetime import datetime

    reasons: list[_Reason] = []

    if evidence.get("gateId") != gate:
        reasons.append(f"wrong gate for evidence {evidence.get('id')}")

    result = evidence.get("result")
    if result != EvidenceResult.PASS:
        # FAIL / BLOCKED / NOT_RUN / UNKNOWN all block. Nothing here converts a
        # non-PASS into a PASS; the block is structural.
        reasons.append(f"non-PASS {gate} [{result}]")

    if expected_digest and evidence.get("artifactSha256") != expected_digest:
        reasons.append(f"artifact digest mismatch {gate}")

    if evidence.get("scopeId") != attestation.get("scopeId"):
        reasons.append(f"evidence scope mismatch {gate}")

    if (
        evidence.get("profileId") != attestation.get("profileId")
        or evidence.get("profileVersion") != attestation.get("profileVersion")
    ):
        reasons.append(f"evidence profile mismatch {gate}")

    if evidence.get("subjectId") != attestation.get("resourceId"):
        reasons.append(f"evidence resource mismatch {gate}")

    if evidence.get("validationRole") == EvidenceValidationRole.BUILDER:
        reasons.append(f"Builder self-certification {gate}")

    if profile.get("reviewPolicy", {}).get("independentValidatorRequired") and (
        evidence.get("actor") == attestation.get("reviewerId")
    ):
        reasons.append(f"reviewer not independent {gate}")

    expires = evidence.get("expiresAt")
    collected = evidence.get("collectedAt")

    def _parse(value: str) -> datetime:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    if not expires:
        reasons.append(f"expired evidence {gate}")
    else:
        try:
            if _parse(expires) <= now:
                reasons.append(f"expired evidence {gate}")
        except ValueError:
            reasons.append(f"unparseable evidence expiry {gate}")

    if collected:
        try:
            if _parse(collected) > now:
                reasons.append(f"future evidence {gate}")
        except ValueError:
            reasons.append(f"unparseable evidence timestamp {gate}")

    # NOTE: gate-to-role checks use the EVIDENCE validation vocabulary
    # (EvidenceValidationRole), not the governance Role enum — see SC-02.
    if gate == "G-LICENSE" and evidence.get("validationRole") != EvidenceValidationRole.LICENSE_REVIEWER:
        reasons.append("license gate wrong role")
    if gate == "G-SECURITY" and evidence.get("validationRole") != EvidenceValidationRole.SECURITY_REVIEWER:
        reasons.append("security gate wrong role")

    return reasons


def check_required_gates_present(
    attestation: dict[str, Any],
    profile: dict[str, Any],
    level: str,
) -> list[_Reason]:
    """Every gate required for ``level`` must have an evidence id bound."""
    levels = profile.get("levels", {})
    order = ["L1", "L2", "L3"]
    if level not in order:
        return [f"unknown attested level {level!r}"]

    upto = order.index(level) + 1
    required: list[str] = []
    for lvl in order[:upto]:
        for gate in levels.get(lvl, []):
            if gate not in required:
                required.append(gate)

    bound = attestation.get("gateEvidenceIds", {})
    return [f"missing required gate {gate}" for gate in required if gate not in bound]


def check_level_within_profile(
    attested_level: Optional[str],
    profile: dict[str, Any],
) -> list[_Reason]:
    """An attested level may not exceed the profile's maxAttestableLevel."""
    cap = profile.get("maxAttestableLevel")
    if not cap or not attested_level:
        return []
    order = ["L1", "L2", "L3"]
    if attested_level not in order or cap not in order:
        return []
    if order.index(attested_level) > order.index(cap):
        return [f"attested level {attested_level} exceeds profile max {cap}"]
    return []


def check_conditional_gates(
    attestation: dict[str, Any],
    profile: dict[str, Any],
    evidences: Sequence[dict[str, Any]],
) -> list[_Reason]:
    """A conditional gate that is activated but not PASS blocks.

    Doc 14: conditional gates (payments, AI, prototypes) activate by resource
    capability. If a trigger fires, the gate must have current PASS evidence —
    an activated-but-unevidenced conditional gate is a BLOCK, not a warning.
    """
    reasons: list[_Reason] = []
    triggers = set(attestation.get("activeConditionalTriggers", []) or [])
    if not triggers:
        return reasons

    bound = attestation.get("gateEvidenceIds", {})
    by_id = {e.get("id"): e for e in evidences}

    for cond in profile.get("conditional", []) or []:
        trigger = cond.get("trigger")
        if trigger not in triggers:
            continue
        gate = cond.get("gateId")
        ev_id = bound.get(gate)
        if ev_id is None:
            reasons.append(
                f"activated conditional gate {gate} (trigger {trigger}) has no evidence"
            )
            continue
        ev = by_id.get(ev_id)
        if ev is None:
            reasons.append(f"activated conditional gate {gate} references missing evidence")
        elif ev.get("result") != EvidenceResult.PASS:
            reasons.append(
                f"activated conditional gate {gate} is not PASS [{ev.get('result')}]"
            )
    return reasons


def check_no_unknown_upgrade(reasons: Iterable[str]) -> list[_Reason]:
    """Guard rail: assert no reason text silently upgrades an UNKNOWN.

    Kept as an explicit function so the invariant is greppable and testable. The
    engine never rewrites a result value; this exists to fail loudly if a future
    change ever tries to.
    """
    out = []
    for r in reasons:
        if "UNKNOWN" in r and "PASS" in r and "not" not in r.lower():
            out.append(f"suspicious UNKNOWN->PASS wording: {r}")
    return out
