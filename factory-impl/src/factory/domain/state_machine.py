"""The authoritative job transition table, encoded from ``07_STATE_MACHINE.v1.2``.

Doc 07 says: "图只给主路径；以下转移表是唯一权威" — the diagram is illustrative,
this table is normative. So this module is the single place a transition is
declared legal, and ``TransitionTable`` is what the rules engine consults.

Two structural invariants live here and nowhere else:

* **Builder cannot self-approve.** No transition into an approval/publish state
  is executable by ``BUILDER_AGENT``.
* **BLOCKED cannot jump to PUBLISHING.** Recovery is only back to a recorded
  stage, and that stage's gates must be re-verified.

Honesty note: a legal transition is a *process* fact. It is not evidence that
any gate passed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional

from .enums import TERMINAL_STATES, JobState, Role

# States reachable as a recovery target from BLOCKED/PAUSED: the recorded
# stage. Recovery never lands on an approval or publish state directly.
RECOVERABLE_STAGES = frozenset(
    {
        JobState.DISCOVERING,
        JobState.EVALUATING,
        JobState.AWAITING_SELECTION,
        JobState.PLAN_APPROVED,
        JobState.TRANSFORMING,
        JobState.CALIBRATING,
        JobState.STAGING_ARTIFACT,
        JobState.VALIDATING,
    }
)


@dataclass(frozen=True)
class Transition:
    """One row of the normative table.

    ``from_state``/``to_state`` of ``None`` mean "any non-terminal state" and
    "the recorded prior stage" respectively — the wildcard rows 18-24.
    """

    number: int
    from_state: Optional[JobState]
    to_state: Optional[JobState]
    # Minimal roles permitted to execute this transition.
    roles: frozenset[Role]
    requires: str
    # Optional extra roles that must co-sign (doc 07 lists these as "+").
    cosigners: frozenset[Role] = field(default_factory=frozenset)


_S = JobState

# The table, verbatim from doc 07 rows 1-27.
TRANSITIONS: tuple[Transition, ...] = (
    Transition(1, _S.QUEUED, _S.DISCOVERING, frozenset({Role.PRODUCT_OWNER}),
               "approved BatchPlan, budget, read-only scope"),
    Transition(2, _S.DISCOVERING, _S.EVALUATING, frozenset({Role.DISCOVERY_AGENT}),
               "read-only discovery result and source register"),
    Transition(3, _S.EVALUATING, _S.AWAITING_SELECTION, frozenset({Role.DISCOVERY_AGENT}),
               "trusted source and triage conclusion, risk readable"),
    Transition(4, _S.EVALUATING, _S.REJECTED,
               frozenset({Role.DISCOVERY_AGENT}), "no trusted candidate or all BLOCKED",
               cosigners=frozenset({Role.PRODUCT_OWNER})),
    Transition(5, _S.AWAITING_SELECTION, _S.PLAN_APPROVED, frozenset({Role.PRODUCT_OWNER}),
               "ADR, license plan, target, budget, sandbox",
               cosigners=frozenset({Role.SECURITY_LICENSE_REVIEWER})),
    Transition(6, _S.AWAITING_SELECTION, _S.REJECTED, frozenset({Role.PRODUCT_OWNER}),
               "selection-veto rationale"),
    Transition(7, _S.PLAN_APPROVED, _S.TRANSFORMING, frozenset({Role.BUILDER_AGENT}),
               "locked SHA, checkpoint, path allowlist, execution approval"),
    Transition(8, _S.TRANSFORMING, _S.CALIBRATING, frozenset({Role.BUILDER_AGENT}),
               "patch applied, pre-test debug plan"),
    Transition(9, _S.CALIBRATING, _S.TRANSFORMING, frozenset({Role.BUILDER_AGENT}),
               "iterative fix (each attempt retained)"),
    Transition(10, _S.CALIBRATING, _S.STAGING_ARTIFACT, frozenset({Role.BUILDER_AGENT}),
               "test plan, code diff, impact list",
               cosigners=frozenset({Role.SECURITY_LICENSE_REVIEWER})),
    Transition(11, _S.STAGING_ARTIFACT, _S.VALIDATING, frozenset({Role.BUILDER_AGENT}),
               "complete candidate payload frozen, ArtifactFreeze produced, "
               "hash locked, no further write permission"),
    Transition(12, _S.VALIDATING, _S.AWAITING_RELEASE_APPROVAL, frozenset({Role.VALIDATOR}),
               "all mandatory gates PASS, evidence locked to frozen digest"),
    Transition(13, _S.VALIDATING, _S.BLOCKED, frozenset({Role.VALIDATOR}),
               "any mandatory gate FAIL/BLOCKED/UNKNOWN, or expired evidence"),
    Transition(14, _S.VALIDATING, _S.TRANSFORMING, frozenset({Role.BUILDER_AGENT}),
               "rework: new attempt, new digest, affected gates re-verified"),
    Transition(15, _S.AWAITING_RELEASE_APPROVAL, _S.PUBLISHING,
               frozenset({Role.RELEASE_APPROVER}),
               "human release authorization, license and security review; "
               "all gates match frozen digest"),
    Transition(16, _S.PUBLISHING, _S.REGISTERED, frozenset({Role.RELEASE_APPROVER}),
               "detached signature/envelope, install and withdrawal path verified; "
               "payload unchanged"),
    Transition(17, _S.PUBLISHING, _S.BLOCKED, frozenset({Role.RELEASE_APPROVER}),
               "same-name version digest conflict"),
    Transition(18, None, _S.PAUSED, frozenset({Role.PRODUCT_OWNER}), "pause rationale"),
    Transition(19, _S.PAUSED, None, frozenset({Role.PRODUCT_OWNER}),
               "resume rationale; gates of that stage must be re-verified"),
    Transition(20, None, _S.BLOCKED,
               frozenset({Role.VALIDATOR, Role.SECURITY_LICENSE_REVIEWER}),
               "blocking reason (license/security/budget/reproducibility)"),
    Transition(21, _S.BLOCKED, None,
               frozenset({Role.VALIDATOR, Role.SECURITY_LICENSE_REVIEWER}),
               "human or rules-engine decision; may NOT jump to PUBLISHING"),
    Transition(22, None, _S.CANCELED, frozenset({Role.PRODUCT_OWNER}), "cancel rationale"),
    Transition(23, None, _S.STOPPED_FOR_REVIEW, frozenset({Role.PRODUCT_OWNER}),
               "budget/time/attempt cap reached"),
    Transition(24, _S.STOPPED_FOR_REVIEW, None, frozenset({Role.PRODUCT_OWNER}),
               "review outcome (PAUSED / REJECTED / CANCELED)"),
    Transition(25, _S.REGISTERED, _S.RECHECK, frozenset({Role.RELEASE_APPROVER}),
               "re-hash / reinstall verification after download"),
    Transition(26, _S.RECHECK, None, frozenset({Role.RELEASE_APPROVER}),
               "consistent (same payload) / inconsistent"),
)

# --- Spec conflict, resolved explicitly --------------------------------------
# Doc 07 states "REJECTED, CANCELED, REGISTERED 对单次 Job 为终态", yet row 25
# defines REGISTERED -> RECHECK. Both cannot hold for a job-scoped transition.
#
# Resolution: RECHECK is *not* a job continuation. It is a post-release
# re-verification of an already-published payload (doc 17's final step), whose
# outcome is "bytes unchanged" (back to REGISTERED) or "inconsistent"
# (BLOCKED). So REGISTERED stays terminal as a *work* state, and the single
# REGISTERED -> RECHECK edge is permitted as an integrity re-check that leaves
# the job's work history intact. No new job is created; no payload is rewritten.
#
# This is recorded as an implementation finding (see docs/SPEC_CONFLICTS.md);
# it does not weaken any gate — RECHECK can only return to REGISTERED or BLOCKED.
POST_TERMINAL_VERIFICATION = frozenset({(JobState.REGISTERED, JobState.RECHECK)})

# Wildcard-row outcomes are constrained. ``None`` as a ``to_state`` means the
# recorded prior stage; these sets bound what a wildcard row may resolve to.
_ROW18_FROM = "any non-terminal"
_WILDCARD_SOURCES = {
    18: _ROW18_FROM, 20: _ROW18_FROM, 22: _ROW18_FROM, 23: _ROW18_FROM,
}
# Holding states: a job is parked here and later returns to the stage it was
# parked from (rows 18-24). Rows 19 and 21 are the only "return" rows.
HOLDING_STATES = frozenset({_S.PAUSED, _S.BLOCKED, _S.STOPPED_FOR_REVIEW})
_RESUME_ROWS = (19, 21)

# What rows 19/21 may statically resolve to. The table alone cannot know which
# stage a particular job was parked from, so it admits every stage a job can be
# parked from; the engine pins the exact one from the job's history (R-B/R-C).
RESUME_CANDIDATES = RECOVERABLE_STAGES | frozenset(
    {_S.QUEUED, _S.PAUSED, _S.BLOCKED, _S.STOPPED_FOR_REVIEW, _S.RECHECK}
)

# Row 24 and 26 enumerate their outcomes in doc 07.
ROW_OUTCOMES: dict[int, frozenset[JobState]] = {
    19: RESUME_CANDIDATES,
    21: RESUME_CANDIDATES,
    24: frozenset({_S.PAUSED, _S.REJECTED, _S.CANCELED}),
    26: frozenset({_S.REGISTERED, _S.BLOCKED}),
}


def resume_target(recorded: JobState) -> JobState:
    """Where a job parked from ``recorded`` returns to.

    The recorded stage itself, except that a job parked while awaiting release
    approval or publishing returns to VALIDATING: row 19 requires the gates of
    that stage to be re-verified, and those gates are verified in VALIDATING
    (rows 12/15). A resume never lands on an approval or publish state (SC-03).
    """
    if recorded in (_S.AWAITING_RELEASE_APPROVAL, _S.PUBLISHING):
        return _S.VALIDATING
    return recorded


def recorded_stage(history: Iterable[tuple[JobState, JobState]]) -> Optional[JobState]:
    """The stage a parked job returns to, replayed from its ordered transitions.

    Holds nest: a job can be BLOCKED, then PAUSED while blocked. Each hold
    remembers the stage it was entered from, so resuming the pause lands back on
    BLOCKED (a pause cannot wash a block away, R-C), and only resuming the block
    returns to the working stage. ``None`` means the job is not parked, or its
    history does not say where it came from.
    """
    stack: list[JobState] = []
    for frm, to in history:
        if frm in HOLDING_STATES and stack and to == resume_target(stack[-1]):
            stack.pop()  # returned to where the hold was entered from
        elif frm == _S.STOPPED_FOR_REVIEW and to == _S.PAUSED:
            pass  # row 24: the review parks the job; it keeps its recorded stage
        elif to in HOLDING_STATES:
            stack.append(frm)  # entered a hold (rows 18 / 20 / 23)
        elif frm in HOLDING_STATES and stack:
            stack.pop()  # left a hold some other way (only terminal exits remain)
    return stack[-1] if stack else None


def _candidates(from_state: JobState, to_state: JobState) -> list[Transition]:
    """Transitions that could apply to this (from, to) pair, wildcards included."""
    out = []
    for t in TRANSITIONS:
        if t.from_state is not None and t.from_state != from_state:
            continue
        if t.to_state is not None and t.to_state != to_state:
            continue
        # Wildcard target rows: ``to_state is None`` means a recorded stage.
        if t.to_state is None:
            if t.number in ROW_OUTCOMES and to_state not in ROW_OUTCOMES[t.number]:
                continue
            elif t.number not in ROW_OUTCOMES and to_state not in RECOVERABLE_STAGES:
                continue
        # Wildcard source rows: only fire on non-terminal sources.
        if t.from_state is None and from_state in TERMINAL_STATES:
            continue
        out.append(t)
    return out


def _specificity(t: Transition) -> tuple[int, int, int]:
    """Fixed source and fixed target beat wildcards; then table order."""
    return (
        0 if t.from_state is not None else 1,
        0 if t.to_state is not None else 1,
        t.number,
    )


def find_transition(from_state: JobState, to_state: JobState) -> Optional[Transition]:
    """Return the most specific normative row for ``from_state -> to_state``.

    Returns ``None`` if no row covers the pair. This ignores roles; use
    ``authorizing_row`` to ask which row lets a given role make the move.
    """
    matches = _candidates(from_state, to_state)
    return sorted(matches, key=_specificity)[0] if matches else None


# Sentinel: "the caller has no job history; answer from the table alone".
STATIC = object()


def _rows_for(from_state: JobState, to_state: JobState, recorded: object) -> list[Transition]:
    rows = _candidates(from_state, to_state)
    if recorded is STATIC:
        return rows
    # With history known, a return row (19/21) only covers the one stage this
    # job was parked from.
    returning = recorded is not None and to_state == resume_target(recorded)  # type: ignore[arg-type]
    return [t for t in rows if t.number not in _RESUME_ROWS or returning]


def authorizing_row(
    from_state: JobState, to_state: JobState, role: Role, *, recorded: object = STATIC
) -> Optional[Transition]:
    """The most specific row that lets ``role`` make this move, or ``None``.

    Every row that covers the pair is considered, not just the most specific
    one, so a specific row never shadows a general one: row 13 (VALIDATING ->
    BLOCKED, VALIDATOR) does not stop row 20 from letting the security/license
    reviewer block the same job (R-D).
    """
    permitted = [t for t in _rows_for(from_state, to_state, recorded) if role in t.roles]
    return sorted(permitted, key=_specificity)[0] if permitted else None


def blocking_roles() -> frozenset[Role]:
    """Roles the general BLOCK row (20) names, independent of source state."""
    return next(t.roles for t in TRANSITIONS if t.number == 20)


def is_legal(
    from_state: JobState, to_state: JobState, role: Role, *, recorded: object = STATIC
) -> tuple[bool, str]:
    """Whether ``role`` may move a job ``from_state -> to_state``.

    ``recorded`` is the stage a parked job returns to (see ``recorded_stage``).
    Leave it unset to ask the table alone; the engine always passes it, so a
    PAUSED or BLOCKED job can only return to where it actually came from.

    Returns ``(ok, reason)``. A false result always carries a reason — the
    engine records it rather than silently refusing.
    """
    if from_state == to_state:
        return False, "no-op transition"
    if from_state in TERMINAL_STATES and (from_state, to_state) not in POST_TERMINAL_VERIFICATION:
        return False, f"{from_state} is terminal for a single job; open a new job"

    rows = _rows_for(from_state, to_state, recorded)
    if not rows:
        if recorded is not STATIC and _candidates(from_state, to_state):
            if recorded is None:
                return False, (
                    f"no recorded prior stage for {from_state}: cannot resume "
                    "without knowing which stage to return to (doc 07 row 19/21)"
                )
            return False, (
                f"{from_state} may only return to its recorded prior stage "
                f"{resume_target(recorded)}, not {to_state} (doc 07 row 19/21)"  # type: ignore[arg-type]
            )
        return False, f"no normative transition {from_state} -> {to_state} (see doc 07)"

    t = authorizing_row(from_state, to_state, role, recorded=recorded)
    if t is None:
        allowed = "/".join(sorted({r.value for row in rows for r in row.roles}))
        best = sorted(rows, key=_specificity)[0]
        return False, (
            f"role {role} may not execute {from_state} -> {to_state}; "
            f"requires {allowed} (row {best.number})"
        )

    # Structural invariant: the builder never signs off its own release.
    if role == Role.BUILDER_AGENT and to_state in (
        _S.AWAITING_RELEASE_APPROVAL,
        _S.PUBLISHING,
        _S.REGISTERED,
    ):
        return False, "Builder cannot self-approve release transitions"

    return True, f"row {t.number}: {t.requires}"


def required_roles(
    from_state: JobState, to_state: JobState, role: Optional[Role] = None
) -> frozenset[Role]:
    """Roles that must co-sign this transition (empty if none).

    With ``role``, the co-signers of the row that actually authorizes that role;
    without it, those of the most specific row.
    """
    t = (
        authorizing_row(from_state, to_state, role)
        if role is not None
        else find_transition(from_state, to_state)
    )
    return t.cosigners if t else frozenset()
