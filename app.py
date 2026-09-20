import atexit
import os

from flask import Flask, request, jsonify, send_from_directory

from MAaCS import cloud_sync, db, local_db, mal_api, predictor, scoring, sync

FRONTEND_DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static_dist")

app = Flask(__name__, static_folder=None)

# Ensure schemas exist regardless of entry point (python app.py, flask run,
# gunicorn, ...). Local SQLite setup is cheap and always safe to run; the
# Postgres setup is wrapped so a temporarily-unreachable Supabase doesn't
# prevent the app (and its local-only pages) from starting at all.
local_db.setup_tables()
try:
    db.setup_tables()
    cloud_sync.restore_if_empty(local_db.DB_PATH)
except Exception as exc:
    app.logger.warning("Could not reach Postgres/Supabase at startup (%s) -- "
                        "hourly-growth features will error until it's reachable.", exc)

# The normal write hook already protects changes immediately.  This is a
# final best-effort flush for graceful process exits on local machines and
# web services; it intentionally never delays or prevents shutdown.
atexit.register(cloud_sync.push_from_sqlite, local_db.DB_PATH)


def _pg_row(row, date_fields=()):
    if row is None:
        return None
    d = dict(row)
    for f in date_fields:
        if d.get(f) is not None and hasattr(d[f], "isoformat"):
            d[f] = d[f].isoformat()
    return d


def _pg_rows(rows, date_fields=()):
    return [_pg_row(r, date_fields) for r in rows]


# -----------------------------------
# |   REACT APP (built by Vite)      |
# -----------------------------------
# The frontend/ directory is a Vite + React SPA; `npm run build` outputs it
# to static_dist/. Flask's only job for non-API routes is to serve that
# build and let React Router handle client-side navigation -- every path
# that isn't /api/... or a real static asset falls through to index.html.

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path and os.path.exists(os.path.join(FRONTEND_DIST, path)):
        return send_from_directory(FRONTEND_DIST, path)
    index_path = os.path.join(FRONTEND_DIST, "index.html")
    if not os.path.exists(index_path):
        return (
            "Frontend build not found. Run:\n"
            "  cd frontend && npm install && npm run build\n"
            "then restart the Flask server.",
            503,
        )
    return send_from_directory(FRONTEND_DIST, "index.html")


# -----------------------------------
# |         CATALOG / BROWSE API     |
# -----------------------------------

@app.get("/api/config")
def api_config():
    """FAL rule constants, so the frontend never hardcodes numbers that live in scoring.py."""
    return jsonify({
        "season_weeks": scoring.SEASON_WEEKS,
        "wildcard_min_week": scoring.WILDCARD_MIN_WEEK,
        "free_swap_limit": scoring.FREE_SWAP_LIMIT,
        "ace_bonus": scoring.ACE_BONUS,
        "ace_penalty": scoring.ACE_PENALTY,
    })


@app.get("/api/catalog")
def api_list_catalog():
    season = request.args.get("season") or None
    year = request.args.get("year") or None
    tracked_only = request.args.get("tracked_only") == "1"
    return jsonify(local_db.list_catalog(season=season, year=year, tracked_only=tracked_only))


@app.get("/api/catalog/<int:anime_id>")
def api_get_catalog_entry(anime_id):
    anime = local_db.get_anime(anime_id)
    if anime is None:
        return jsonify({"error": "not found in catalog"}), 404
    return jsonify(anime)


@app.get("/api/catalog/<int:anime_id>/teams")
def api_get_anime_teams(anime_id):
    """Which teams have drafted this anime -- backs the 'drafted by' panel
    on the per-anime dashboard."""
    return jsonify(local_db.get_teams_for_anime(anime_id))


@app.post("/api/catalog/refresh")
def api_refresh_catalog():
    payload = request.get_json(force=True, silent=True) or {}
    season = payload.get("season")
    year = payload.get("year")
    if not season or not year:
        return jsonify({"error": "season and year are required"}), 400
    try:
        entries = mal_api.fetch_seasonal_catalog(season, year)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
    if not entries:
        return jsonify({"error": "MAL returned no eligible TV entries for that season/year (check season spelling and that your MAL_CLIENT_ID is set)"}), 502
    local_db.upsert_catalog_entries(entries)
    return jsonify({"added": len(entries)})


