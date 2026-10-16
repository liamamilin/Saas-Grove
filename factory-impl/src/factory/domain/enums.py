"""Canonical enumerations for the Template Factory.

Single source of truth for every closed vocabulary in the factory. These mirror
the v1.2 JSON Schemas exactly; where the schema and this module disagree, the
schema wins and this module is the bug.

Honesty note: none of these values encode a permission to release. A resource
carrying ``qualityLevel=L3`` is *not* thereby production-eligible.
"""

from __future__ import annotations

from enum import Enum


class StrEnum(str, Enum):
    """String-valued enum that compares equal to its raw value."""

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


# --- resourceType: WHAT a resource is. Never a quality level. -----------------

class ResourceType(StrEnum):
    SAAS_CORE_MODULE = "saas-core-module"
    BUSINESS_SAAS_TEMPLATE = "business-saas-template"
    AI_NATIVE_TEMPLATE = "ai-native-template"
    SAAS_AI_MODULE = "saas-ai-module"


# Legacy product-line codes from Foundation V1.0.1. Explicitly NOT resource
# types. CF-6: the factory rejects these wherever a resourceType is expected.
LEGACY_PRODUCT_LINES = ("L1", "L2", "L3", "L4")


# --- qualityLevel: maturity. Never a production admission. --------------------

class QualityLevel(StrEnum):
    L0 = "L0"
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"


# --- verificationStatus: what acceptance has actually been performed. ---------

class VerificationStatus(StrEnum):
    CATALOGED = "CATALOGED"
    VERIFIED = "VERIFIED"
    RELEASE_READY = "RELEASE_READY"


# --- usePolicy: where it may be used. Has exactly ONE source of truth: --------
# the DeploymentEligibilityDecision (CF-4). Must never be derived from
# qualityLevel.

class UsePolicy(StrEnum):
    RESEARCH_ONLY = "RESEARCH_ONLY"
    SANDBOX_ONLY = "SANDBOX_ONLY"
    INTERNAL_ONLY = "INTERNAL_ONLY"
    PRODUCTION_ELIGIBLE = "PRODUCTION_ELIGIBLE"


# --- publicationStatus: registry visibility / retirement. --------------------

class PublicationStatus(StrEnum):
    PRIVATE = "PRIVATE"
    LISTED = "LISTED"
    DEPRECATED = "DEPRECATED"
    QUARANTINED = "QUARANTINED"
    WITHDRAWN = "WITHDRAWN"


# --- implementationLevel: prototype presentation maturity. --------------------
# Orthogonal to qualityLevel and verificationStatus.

class ImplementationLevel(StrEnum):
    DESIGN_ONLY = "design-only"
    INTERACTIVE_MOCK = "interactive-mock"
    INTEGRATED = "integrated"


class Coverage(StrEnum):
    FULL_APP = "full-app"
    PAGE = "page"
    FLOW = "flow"


# --- originStrategy: D9. ------------------------------------------------------

class OriginStrategy(StrEnum):
    REUSE = "REUSE"
    INTEGRATE = "INTEGRATE"
    BUILD_FROM_SPEC = "BUILD_FROM_SPEC"


# --- riskClass: CF-2. PRODUCTION_SENSITIVE may not run in a generic batch. ----

class RiskClass(StrEnum):
    READ_ONLY = "READ_ONLY"
    SANDBOX_CODE = "SANDBOX_CODE"
    EXTERNAL_SANDBOX_API = "EXTERNAL_SANDBOX_API"
    PRODUCTION_SENSITIVE = "PRODUCTION_SENSITIVE"


class ExecutionMode(StrEnum):
    READ_ONLY = "READ_ONLY"
    SANDBOX_BUILD = "SANDBOX_BUILD"
    SANDBOX_INTEGRATION = "SANDBOX_INTEGRATION"


# --- Canonical roles (CF-7). Six names, no aliases. ---------------------------

class Role(StrEnum):
    PRODUCT_OWNER = "PRODUCT_OWNER"
    DISCOVERY_AGENT = "DISCOVERY_AGENT"
    BUILDER_AGENT = "BUILDER_AGENT"
    VALIDATOR = "VALIDATOR"
    SECURITY_LICENSE_REVIEWER = "SECURITY_LICENSE_REVIEWER"
    RELEASE_APPROVER = "RELEASE_APPROVER"


# Legacy controller names. Rejected by the schema; mapped here only so a reader
# can migrate. Never accepted as a ``role`` value.
LEGACY_ROLE_ALIASES = {
    "Builder Controller": Role.BUILDER_AGENT,
    "Build Controller": Role.BUILDER_AGENT,
    "Registry Controller": Role.RELEASE_APPROVER,
    "Discovery/Reviewer": Role.DISCOVERY_AGENT,
}


# --- Evidence validation role: a SECOND, distinct vocabulary (finding SC-02) --
# CF-7 unified the *governance* roles (above). But the approved v1.2 schemas keep
# a separate enum for the role that validated a gate record, and the reference
# engine (`scripts/validate_attestation.py`) compares against its values:
#
#   evidence.schema.json / scoped-attestation.schema.json  -> EvidenceValidationRole
#   state-transition.schema.json / production-job.schema.json -> Role
#
# Both are normative. They are not interchangeable: writing
# `SECURITY_LICENSE_REVIEWER` into an evidence record is rejected by the schema.
# This module is the single adapter between them so no caller has to remember.

