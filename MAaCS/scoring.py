"""FAL points rules and the weekly season simulator that powers the Planner
page. Constants below are taken from MyAnimeList's own Fantasy Anime League
rules (fal.myanimelist.net/rules, Spring 2026 season text) so the simulation
tracks the real game rather than an invented one.

What's simulated: Users Watching points, Score points, Dropped-user points,
Favorites points, Aces (with the members "cap" eligibility rule), swaps
(4 free + 1 via the Extra Swap wildcard), and all four wildcards.

What's NOT simulated: Episode Discussion points. That component depends on
MAL forum post counts, which this app has no data source for -- it's left
out rather than faked, and is called out in the planner UI.
"""

from . import predictor

SEASON_WEEKS = 13

# ---- Users Watching (every week) ----
WATCHING_POINTS_PER_MEMBER = 0.5
WATCHING_BONUS_WEEKS = {2, 4, 6, 8, 10, 12}
WATCHING_BONUS_PER_MEMBER = 0.25

# ---- Score (weeks 3, 7, 10, 13) ----
SCORE_WEEKS = {3, 7, 10, 13}
SCORE_MULTIPLIER = 17500
SCORE_MULTIPLIER_FINAL = 35000
SCORE_BASELINE = 6.00

# ---- Dropped (weeks 4, 8, 11, 13) ----
DROPPED_WEEKS = {4, 8, 11, 13}
DROPPED_PENALTY_PER_USER = -4
DROPPED_PENALTY_PER_USER_FINAL = -8

# ---- Favorites (weeks 5, 9, 12, 13) ----
FAVORITES_WEEKS = {5, 9, 12, 13}
FAVORITES_POINTS_PER_USER = 15
FAVORITES_POINTS_PER_USER_FINAL = 30

# ---- Aces ----
ACE_BONUS = 75000
ACE_PENALTY = -5000

# ---- Swaps ----
FREE_SWAP_LIMIT = 4

# ---- Wildcards (available from week 10, one use per season) ----
WILDCARD_MIN_WEEK = 10
WILDCARD_BOOSTER_BONUS = 10000
WILDCARD_EXTRA_SWAP_COST = -5000
WILDCARD_BOMBER_SELF_COST = -5000
WILDCARD_BOMBER_TARGET_HIT = -20000
WILDCARD_TYPES = {"booster", "extra_swap", "bomber_up", "bomber_down"}


def _predicted_value(pred_row, week):
    if pred_row is None:
        return 0.0
    return predictor.evaluate_log_curve(pred_row["baseline"], pred_row["a"], pred_row["b"], week)


def weekly_anime_points(preds_for_anime: dict, week: int):
    """preds_for_anime: {metric: prediction_row}. Returns (total, breakdown dict)."""
    watching = _predicted_value(preds_for_anime.get("watching"), week)
    completed = _predicted_value(preds_for_anime.get("completed"), week)
    members = max(watching + completed, 0)

    breakdown = {"watching": 0.0, "score": 0.0, "dropped": 0.0, "favorites": 0.0}

    breakdown["watching"] = members * WATCHING_POINTS_PER_MEMBER
    if week in WATCHING_BONUS_WEEKS:
        breakdown["watching"] += members * WATCHING_BONUS_PER_MEMBER

    if week in SCORE_WEEKS:
        score = _predicted_value(preds_for_anime.get("score"), week)
        mult = SCORE_MULTIPLIER_FINAL if week == SEASON_WEEKS else SCORE_MULTIPLIER
        breakdown["score"] = mult * (score - SCORE_BASELINE)

    if week in DROPPED_WEEKS:
        dropped = max(_predicted_value(preds_for_anime.get("dropped"), week), 0)
        penalty = DROPPED_PENALTY_PER_USER_FINAL if week == SEASON_WEEKS else DROPPED_PENALTY_PER_USER
        breakdown["dropped"] = penalty * dropped

    if week in FAVORITES_WEEKS:
        favorites = max(_predicted_value(preds_for_anime.get("favorites"), week), 0)
        pts = FAVORITES_POINTS_PER_USER_FINAL if week == SEASON_WEEKS else FAVORITES_POINTS_PER_USER
        breakdown["favorites"] = pts * favorites

    total = sum(breakdown.values())
    breakdown["members_watching_completed"] = members
    breakdown["total"] = total
    return total, breakdown


