"""The factory engine: the operations that move work through the pipeline.

Each method answers exactly one question and returns an ``Outcome``. None of
them certify anything; each validates metadata and records what it saw.

The pipeline, from doc 05:
    SPECIFY -> DISCOVER -> ASSESS -> SELECT -> PLAN_TRANSFORM -> BUILD
    -> CALIBRATE -> PACKAGE_CANDIDATE (= STAGING_ARTIFACT) -> VALIDATE
    -> APPROVE -> REGISTER

The ordering rule that makes the whole design work (doc 17): **freeze before
validate**. `freeze()` produces an immutable digest; `attest()` requires that
freeze and binds every evidence record to it. A payload that changes after
freezing needs a new freeze and a new attestation — there is no path that lets
post-freeze edits inherit the old acceptance.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

from ..domain import JobState, Role
from ..domain.state_machine import authorizing_row, is_legal, recorded_stage
from ..rules import policy
from ..rules.schema import validate
from ..store import StoreError, Warehouse
from ..store.paths import check_id
from . import digest as dg
from .orchestrator import LeaseRegistry
from .result import HONESTY_NOTE, Outcome, blocked, ok

ISO = lambda dt: dt.astimezone(timezone.utc).isoformat()  # noqa: E731


def _now() -> datetime:
    return datetime.now(timezone.utc)


# States a job is moved into to stop or park work. These may preempt a lease;
# every other move needs the lease holder.
CONTROL_STATES = frozenset(
    {JobState.PAUSED, JobState.BLOCKED, JobState.CANCELED, JobState.STOPPED_FOR_REVIEW}
)


def _cosign_key(cosignatures: Sequence[Any]) -> list[tuple[str, str]]:
    """Order-free identity of a co-signature list, for replay comparison."""
    out = []
    for c in cosignatures:
        if isinstance(c, dict):
            out.append((str(c.get("role")), str(c.get("actor"))))
        else:  # journal entries written before co-signer identities were required
            out.append((str(c), ""))
    return sorted(out)


class Factory:
    """Operations over one warehouse root."""

    def __init__(self, warehouse: Warehouse):
        self.wh = warehouse

    # -- SPECIFY ------------------------------------------------------------

    def validate_catalog(self, catalog: dict[str, Any]) -> Outcome:
        """Shape + internal consistency of a Production Catalog."""
        reasons = validate(catalog, "production-catalog")
        if reasons:
            return blocked("catalog.validate", reasons)

        seen: set[str] = set()
        for target in catalog.get("targets", []):
            tid = target.get("id")
            if tid in seen:
                reasons.append(f"duplicate target id: {tid}")
            seen.add(tid)

        # Internal dependencies must resolve within the same catalog.
        for target in catalog.get("targets", []):
            for dep in target.get("dependencies", []):
                if dep not in seen:
                    reasons.append(
                        f"target {target.get('id')} depends on unknown target {dep}"
                    )

        if reasons:
            return blocked("catalog.validate", reasons)
        return ok("catalog.validate", targets=len(catalog.get("targets", [])))

    # -- Batch planning -----------------------------------------------------

    def validate_batch(
        self, batch: dict[str, Any], catalog: dict[str, Any]
    ) -> Outcome:
        """Shape + risk classification + dependency gating for a BatchPlan."""
        reasons = validate(batch, "batch-plan")
        reasons += policy.check_batch_plan(batch)
        reasons += policy.check_catalog_dependency_gating(catalog, batch)

        catalog_ids = {t.get("id") for t in catalog.get("targets", [])}
        for tid in batch.get("targetIds", []):
            if tid not in catalog_ids:
                reasons.append(f"batch selects unknown target: {tid}")

        if batch.get("catalogRevision") != catalog.get("catalogRevision"):
            reasons.append("batch catalogRevision does not match the catalog")

        if reasons:
            return blocked("batch.validate", reasons)
        return ok(
            "batch.validate",
            riskClass=batch.get("riskClass"),
            executionMode=batch.get("executionMode"),
        )

    # -- Jobs ---------------------------------------------------------------

    def create_job(
        self,
        *,
        job_id: str,
        target_id: str,
        catalog_revision: str,
        risk_class: str,
        owner: str,
        owner_role: str,
        workspace_id: Optional[str] = None,
        input_sha: str = "UNSELECTED",
    ) -> Outcome:
        """Create a ProductionJob in QUEUED."""
        ts = ISO(_now())
        job = {
            "schemaVersion": "1.2",
            "jobId": job_id,
            "targetId": target_id,
            "catalogRevision": catalog_revision,
            "attemptId": f"{job_id}-a1",
            "state": JobState.QUEUED.value,
            "riskClass": risk_class,
            "inputSha": input_sha,
            "workspaceId": workspace_id or f"ws-{job_id}",
            "checkpointId": f"ckpt-{job_id}-0",
            "owner": owner,
            "ownerRole": owner_role,
            "createdAt": ts,
            "updatedAt": ts,
        }
        reasons = validate(job, "production-job")
        if reasons:
            return blocked("job.create", reasons)
        try:
            with self.wh.workspace.lock(job_id):
                if self.wh.workspace.get_job(job_id) is not None:
                    return blocked("job.create", [f"job already exists: {job_id}"])
                self.wh.workspace.put_job(job_id, job)
        except StoreError as exc:
            return blocked("job.create", [str(exc)])
        return ok("job.create", job=job)

    def transition(
        self,
        *,
        job_id: str,
        to_state: str,
        role: str,
        actor: str,
        reason: str,
        evidence_ids: Sequence[str] = (),
        idempotency_key: Optional[str] = None,
        checkpoint_id: Optional[str] = None,
        cosigners: Sequence[str] = (),
        holder: Optional[str] = None,
    ) -> Outcome:
        """Move a job one step, under that job's lock. See ``_transition``."""
        try:
            if self.wh.workspace.get_job(job_id) is None:
                return blocked("job.transition", [f"unknown job: {job_id}"])
        except StoreError as exc:
            return blocked("job.transition", [str(exc)])
        with self.wh.workspace.lock(job_id):
            return self._transition(
                job_id=job_id, to_state=to_state, role=role, actor=actor,
                reason=reason, evidence_ids=evidence_ids,
                idempotency_key=idempotency_key, checkpoint_id=checkpoint_id,
                cosigners=cosigners, holder=holder,
            )

    def _transition(
        self,
        *,
        job_id: str,
        to_state: str,
        role: str,
        actor: str,
        reason: str,
        evidence_ids: Sequence[str] = (),
        idempotency_key: Optional[str] = None,
        checkpoint_id: Optional[str] = None,
        cosigners: Sequence[str] = (),
        holder: Optional[str] = None,
    ) -> Outcome:
        """Move a job one step, enforcing the normative transition table.

        Idempotent: replaying the same ``idempotency_key`` with the *same*
        request returns the original record and does not move the job again
        (doc 07). Reusing a key for a different request is refused (R-E).

        Gates enforced here (all additions, none weaken an existing check):

        * **R-B** — resuming from ``PAUSED`` may only land on the stage the job
          actually paused from (doc 07 row 19).
        * **R-C** — a job paused while ``BLOCKED`` resumes back to ``BLOCKED``,
          so a pause/resume cycle cannot wash a security/license block away.
        * **R-X** — a transition whose row names a co-signer ("+") refuses when
          that co-signature is absent.
        * **R-R** — a ``READ_ONLY`` job may not enter the transforming half of
          the pipeline (doc 08).
        * **R-G** — entering ``VALIDATING`` requires an ArtifactFreeze bound to
          *this* job and *this* attempt.
        """
        job = self.wh.workspace.get_job(job_id)
        if job is None:
            return blocked("job.transition", [f"unknown job: {job_id}"])

        try:
            from_state = JobState(job["state"])
            to_enum = JobState(to_state)
        except ValueError as exc:
            return blocked("job.transition", [f"non-canonical state value: {exc}"])

        # Co-signatures are part of the request identity, so parse them first.
        cosignatures, cosign_problems = self._parse_cosignatures(cosigners)
        if cosign_problems:
            return blocked("job.transition", cosign_problems)

        key = idempotency_key or (
            f"{job_id}:{from_state.value}->{to_enum.value}:{role}:{uuid.uuid4().hex}"
        )
        prior = self.wh.journal.seen_idempotency_key(key)
        if prior is not None:
            if not self._same_request(
                prior, job_id=job_id, to_state=to_enum.value, role=role,
                actor=actor, reason=reason, evidence_ids=evidence_ids,
                cosignatures=cosignatures,
            ):
                return blocked(
                    "job.transition",
                    [
                        f"idempotency key {key!r} was already used for a different "
                        f"request ({prior.get('from')}->{prior.get('to')} by "
                        f"{prior.get('role')}); refusing to replay a foreign result "
                        "(doc 07)"
                    ],
                )
            return ok(
                "job.transition",
                job=self.wh.workspace.get_job(job_id),
                transition=prior,
                idempotent_replay=True,
            )

        # R-B / R-C / R-D: legality is judged against this job's own history, so
        # a PAUSED or BLOCKED job can only return to the stage it was parked
        # from, and every row covering the move is considered (a specific row
        # does not shadow the general BLOCK row).
        history = self._history(job_id)
        recorded = recorded_stage(history)
        try:
            role_enum = Role(role)
        except ValueError:
            return blocked("job.transition", [f"non-canonical role: {role!r}"])
        legal, detail = is_legal(from_state, to_enum, role_enum, recorded=recorded)
        if not legal:
            return blocked("job.transition", [detail])
        row = authorizing_row(from_state, to_enum, role_enum, recorded=recorded)

        # R-R: a READ_ONLY job never transforms (doc 08).
        reasons = policy.check_risk_class_transition(
            job.get("riskClass"), from_state, to_enum
        )

        # R-X / V-2: a row that names a co-signer ("+") needs a co-signature
        # from that role, by a named person other than the one making the move.
        required = row.cosigners if row is not None else frozenset()
        reasons += self._check_cosignatures(required, cosignatures, actor)
        if reasons:
            return blocked("job.transition", reasons)

        # Gate 11 (R-G): cannot enter VALIDATING without a real freeze on record
        # that is bound to this job and this attempt.
        if to_enum is JobState.VALIDATING:
            freeze = self._job_freeze(job_id, job.get("attemptId"))
            if freeze is None:
                return blocked(
                    "job.transition",
                    ["no ArtifactFreeze on record: a payload must be frozen "
                     "before it can be validated (doc 07 / 17)"],
                )
            if freeze.get("immutable") is not True:
                return blocked(
                    "job.transition", ["freeze record is not marked immutable"]
                )

        # V-5: a leased job is advanced only by its lease holder. Control moves
        # (pause / block / cancel / stop) may preempt a lease, and say so.
        lease = LeaseRegistry(self.wh.layout.leases).current(job_id)
        preempted: Optional[str] = None
        if lease is not None and lease.holder != holder:
            if to_enum not in CONTROL_STATES:
                return blocked(
                    "job.transition",
                    [f"job {job_id} is leased by {lease.holder!r}; only the lease "
                     "holder may advance it (pass holder). Pause, block, cancel "
                     "and stop may preempt a lease (doc 11)."],
                )
            preempted = lease.holder

        release_problems = self._release_gate(job, to_enum)
        if release_problems:
            return blocked("job.transition", release_problems)

        # A new attempt begins when work loops back into TRANSFORMING. The old
        # freeze stays bound to the old attempt, so rework cannot inherit it.
        next_attempt = job["attemptId"]
        if to_enum is JobState.TRANSFORMING and from_state in (
            JobState.VALIDATING,
            JobState.CALIBRATING,
        ):
            next_attempt = self._next_attempt_id(job["attemptId"])

        transition = {
            "schemaVersion": "1.2",
            "jobId": job_id,
            "attemptId": next_attempt,
            "from": from_state.value,
            "to": to_enum.value,
            "actor": actor,
            "role": role,
            "reason": reason,
            "evidenceIds": list(evidence_ids),
            "idempotencyKey": key,
            "timestamp": ISO(_now()),
            **({"checkpointId": checkpoint_id} if checkpoint_id else {}),
        }

        reasons = validate(transition, "state-transition")
        reasons += policy.check_state_transition(transition)
        if reasons:
            return blocked("job.transition", reasons)

        updated = {
            **job,
            "state": to_enum.value,
            "attemptId": next_attempt,
            "updatedAt": ISO(_now()),
        }
        self.wh.workspace.put_job(job_id, updated)
        # The schema-clean dict is what we validate; the journal entry also
        # carries the supplied co-signatures so a replay can compare them as part
        # of the request identity (without touching the schema).
        journal_record = dict(transition)
        if cosignatures:
            journal_record["cosignatures"] = cosignatures
        if preempted:
            journal_record["preemptedLease"] = preempted
        entry = self.wh.journal.append("transition", journal_record)

        return ok(
            "job.transition",
            job=updated,
            transition=entry,
            cosigners_required=sorted(r.value for r in required),
        )

    @staticmethod
    def _same_request(
        prior: dict[str, Any],
        *,
        job_id: str,
        to_state: str,
        role: str,
        actor: str,
        reason: str,
        evidence_ids: Sequence[str],
        cosignatures: Sequence[dict[str, str]] = (),
    ) -> bool:
        """Whether a stored transition answers the same request as this one.

        ``from`` is deliberately excluded: it is derived from the job's current
        state, which has already advanced by the time a replay arrives. The
        supplied co-signatures *are* compared, so replaying a keyed transition
        with a different co-signature set is treated as a different request.
        """
        return (
            prior.get("jobId") == job_id
            and prior.get("to") == to_state
            and prior.get("role") == role
            and prior.get("actor") == actor
            and prior.get("reason") == reason
            and list(prior.get("evidenceIds", [])) == list(evidence_ids)
            and _cosign_key(prior.get("cosignatures", [])) == _cosign_key(cosignatures)
        )

    def _history(self, job_id: str) -> list[tuple[JobState, JobState]]:
        """This job's journaled transitions, oldest first, as (from, to)."""
        out: list[tuple[JobState, JobState]] = []
        for entry in self.wh.journal.entries():
            if entry.get("event") == "transition" and entry.get("jobId") == job_id:
                try:
                    out.append((JobState(entry["from"]), JobState(entry["to"])))
                except (KeyError, ValueError):
                    continue
        return out

    @staticmethod
    def _parse_cosignatures(
        raw: Sequence[str],
    ) -> tuple[list[dict[str, str]], list[str]]:
        """Parse ``ROLE:actor`` co-signatures. A bare role names nobody."""
        parsed: list[dict[str, str]] = []
        problems: list[str] = []
        for item in raw:
            role_part, sep, actor_part = str(item).partition(":")
            role_part, actor_part = role_part.strip(), actor_part.strip()
            if not sep or not actor_part:
                problems.append(
                    f"co-signature {item!r} does not name the co-signer; "
                    "use ROLE:actor (e.g. SECURITY_LICENSE_REVIEWER:alice)"
                )
                continue
            try:
                parsed.append({"role": Role(role_part).value, "actor": actor_part})
            except ValueError:
                problems.append(f"non-canonical co-signer role: {role_part!r}")
        return sorted(parsed, key=lambda c: (c["role"], c["actor"])), problems

    @staticmethod
    def _check_cosignatures(
        required: frozenset[Role], cosignatures: list[dict[str, str]], actor: str
    ) -> list[str]:
        reasons: list[str] = []
        for cosign in cosignatures:
            if cosign["actor"] == actor:
                reasons.append(
                    f"{cosign['role']} co-signature is by {actor!r}, who is making "
                    "the transition; a co-signature must come from someone else"
                )
        signed = {c["role"] for c in cosignatures if c["actor"] != actor}
        missing = sorted(r.value for r in required if r.value not in signed)
        if missing:
            reasons.append(
                "missing required co-signature(s): "
                f"{', '.join(missing)} (doc 07 marks this row with '+'; "
                "supply ROLE:actor)"
            )
        return reasons

    @staticmethod
    def _next_attempt_id(current: str) -> str:
        """``job-1-a1`` -> ``job-1-a2``; a stable, monotonic attempt id."""
        match = re.match(r"^(?P<stem>.*-a)(?P<n>\d+)$", current or "")
        if match:
            return f"{match.group('stem')}{int(match.group('n')) + 1}"
        return f"{(current or 'attempt')}-a2"

    def _job_freeze(
        self, job_id: str, attempt_id: Optional[str]
    ) -> Optional[dict[str, Any]]:
        """The freeze bound to this job *and* this attempt, if it is still genuine.

        Each attempt has its own binding file, so a freeze made for an earlier
        attempt is never found for a later one and rework cannot inherit it
        (R-G). The binding must also agree with the registry's immutable freeze
        for the same resource@version.
        """
        if not attempt_id:
            return None
        from ..store import read_json_optional

        record = read_json_optional(
            self.wh.workspace.job_dir(job_id) / "artifacts" / f"artifact-freeze.{attempt_id}.json"
        )
        if not record or record.get("jobId") != job_id or record.get("attemptId") != attempt_id:
            return None
        try:
            canonical = self.wh.registry.get(
                record["resourceId"], record["resourceVersion"], "artifact-freeze"
            )
        except (KeyError, StoreError):
            return None
        if canonical is None or canonical.get("artifactSha256") != record.get("artifactSha256"):
            return None
        return record

    # -- PACKAGE_CANDIDATE / STAGING_ARTIFACT -------------------------------

    def freeze(
        self,
        *,
        resource_id: str,
        resource_version: str,
        manifest: dict[str, Any],
        payload_root: Path,
        frozen_by: str,
        freeze_id: Optional[str] = None,
        exclude: Iterable[str] = (),
        job_id: Optional[str] = None,
        attempt_id: Optional[str] = None,
    ) -> Outcome:
        """Freeze a candidate payload and produce its ArtifactFreeze.

        Refuses if the manifest embeds certification data (CF-5) or if the
        payload is placeholder content. The result is written immutably: a
        second freeze of the same id@version is a version conflict.

        When ``job_id`` is supplied the freeze is *also* recorded inside that
        job's workspace, bound to ``job_id`` and ``attempt_id``. Gate-11 then
        requires a freeze bound to the job's *current* attempt, so rework after a
        new attempt cannot reuse a stale freeze (R-G). The binding lives in the
        workspace, keeping the registry's ArtifactFreeze schema-compatible.

        A job-bound freeze is accepted only while the job is in
        STAGING_ARTIFACT (doc 17 step 2), only for the job's current attempt,
        and only once per attempt (V-6).
        """
        bound_attempt: Optional[str] = None
        if job_id is not None:
            try:
                job = self.wh.workspace.get_job(job_id)
            except StoreError as exc:
                return blocked("artifact.freeze", [str(exc)])
            if job is None:
                return blocked("artifact.freeze", [f"unknown job: {job_id}"])
            if job.get("state") != JobState.STAGING_ARTIFACT.value:
                return blocked(
                    "artifact.freeze",
                    [f"job {job_id} is {job.get('state')}; a payload is frozen in "
                     "STAGING_ARTIFACT (doc 07 row 11 / doc 17)"],
                )
            bound_attempt = job.get("attemptId")
            if attempt_id is not None and attempt_id != bound_attempt:
                return blocked(
                    "artifact.freeze",
                    [f"attempt {attempt_id!r} is not job {job_id}'s current attempt "
                     f"({bound_attempt!r}); a freeze binds to the current attempt only"],
                )
            if self._job_freeze(job_id, bound_attempt) is not None:
                return blocked(
                    "artifact.freeze",
                    [f"attempt {bound_attempt} of job {job_id} already has a freeze; "
                     "a changed payload needs a new attempt (rework) and a new version"],
                )

        reasons = policy.verify_payload_purity(manifest)
        reasons += validate(manifest, "resource-manifest")
        if reasons:
            return blocked("artifact.freeze", reasons)

        payload_root = Path(payload_root)
        if not payload_root.is_dir():
            return blocked("artifact.freeze", [f"payload root not found: {payload_root}"])

        try:
            file_list = dg.build_file_list(payload_root, exclude=exclude)
            artifact_sha = dg.artifact_digest_from_files(file_list)
            dg.assert_real_content(artifact_sha)
        except dg.UnhashableContent as exc:
            return blocked("artifact.freeze", [str(exc)])

        if not file_list:
            return blocked("artifact.freeze", ["refusing to freeze an empty payload"])

        manifest_sha = dg.payload_manifest_digest(manifest)
        freeze = {
            "schemaVersion": "1.2",
            "freezeId": freeze_id or f"freeze-{resource_id}-{resource_version}",
            "resourceId": resource_id,
            "resourceVersion": resource_version,
            "artifactSha256": artifact_sha,
            "payloadManifestSha256": manifest_sha,
            "frozenAt": ISO(_now()),
            "frozenBy": frozen_by,
            "fileList": file_list,
            "immutable": True,
        }
        problems = validate(freeze, "artifact-freeze")
        if problems:
            return blocked("artifact.freeze", problems)

        try:
            self.wh.registry.put_immutable(
                resource_id, resource_version, "artifact-freeze", freeze
            )
        except StoreError as exc:
            return blocked("artifact.freeze", [str(exc)])

        # R-G: record the job/attempt binding in the workspace so the freeze is
        # attributable and cannot be inherited by a later attempt.
        if job_id is not None and bound_attempt:
            binding = {**freeze, "jobId": job_id, "attemptId": bound_attempt}
            try:
                self.wh.workspace.put_artifact(
                    job_id, f"artifact-freeze.{bound_attempt}", binding, immutable=True
                )
            except StoreError as exc:
                return blocked("artifact.freeze", [str(exc)])

        # Payload bytes themselves are immutable once frozen. The canonical form
        # is the manifest digest; caller-supplied payload_root is not rewritten.
        return ok(
            "artifact.freeze",
            freeze=freeze,
            fileCount=len(file_list),
            artifactSha256=artifact_sha,
        )

    # -- VALIDATE -----------------------------------------------------------

    def attest(
        self,
        *,
        attestation: dict[str, Any],
        profile: dict[str, Any],
        evidences: Sequence[dict[str, Any]],
        freeze: Optional[dict[str, Any]] = None,
        state: Optional[dict[str, Any]] = None,
        now: Optional[datetime] = None,
        job_id: Optional[str] = None,
    ) -> Outcome:
        """Evaluate a ScopedAttestation; with ``job_id``, record it for that job.

        Without a job this is a pure evaluation and records nothing. With a job,
        the job must be VALIDATING, the evaluation runs against the freeze bound
        to the job's current attempt, and a consistent result is journaled and
        kept in the job's workspace. That record is what rows 12/15 and
        ``register`` require (V-1): nothing reaches the Certified Registry on an
        attestation that was never evaluated against its frozen digest.
        """
        if job_id is None:
            return self._evaluate_attestation(
                attestation=attestation, profile=profile, evidences=evidences,
                freeze=freeze, state=state, now=now,
            )
        try:
            job = self.wh.workspace.get_job(job_id)
            attestation_id = check_id(str(attestation.get("attestationId")), "attestationId")
        except StoreError as exc:
            return blocked("attestation.evaluate", [str(exc)])
        if job is None:
            return blocked("attestation.evaluate", [f"unknown job: {job_id}"])
        if job.get("state") != JobState.VALIDATING.value:
            return blocked(
                "attestation.evaluate",
                [f"job {job_id} is {job.get('state')}; attestations are evaluated "
                 "in VALIDATING (doc 17 step 3)"],
            )
        attempt = job.get("attemptId")
        bound = self._job_freeze(job_id, attempt)
        if bound is None:
            return blocked(
                "attestation.evaluate",
                [f"no freeze bound to attempt {attempt} of job {job_id}"],
            )
        if freeze is not None and freeze.get("artifactSha256") != bound.get("artifactSha256"):
            return blocked(
                "attestation.evaluate",
                ["supplied freeze is not the payload frozen for this job's current attempt"],
            )
        outcome = self._evaluate_attestation(
            attestation=attestation, profile=profile, evidences=evidences,
            freeze=bound, state=state, now=now,
        )
        if not outcome.ok:
            return outcome

        record = {
            "jobId": job_id,
            "attemptId": attempt,
            "attestationId": attestation_id,
            "resourceId": bound.get("resourceId"),
            "resourceVersion": bound.get("resourceVersion"),
            "artifactSha256": bound.get("artifactSha256"),
            "payloadManifestSha256": bound.get("payloadManifestSha256"),
            "scopeId": attestation.get("scopeId"),
            "profileId": attestation.get("profileId"),
            "profileVersion": attestation.get("profileVersion"),
            "attestedLevel": attestation.get("attestedLevel"),
            "evidenceIds": sorted(str(e.get("id")) for e in evidences),
            "result": "METADATA_CONSISTENT",
        }
        try:
            self.wh.workspace.put_artifact(
                job_id,
                f"attestation.{attempt}.{attestation_id}",
                {**record, "attestation": attestation, "evidences": list(evidences)},
                immutable=True,
            )
        except StoreError as exc:
            return blocked(
                "attestation.evaluate",
                [f"{exc} (an evaluated attestation is not re-evaluated in place; "
                 "issue a new attestationId)"],
            )
        self.wh.journal.append("attestation", record)
        return ok(
            "attestation.evaluate",
            metadataConsistency="METADATA_CONSISTENT",
            recorded=record,
            note=HONESTY_NOTE,
        )

    def _attestation_record(
        self, job_id: str, attempt_id: Optional[str], digest: Optional[str]
    ) -> Optional[dict[str, Any]]:
        """Latest consistent attestation journaled for this job/attempt/digest."""
        found = None
        for entry in self.wh.journal.find("attestation"):
            if (
                entry.get("jobId") == job_id
                and entry.get("attemptId") == attempt_id
                and entry.get("artifactSha256") == digest
                and entry.get("result") == "METADATA_CONSISTENT"
            ):
                found = entry
        return found

    def _release_gate(self, job: dict[str, Any], to_state: JobState) -> list[str]:
        """Rows 12 / 15 / 16 / 26: release steps are bound to the frozen digest.

        * into AWAITING_RELEASE_APPROVAL or PUBLISHING: an attestation evaluated
          against this attempt's frozen digest must be on record;
        * into REGISTERED: the payload must actually be in the registry at that
          same digest, registered for this job and attempt.
        """
        if to_state not in (
            JobState.AWAITING_RELEASE_APPROVAL, JobState.PUBLISHING, JobState.REGISTERED,
        ):
            return []
        job_id, attempt = job["jobId"], job.get("attemptId")
        freeze = self._job_freeze(job_id, attempt)
        if freeze is None:
            return [f"no freeze bound to attempt {attempt}; nothing to release"]
        digest = freeze.get("artifactSha256")
        if to_state is not JobState.REGISTERED:
            if self._attestation_record(job_id, attempt, digest) is None:
                return [
                    "no attestation evaluated against the frozen digest for attempt "
                    f"{attempt} (doc 07 rows 12/15); run attest with this job"
                ]
            return []
        state = self.wh.registry.get(
            freeze["resourceId"], freeze["resourceVersion"], "resource-state"
        )
        registered = any(
            e.get("jobId") == job_id and e.get("attemptId") == attempt
            and e.get("artifactSha256") == digest
            for e in self.wh.journal.find("register")
        )
        if state is None or state.get("artifactSha256") != digest or not registered:
            return [
                "payload is not registered at the frozen digest for this attempt "
                "(doc 07 row 16); run registry register with this job first"
            ]
        return []

    def _evaluate_attestation(
        self,
        *,
        attestation: dict[str, Any],
        profile: dict[str, Any],
        evidences: Sequence[dict[str, Any]],
        freeze: Optional[dict[str, Any]] = None,
        state: Optional[dict[str, Any]] = None,
        now: Optional[datetime] = None,
    ) -> Outcome:
        """Evaluate a ScopedAttestation against its gates and evidence.

        Requires a freeze. Every gate's evidence, the freeze and the attestation
        must all agree on one artifact digest. Returns METADATA_CONSISTENT at
        best — never a certification.
        """
        now = now or _now()
        reasons = validate(attestation, "scoped-attestation")
        reasons += validate(profile, "gate-profile")
        for ev in evidences:
            reasons += validate(ev, "evidence")

        # Duplicate evidence ids would let one real record satisfy two gates.
        seen: set[str] = set()
        for ev in evidences:
            eid = ev.get("id")
            if eid in seen:
                reasons.append("duplicate evidence ID")
            seen.add(eid)

        if reasons:
            return blocked("attestation.evaluate", reasons)

        if attestation.get("attestationStatus") != "ACTIVE":
            reasons.append("not ACTIVE")

        level = attestation.get("attestedLevel")
        if level not in ("L1", "L2", "L3"):
            reasons.append("missing attested quality level")

        if attestation.get("artifactSha256") == "UNBUILT":
            reasons.append("unbuilt artifact")

        if not attestation.get("reviewerId") or not attestation.get("reviewDecisionId"):
            reasons.append("missing independent review decision")

        if attestation.get("scopeId") != profile.get("scopeId"):
            reasons.append("scope mismatch")
        if (
            attestation.get("profileId") != profile.get("profileId")
            or attestation.get("profileVersion") != profile.get("profileVersion")
        ):
            reasons.append("profile mismatch")

        def parse(value: str) -> datetime:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))

        try:
            if parse(attestation["issuedAt"]) > now:
                reasons.append("attestation issued in future")
            if parse(attestation["expiresAt"]) <= now:
                reasons.append("attestation expired")
            if parse(attestation["issuedAt"]) >= parse(attestation["expiresAt"]):
                reasons.append("invalid attestation time window")
        except (KeyError, ValueError):
            reasons.append("unparseable attestation time window")

        # Freeze-first: validation is meaningful only against a frozen digest.
        if freeze is None:
            reasons.append(
                "no ArtifactFreeze supplied: a payload must be frozen before validation"
            )
        else:
            reasons += policy.verify_digest_chain(freeze, state, attestation, evidences)
            if freeze.get("payloadManifestSha256") and not attestation.get(
                "payloadManifestSha256"
            ):
                reasons.append(
                    "attestation must bind the frozen payloadManifestSha256"
                )

        # Per-gate evidence, bound to the frozen digest.
        expected = attestation.get("artifactSha256")
        by_id = {e.get("id"): e for e in evidences}
        if level in ("L1", "L2", "L3"):
            reasons += policy.check_required_gates_present(attestation, profile, level)

            order = ["L1", "L2", "L3"]
            upto = order.index(level) + 1
            required: list[str] = []
            for lvl in order[:upto]:
                for gate in profile.get("levels", {}).get(lvl, []):
                    if gate not in required:
                        required.append(gate)

            for gate in required:
                ev_id = attestation.get("gateEvidenceIds", {}).get(gate)
                if ev_id is None:
                    continue  # already reported as missing
                ev = by_id.get(ev_id)
                if ev is None:
                    reasons.append(f"missing evidence record {ev_id}")
                    continue
                reasons += policy.check_gate_evidence(
                    ev,
                    attestation=attestation,
                    gate=gate,
                    profile=profile,
                    expected_digest=expected,
                    now=now,
                )

        reasons += policy.check_level_within_profile(level, profile)
        reasons += policy.check_conditional_gates(attestation, profile, evidences)

        if reasons:
            return blocked("attestation.evaluate", reasons)
        return ok(
            "attestation.evaluate",
            metadataConsistency="METADATA_CONSISTENT",
            note=HONESTY_NOTE,
        )

    # -- APPROVE / REGISTER -------------------------------------------------

    def record_decision(
        self,
        *,
        decision: dict[str, Any],
        state: Optional[dict[str, Any]] = None,
    ) -> Outcome:
        """Record a DeploymentEligibilityDecision — the sole source of usePolicy."""
        reasons = validate(decision, "deployment-eligibility-decision")
        if decision.get("usePolicy") == "PRODUCTION_ELIGIBLE":
            if not decision.get("approvalId"):
                reasons.append("PRODUCTION_ELIGIBLE requires an approvalId")
            if decision.get("decidedByRole") != Role.RELEASE_APPROVER:
                reasons.append(
                    "PRODUCTION_ELIGIBLE requires a RELEASE_APPROVER decision"
                )
        if state is not None:
            reasons += policy.check_use_policy(decision, state)
        if reasons:
            return blocked("decision.record", reasons)

        try:
            self.wh.registry.put_decision(decision)
        except StoreError as exc:
            return blocked("decision.record", [str(exc)])
        self.wh.journal.append("decision", decision)
        return ok("decision.record", decision=decision)

    def register(
        self,
        *,
        state: dict[str, Any],
        freeze: dict[str, Any],
        decision: Optional[dict[str, Any]],
        actor: str,
        role: str,
        job_id: Optional[str] = None,
    ) -> Outcome:
        """Publish a frozen payload into the Certified Registry.

        Refuses if the actor is not a RELEASE_APPROVER, if there is no job in
        PUBLISHING carrying this payload, if the freeze is not the one bound to
        that job's current attempt, if no attestation was evaluated against that
        frozen digest, or if the state claims more than was evaluated (V-1).
        Registry content is immutable, so a colliding id@version is refused
        rather than overwritten.
        """
        if role != Role.RELEASE_APPROVER:
            return blocked(
                "registry.register",
                [f"registry release requires RELEASE_APPROVER, got {role}"],
            )
        if job_id is None:
            return blocked(
                "registry.register",
                ["registry release goes through a job in PUBLISHING (doc 07 rows "
                 "15-16); pass the job id"],
            )
        try:
            job = self.wh.workspace.get_job(job_id)
        except StoreError as exc:
            return blocked("registry.register", [str(exc)])
        if job is None:
            return blocked("registry.register", [f"unknown job: {job_id}"])
        if job.get("state") != JobState.PUBLISHING.value:
            return blocked(
                "registry.register",
                [f"job {job_id} is {job.get('state')}; registration happens in "
                 "PUBLISHING (doc 07 row 16)"],
            )
        attempt = job.get("attemptId")
        bound = self._job_freeze(job_id, attempt)
        if bound is None:
            return blocked("registry.register", [f"no freeze bound to attempt {attempt}"])
        if (
            freeze.get("artifactSha256") != bound.get("artifactSha256")
            or freeze.get("resourceId") != bound.get("resourceId")
            or freeze.get("resourceVersion") != bound.get("resourceVersion")
        ):
            return blocked(
                "registry.register",
                ["supplied freeze is not the payload frozen for this job's current attempt"],
            )
        evaluated = self._attestation_record(job_id, attempt, bound.get("artifactSha256"))
        if evaluated is None:
            return blocked(
                "registry.register",
                ["no attestation evaluated against this frozen digest; an "
                 "unevaluated payload cannot enter the Certified Registry"],
            )

        reasons: list[str] = []
        if evaluated["attestationId"] not in state.get("attestationRefs", []):
            reasons.append(
                f"resource-state must reference the evaluated attestation "
                f"{evaluated['attestationId']}"
            )
        unevaluated = sorted(set(state.get("evidenceIds", [])) - set(evaluated["evidenceIds"]))
        if unevaluated:
            reasons.append(f"resource-state cites evidence that was never evaluated: {unevaluated}")
        order = ["L0", "L1", "L2", "L3"]
        claimed, attested = state.get("qualityLevel"), evaluated.get("attestedLevel")
        if claimed in order and attested in order and order.index(claimed) > order.index(attested):
            reasons.append(f"qualityLevel {claimed} exceeds the attested level {attested}")
        if decision is not None:
            on_record = self.wh.registry.get_decision(
                str(state.get("resourceId")), str(state.get("resourceVersion")),
                str(decision.get("decisionId")),
            ) if decision.get("decisionId") else None
            if on_record != decision:
                reasons.append(
                    "deployment eligibility decision is not on record as supplied; "
                    "record it first (decide)"
                )

        reasons += validate(state, "resource-state")
        reasons += policy.check_use_policy(decision, state)
        reasons += policy.verify_digest_chain(freeze, state)
        reasons += policy.check_installable(state)
        if reasons:
            return blocked("registry.register", reasons)

        # Digest conflict: same id@version, different bytes -> refuse.
        existing = self.wh.registry.digest_recorded(
            state["resourceId"], state["resourceVersion"]
        )
        if existing is not None and existing != freeze.get("artifactSha256"):
            return blocked(
                "registry.register",
                [
                    "version conflict: "
                    f"{state['resourceId']}@{state['resourceVersion']} is already "
                    f"frozen at a different digest ({existing[:12]}… vs "
                    f"{str(freeze.get('artifactSha256'))[:12]}…). Published payloads "
                    "are immutable; a change must become a new version."
                ],
            )

        self.wh.registry.put_state(state)
        self.wh.journal.append(
            "register",
            {
                "resourceId": state["resourceId"],
                "resourceVersion": state["resourceVersion"],
                "artifactSha256": freeze.get("artifactSha256"),
                "actor": actor,
                "role": role,
                "publicationStatus": state.get("publicationStatus"),
                "jobId": job_id,
                "attemptId": attempt,
            },
        )
        return ok("registry.register", state=state)

    def installable(self, state: dict[str, Any]) -> Outcome:
        """Whether a registry entry may be installed, per publication status."""
        reasons = policy.check_installable(state)
        if reasons:
            return blocked("registry.install-check", reasons)
        return ok(
            "registry.install-check",
            publicationStatus=state.get("publicationStatus"),
        )

    # -- Retirement (doc 10) ------------------------------------------------

    # Legal movement of publicationStatus. Doc 10 defines the meanings; this
    # table makes illegal jumps (e.g. straight from LISTED to PRIVATE to hide a
    # quarantine) a refusal rather than a silent state write.
    RETIREMENT_PATHS: dict[str, frozenset[str]] = {
        "PRIVATE": frozenset({"LISTED", "DEPRECATED", "QUARANTINED", "WITHDRAWN"}),
        "LISTED": frozenset({"DEPRECATED", "QUARANTINED", "WITHDRAWN"}),
        "DEPRECATED": frozenset({"QUARANTINED", "WITHDRAWN", "LISTED"}),
        "QUARANTINED": frozenset({"WITHDRAWN", "DEPRECATED"}),
        "WITHDRAWN": frozenset(),  # terminal for distribution
    }

    def retire(
        self,
        *,
        resource_id: str,
        resource_version: str,
        to_status: str,
        actor: str,
        role: str,
        reason: str,
    ) -> Outcome:
        """Move a registry entry's publication status.

        ``QUARANTINED`` disables new installs immediately (doc 10). History is
        never erased: the state projection advances and the journal records why.
        """
        state = self.wh.registry.get(resource_id, resource_version, "resource-state")
        if state is None:
            return blocked(
                "registry.retire", [f"not in registry: {resource_id}@{resource_version}"]
            )

        if role not in (Role.RELEASE_APPROVER, Role.SECURITY_LICENSE_REVIEWER):
            return blocked(
                "registry.retire",
                [
                    "retirement requires RELEASE_APPROVER or SECURITY_LICENSE_REVIEWER, "
                    f"got {role}"
                ],
            )

        current = state.get("publicationStatus")
        allowed = self.RETIREMENT_PATHS.get(current, frozenset())
        if to_status not in allowed:
            return blocked(
                "registry.retire",
                [f"illegal publication transition {current} -> {to_status}"],
            )

        new_state = {**state, "publicationStatus": to_status}
        problems = validate(new_state, "resource-state")
        if problems:
            return blocked("registry.retire", problems)

        self.wh.registry.put_state(new_state)
        self.wh.journal.append(
            "retire",
            {
                "resourceId": resource_id,
                "resourceVersion": resource_version,
                "from": current,
                "to": to_status,
                "actor": actor,
                "role": role,
                "reason": reason,
            },
        )
        return ok("registry.retire", state=new_state, fromStatus=current, toStatus=to_status)
