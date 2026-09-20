#!/usr/bin/env python
"""Entry point for the hourly GitHub Action sync job.

Run manually with: python scripts/run_sync.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from MAaCS import cloud_sync, db, local_db, sync  # noqa: E402

if __name__ == "__main__":
    # The Action runs in a fresh checkout each time -- fal_local.db is
    # gitignored, so its tables (and the "tracked" list) won't exist yet.
    # If TRACK_IDS is set, seed those into the catalog/tracked set so a
    # from-scratch runner still has something to sync.
    local_db.setup_tables()
    db.setup_tables()
    # Hosted runners have no persistent disk. Recover the tracked list (and
    # all other application state) before the hourly job starts.
    cloud_sync.restore_if_empty(local_db.DB_PATH)

    from MAaCS import mal_api, TRACK_IDS
    if TRACK_IDS:
        existing = set(local_db.list_tracked_ids())
        for anime_id in TRACK_IDS:
            if anime_id in existing:
                continue
            try:
                info = mal_api.fetch_anime_info(anime_id)
                local_db.upsert_catalog_entries([info])
                local_db.set_tracked(anime_id, True)
            except Exception as exc:
                print(f"Could not seed anime {anime_id}: {exc}")

    result = sync.sync_all()
    print(f"Synced OK: {result['ok']}")
    if result["failed"]:
        print(f"Failed: {result['failed']}")
        sys.exit(1)
