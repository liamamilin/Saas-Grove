#!/usr/bin/env python3
"""Generate factory-v1.2/FILE_MANIFEST.json (CF-8 canonical 'path' key convention).

Hash only. This proves nothing about correctness, licensing or security of the
listed files; it only records their bytes and sha256 at generation time.
"""
import hashlib
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {'__pycache__', '.git'}
SKIP_FILES = {'FILE_MANIFEST.json', '.DS_Store', '_run.log'}


def digest(path):
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def main():
    files = []
    for path in sorted(ROOT.rglob('*')):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if rel.name in SKIP_FILES:
            continue
        files.append({
            'path': str(rel),
            'bytes': path.stat().st_size,
            'sha256': digest(path),
        })
    manifest = {
        'release': 'Template Factory V1.2 patch bundle',
        'status': 'PROPOSED specification fix bundle; not implemented software; no commercial certification',
        'generatedOn': date.today().isoformat(),
        'hashAlgorithm': 'sha256',
        'files': files,
    }
    out = ROOT / 'FILE_MANIFEST.json'
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'wrote {out} with {len(files)} files')


if __name__ == '__main__':
    main()
