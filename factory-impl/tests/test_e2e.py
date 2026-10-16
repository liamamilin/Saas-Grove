"""End-to-end (P10): the whole pipeline through the real CLI and HTTP API.

These tests drive the *actual* entry points (typer app and TestClient), not the
engine directly, so they catch wiring mistakes the unit tests cannot. The last
assertion of each is the honesty boundary: the final state is a work state
(`VALIDATING`), never a release, and no response claims certification.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from typer.testing import CliRunner

from factory.api import app as api_app, set_root
from factory.cli import app as cli_app
from factory.store import Warehouse

runner = CliRunner()


def _payload(root):
    root.mkdir(parents=True)
    (root / "src").mkdir()
    (root / "README.md").write_text("# candidate resource\n", encoding="utf-8")
    (root / "src" / "index.ts").write_text("export const version = 1;\n", encoding="utf-8")
    return root


def test_cli_full_pipeline_reaches_validating(tmp_path, repo_examples):
    root = tmp_path / "factory"
    payload = _payload(tmp_path / "payload")

    def run(*args):
        return runner.invoke(cli_app, ["--root", str(root), *args])

    assert run("init").exit_code == 0
    assert run("job", "create", "--id", "j1", "--target", "business.crm",
               "--revision", "r1", "--risk", "SANDBOX_CODE", "--owner", "po").exit_code == 0

    steps = [
        ("DISCOVERING", "PRODUCT_OWNER", None),
        ("EVALUATING", "DISCOVERY_AGENT", None),
        ("AWAITING_SELECTION", "DISCOVERY_AGENT", None),
        ("PLAN_APPROVED", "PRODUCT_OWNER", "SECURITY_LICENSE_REVIEWER:sec-reviewer"),
        ("TRANSFORMING", "BUILDER_AGENT", None),
        ("CALIBRATING", "BUILDER_AGENT", None),
        ("STAGING_ARTIFACT", "BUILDER_AGENT", "SECURITY_LICENSE_REVIEWER:sec-reviewer"),
    ]
    for state, role, cosigner in steps:
        args = ["job", "transition", "--id", "j1", "--to", state, "--role", role,
                "--actor", role.lower(), "--reason", "step"]
        if cosigner:
            args += ["--cosigner", cosigner]
        result = run(*args)
        assert result.exit_code == 0, (state, result.stdout)

    frozen = run("freeze", "--id", "business.crm", "--version", "1.0.0",
                 "--manifest", str(repo_examples / "resource_manifest.json"),
                 "--payload", str(payload), "--by", "b",
                 "--job-id", "j1", "--attempt-id", "j1-a1")
    assert frozen.exit_code == 0, frozen.stdout

    moved = run("job", "transition", "--id", "j1", "--to", "VALIDATING",
                "--role", "BUILDER_AGENT", "--actor", "b", "--reason", "frozen")
    assert moved.exit_code == 0, moved.stdout

    import json

    job = json.loads(run("job", "show", "j1").stdout)
    assert job["state"] == "VALIDATING"
    assert job["attemptId"] == "j1-a1"


def test_cli_freeze_bound_to_wrong_attempt_blocks_validating(tmp_path, repo_examples):
    root = tmp_path / "factory"
    payload = _payload(tmp_path / "payload")

    def run(*args):
        return runner.invoke(cli_app, ["--root", str(root), *args])

    run("init")
    run("job", "create", "--id", "j1", "--target", "business.crm",
        "--revision", "r1", "--risk", "SANDBOX_CODE", "--owner", "po")
    for state, role, cosigner in [
        ("DISCOVERING", "PRODUCT_OWNER", None),
        ("EVALUATING", "DISCOVERY_AGENT", None),
        ("AWAITING_SELECTION", "DISCOVERY_AGENT", None),
        ("PLAN_APPROVED", "PRODUCT_OWNER", "SECURITY_LICENSE_REVIEWER:sec-reviewer"),
        ("TRANSFORMING", "BUILDER_AGENT", None),
        ("CALIBRATING", "BUILDER_AGENT", None),
        ("STAGING_ARTIFACT", "BUILDER_AGENT", "SECURITY_LICENSE_REVIEWER:sec-reviewer"),
    ]:
        args = ["job", "transition", "--id", "j1", "--to", state, "--role", role,
                "--actor", role.lower(), "--reason", "step"]
        if cosigner:
            args += ["--cosigner", cosigner]
        run(*args)

    # Freeze bound to a *different* attempt than the job's current one.
    run("freeze", "--id", "business.crm", "--version", "1.0.0",
        "--manifest", str(repo_examples / "resource_manifest.json"),
        "--payload", str(payload), "--by", "b",
        "--job-id", "j1", "--attempt-id", "j1-a9")

    refused = run("job", "transition", "--id", "j1", "--to", "VALIDATING",
                  "--role", "BUILDER_AGENT", "--actor", "b", "--reason", "stale")
    assert refused.exit_code == 1
    import json

    assert json.loads(refused.stdout)["status"] == "BLOCKED"


def test_api_full_pipeline_reaches_validating(tmp_path, repo_examples):
    root = tmp_path / "factory"
    payload = _payload(tmp_path / "payload")
    set_root(root)
    Warehouse.open(root)
    client = TestClient(api_app)

    created = client.post("/jobs", json={
        "jobId": "j1", "targetId": "business.crm", "catalogRevision": "r1",
        "riskClass": "SANDBOX_CODE", "owner": "po",
    })
    assert created.status_code == 200

    steps = [
        ("DISCOVERING", "PRODUCT_OWNER", []),
        ("EVALUATING", "DISCOVERY_AGENT", []),
        ("AWAITING_SELECTION", "DISCOVERY_AGENT", []),
        ("PLAN_APPROVED", "PRODUCT_OWNER", ["SECURITY_LICENSE_REVIEWER:sec-reviewer"]),
        ("TRANSFORMING", "BUILDER_AGENT", []),
        ("CALIBRATING", "BUILDER_AGENT", []),
        ("STAGING_ARTIFACT", "BUILDER_AGENT", ["SECURITY_LICENSE_REVIEWER:sec-reviewer"]),
    ]
    for state, role, cosigners in steps:
        resp = client.post("/jobs/j1/transition", json={
            "to": state, "role": role, "actor": role.lower(), "reason": "step",
            "cosigners": cosigners,
        })
        assert resp.status_code == 200, (state, resp.text)

    frozen = client.post("/artifacts/freeze", json={
        "resourceId": "business.crm", "resourceVersion": "1.0.0",
        "manifest": __import__("json").loads(
            (repo_examples / "resource_manifest.json").read_text(encoding="utf-8")
        ),
        "payloadRoot": str(payload), "frozenBy": "b",
        "jobId": "j1", "attemptId": "j1-a1",
    })
    assert frozen.status_code == 200, frozen.text

    moved = client.post("/jobs/j1/transition", json={
        "to": "VALIDATING", "role": "BUILDER_AGENT", "actor": "b", "reason": "frozen",
    })
    assert moved.status_code == 200, moved.text
    # The response carries the honesty boundary.
    assert "not a" in moved.json()["note"].lower()
    assert client.get("/jobs/j1").json()["state"] == "VALIDATING"


def _fresh_times(ctx):
    """The CLI evaluates against the real clock, so re-date the synthetic chain."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    ctx["attestation"].update(issuedAt=(now - timedelta(hours=1)).isoformat(),
                              expiresAt=(now + timedelta(days=1)).isoformat())
    for ev in ctx["evidences"]:
        ev.update(collectedAt=(now - timedelta(minutes=30)).isoformat(),
                  expiresAt=(now + timedelta(days=1)).isoformat())
    return ctx


