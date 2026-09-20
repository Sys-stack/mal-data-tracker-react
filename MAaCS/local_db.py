"""Local, fast storage for everything that isn't the hourly MAL snapshot.

SQLite is the fast request-time cache for the seasonal catalog, predictions,
teams/drafts, and planner actions.  cloud_sync.py mirrors this file to
Supabase after writes so the cache can be recreated on a fresh host.
"""

import json
import logging
import os
import sqlite3
from contextlib import contextmanager

logger = logging.getLogger("MAaCS.local_db")

DB_PATH = os.getenv("LOCAL_DB_PATH", "fal_local.db")
ACE_THRESHOLD_DEFAULT = int(os.getenv("ACE_THRESHOLD", "60000"))  # current FAL season's cap

SCHEMA = """
CREATE TABLE IF NOT EXISTS anime_catalog (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    media_type TEXT,
    start_date TEXT,
    end_date TEXT,
    studios TEXT,
    season TEXT,
    year INTEGER,
    image_url TEXT,
    tracked INTEGER NOT NULL DEFAULT 0,
    added_at TEXT DEFAULT (datetime('now')),
    genres TEXT,
    status TEXT,
    num_episodes INTEGER,
    source TEXT,
    rating TEXT,
    broadcast_day TEXT,
    broadcast_time TEXT,
    average_episode_duration INTEGER,
    mal_created_at TEXT,
    mal_updated_at TEXT,
    synopsis TEXT
);

CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anime_id INTEGER NOT NULL,
    metric TEXT NOT NULL,
    baseline REAL NOT NULL DEFAULT 0,
    a REAL NOT NULL DEFAULT 0,
    b REAL NOT NULL DEFAULT 1,
    is_set INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(anime_id, metric)
);

CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    ace_threshold INTEGER NOT NULL DEFAULT {ace_threshold},
    swaps_used INTEGER NOT NULL DEFAULT 0,
    wildcard_used INTEGER NOT NULL DEFAULT 0,
    wildcard_type TEXT,
    wildcard_week INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_members (
    team_id INTEGER NOT NULL,
    anime_id INTEGER NOT NULL,
    slot TEXT NOT NULL DEFAULT 'bench',   -- 'active' | 'bench'
    ace_used INTEGER NOT NULL DEFAULT 0,  -- this anime already spent its one Ace this season
    drafted_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (team_id, anime_id)
);

CREATE TABLE IF NOT EXISTS weekly_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    week INTEGER NOT NULL,
    action_type TEXT NOT NULL,   -- 'swap' | 'ace' | 'wildcard'
    payload TEXT NOT NULL,       -- json
    created_at TEXT DEFAULT (datetime('now'))
);
""".format(ace_threshold=ACE_THRESHOLD_DEFAULT)

# Columns added after the original release -- ALTER TABLE so anyone with an
# existing fal_local.db from before gets them too, instead of needing to
# delete the file.
_MIGRATION_COLUMNS = [
    ("anime_catalog", "genres", "TEXT"),
    ("anime_catalog", "status", "TEXT"),
    ("anime_catalog", "num_episodes", "INTEGER"),
    ("anime_catalog", "source", "TEXT"),
    ("anime_catalog", "rating", "TEXT"),
    ("anime_catalog", "broadcast_day", "TEXT"),
    ("anime_catalog", "broadcast_time", "TEXT"),
    ("anime_catalog", "average_episode_duration", "INTEGER"),
    ("anime_catalog", "mal_created_at", "TEXT"),
    ("anime_catalog", "mal_updated_at", "TEXT"),
    ("anime_catalog", "synopsis", "TEXT"),
]


@contextmanager
def get_conn():
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)) or ".", exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    changes_before = conn.total_changes
    try:
        yield conn
        conn.commit()
        # Mirror only real writes, not the many read-only API calls.  Import
        # lazily to avoid a package-import cycle during application startup.
        if conn.total_changes > changes_before:
            from . import cloud_sync
            cloud_sync.push_from_sqlite(DB_PATH)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def setup_tables():
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        for table, column, coltype in _MIGRATION_COLUMNS:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")
            except sqlite3.OperationalError as exc:
                if "duplicate column" not in str(exc).lower():
                    raise
    logger.info("Local schema ensured at %s (anime_catalog, predictions, teams, team_members, weekly_actions).", DB_PATH)


def _row(r):
    return dict(r) if r is not None else None


def _rows(rs):
    return [dict(r) for r in rs]


# ---------------------------------------------------------------- catalog --

