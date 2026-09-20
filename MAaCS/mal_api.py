"""MyAnimeList API access."""

import logging
import datetime
import requests

from . import HEADERS

logger = logging.getLogger("MAaCS.mal_api")

MAL_BASE = "https://api.myanimelist.net/v2"

# Fields used for a single anime's full profile (catalog entry + the anime
# detail dashboard). Broader than the hourly snapshot fields below, since
# most of these are static or change rarely.
PROFILE_FIELDS = (
    "id,title,main_picture,start_date,end_date,synopsis,mean,rank,popularity,"
    "num_list_users,num_scoring_users,num_favorites,created_at,updated_at,"
    "media_type,status,genres,num_episodes,start_season,broadcast,source,"
    "average_episode_duration,rating,studios,statistics"
)

# Fields that actually change hour to hour and are worth a growth_snapshots
# row. rank/popularity are included because they move constantly and are
# genuinely "growth" signals, same as member counts.
SNAPSHOT_FIELDS = "statistics,num_list_users,num_scoring_users,num_favorites,mean,rank,popularity"


def _extract_profile(data: dict, fallback_id=None):
    picture = data.get("main_picture", {}) or {}
    genres = data.get("genres", []) or []
    broadcast = data.get("broadcast", {}) or {}
    season = data.get("start_season", {}) or {}
    return {
        "id": data.get("id", fallback_id),
        "title": data.get("title"),
        "media_type": data.get("media_type"),
        "start_date": data.get("start_date") or None,
        "end_date": data.get("end_date") or None,
        "studios": ", ".join(s.get("name", "") for s in data.get("studios", [])) or None,
        "season": season.get("season"),
        "year": season.get("year"),
        "image_url": picture.get("large") or picture.get("medium"),
        "genres": ", ".join(g.get("name", "") for g in genres) or None,
        "status": data.get("status"),
        "num_episodes": data.get("num_episodes") or None,
        "source": data.get("source"),
        "rating": data.get("rating"),
        "broadcast_day": broadcast.get("day_of_the_week"),
        "broadcast_time": broadcast.get("start_time"),
        "average_episode_duration": data.get("average_episode_duration"),
        "mal_created_at": data.get("created_at"),
        "mal_updated_at": data.get("updated_at"),
        "synopsis": data.get("synopsis"),
    }


def fetch_seasonal_list(season: str, year):
    """Pull the ranked TV list for a season, e.g. fetch_seasonal_list('fall', 2026)."""
    resp = requests.get(
        f"{MAL_BASE}/anime/season/{year}/{season}",
        headers=HEADERS,
        params={
            "fields": "start_date,end_date,studios,id,title,media_type,created_at",
            "limit": 100,
            "sort": "anime_num_list_users",
        },
        timeout=20,
    )
    if resp.status_code != 200:
        logger.error("Seasonal list fetch failed (%s): %s", resp.status_code, resp.text[:200])
        return []

    results = []
    for entry in resp.json().get("data", []):
        node = entry.get("node", {})
        if node.get("media_type") != "tv":
            continue
        studios = node.get("studios", [])
        results.append({
            "id": node.get("id"),
            "title": node.get("title"),
            "media_type": node.get("media_type"),
            "start_date": node.get("start_date") or None,
            "end_date": node.get("end_date") or None,
            "studios": ", ".join(s.get("name", "") for s in studios) or None,
        })
    return results


def fetch_seasonal_catalog(season: str, year, limit: int = 100):
    """Full seasonal TV list including cover images and the extended profile
    fields, shaped for anime_catalog. Every eligible title is returned (not
    just ones already being tracked); OVA/ONA/Movie/Special entries are
    excluded to mirror FAL's own eligibility rule.
    """
    resp = requests.get(
        f"{MAL_BASE}/anime/season/{year}/{season}",
        headers=HEADERS,
        params={"fields": PROFILE_FIELDS, "limit": limit, "sort": "anime_num_list_users"},
        timeout=20,
    )
    if resp.status_code != 200:
        logger.error("Seasonal catalog fetch failed (%s): %s", resp.status_code, resp.text[:200])
        return []

    results = []
    for entry in resp.json().get("data", []):
        node = entry.get("node", {})
        if node.get("media_type") != "tv":
            continue
        profile = _extract_profile(node)
        profile["season"] = season
        profile["year"] = int(year)
        results.append(profile)
    return results


class MALAPIError(Exception):
    """Raised when MAL returns a non-200 response, with MAL's own error
    message attached (instead of a generic requests HTTPError with no
    context about what actually went wrong)."""


def _raise_with_mal_message(resp):
    try:
        body = resp.json()
        detail = body.get("message") or body.get("error") or resp.text[:200]
    except ValueError:
        detail = resp.text[:200]
    raise MALAPIError(f"MAL API {resp.status_code} for {resp.url}: {detail}")


def fetch_anime_info(anime_id: int):
    """Full profile for one anime -- used when a show is first added to
    tracking, and to back the per-anime dashboard page."""
    resp = requests.get(
        f"{MAL_BASE}/anime/{anime_id}",
        headers=HEADERS,
        params={"fields": PROFILE_FIELDS},
        timeout=20,
    )
    if resp.status_code != 200:
        _raise_with_mal_message(resp)
    return _extract_profile(resp.json(), fallback_id=anime_id)


def fetch_anime_snapshot(anime_id: int):
    """Current growth stats for one anime, shaped for growth_snapshots. Returns
    None (and logs the failure) instead of raising, so one bad ID doesn't
    kill an hourly sync run for every other tracked show."""
    resp = requests.get(
        f"{MAL_BASE}/anime/{anime_id}",
        headers=HEADERS,
        params={"fields": SNAPSHOT_FIELDS},
        timeout=20,
    )
    if resp.status_code != 200:
        try:
            detail = resp.json().get("message") or resp.json().get("error") or resp.text[:200]
        except ValueError:
            detail = resp.text[:200]
        logger.error("Snapshot fetch failed for %s (%s): %s", anime_id, resp.status_code, detail)
        return None

    data = resp.json()
    stat = data.get("statistics", {}).get("status", {})
    return {
        "anime_id": anime_id,
        "watching": int(stat.get("watching", 0) or 0),
        "plan_to_watch": int(stat.get("plan_to_watch", 0) or 0),
        "completed": int(stat.get("completed", 0) or 0),
        "on_hold": int(stat.get("on_hold", 0) or 0),
        "dropped": int(stat.get("dropped", 0) or 0),
        "num_list_users": int(data.get("num_list_users", 0) or 0),
        "score": float(data["mean"]) if data.get("mean") is not None else None,
        "favorites": int(data.get("num_favorites", 0) or 0),
        "num_scoring_users": int(data.get("num_scoring_users", 0) or 0),
        "rank": data.get("rank"),
        "popularity": data.get("popularity"),
        "snapshot_at": datetime.datetime.utcnow(),
    }