@app.post("/api/catalog")
def api_add_single_anime():
    """Add one anime to the catalog by MAL ID directly (outside a seasonal refresh)."""
    payload = request.get_json(force=True, silent=True) or {}
    anime_id = payload.get("id")
    if not anime_id:
        return jsonify({"error": "id is required"}), 400
    try:
        info = mal_api.fetch_anime_info(int(anime_id))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
    local_db.upsert_catalog_entries([info])
    return jsonify(info), 201


@app.post("/api/catalog/<int:anime_id>/track")
def api_toggle_track(anime_id):
    payload = request.get_json(force=True, silent=True) or {}
    tracked = bool(payload.get("tracked", True))
    local_db.set_tracked(anime_id, tracked)
    if tracked:
        # Fetch an immediate first snapshot so the dashboard isn't empty
        # until the next hourly run.
        try:
            snap = mal_api.fetch_anime_snapshot(anime_id)
            if snap:
                db.insert_snapshot(snap)
        except Exception:
            pass
    return jsonify({"message": "updated", "tracked": tracked})


# -----------------------------------
# |     GROWTH (Postgres, hourly)    |
# -----------------------------------

@app.get("/api/anime/<int:anime_id>/growth")
def api_get_growth(anime_id):
    rows = db.get_growth(anime_id, start=request.args.get("start"), end=request.args.get("end"))
    return jsonify(_pg_rows(rows, ("snapshot_at",)))


@app.get("/api/slider_data")
def get_slider_data():
    anime_id = request.args.get("anime_id", type=int)
    if not anime_id:
        return jsonify({"error": "anime_id query param is required"}), 400
    rows = db.get_growth(anime_id)
    if not rows:
        return jsonify({"min": None, "max": None, "count": 0})
    return jsonify({"min": rows[0]["snapshot_at"].isoformat(), "max": rows[-1]["snapshot_at"].isoformat(), "count": len(rows)})


@app.post("/api/slider_data")
def post_slider_data():
    payload = request.get_json(force=True, silent=True) or {}
    anime_id = payload.get("anime_id")
    if not anime_id:
        return jsonify({"error": "anime_id is required"}), 400
    rows = db.get_growth(anime_id, start=payload.get("start"), end=payload.get("end"))
    return jsonify(_pg_rows(rows, ("snapshot_at",)))


@app.post("/api/sync")
def api_manual_sync():
    return jsonify(sync.sync_all())


# -----------------------------------
# |           PREDICTIONS            |
# -----------------------------------

@app.get("/api/predictions/<int:anime_id>")
def api_list_predictions(anime_id):
    return jsonify(local_db.list_predictions(anime_id))


@app.post("/api/predictions/<int:anime_id>/fit")
def api_fit_prediction(anime_id):
    payload = request.get_json(force=True, silent=True) or {}
    metric = payload.get("metric")
    seed = payload.get("seed", 0) or 0
    if metric not in predictor.METRICS:
        return jsonify({"error": f"unknown metric '{metric}'"}), 400

    history_points = []
    try:
        growth_rows = db.get_growth(anime_id)
    except Exception as exc:
        # Predicting an untracked show, or Supabase is briefly unreachable --
        # either way, fall back to a manual seed curve instead of erroring.
        growth_rows = []
    if growth_rows:
        t0 = growth_rows[0]["snapshot_at"]
        for row in growth_rows:
            weeks = (row["snapshot_at"] - t0).total_seconds() / (3600 * 24 * 7)
            history_points.append((weeks, row.get(metric)))
        if not seed:
            seed = growth_rows[-1].get(metric) or 0

    baseline, a, b = predictor.fit_log_curve(history_points, seed_baseline=float(seed), metric=metric)
    bounds = predictor.slider_bounds(baseline, a, metric=metric)
    return jsonify({"baseline": baseline, "a": a, "b": b, **bounds, "history_points": len(history_points)})


