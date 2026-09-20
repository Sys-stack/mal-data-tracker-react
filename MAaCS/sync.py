"""Sync orchestration: pull fresh MAL data for every hourly-tracked anime.

Tracked IDs are read from the local SQLite cache, which is restored from its
Supabase backup before hosted runners invoke this module. This module writes
the actual hourly snapshot rows to Postgres/Supabase.
"""

import logging

from . import local_db
from . import db
from . import mal_api

logger = logging.getLogger("MAaCS.sync")


def sync_all():
    """Sync every anime marked tracked=1 in the local catalog."""
    track_ids = local_db.list_tracked_ids()
    results = {"ok": [], "failed": []}

    for anime_id in track_ids:
        try:
            snapshot = mal_api.fetch_anime_snapshot(anime_id)
            if snapshot is None:
                results["failed"].append(anime_id)
                continue

            db.insert_snapshot(snapshot)
            results["ok"].append(anime_id)
            logger.info("Synced anime %s", anime_id)
        except Exception as exc:
            logger.exception("Failed to sync anime %s: %s", anime_id, exc)
            results["failed"].append(anime_id)

    return results


if __name__ == "__main__":
    local_db.setup_tables()
    db.setup_tables()
    print(sync_all())
