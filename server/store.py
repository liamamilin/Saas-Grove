"""Local application identities and independent open-source/commercial lists."""
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

from .config import RUNTIME_DIR

TRACKS = {"open_source", "commercial"}


class Store:
    def __init__(self, path=None):
        self.path = Path(path or RUNTIME_DIR / "catalog.sqlite")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as con:
            con.execute("PRAGMA journal_mode=WAL")
            con.executescript("""
                CREATE TABLE IF NOT EXISTS application (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS application_track (
                  app_id TEXT NOT NULL REFERENCES application(id), track TEXT NOT NULL,
                  PRIMARY KEY(app_id,track), CHECK(track IN ('open_source','commercial')));
                CREATE TABLE IF NOT EXISTS leaf_application (
                  leaf TEXT NOT NULL, app_id TEXT NOT NULL REFERENCES application(id), PRIMARY KEY(leaf,app_id));
            """)

    @contextmanager
    def connect(self):
        con = sqlite3.connect(self.path, timeout=10)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys=ON")
        try:
            with con:
                yield con
        finally:
            con.close()

    def save(self, app, leaves, tracks):
        """Internal import boundary; no public write endpoint is exposed in M1."""
        if not app.get("id") or not app.get("name") or not leaves or not tracks or set(tracks) - TRACKS:
            raise ValueError("应用身份、叶子或分区无效")
        for field in ("homepage", "repository_url", "source_url"):
            if app.get(field) and urlparse(app[field]).scheme not in {"http", "https"}:
                raise ValueError("应用链接必须为 HTTP(S)")
        with self.connect() as con:
            con.execute("INSERT INTO application VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,data=excluded.data",
                        (app["id"], app["name"], json.dumps(app, ensure_ascii=False)))
            con.execute("DELETE FROM application_track WHERE app_id=?", (app["id"],))
            con.execute("DELETE FROM leaf_application WHERE app_id=?", (app["id"],))
            con.executemany("INSERT INTO application_track VALUES (?,?)", [(app["id"], t) for t in sorted(set(tracks))])
            con.executemany("INSERT INTO leaf_application VALUES (?,?)", [(leaf, app["id"]) for leaf in sorted(set(leaves))])

    def counts(self):
        counts = {}
        with self.connect() as con:
            for row in con.execute("SELECT l.leaf,t.track,COUNT(*) AS count FROM leaf_application l JOIN application_track t ON t.app_id=l.app_id GROUP BY l.leaf,t.track"):
                counts.setdefault(row["leaf"], {"open_source": 0, "commercial": 0})[row["track"]] = row["count"]
            totals = {r["track"]: r["count"] for r in con.execute("SELECT track,COUNT(*) AS count FROM application_track GROUP BY track")}
        return counts, {t: totals.get(t, 0) for t in sorted(TRACKS)}

    def applications(self, leaf, track="open_source", query=""):
        if track not in TRACKS:
            raise ValueError("未知的应用分区")
        with self.connect() as con:
            records = [json.loads(row[0]) for row in con.execute("""
                SELECT a.data FROM application a JOIN application_track t ON t.app_id=a.id
                JOIN leaf_application l ON l.app_id=a.id WHERE l.leaf=? AND t.track=? ORDER BY a.name,a.id
            """, (leaf, track))]
        words = query.casefold().split()
        records = [r for r in records if all(w in (r["name"] + " " + r.get("summary", "")).casefold() for w in words)]
        return {"leaf": leaf, "track": track, "applications": records, "total": len(records)}
