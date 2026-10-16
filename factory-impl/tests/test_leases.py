"""File-based leases (R-P8): exclusive, durable, heartbeat-able.

The in-memory version lost the lease with the process, so a crashed worker's job
could be claimed twice. These tests pin the on-disk behaviour: ``O_EXCL`` create
is the atomic claim, the file survives a fresh registry (a crash), heartbeats
extend a live lease, and only the holder may heartbeat.
"""

from __future__ import annotations

import json
from datetime import timedelta

from fastapi.testclient import TestClient
from typer.testing import CliRunner

from factory.api import app as api_app, set_root
from factory.cli import app
from factory.engine import LeaseRegistry
from factory.store import Warehouse

runner = CliRunner()


def test_lease_file_is_created_and_is_exclusive(factory_root):
    reg = LeaseRegistry(factory_root / "leases")
    lease = reg.acquire("job-1", "worker-a")
    assert lease is not None
    assert (factory_root / "leases" / "job-1.json").is_file()
    # A second claim on the same live lease is refused.
    assert reg.acquire("job-1", "worker-b") is None


def test_lease_survives_a_new_registry_instance(factory_root):
    """Simulates a crash: the lease is on disk, not in the dead process."""
    first = LeaseRegistry(factory_root / "leases")
    assert first.acquire("job-1", "worker-a") is not None

    second = LeaseRegistry(factory_root / "leases")
    assert second.held_by("job-1") == "worker-a"
    assert second.acquire("job-1", "worker-b") is None  # still held


def test_expired_lease_is_reclaimed_and_flagged(factory_root):
    reg = LeaseRegistry(factory_root / "leases")
    reg.acquire("job-1", "worker-a", ttl=timedelta(seconds=-1))
    reclaimed = reg.acquire("job-1", "worker-b", ttl=timedelta(minutes=5))
    assert reclaimed is not None
    assert reclaimed.recovered_from_crash is True
    assert reg.held_by("job-1") == "worker-b"


def test_heartbeat_extends_and_requires_the_holder(factory_root):
    reg = LeaseRegistry(factory_root / "leases")
    before = reg.acquire("job-1", "worker-a", ttl=timedelta(seconds=10))
    renewed = reg.heartbeat("job-1", "worker-a", ttl=timedelta(hours=1))
    assert renewed is not None
    assert renewed.expires_at > before.expires_at
    # A non-holder may not renew.
    assert reg.heartbeat("job-1", "worker-b") is None


def test_release_frees_the_lease(factory_root):
    reg = LeaseRegistry(factory_root / "leases")
    reg.acquire("job-1", "a")
    assert reg.release("job-1", "b") is False  # not b's lease
    assert reg.release("job-1", None) is False  # a missing holder is not a wildcard
    assert reg.release("job-1", "a") is True
    assert reg.held_by("job-1") is None
    assert reg.acquire("job-1", "b") is not None


def test_cli_claim_heartbeat_release(tmp_path):
    root = tmp_path / "factory"
    # Create a job so the CLI lease commands have something to claim.
    runner.invoke(app, ["--root", str(root), "job", "create", "--id", "j1",
                        "--target", "business.crm", "--revision", "r1", "--owner", "po"])

    claim = runner.invoke(app, ["--root", str(root), "job", "claim",
                                "--id", "j1", "--holder", "w1"])
    assert claim.exit_code == 0, claim.stdout
    assert json.loads(claim.stdout)["lease"]["holder"] == "w1"

    conflict = runner.invoke(app, ["--root", str(root), "job", "claim",
                                   "--id", "j1", "--holder", "w2"])
    assert conflict.exit_code == 1
    assert json.loads(conflict.stdout)["status"] == "BLOCKED"

    beat = runner.invoke(app, ["--root", str(root), "job", "heartbeat",
                               "--id", "j1", "--holder", "w1"])
    assert beat.exit_code == 0, beat.stdout

    foreign = runner.invoke(app, ["--root", str(root), "job", "release", "--id", "j1",
                                  "--holder", "w2"])
    assert foreign.exit_code != 0  # w2 cannot free w1's job
    release = runner.invoke(app, ["--root", str(root), "job", "release", "--id", "j1",
                                  "--holder", "w1"])
    assert release.exit_code == 0

    reclaim = runner.invoke(app, ["--root", str(root), "job", "claim",
                                  "--id", "j1", "--holder", "w2"])
    assert reclaim.exit_code == 0, reclaim.stdout


def test_api_lease_conflict_is_409(factory_root):
    set_root(factory_root / "factory")
    Warehouse.open(factory_root / "factory")
    client = TestClient(api_app)

    client.post("/jobs", json={"jobId": "j1", "targetId": "t", "catalogRevision": "r", "owner": "po"})
    first = client.post("/jobs/j1/lease", json={"holder": "w1"})
    assert first.status_code == 200
    second = client.post("/jobs/j1/lease", json={"holder": "w2"})
    assert second.status_code == 409
    assert second.json()["status"] == "BLOCKED"

    beat = client.post("/jobs/j1/heartbeat", json={"holder": "w1"})
    assert beat.status_code == 200
    assert client.delete("/jobs/j1/lease", params={"holder": "w2"}).status_code == 409
    assert client.delete("/jobs/j1/lease", params={"holder": "w1"}).status_code == 200
    assert client.post("/jobs/j1/lease", json={"holder": "w2"}).status_code == 200


def test_cli_report_is_stage_counts_not_a_percentage(tmp_path):
    root = tmp_path / "factory"
    runner.invoke(app, ["--root", str(root), "job", "create", "--id", "j1",
                        "--target", "business.crm", "--revision", "r1", "--owner", "po"])
    runner.invoke(app, ["--root", str(root), "job", "transition", "--id", "j1",
                        "--to", "DISCOVERING", "--role", "PRODUCT_OWNER",
                        "--actor", "po", "--reason", "go"])
    result = runner.invoke(app, ["--root", str(root), "job", "report", "--id", "j1"])
    assert result.exit_code == 0, result.stdout
    report = json.loads(result.stdout)
    assert report["state"] == "DISCOVERING"
    assert report["transitions"] == 1
    # Counts and stage facts only — no numeric completion field.
    assert not any("percent" in k.lower() for k in report)


def test_api_report_endpoint(factory_root):
    set_root(factory_root / "factory")
    Warehouse.open(factory_root / "factory")
    client = TestClient(api_app)
    client.post("/jobs", json={"jobId": "j1", "targetId": "t", "catalogRevision": "r", "owner": "po"})
    report = client.get("/jobs/j1/report")
    assert report.status_code == 200
    body = report.json()
    assert body["state"] == "QUEUED"
    assert body["transitions"] == 0
    assert client.get("/jobs/nope/report").status_code == 404
