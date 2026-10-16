# tests/v1_1_baseline — pristine V1.1 test suite (NOT executed)

This directory contains a **verbatim copy** of the V1.1 test suite:

- `test_factory_policy_v1_1_original.py` — byte-for-byte the file
  `Source/SaaS_AI_Foundation_with_Template_Factory_V1_1/Template_Factory_V1_1/tests/test_factory_policy.py`.

## Why it is not run

The V1.1 suite asserts V1.1 schema behaviour that the ADR-Factory-001 fix
intentionally changes (e.g. it expects `resource-manifest.schema.json` to accept
a `publicationStatus` field, which is now a payload-purity violation; it builds
`evidence` records with `schemaVersion: "1.1"`, which the V1.2 evidence schema
rejects). Running it against V1.2 schemas would therefore fail **by design** and
would be a false negative.

It is kept here so a reader can compare the two suites:

| Suite | Location | Status |
|---|---|---|
| V1.1 original (reference only) | `tests/v1_1_baseline/` + `baseline_v1_1/tests/` | not discovered/run |
| V1.1 adapted to V1.2 schemas | `tests/test_factory_policy.py` | run (19 tests) |
| V1.2 fix suite (new) | `tests/test_v1_2_fixes.py` | run (10 positives + 12 negatives) |

`python3 -m unittest discover -s tests` uses the default pattern `test*.py` and,
on Python 3.10, does not descend into non-package subdirectories, so this
directory is intentionally skipped. The adapted suite in `tests/` preserves every
original V1.1 test's intent; the single meaning-changing adaptation
(`test_l0_manifest_not_publishable` → `test_l0_state_not_publishable`) is because
the L0/publication fields moved off the payload manifest per CF-5.
