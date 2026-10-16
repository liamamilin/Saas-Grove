"""API contract: the HTTP surface must not diverge from the engine."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from factory.api import app, set_root
from factory.store import Warehouse

from conftest import load_example


@pytest.fixture()
def client(factory_root):
    set_root(factory_root / "factory")
    Warehouse.open(factory_root / "factory")
    return TestClient(app)


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["factoryVersion"]


def test_schemas_listed(client):
    body = client.get("/schemas").json()
    assert body["count"] == 15


def test_transitions_exposed(client):
    body = client.get("/transitions").json()
    rows = body["transitions"]
    assert len(rows) >= 26
    publish = [r for r in rows if r["to"] == "PUBLISHING" and r["from"] == "AWAITING_RELEASE_APPROVAL"][0]
    assert publish["roles"] == ["RELEASE_APPROVER"]


def test_catalog_validate_ok(client, repo_examples):
    resp = client.post("/catalog/validate", json={"catalog": load_example("production_catalog")})
    assert resp.status_code == 200
    assert resp.json()["status"] == "OK"


def test_blocked_request_is_409_not_500(client, repo_examples):
    """A refusal is a domain answer, not a server fault."""
    catalog = load_example("production_catalog")
    catalog["targets"][0]["id"] = 12345  # invalid type
    resp = client.post("/catalog/validate", json={"catalog": catalog})
    assert resp.status_code == 409
    body = resp.json()
    assert body["status"] == "BLOCKED"
    assert body["reasons"]
    assert "not a" in body["note"].lower()


def test_job_lifecycle_over_http(client):
    created = client.post(
        "/jobs",
        json={
            "jobId": "j1",
            "targetId": "business.crm",
            "catalogRevision": "r1",
            "owner": "po",
        },
    )
    assert created.status_code == 200
    assert created.json()["data"]["job"]["state"] == "QUEUED"

    moved = client.post(
        "/jobs/j1/transition",
        json={"to": "DISCOVERING", "role": "PRODUCT_OWNER", "actor": "po", "reason": "go"},
    )
    assert moved.status_code == 200

    refused = client.post(
        "/jobs/j1/transition",
        json={"to": "EVALUATING", "role": "BUILDER_AGENT", "actor": "b", "reason": "bad"},
    )
    assert refused.status_code == 409

    history = client.get("/jobs/j1/history").json()
    assert history["count"] == 1  # the refusal was not recorded as a transition


def test_unknown_job_is_404(client):
    assert client.get("/jobs/nope").status_code == 404


def test_install_check_reports_without_500(client, publishing):
    ctx = publishing
    registered = client.post(
        "/registry/register",
        json={
            "state": ctx["state"],
            "freeze": ctx["freeze"],
            "actor": "ra",
            "role": "RELEASE_APPROVER",
            "jobId": ctx["jobId"],
        },
    )
    assert registered.status_code == 200, registered.text
    resp = client.get(f"/registry/{ctx['state']['resourceId']}/{ctx['state']['resourceVersion']}/install-check")
    assert resp.status_code == 200
    assert resp.json()["status"] == "OK"


def test_unknown_schema_is_404(client):
    assert client.get("/schemas/does-not-exist").status_code == 404


def test_ui_is_served_and_is_read_only(client):
    """P9: the console is served, carries the honesty note, and has no release verb."""
    resp = client.get("/ui/")
    assert resp.status_code == 200
    body = resp.text
    assert "read-only" in body.lower()
    assert "not a commercial certification" in body
    # No write endpoints are wired into the UI.
    assert "/registry/register" not in body
