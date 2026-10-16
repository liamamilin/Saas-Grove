"""Content hashing for the freeze/digest chain.

Doc 17 requires the payload to be frozen *before* validation, with its digest
computed from content. This module is the only place a digest is produced, so
the chain's meaning is auditable.

Two digests matter:

* ``payload_manifest_sha256`` — of the canonicalised manifest payload view.
* ``artifact_sha256`` — of the full payload (every file, path + bytes).

Canonicalisation is deterministic (sorted keys, no whitespace variance) so the
same logical content always yields the same digest. Values that are placeholders
(``UNBUILT``, ``NOT_RUN``, ``UNSELECTED``, ``NOT_AVAILABLE``) are never hashed as
if they were real content — calling ``freeze`` on a placeholder is refused.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable, Mapping

# Placeholders from the spec's example data (schemas/README: "刻意使用的演示占位值").
PLACEHOLDERS = frozenset(
    {"UNBUILT", "NOT_RUN", "UNSELECTED", "NOT_AVAILABLE", "UNKNOWN", ""}
)

# Bumped only if the canonicalisation changes; recorded alongside each digest so
# an old digest can be reproduced and never silently reinterpreted.
CANONICALISATION = "factory-digest/1"


class UnhashableContent(ValueError):
    """Raised when asked to freeze placeholder rather than real content."""


def canonical_bytes(obj: Any) -> bytes:
    """Deterministic serialization of a JSON-compatible object."""
    return json.dumps(
        obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hash_object(obj: Any) -> str:
    return sha256_hex(canonical_bytes(obj))


def hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def build_file_list(root: Path, *, exclude: Iterable[str] = ()) -> list[dict[str, Any]]:
    """Hash every regular file under ``root`` into a stable, ordered list.

    ``exclude`` holds path prefixes to skip (e.g. scratch dirs). The list is
    sorted by relative path so the same tree always yields the same list, and
    thus the same artifact digest.
    """
    root = Path(root)
    skip = tuple(exclude)
    files: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if skip and rel.startswith(skip):
            continue
        if path.name.startswith(".tmp-"):
            continue
        files.append(
            {"path": rel, "sha256": hash_file(path), "bytes": path.stat().st_size}
        )
    return files


def artifact_digest_from_files(files: list[dict[str, Any]]) -> str:
    """The artifact digest is the hash of the (path, digest) pairs, not raw bytes.

    This keeps the digest independent of file ordering on disk while still
    covering every byte of every file via its individual hash.
    """
    return hash_object(
        [{"path": f["path"], "sha256": f["sha256"]} for f in files]
    )


def payload_manifest_digest(manifest: Mapping[str, Any]) -> str:
    """Digest of the payload manifest view, after purity is enforced elsewhere."""
    return hash_object(dict(manifest))


def assert_real_content(*values: str) -> None:
    """Refuse to freeze placeholder content as if it were an artifact."""
    bad = [v for v in values if v in PLACEHOLDERS]
    if bad:
        raise UnhashableContent(
            f"refusing to freeze placeholder content {bad}: a real payload "
            "must be built before it can be frozen"
        )
