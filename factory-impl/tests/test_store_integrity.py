"""Store invariants: immutability where it matters, mutability where it must.

The distinction is the whole point. A freeze is identity and never changes. A
resource-state is a projection and must change, or retirement would be
impossible (doc 10).
"""

from __future__ import annotations

import pytest

from factory.store import StoreError, Warehouse


def test_immutable_write_refused_on_second_write(factory_root):
    wh = Warehouse.open(factory_root / "f")
    wh.registry.put_immutable("r", "1", "artifact-freeze", {"artifactSha256": "a" * 64})
    with pytest.raises(StoreError, match="immutable"):
        wh.registry.put_immutable("r", "1", "artifact-freeze", {"artifactSha256": "b" * 64})


def test_different_versions_are_separate_slots(factory_root):
    wh = Warehouse.open(factory_root / "f")
    wh.registry.put_immutable("r", "1", "artifact-freeze", {"artifactSha256": "a" * 64})
    wh.registry.put_immutable("r", "2", "artifact-freeze", {"artifactSha256": "b" * 64})
    assert wh.registry.versions("r") == ["1", "2"]


def test_state_projection_is_updatable(factory_root):
    """Retirement requires rewriting the projection; freezing must not."""
    wh = Warehouse.open(factory_root / "f")
    state = {"resourceId": "r", "resourceVersion": "1", "publicationStatus": "PRIVATE"}
    wh.registry.put_state(state)
    wh.registry.put_state({**state, "publicationStatus": "QUARANTINED"})
    assert wh.registry.get("r", "1", "resource-state")["publicationStatus"] == "QUARANTINED"


def test_decisions_are_append_only(factory_root):
    wh = Warehouse.open(factory_root / "f")
    d = {"resourceId": "r", "resourceVersion": "1", "decisionId": "d1", "decidedAt": "2026-01-01T00:00:00+00:00"}
    wh.registry.put_decision(d)
    with pytest.raises(StoreError, match="immutable"):
        wh.registry.put_decision(d)
    assert wh.registry.get_decision("r", "1", "d1")["decisionId"] == "d1"


def test_no_temp_files_left_behind(factory_root):
    wh = Warehouse.open(factory_root / "f")
    wh.registry.put_immutable("r", "1", "artifact-freeze", {"artifactSha256": "a" * 64})
    leftovers = list((factory_root / "f" / "registry").rglob(".tmp-*"))
    assert leftovers == []


def test_journal_is_append_only_and_ordered(factory_root):
    wh = Warehouse.open(factory_root / "f")
    for key in ("k1", "k2", "k3"):
        wh.record_transition({"jobId": "j", "idempotencyKey": key})
    assert [e["idempotencyKey"] for e in wh.journal.entries()] == ["k1", "k2", "k3"]


def test_idempotent_transition_recorded_once(factory_root):
    wh = Warehouse.open(factory_root / "f")
    payload = {"jobId": "j", "idempotencyKey": "same"}
    first = wh.record_transition(payload)
    second = wh.record_transition(payload)
    assert first == second
    assert len(wh.journal.find("transition")) == 1


def test_jobs_are_isolated_directories(factory_root):
    wh = Warehouse.open(factory_root / "f")
    wh.workspace.put_job("a", {"jobId": "a"})
    wh.workspace.put_job("b", {"jobId": "b"})
    assert wh.workspace.list_jobs() == ["a", "b"]
    assert wh.workspace.get_job("a")["jobId"] == "a"