def test_cli_full_pipeline_reaches_registered(tmp_path, repo_examples):
    """freeze -> VALIDATING -> attest (bound to the job) -> release approval
    -> PUBLISHING -> register -> REGISTERED, all through the real CLI."""
    import json

    from conftest import attestation_for

    root = tmp_path / "factory"
    payload = _payload(tmp_path / "payload")
    files = tmp_path / "records"
    files.mkdir()

    def run(*args):
        return runner.invoke(cli_app, ["--root", str(root), *args])

    def write(name, obj):
        path = files / f"{name}.json"
        path.write_text(json.dumps(obj), encoding="utf-8")
        return str(path)

    assert run("job", "create", "--id", "j1", "--target", "business.crm", "--revision", "r1",
               "--risk", "SANDBOX_CODE", "--owner", "po").exit_code == 0
    for state, role, cosigner in [
        ("DISCOVERING", "PRODUCT_OWNER", None),
        ("EVALUATING", "DISCOVERY_AGENT", None),
        ("AWAITING_SELECTION", "DISCOVERY_AGENT", None),
        ("PLAN_APPROVED", "PRODUCT_OWNER", "SECURITY_LICENSE_REVIEWER:sec-reviewer"),
        ("TRANSFORMING", "BUILDER_AGENT", None),
        ("CALIBRATING", "BUILDER_AGENT", None),
        ("STAGING_ARTIFACT", "BUILDER_AGENT", "SECURITY_LICENSE_REVIEWER:sec-reviewer"),
    ]:
        args = ["job", "transition", "--id", "j1", "--to", state, "--role", role,
                "--actor", role.lower(), "--reason", "step"]
        if cosigner:
            args += ["--cosigner", cosigner]
        assert run(*args).exit_code == 0, state

    frozen = run("freeze", "--id", "business.crm", "--version", "1.0.0",
                 "--manifest", str(repo_examples / "resource_manifest.json"),
                 "--payload", str(payload), "--by", "b", "--job-id", "j1")
    assert frozen.exit_code == 0, frozen.stdout
    freeze = json.loads(frozen.stdout)["data"]["freeze"]
    assert run("job", "transition", "--id", "j1", "--to", "VALIDATING", "--role",
               "BUILDER_AGENT", "--actor", "b", "--reason", "frozen").exit_code == 0

    # Release approval is refused until an attestation is evaluated for this job.
    early = run("job", "transition", "--id", "j1", "--to", "AWAITING_RELEASE_APPROVAL",
                "--role", "VALIDATOR", "--actor", "v", "--reason", "too soon")
    assert early.exit_code == 1

    ctx = _fresh_times(attestation_for(freeze))
    evidence_args = []
    for ev in ctx["evidences"]:
        evidence_args += ["--evidence", write(ev["id"], ev)]
    attested = run("attest", write("attestation", ctx["attestation"]), write("profile", ctx["profile"]),
                   *evidence_args, "--freeze", write("freeze", freeze),
                   "--state", write("state", ctx["state"]), "--job-id", "j1")
    assert attested.exit_code == 0, attested.stdout

    for to, role, actor in [("AWAITING_RELEASE_APPROVAL", "VALIDATOR", "v"),
                            ("PUBLISHING", "RELEASE_APPROVER", "ra")]:
        moved = run("job", "transition", "--id", "j1", "--to", to, "--role", role,
                    "--actor", actor, "--reason", "release")
        assert moved.exit_code == 0, (to, moved.stdout)

    registered = run("registry", "register", "--state", write("state", ctx["state"]),
                     "--freeze", write("freeze", freeze), "--actor", "ra",
                     "--role", "RELEASE_APPROVER", "--job-id", "j1")
    assert registered.exit_code == 0, registered.stdout
    done = run("job", "transition", "--id", "j1", "--to", "REGISTERED", "--role",
               "RELEASE_APPROVER", "--actor", "ra", "--reason", "published")
    assert done.exit_code == 0, done.stdout
    assert json.loads(run("job", "show", "j1").stdout)["state"] == "REGISTERED"
    # The honesty boundary rides on every result.
    assert "not a commercial certification" in json.loads(registered.stdout)["note"]


