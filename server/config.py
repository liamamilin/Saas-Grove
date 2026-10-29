import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAXONOMY_DIR = ROOT / "data" / "taxonomy"
RUNTIME_DIR = Path(os.environ.get("SAAS_RUNTIME_DIR", ROOT / "var"))
WEB_ROOT = ROOT / "web" / "dist"