class EvidenceValidationRole(StrEnum):
    BUILDER = "BUILDER"
    INDEPENDENT_VALIDATOR = "INDEPENDENT_VALIDATOR"
    LICENSE_REVIEWER = "LICENSE_REVIEWER"
    SECURITY_REVIEWER = "SECURITY_REVIEWER"
    RELEASE_APPROVER = "RELEASE_APPROVER"


# Governance role -> the evidence validation role it is entitled to sign as.
ROLE_TO_EVIDENCE_ROLE: dict[Role, EvidenceValidationRole] = {
    Role.BUILDER_AGENT: EvidenceValidationRole.BUILDER,
    Role.VALIDATOR: EvidenceValidationRole.INDEPENDENT_VALIDATOR,
    Role.SECURITY_LICENSE_REVIEWER: EvidenceValidationRole.SECURITY_REVIEWER,
    Role.RELEASE_APPROVER: EvidenceValidationRole.RELEASE_APPROVER,
}


def evidence_role_for(role: Role, gate_id: str | None = None) -> EvidenceValidationRole:
    """The evidence validation role for a governance role on a given gate.

    ``SECURITY_LICENSE_REVIEWER`` signs G-LICENSE as LICENSE_REVIEWER and
    G-SECURITY as SECURITY_REVIEWER — the gate determines which. This is the
    one place that mapping lives.
    """
    if role == Role.SECURITY_LICENSE_REVIEWER:
        return (
            EvidenceValidationRole.LICENSE_REVIEWER
            if gate_id == "G-LICENSE"
            else EvidenceValidationRole.SECURITY_REVIEWER
        )
    try:
        return ROLE_TO_EVIDENCE_ROLE[role]
    except KeyError:
        raise ValueError(
            f"role {role} has no evidence validation role (it is not a validating role)"
        ) from None


# --- Evidence -----------------------------------------------------------------

class EvidenceResult(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    BLOCKED = "BLOCKED"
    NOT_RUN = "NOT_RUN"
    UNKNOWN = "UNKNOWN"


# Results that block a mandatory gate. Everything that is not PASS blocks.
BLOCKING_RESULTS = (
    EvidenceResult.FAIL,
    EvidenceResult.BLOCKED,
    EvidenceResult.NOT_RUN,
    EvidenceResult.UNKNOWN,
)


class EvidenceKind(StrEnum):
    SPEC = "SPEC"
    CODE = "CODE"
    UNIT = "UNIT"
    INTEGRATION = "INTEGRATION"
    E2E = "E2E"
    BLIND = "BLIND"
    LIVE = "LIVE"
    LICENSE = "LICENSE"
    SECURITY = "SECURITY"
    RELEASE = "RELEASE"


class EnvironmentType(StrEnum):
    STATIC = "STATIC"
    MOCK = "MOCK"
    SANDBOX = "SANDBOX"
    LIVE = "LIVE"


# --- Job states (CF-7). One canonical vocabulary. -----------------------------

class JobState(StrEnum):
    QUEUED = "QUEUED"
    DISCOVERING = "DISCOVERING"
    EVALUATING = "EVALUATING"
    AWAITING_SELECTION = "AWAITING_SELECTION"
    PLAN_APPROVED = "PLAN_APPROVED"
    TRANSFORMING = "TRANSFORMING"
    CALIBRATING = "CALIBRATING"
    STAGING_ARTIFACT = "STAGING_ARTIFACT"
    VALIDATING = "VALIDATING"
    AWAITING_RELEASE_APPROVAL = "AWAITING_RELEASE_APPROVAL"
    PUBLISHING = "PUBLISHING"
    REGISTERED = "REGISTERED"
    REJECTED = "REJECTED"
    BLOCKED = "BLOCKED"
    PAUSED = "PAUSED"
    STOPPED_FOR_REVIEW = "STOPPED_FOR_REVIEW"
    RECHECK = "RECHECK"
    CANCELED = "CANCELED"


# Legacy state names documented as aliases, not independent states.
LEGACY_STATE_ALIASES = {
    "PACKAGE_CANDIDATE": JobState.STAGING_ARTIFACT,
    "payload freeze": JobState.STAGING_ARTIFACT,
}

# A single Job's terminal states. Follow-up work is a new Job.
TERMINAL_STATES = frozenset(
    {JobState.REJECTED, JobState.CANCELED, JobState.REGISTERED}
)


class AttestationStatus(StrEnum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    REVIEW_DUE = "REVIEW_DUE"
    REVOKED = "REVOKED"
    SUPERSEDED = "SUPERSEDED"


class PublicationStage(StrEnum):
    """Artifact/release lifecycle. Distinct from JobState."""

    STAGED = "STAGED"
    VERIFIED = "VERIFIED"
    RELEASE_APPROVED = "RELEASE_APPROVED"
    PUBLISHED = "PUBLISHED"
