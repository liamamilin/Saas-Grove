"""CLI contract: a BLOCKED operation exits non-zero and prints the reasons.

The exit code is the interface. Scripts must be able to detect a refusal
without parsing prose, so this is asserted rather than assumed.
"""

from __future__ import annotations

import json

import pytest
from typer.testing import CliRunner

from factory.cli import app

runner = CliRunner()


@pytest.fixture()
def root(tmp_path):
    return tmp_path / "factory"


def _run(*args, **kwargs):
    return runner.invoke(app, ["--root", str(kwargs["root"]), *args])


def test_init_creates_warehouses(root):
    result = _run("init", root=root)
    assert result.exit_code == 0
    assert (root / "candidate").is_dir()
    assert (root / "workspace").is_dir()
    assert (root / "registry").is_dir()


def test_doctor_reports_version_and_schema_count(root):
    result = _run("doctor", root=root)
    assert result.exit_code == 0
    info = json.loads(result.stdout)
    assert info["factoryVersion"]
    assert info["schemas"] == 15


def test_schema_check_passes(root):
    result = _run("schema", "check", root=root)
    assert result.exit_code == 0
    assert json.loads(result.stdout)["status"] == "OK"


def test_schema_list(root):
    result = _run("schema", "list", root=root)
    assert result.exit_code == 0
    assert "production-job" in result.stdout


def test_catalog_validate_exit_zero(root, repo_examples):
    result = _run("catalog-validate", str(repo_examples / "production_catalog.json"), root=root)
    assert result.exit_code == 0, result.stdout
    assert json.loads(result.stdout)["status"] == "OK"


def test_batch_validate_exit_zero(root, repo_examples):
    result = _run(
        "batch-validate",
        str(repo_examples / "production_catalog.json"),
        str(repo_examples / "batch_plan.json"),
        root=root,
    )
    assert result.exit_code == 0, result.stdout


def test_blocked_operation_exits_nonzero(root):
    """A wrong role is a refusal, and a refusal is a non-zero exit."""
    _run("job", "create", "--id", "j1", "--target", "business.crm",
         "--revision", "r1", "--owner", "po", root=root)
    _run("job", "transition", "--id", "j1", "--to", "DISCOVERING",
         "--role", "PRODUCT_OWNER", "--actor", "po", "--reason", "go", root=root)
    result = _run("job", "transition", "--id", "j1", "--to", "EVALUATING",
                  "--role", "BUILDER_AGENT", "--actor", "b", "--reason", "bad", root=root)
    assert result.exit_code == 1
    payload = json.loads(result.stdout)
    assert payload["status"] == "BLOCKED"
    assert payload["reasons"]
    # Every result carries the honesty boundary.
    assert "not a" in payload["note"].lower()


def test_install_check_does_not_fail_on_blocked(root):
    """install-check reports; it does not raise, because the answer is the point."""
    result = _run("registry", "install-check", "--id", "nope", "--version", "1", root=root)
    assert result.exit_code == 1  # unknown resource still exits 1
    assert json.loads(result.stdout)["status"] == "BLOCKED"
