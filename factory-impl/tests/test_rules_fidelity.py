"""Port fidelity: the rules layer must agree with the approved v1.2 engine.

The v1.2 reference engine (`factory-v1.2/scripts/factory_rules.py`) is the
approved behavioral baseline. If this port ever diverges, the port is wrong.
These tests import both and compare on the shipped examples.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from factory.rules import policy as mine

REPO = Path(__file__).resolve().parents[2]
REFERENCE = REPO / "factory-v1.2" / "scripts" / "factory_rules.py"
EXAMPLES = REPO / "factory-v1.2" / "examples"


def _load_reference():
    spec = importlib.util.spec_from_file_location("v12_reference_rules", REFERENCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def reference():
    if not REFERENCE.is_file():
        pytest.skip("approved v1.2 reference engine not present")
    return _load_reference()


def _example(name: str) -> dict:
    import json

    return json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))


# (function name, example arguments) — arguments are resolved lazily below.
CASES = [
    ("verify_payload_purity", ("resource_manifest",)),
    ("check_batch_plan", ("batch_plan",)),
    ("check_use_policy", ("deployment_eligibility_decision", "resource_state")),
    ("check_installable", ("resource_state",)),
    ("check_origin_strategy", ("resource_manifest",)),
    ("check_state_transition", ("state_transition",)),
    ("check_catalog_dependency_gating", ("production_catalog", "batch_plan")),
]


@pytest.mark.parametrize("func,arg_names", CASES)
def test_port_matches_reference(reference, func, arg_names):
    args = [_example(n) for n in arg_names]
    expected = sorted(getattr(reference, func)(*args))
    actual = sorted(getattr(mine, func)(*args))
    assert actual == expected, f"{func} diverged from the approved engine"


def test_digest_chain_matches_reference(reference):
    freeze = _example("artifact_freeze")
    state = _example("resource_state")
    assert sorted(mine.verify_digest_chain(freeze, state)) == sorted(
        reference.verify_digest_chain(freeze, state)
    )


def test_forbidden_payload_keys_are_identical(reference):
    assert set(mine.FORBIDDEN_PAYLOAD_KEYS) == set(reference.FORBIDDEN_PAYLOAD_KEYS)


def test_payload_purity_catches_every_forbidden_key(frozen):
    """CF-5: no certification field may survive inside a payload manifest."""
    for key in mine.FORBIDDEN_PAYLOAD_KEYS:
        impure = {**frozen["manifest"], key: "anything"}
        reasons = mine.verify_payload_purity(impure)
        assert any(key in r for r in reasons), f"{key} not caught"
