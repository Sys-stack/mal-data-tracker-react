"""MAaCS -- MyAnimeList API and Cross-season Sync.

Package powering the FAL Tracker: pulls growth stats from the MyAnimeList
API, stores them in Postgres (Supabase), predicts trends, and backs the
Flask app in app.py.

Configuration is read from environment variables (see .env.example) rather
than a committed config.json -- never put real credentials in a file that
gets checked into git.
"""

import os
import logging

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # python-dotenv isn't installed; assume the environment is already set
    # (this is exactly what happens in the GitHub Action runner).
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("MAaCS")


def env_value(*names, default=""):
    """Return the first configured value, regardless of deployment naming."""
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return default


def _split_ids(raw: str):
    if not raw:
        return []
    return [int(x.strip()) for x in raw.split(",") if x.strip()]


MAL_CLIENT_ID = env_value("MAL_CLIENT_ID", "VITE_MAL_CLIENT_ID")
HEADERS = {"X-MAL-CLIENT-ID": MAL_CLIENT_ID}

TRACK_SEASON = env_value("TRACK_SEASON", "VITE_TRACK_SEASON")
TRACK_YEAR = env_value("TRACK_YEAR", "VITE_TRACK_YEAR")
TRACK_IDS = _split_ids(env_value("TRACK_IDS", "VITE_TRACK_IDS"))

# DATABASE_URL is the convention used by most web hosts.  The individual
# DB_* values remain supported for existing .env files and GitHub secrets.
DATABASE_URL = env_value("DATABASE_URL", "SUPABASE_DB_URL", "POSTGRES_URL")

DB_CONFIG = {
    "host": env_value("DB_HOST", "SUPABASE_DB_HOST"),
    "port": int(env_value("DB_PORT", "SUPABASE_DB_PORT", default="5432") or 5432),
    "user": env_value("DB_USER", "SUPABASE_DB_USER"),
    "password": env_value("DB_PASSWORD", "SUPABASE_DB_PASSWORD"),
    "database": env_value("DB_NAME", "SUPABASE_DB_NAME", default="postgres"),
    "sslmode": env_value("DB_SSLMODE", "SUPABASE_DB_SSLMODE", default="require"),
}

SUPABASE_URL = env_value("SUPABASE_URL", "VITE_SUPABASE_URL")
SUPABASE_KEY = env_value("SUPABASE_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY")

_missing = [name for name, val in [
    ("MAL_CLIENT_ID", MAL_CLIENT_ID),
    ("DATABASE_URL or DB_HOST", DATABASE_URL or DB_CONFIG["host"]),
    ("DB_USER", DATABASE_URL or DB_CONFIG["user"]),
    ("DB_PASSWORD", DATABASE_URL or DB_CONFIG["password"]),
] if not val]

if _missing:
    logger.warning(
        "Missing config values: %s. Copy .env.example to .env and fill them in "
        "(or set them as GitHub Action secrets).",
        ", ".join(_missing),
    )

from . import local_db      # noqa: E402  (submodules import CONFIG above, so import after it's built)
from . import db            # noqa: E402
from . import mal_api       # noqa: E402
from . import predictor     # noqa: E402
from . import scoring       # noqa: E402
from . import sync          # noqa: E402
