"""Growth prediction using a 2-parameter log curve.

Model: v(t) = baseline + a * ln(1 + b * t)
  - t is weeks elapsed since the prediction's reference point (0..13, matching
    a 13-week FAL season)
  - baseline is the anime's current known value (t=0 anchor)
  - a is the "scale" slider: how much the metric grows overall
  - b is the "rate" slider: how quickly growth front-loads vs. stretches out

This shape is a deliberate choice for anime growth stats: MAL member counts
and similar metrics grow fast right after a premiere and then taper off,
which a log curve captures with just two intuitive, sliderable knobs
(no black-box regression to trust).

Only numpy is used -- fit_log_curve does a small grid search over b and a
closed-form least-squares solve for (a, baseline) at each candidate, which
avoids needing scipy.optimize as a dependency.

Defaults and slider bounds are metric-aware: a "score" is 0-10 and should
stay near there, while member-count metrics (watching, completed,
num_list_users, ...) for a popular show can realistically reach the
hundreds of thousands, so their default range needs to comfortably cover
that -- a fixed generic default badly undersells count metrics (capping
around a few thousand) and badly oversells score (letting it default to
triple digits), which is exactly backwards.
"""

import math
import numpy as np

METRICS = [
    "watching", "plan_to_watch", "completed", "on_hold", "dropped",
    "num_list_users", "score", "favorites", "num_scoring_users",
]

# Metrics whose natural scale is a small 0-10 score, not a headcount.
SCORE_LIKE_METRICS = {"score"}

SEASON_WEEKS = 13

# A popular seasonal show's member-style counts can climb well past 100k by
# the end of a season, so defaults/bounds for those metrics are anchored to
# a six-figure ceiling rather than whatever tiny number a fresh, untracked
# show happens to start at.
COUNT_METRIC_CEILING = 150_000
COUNT_METRIC_DEFAULT_A = 20_000


def evaluate_log_curve(baseline: float, a: float, b: float, weeks):
    """weeks: scalar or iterable of week offsets (0..13). Returns same shape."""
    b = max(b, 1e-6)
    if np.isscalar(weeks):
        return baseline + a * math.log(1 + b * weeks)
    weeks = np.asarray(weeks, dtype=float)
    return baseline + a * np.log(1 + b * weeks)


def fit_log_curve(history_points, seed_baseline: float = 0.0, metric: str = None):
    """history_points: list of (weeks_elapsed, value) tuples, weeks_elapsed >= 0.
    Returns (baseline, a, b). Falls back to a metric-aware default curve when
    there's not enough history to fit (e.g. an untracked anime, or a metric
    the user is predicting manually) rather than one generic default that
    only makes sense for one kind of metric."""
    points = [(t, v) for t, v in history_points if v is not None]

    if len(points) < 3:
        is_score = metric in SCORE_LIKE_METRICS
        if is_score:
            baseline = seed_baseline if seed_baseline else 7.0
            return baseline, 1.0, 1.0
        baseline = seed_baseline if seed_baseline else 0.0
        a_default = max(baseline * 0.6, COUNT_METRIC_DEFAULT_A)
        return baseline, a_default, 1.0

    ts = np.array([p[0] for p in points], dtype=float)
    vs = np.array([p[1] for p in points], dtype=float)

    best = None
    for b in np.geomspace(0.02, 6.0, 60):
        x = np.log1p(b * ts)
        design = np.column_stack([x, np.ones_like(x)])
        (a, baseline), *_ = np.linalg.lstsq(design, vs, rcond=None)
        residual = float(np.sum((design @ [a, baseline] - vs) ** 2))
        if best is None or residual < best[0]:
            best = (residual, float(a), float(baseline), float(b))

    _, a, baseline, b = best
    return baseline, a, b


def slider_bounds(baseline: float, a: float, metric: str = None):
    """Generous, metric-aware min/max for the two value sliders (a and
    baseline; the rate slider b has its own fixed 0.01-10 range everywhere).
    A 'score' curve gets a small -10..10 range; count metrics get bounds
    that comfortably reach six figures even from a small starting fit,
    since that's realistic for a popular show's member/watcher counts."""
    if metric in SCORE_LIKE_METRICS:
        return {
            "a_min": -10.0, "a_max": 10.0,
            "baseline_min": 0.0, "baseline_max": 10.0,
        }
    magnitude = max(abs(baseline), abs(a), COUNT_METRIC_DEFAULT_A)
    ceiling = max(magnitude * 3, COUNT_METRIC_CEILING)
    return {
        "a_min": round(-ceiling, 2),
        "a_max": round(ceiling, 2),
        "baseline_min": 0.0,
        "baseline_max": round(max(baseline * 1.5, ceiling), 2),
    }


def curve_series(baseline: float, a: float, b: float, weeks_ahead: int = SEASON_WEEKS, step: float = 1.0):
    weeks = np.arange(0, weeks_ahead + step, step)
    values = evaluate_log_curve(baseline, a, b, weeks)
    return [{"week": float(w), "v": float(v)} for w, v in zip(weeks, values)]
