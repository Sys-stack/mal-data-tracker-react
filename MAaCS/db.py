"""Postgres (Supabase) layer for hourly snapshots and durable local-state backups.

The catalog, predictions, teams, and planner actions still use SQLite for
instant request-time reads/writes. cloud_sync.py stores an atomic backup of
that cache here so stateless deployments can restore it.
"""

import logging
from contextlib import contextmanager

import psycopg2
import psycopg2.extras

from . import DB_CONFIG, DATABASE_URL

logger = logging.getLogger("MAaCS.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS growth_snapshots (
    id SERIAL PRIMARY KEY,
    anime_id INTEGER NOT NULL,
    watching INTEGER DEFAULT 0,
    plan_to_watch INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    on_hold INTEGER DEFAULT 0,
    dropped INTEGER DEFAULT 0,
    num_list_users INTEGER DEFAULT 0,
    score REAL,
    favorites INTEGER DEFAULT 0,
    num_scoring_users INTEGER DEFAULT 0,
    snapshot_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_anime_time ON growth_snapshots (anime_id, snapshot_at);

-- Added after the original release. Postgres supports IF NOT EXISTS on
-- ADD COLUMN directly, so this is a safe no-op on a table that already has
-- these columns.
ALTER TABLE growth_snapshots ADD COLUMN IF NOT EXISTS rank INTEGER;
ALTER TABLE growth_snapshots ADD COLUMN IF NOT EXISTS popularity INTEGER;

-- Earlier deployments stored catalog rows in a Postgres `anime` table and
-- constrained snapshots to it.  The catalog now lives in the mirrored local
-- SQLite state (`anime_catalog`), so that legacy constraint rejects valid
-- snapshots from newly tracked shows.  Keep this migration idempotent for
-- both fresh databases and existing deployments.
ALTER TABLE growth_snapshots DROP CONSTRAINT IF EXISTS growth_snapshots_anime_id_fkey;

-- A complete, JSONB mirror of fal_local.db.  Keeping this as one atomic
-- document prevents an interrupted deployment from leaving a partial team.
CREATE TABLE IF NOT EXISTS local_state_backups (
    key TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


@contextmanager
def get_connection():
    conn = psycopg2.connect(DATABASE_URL) if DATABASE_URL else psycopg2.connect(**DB_CONFIG)
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def get_cursor(commit=False):
    with get_connection() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield cur
            if commit:
                conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()


def setup_tables():
    with get_cursor(commit=True) as cur:
        cur.execute(SCHEMA)
    logger.info("Postgres schema ensured (growth_snapshots only).")


def insert_snapshot(snapshot: dict):
    with get_cursor(commit=True) as cur:
        cur.execute(
            """
            INSERT INTO growth_snapshots
                (anime_id, watching, plan_to_watch, completed, on_hold, dropped,
                 num_list_users, score, favorites, num_scoring_users, rank, popularity, snapshot_at)
            VALUES
                (%(anime_id)s, %(watching)s, %(plan_to_watch)s, %(completed)s, %(on_hold)s, %(dropped)s,
                 %(num_list_users)s, %(score)s, %(favorites)s, %(num_scoring_users)s,
                 %(rank)s, %(popularity)s, %(snapshot_at)s)
            """,
            {**snapshot, "rank": snapshot.get("rank"), "popularity": snapshot.get("popularity")},
        )


def get_growth(anime_id, start=None, end=None):
    query = "SELECT * FROM growth_snapshots WHERE anime_id = %s"
    params = [anime_id]
    if start:
        query += " AND snapshot_at >= %s"
        params.append(start)
    if end:
        query += " AND snapshot_at <= %s"
        params.append(end)
    query += " ORDER BY snapshot_at ASC"
    with get_cursor() as cur:
        cur.execute(query, params)
        return cur.fetchall()


def get_latest_snapshot(anime_id):
    with get_cursor() as cur:
        cur.execute(
            "SELECT * FROM growth_snapshots WHERE anime_id = %s ORDER BY snapshot_at DESC LIMIT 1",
            (anime_id,),
        )
        return cur.fetchone()


def get_latest_snapshots_bulk(anime_ids):
    """{anime_id: latest_row} for every id given -- one query instead of N,
    since this backs the dashboard's list view."""
    if not anime_ids:
        return {}
    with get_cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (anime_id) *
            FROM growth_snapshots
            WHERE anime_id = ANY(%s)
            ORDER BY anime_id, snapshot_at DESC
            """,
            (list(anime_ids),),
        )
        return {row["anime_id"]: row for row in cur.fetchall()}