@app.post("/api/predictions/<int:anime_id>/set")
def api_set_prediction(anime_id):
    payload = request.get_json(force=True, silent=True) or {}
    metric = payload.get("metric")
    if metric not in predictor.METRICS:
        return jsonify({"error": f"unknown metric '{metric}'"}), 400
    try:
        baseline, a, b = float(payload["baseline"]), float(payload["a"]), float(payload["b"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "baseline, a, and b are required numbers"}), 400
    local_db.upsert_prediction(anime_id, metric, baseline, a, b, is_set=True)
    return jsonify({"message": "set"})


# -----------------------------------
# |              TEAMS               |
# -----------------------------------

@app.get("/api/teams")
def api_list_teams():
    teams = local_db.list_teams()
    for t in teams:
        t["roster"] = local_db.get_roster(t["id"])
    return jsonify(teams)


@app.post("/api/teams")
def api_create_team():
    payload = request.get_json(force=True, silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    try:
        team = local_db.create_team(name, ace_threshold=payload.get("ace_threshold"))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 409
    return jsonify(team), 201


@app.delete("/api/teams/<int:team_id>")
def api_delete_team(team_id):
    local_db.delete_team(team_id)
    return jsonify({"message": "removed"})


@app.get("/api/teams/<int:team_id>/roster")
def api_team_roster(team_id):
    return jsonify(local_db.get_roster(team_id))


@app.get("/api/teams/<int:team_id>/available")
def api_team_available(team_id):
    season = request.args.get("season") or None
    year = request.args.get("year") or None
    return jsonify(local_db.get_available_for_draft(team_id, season=season, year=year))


@app.post("/api/teams/<int:team_id>/draft")
def api_draft(team_id):
    payload = request.get_json(force=True, silent=True) or {}
    anime_id = payload.get("anime_id")
    slot = payload.get("slot", "bench")
    if not anime_id or slot not in ("active", "bench"):
        return jsonify({"error": "anime_id is required and slot must be 'active' or 'bench'"}), 400
    roster = local_db.get_roster(team_id)
    count_in_slot = sum(1 for r in roster if r["slot"] == slot)
    limit = 5 if slot == "active" else 3
    if count_in_slot >= limit:
        return jsonify({"error": f"{slot} is full ({limit} max, per FAL's 5-active/3-bench roster rule)"}), 409
    local_db.draft_anime(team_id, int(anime_id), slot=slot)
    return jsonify({"message": "drafted"})


@app.post("/api/teams/<int:team_id>/undraft")
def api_undraft(team_id):
    payload = request.get_json(force=True, silent=True) or {}
    anime_id = payload.get("anime_id")
    if not anime_id:
        return jsonify({"error": "anime_id is required"}), 400
    local_db.undraft_anime(team_id, int(anime_id))
    return jsonify({"message": "undrafted"})


@app.post("/api/teams/<int:team_id>/slot")
def api_set_slot(team_id):
    """Pre-season slot editing (draft-time only) -- not the same as the
    Planner's in-season swap action, which is week-tracked and rate-limited."""
    payload = request.get_json(force=True, silent=True) or {}
    anime_id = payload.get("anime_id")
    slot = payload.get("slot")
    if not anime_id or slot not in ("active", "bench"):
        return jsonify({"error": "anime_id is required and slot must be 'active' or 'bench'"}), 400
    local_db.set_slot(team_id, int(anime_id), slot)
    return jsonify({"message": "updated"})


@app.get("/api/teams/<int:team_id>/compare")
def api_compare_predictions(team_id):
    """Overlay every roster anime's SET prediction curve for one metric --
    backs the Team Draft page's comparison chart."""
    metric = request.args.get("metric", "num_list_users")
    roster = local_db.get_roster(team_id)
    anime_ids = [r["anime_id"] for r in roster]
    preds = local_db.get_set_predictions(anime_ids)

    series = []
    for r in roster:
        pred = preds.get(r["anime_id"], {}).get(metric)
        if pred is None:
            series.append({"anime_id": r["anime_id"], "title": r["title"], "image_url": r["image_url"], "set": False, "points": []})
        else:
            points = predictor.curve_series(pred["baseline"], pred["a"], pred["b"])
            series.append({"anime_id": r["anime_id"], "title": r["title"], "image_url": r["image_url"], "set": True, "points": points})
    return jsonify(series)


# -----------------------------------
# |         PLANNER / SIMULATE       |
# -----------------------------------

@app.get("/api/teams/<int:team_id>/actions")
def api_list_actions(team_id):
    return jsonify(local_db.list_actions(team_id))


@app.delete("/api/teams/<int:team_id>/actions/<int:action_id>")
def api_delete_action(team_id, action_id):
    local_db.delete_action(team_id, action_id)
    return jsonify({"message": "removed"})


@app.post("/api/teams/<int:team_id>/actions/reset")
def api_reset_actions(team_id):
    local_db.clear_actions(team_id)
    return jsonify({"message": "reset"})


@app.post("/api/teams/<int:team_id>/actions/swap")
def api_action_swap(team_id):
    payload = request.get_json(force=True, silent=True) or {}
    week = payload.get("week")
    bench_to_active = payload.get("bench_to_active")
    active_to_bench = payload.get("active_to_bench")
    if not all([week, bench_to_active, active_to_bench]):
        return jsonify({"error": "week, bench_to_active, and active_to_bench are required"}), 400
    local_db.add_action(team_id, int(week), "swap", {"bench_to_active": int(bench_to_active), "active_to_bench": int(active_to_bench)})
    return jsonify({"message": "swap scheduled"})


@app.post("/api/teams/<int:team_id>/actions/ace")
def api_action_ace(team_id):
    payload = request.get_json(force=True, silent=True) or {}
    week = payload.get("week")
    anime_id = payload.get("anime_id")
    if not week or not anime_id:
        return jsonify({"error": "week and anime_id are required"}), 400
    local_db.add_action(team_id, int(week), "ace", {"anime_id": int(anime_id)})
    return jsonify({"message": "ace scheduled"})


@app.post("/api/teams/<int:team_id>/actions/wildcard")
def api_action_wildcard(team_id):
    payload = request.get_json(force=True, silent=True) or {}
    week = payload.get("week")
    wtype = payload.get("type")
    if not week or wtype not in scoring.WILDCARD_TYPES:
        return jsonify({"error": f"week is required and type must be one of {sorted(scoring.WILDCARD_TYPES)}"}), 400
    if int(week) < scoring.WILDCARD_MIN_WEEK:
        return jsonify({"error": f"wildcards aren't available until week {scoring.WILDCARD_MIN_WEEK}"}), 400
    local_db.add_action(team_id, int(week), "wildcard", {"type": wtype, "target_team": payload.get("target_team")})
    return jsonify({"message": "wildcard scheduled"})


@app.get("/api/teams/<int:team_id>/simulate")
def api_simulate(team_id):
    team = local_db.get_team(team_id)
    if team is None:
        return jsonify({"error": "team not found"}), 404
    roster = local_db.get_roster(team_id)
    active_count = sum(1 for r in roster if r["slot"] == "active")
    bench_count = sum(1 for r in roster if r["slot"] == "bench")
    if active_count != 5 or bench_count != 3:
        return jsonify({"error": f"FAL rosters need exactly 5 active + 3 bench to simulate (currently {active_count} active, {bench_count} bench)."}), 400

    anime_ids = [r["anime_id"] for r in roster]
    preds = local_db.get_set_predictions(anime_ids)
    missing = [r["title"] for r in roster if r["anime_id"] not in preds]
    actions = local_db.list_actions(team_id)

    result = scoring.simulate_season(roster, preds, actions, ace_threshold=team["ace_threshold"])
    if missing:
        result["warnings"].insert(0, f"No set prediction yet for: {', '.join(missing)} -- they'll score 0 until you set one on the Predictor page.")
    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True)
