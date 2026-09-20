"""Durable Supabase mirror for the SQLite application state.

SQLite remains the fast request-time store.  This module restores it on a
new instance and atomically uploads it after each successful write, which is
safe for short-lived web-service containers and GitHub Action runners.
"""

import json
import logging
import os
import sqlite3

import psycopg2.extras

from . import DATABASE_URL, DB_CONFIG

logger = logging.getLogger("MAaCS.cloud_sync")

BACKUP_KEY = "fal_local"
TABLES = ("anime_catalog", "predictions", "teams", "team_members", "weekly_actions")


def enabled():
    return bool(DATABASE_URL or (DB_CONFIG["host"] and DB_CONFIG["user"] and DB_CONFIG["password"]))


def _connection():
    return psycopg2.connect(DATABASE_URL) if DATABASE_URL else psycopg2.connect(**DB_CONFIG)


def push_from_sqlite(path):
    """Upload a consistent snapshot. Failures never undo the local write."""
    if not enabled() or not os.path.exists(path):
        return False
    try:
        with sqlite3.connect(path) as source:
            source.row_factory = sqlite3.Row
            payload = {table: [dict(row) for row in source.execute("SELECT * FROM " + table)] for table in TABLES}
        with _connection() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO local_state_backups (key, payload, updated_at) VALUES (%s, %s, now()) "
                "ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()",
                (BACKUP_KEY, psycopg2.extras.Json(payload)),
            )
        logger.info("Uploaded local SQLite state to Supabase.")
        return True
    except Exception as exc:
        logger.warning("Could not upload local SQLite state: %s", exc)
        return False


def restore_if_empty(path):
    """Restore only a brand-new/empty local database; never overwrite data."""
    if not enabled() or not os.path.exists(path):
        return False
    try:
        with sqlite3.connect(path) as target:
            has_local_data = any(target.execute("SELECT 1 FROM " + table + " LIMIT 1").fetchone() for table in TABLES)
        if has_local_data:
            return False
        with _connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT payload FROM local_state_backups WHERE key = %s", (BACKUP_KEY,))
            row = cur.fetchone()
        if not row:
            return False
        payload = row[0]
        if isinstance(payload, str):
            payload = json.loads(payload)
        with sqlite3.connect(path) as target:
            target.execute("PRAGMA foreign_keys = OFF")
            for table in reversed(TABLES):
                target.execute("DELETE FROM " + table)
            for table in TABLES:
                rows = payload.get(table, [])
                if not rows:
                    continue
                columns = list(rows[0])
                quoted = ", ".join(columns)
                placeholders = ", ".join("?" for _ in columns)
                target.executemany(
                    "INSERT INTO " + table + " (" + quoted + ") VALUES (" + placeholders + ")",
                    [[entry.get(column) for column in columns] for entry in rows],
                )
            target.execute("PRAGMA foreign_keys = ON")
        logger.info("Restored local SQLite state from Supabase.")
        return True
    except Exception as exc:
        logger.warning("Could not restore local SQLite state: %s", exc)
        return False