def simulate_season(roster: list, predictions_by_anime: dict, actions: list, ace_threshold: int,
                     other_teams: dict = None):
    """roster: local_db.get_roster() rows (team_id, anime_id, slot, ace_used, title, ...)
    predictions_by_anime: {anime_id: {metric: prediction_row}}
    actions: local_db.list_actions() rows, each {week, action_type, payload}
    ace_threshold: this team's members cap for Ace eligibility
    other_teams: optional {team_id: predicted_weekly_totals list} for bomber wildcard targets

    Returns {weeks: [...], season_total, swaps_used, wildcard, warnings: [...]}
    """
    slot_by_anime = {r["anime_id"]: r["slot"] for r in roster}
    ace_spent = {r["anime_id"] for r in roster if r["ace_used"]}
    titles = {r["anime_id"]: r["title"] for r in roster}

    actions_by_week = {}
    for act in actions:
        actions_by_week.setdefault(act["week"], []).append(act)

    weeks_out = []
    season_total = 0.0
    swaps_used = 0
    wildcard_played = None
    warnings = []
    aced_this_season = set()

    for week in range(1, SEASON_WEEKS + 1):
        for act in actions_by_week.get(week, []):
            payload = act["payload"]
            if act["action_type"] == "swap":
                out_id, in_id = payload.get("bench_to_active"), payload.get("active_to_bench")
                if out_id in slot_by_anime and in_id in slot_by_anime:
                    slot_by_anime[out_id] = "active"
                    slot_by_anime[in_id] = "bench"
                    swaps_used += 1
            elif act["action_type"] == "wildcard":
                wildcard_played = {"type": payload.get("type"), "week": week, "target_team": payload.get("target_team")}

        active_ids = [aid for aid, slot in slot_by_anime.items() if slot == "active"]

        per_anime = {}
        for aid in active_ids:
            total, breakdown = weekly_anime_points(predictions_by_anime.get(aid, {}), week)
            per_anime[aid] = {"total": total, "breakdown": breakdown, "title": titles.get(aid, f"#{aid}")}

        week_total = sum(v["total"] for v in per_anime.values())
        week_note = []

        ace_action = next((a for a in actions_by_week.get(week, []) if a["action_type"] == "ace"), None)
        if ace_action:
            aid = ace_action["payload"].get("anime_id")
            if aid in active_ids and aid not in ace_spent:
                pred = predictions_by_anime.get(aid, {})
                watching = _predicted_value(pred.get("watching"), week)
                completed = _predicted_value(pred.get("completed"), week)
                members = watching + completed
                eligible = members <= ace_threshold
                is_top = per_anime and aid == max(per_anime, key=lambda k: per_anime[k]["total"])
                if eligible and is_top:
                    week_total += ACE_BONUS
                    week_note.append(f"Ace on {titles.get(aid)} succeeded (+{ACE_BONUS:,})")
                else:
                    week_total += ACE_PENALTY
                    reason = "over the members cap" if not eligible else "wasn't the team's top scorer"
                    week_note.append(f"Ace on {titles.get(aid)} failed ({reason}, {ACE_PENALTY:,})")
                aced_this_season.add(aid)
                ace_spent.add(aid)
            else:
                warnings.append(f"Week {week}: Ace on anime #{aid} skipped (not active, or already used its Ace).")

        if wildcard_played and wildcard_played["week"] == week:
            wtype = wildcard_played["type"]
            if wtype == "booster":
                week_total += WILDCARD_BOOSTER_BONUS
                week_note.append(f"Booster wildcard (+{WILDCARD_BOOSTER_BONUS:,})")
            elif wtype == "extra_swap":
                week_total += WILDCARD_EXTRA_SWAP_COST
                week_note.append(f"Extra Swap wildcard ({WILDCARD_EXTRA_SWAP_COST:,}, grants 1 bonus swap)")
            elif wtype in ("bomber_up", "bomber_down"):
                week_total += WILDCARD_BOMBER_SELF_COST
                week_note.append(
                    f"{'Bomber (up)' if wtype == 'bomber_up' else 'Bomber (down)'} wildcard "
                    f"({WILDCARD_BOMBER_SELF_COST:,} self, {WILDCARD_BOMBER_TARGET_HIT:,} to target team)"
                )

        season_total += week_total
        weeks_out.append({
            "week": week,
            "active_ids": active_ids,
            "per_anime": per_anime,
            "team_total": week_total,
            "running_total": season_total,
            "notes": week_note,
        })

    swap_budget = FREE_SWAP_LIMIT + (1 if wildcard_played and wildcard_played["type"] == "extra_swap" else 0)
    if swaps_used > swap_budget:
        warnings.append(f"Swaps used ({swaps_used}) exceed the allowed budget ({swap_budget}).")

    return {
        "weeks": weeks_out,
        "season_total": season_total,
        "swaps_used": swaps_used,
        "swap_budget": swap_budget,
        "wildcard": wildcard_played,
        "warnings": warnings,
    }
