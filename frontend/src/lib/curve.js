// Mirrors MAaCS/predictor.py's evaluate_log_curve: value = baseline + a * ln(1 + b * t)
export function evaluateLogCurve(baseline, a, b, weeks) {
  const safeB = Math.max(b, 1e-6);
  return baseline + a * Math.log(1 + safeB * weeks);
}

export function curveSeries(baseline, a, b, weeksAhead = 13, step = 1) {
  const out = [];
  for (let w = 0; w <= weeksAhead; w += step) {
    out.push({ week: w, value: evaluateLogCurve(baseline, a, b, w) });
  }
  return out;
}

export const METRICS = [
  "watching", "plan_to_watch", "completed", "on_hold", "dropped",
  "num_list_users", "score", "favorites", "num_scoring_users",
];

export const METRIC_LABELS = {
  watching: "Watching",
  plan_to_watch: "Plan to watch",
  completed: "Completed",
  on_hold: "On hold",
  dropped: "Dropped",
  num_list_users: "Members",
  score: "Score",
  favorites: "Favorites",
  num_scoring_users: "Scoring users",
};

// Mirrors MAaCS/predictor.py's slider_bounds: score stays near a 0-10 range,
// count-style metrics (member/watcher counts) default to a range that
// comfortably reaches six figures, since a popular seasonal show's numbers
// realistically climb that high.
const COUNT_METRIC_CEILING = 150_000;

export function metricBounds(baseline, a, metric) {
  if (metric === "score") {
    return { a_min: -10, a_max: 10, baseline_min: 0, baseline_max: 10 };
  }
  const magnitude = Math.max(Math.abs(baseline), Math.abs(a), 20_000);
  const ceiling = Math.max(magnitude * 3, COUNT_METRIC_CEILING);
  return {
    a_min: -ceiling, a_max: ceiling,
    baseline_min: 0, baseline_max: Math.max(baseline * 1.5, ceiling),
  };
}

// If the user types a value outside the current slider range (via the text
// input next to it), grow the range to fit rather than silently clamping.
export function expandBounds(bounds, key, value) {
  const minKey = `${key}_min`, maxKey = `${key}_max`;
  const next = { ...bounds };
  if (value < next[minKey]) next[minKey] = key === "baseline" ? Math.min(value, 0) : value * 1.2;
  if (value > next[maxKey]) next[maxKey] = value * 1.2;
  return next;
}

export function formatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : (Math.round(n * 100) / 100).toLocaleString();
}