def test_cli_and_api_batch_round_trip(tmp_path, repo_examples):
    """Start a READ_ONLY batch by CLI, work one job, report it over HTTP."""
    import json

    root = tmp_path / "factory"
    batch = json.loads((repo_examples / "batch_plan.json").read_text(encoding="utf-8"))
    batch["dryRun"] = False
    batch_file = tmp_path / "batch.json"
    batch_file.write_text(json.dumps(batch), encoding="utf-8")

    def run(*args):
        return runner.invoke(cli_app, ["--root", str(root), *args])

    preview = run("batch", "start", str(repo_examples / "production_catalog.json"),
                  str(repo_examples / "batch_plan.json"), "--actor", "po", "--role", "PRODUCT_OWNER")
    assert preview.exit_code == 0 and json.loads(preview.stdout)["data"]["dryRun"] is True
    started = run("batch", "start", str(repo_examples / "production_catalog.json"),
                  str(batch_file), "--actor", "po", "--role", "PRODUCT_OWNER")
    assert started.exit_code == 0, started.stdout

    claim = json.loads(run("batch", "claim", "--batch-id", batch["batchId"],
                           "--holder", "w1").stdout)
    job_id = claim["data"]["job"]["jobId"]
    for to, role in [("DISCOVERING", "PRODUCT_OWNER"), ("EVALUATING", "DISCOVERY_AGENT"),
                     ("AWAITING_SELECTION", "DISCOVERY_AGENT")]:
        assert run("job", "transition", "--id", job_id, "--to", to, "--role", role,
                   "--actor", role.lower(), "--reason", "work", "--holder", "w1").exit_code == 0

    set_root(root)
    client = TestClient(api_app)
    report = client.post(f"/batches/{batch['batchId']}/report",
                         json={"jobId": job_id, "holder": "w1", "usd": 0, "outcome": "ok"})
    assert report.status_code == 200, report.text
    status = client.get(f"/batches/{batch['batchId']}").json()["data"]["batch"]
    assert status["counts"] == {"DONE": 1, "READY": 2}
    assert client.get("/batches").json()["count"] == 1
