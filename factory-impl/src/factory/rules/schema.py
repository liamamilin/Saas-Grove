"""JSON Schema loading and validation.

The factory ships its own copy of the v1.2 schemas so it can run standalone.
The normative originals live in ``factory-v1.2/schemas``; the copy's hashes are
recorded in ``docs/SCHEMA_PROVENANCE.md``. If the two ever diverge, this copy is
the bug — the specification is the source of truth.

Honesty note: "schema-valid" means the object has the declared shape. It is not
evidence of a build, a license decision, a signature, or a security result.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

# factory-impl/schemas — resolved from this file's location, not the CWD.
SCHEMA_DIR = Path(__file__).resolve().parents[3] / "schemas"


class SchemaNotFound(LookupError):
    """Raised when a named schema is not present in the schema directory."""


@lru_cache(maxsize=None)
def load_schema(name: str) -> dict[str, Any]:
    """Load a schema by file name or bare stem.

    ``load_schema("production-job")`` and ``load_schema("production-job.schema.json")``
    are equivalent.
    """
    filename = name if name.endswith(".json") else f"{name}.schema.json"
    path = SCHEMA_DIR / filename
    if not path.is_file():
        raise SchemaNotFound(f"no schema {filename!r} in {SCHEMA_DIR}")
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def _validator(name: str) -> Draft202012Validator:
    schema = load_schema(name)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def validate(data: Any, schema_name: str) -> list[str]:
    """Return a list of schema violations. Empty list means the shape is valid.

    Errors are returned as ``"schema: ['/path', 0] message"`` so callers can
    surface them without depending on jsonschema's error type.
    """
    errors = _validator(schema_name).iter_errors(data)
    return [f"schema: {list(e.path)} {e.message}" for e in errors]


def is_valid(data: Any, schema_name: str) -> bool:
    return not validate(data, schema_name)


def available_schemas() -> list[str]:
    """Every schema shipped with this build, sorted."""
    return sorted(p.stem.replace(".schema", "") for p in SCHEMA_DIR.glob("*.schema.json"))