def upsert_catalog_entries(entries: list):
    defaults = {
        "media_type": None, "start_date": None, "end_date": None, "studios": None,
        "season": None, "year": None, "image_url": None, "genres": None, "status": None,
        "num_episodes": None, "source": None, "rating": None, "broadcast_day": None,
        "broadcast_time": None, "average_episode_duration": None, "mal_created_at": None,
        "mal_updated_at": None, "synopsis": None,
    }
    with get_conn() as conn:
        for e in entries:
            row = {**defaults, **e}
            conn.execute(
                """
                INSERT INTO anime_catalog (
                    id, title, media_type, start_date, end_date, studios, season, year, image_url,
                    genres, status, num_episodes, source, rating, broadcast_day, broadcast_time,
                    average_episode_duration, mal_created_at, mal_updated_at, synopsis
                )
                VALUES (
                    :id, :title, :media_type, :start_date, :end_date, :studios, :season, :year, :image_url,
                    :genres, :status, :num_episodes, :source, :rating, :broadcast_day, :broadcast_time,
                    :average_episode_duration, :mal_created_at, :mal_updated_at, :synopsis
                )
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title, media_type=excluded.media_type,
                    start_date=excluded.start_date, end_date=excluded.end_date,
                    studios=excluded.studios, season=excluded.season, year=excluded.year,
                    image_url=COALESCE(excluded.image_url, anime_catalog.image_url),
                    genres=COALESCE(excluded.genres, anime_catalog.genres),
                    status=COALESCE(excluded.status, anime_catalog.status),
                    num_episodes=COALESCE(excluded.num_episodes, anime_catalog.num_episodes),
                    source=COALESCE(excluded.source, anime_catalog.source),
                    rating=COALESCE(excluded.rating, anime_catalog.rating),
                    broadcast_day=COALESCE(excluded.broadcast_day, anime_catalog.broadcast_day),
                    broadcast_time=COALESCE(excluded.broadcast_time, anime_catalog.broadcast_time),
                    average_episode_duration=COALESCE(excluded.average_episode_duration, anime_catalog.average_episode_duration),
                    mal_created_at=COALESCE(excluded.mal_created_at, anime_catalog.mal_created_at),
                    mal_updated_at=COALESCE(excluded.mal_updated_at, anime_catalog.mal_updated_at),
                    synopsis=COALESCE(excluded.synopsis, anime_catalog.synopsis)
                """,
                row,
            )


def set_tracked(anime_id: int, tracked: bool):
    with get_conn() as conn:
        conn.execute("UPDATE anime_catalog SET tracked = ? WHERE id = ?", (1 if tracked else 0, anime_id))


def get_anime(anime_id: int):
    with get_conn() as conn:
        return _row(conn.execute("SELECT * FROM anime_catalog WHERE id = ?", (anime_id,)).fetchone())


def get_teams_for_anime(anime_id: int):
    """Which teams (and in which slot) have drafted this anime -- backs the
    'drafted by' section of the per-anime dashboard."""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT t.id AS team_id, t.name AS team_name, tm.slot, tm.ace_used
            FROM team_members tm JOIN teams t ON t.id = tm.team_id
            WHERE tm.anime_id = ? ORDER BY t.name
            """,
            (anime_id,),
        ).fetchall()
        return _rows(rows)


def list_catalog(season=None, year=None, tracked_only=False):
    query = "SELECT * FROM anime_catalog WHERE 1=1"
    params = []
    if season:
        query += " AND season = ?"
        params.append(season)
    if year:
        query += " AND year = ?"
        params.append(year)
    if tracked_only:
        query += " AND tracked = 1"
    query += " ORDER BY title"
    with get_conn() as conn:
        return _rows(conn.execute(query, params).fetchall())


def list_tracked_ids():
    with get_conn() as conn:
        return [r["id"] for r in conn.execute("SELECT id FROM anime_catalog WHERE tracked = 1").fetchall()]


# ------------------------------------------------------------ predictions --

def get_prediction(anime_id: int, metric: str):
    with get_conn() as conn:
        return _row(conn.execute(
            "SELECT * FROM predictions WHERE anime_id = ? AND metric = ?", (anime_id, metric)
        ).fetchone())


def list_predictions(anime_id: int):
    with get_conn() as conn:
        return _rows(conn.execute("SELECT * FROM predictions WHERE anime_id = ?", (anime_id,)).fetchall())


def get_set_predictions(anime_ids: list):
    """metric -> {anime_id: prediction_row} for every anime given, set predictions only."""
    if not anime_ids:
        return {}
    placeholders = ",".join("?" * len(anime_ids))
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM predictions WHERE is_set = 1 AND anime_id IN ({placeholders})", anime_ids
        ).fetchall()
    out = {}
    for r in rows:
        d = dict(r)
        out.setdefault(d["anime_id"], {})[d["metric"]] = d
    return out


def upsert_prediction(anime_id: int, metric: str, baseline: float, a: float, b: float, is_set: bool = False):
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO predictions (anime_id, metric, baseline, a, b, is_set, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(anime_id, metric) DO UPDATE SET
                baseline=excluded.baseline, a=excluded.a, b=excluded.b,
                is_set=excluded.is_set, updated_at=datetime('now')
            """,
            (anime_id, metric, baseline, a, b, 1 if is_set else 0),
        )


# ----------------------------------------------------------------- teams --

def create_team(name: str, ace_threshold: int = None):
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO teams (name, ace_threshold) VALUES (?, ?)",
            (name, ace_threshold or ACE_THRESHOLD_DEFAULT),
        )
        return _row(conn.execute("SELECT * FROM teams WHERE id = ?", (cur.lastrowid,)).fetchone())


def get_team(team_id: int):
    with get_conn() as conn:
        return _row(conn.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone())


def list_teams():
    with get_conn() as conn:
        return _rows(conn.execute("SELECT * FROM teams ORDER BY created_at DESC").fetchall())


def delete_team(team_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM weekly_actions WHERE team_id = ?", (team_id,))
        conn.execute("DELETE FROM team_members WHERE team_id = ?", (team_id,))
        conn.execute("DELETE FROM teams WHERE id = ?", (team_id,))


def draft_anime(team_id: int, anime_id: int, slot: str = "bench"):
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO team_members (team_id, anime_id, slot) VALUES (?, ?, ?)",
            (team_id, anime_id, slot),
        )


def undraft_anime(team_id: int, anime_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM team_members WHERE team_id = ? AND anime_id = ?", (team_id, anime_id))


def set_slot(team_id: int, anime_id: int, slot: str):
    with get_conn() as conn:
        conn.execute("UPDATE team_members SET slot = ? WHERE team_id = ? AND anime_id = ?", (slot, team_id, anime_id))


def mark_ace_used(team_id: int, anime_id: int):
    with get_conn() as conn:
        conn.execute(
            "UPDATE team_members SET ace_used = 1 WHERE team_id = ? AND anime_id = ?", (team_id, anime_id)
        )


def get_roster(team_id: int):
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT tm.*, a.title, a.image_url, a.media_type, a.studios
            FROM team_members tm JOIN anime_catalog a ON a.id = tm.anime_id
            WHERE tm.team_id = ? ORDER BY tm.slot DESC, a.title
            """,
            (team_id,),
        ).fetchall()
        return _rows(rows)


def get_available_for_draft(team_id: int, season=None, year=None):
    query = """
        SELECT * FROM anime_catalog
        WHERE id NOT IN (SELECT anime_id FROM team_members WHERE team_id = ?)
    """
    params = [team_id]
    if season:
        query += " AND season = ?"
        params.append(season)
    if year:
        query += " AND year = ?"
        params.append(year)
    query += " ORDER BY title"
    with get_conn() as conn:
        return _rows(conn.execute(query, params).fetchall())


def record_swap_used(team_id: int, delta: int = 1):
    with get_conn() as conn:
        conn.execute("UPDATE teams SET swaps_used = swaps_used + ? WHERE id = ?", (delta, team_id))


def set_wildcard(team_id: int, wildcard_type: str, week: int):
    with get_conn() as conn:
        conn.execute(
            "UPDATE teams SET wildcard_used = 1, wildcard_type = ?, wildcard_week = ? WHERE id = ?",
            (wildcard_type, week, team_id),
        )


def add_action(team_id: int, week: int, action_type: str, payload: dict):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO weekly_actions (team_id, week, action_type, payload) VALUES (?, ?, ?, ?)",
            (team_id, week, action_type, json.dumps(payload)),
        )


def list_actions(team_id: int):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM weekly_actions WHERE team_id = ? ORDER BY week, id", (team_id,)
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["payload"] = json.loads(d["payload"])
        out.append(d)
    return out


def delete_action(team_id: int, action_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM weekly_actions WHERE team_id = ? AND id = ?", (team_id, action_id))


def clear_actions(team_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM weekly_actions WHERE team_id = ?", (team_id,))
        conn.execute("UPDATE teams SET swaps_used = 0, wildcard_used = 0, wildcard_type = NULL, wildcard_week = NULL WHERE id = ?", (team_id,))
