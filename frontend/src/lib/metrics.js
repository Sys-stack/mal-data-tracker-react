// Shared metric metadata + formatting/date helpers for the growth-analysis
// pages (Explorer, Tables). Centralized here so both pages bucket, format,
// and window snapshot data the same way instead of drifting apart.

export const METRICS = [
  "num_list_users", "watching", "completed", "watching_completed", "plan_to_watch",
  "on_hold", "dropped", "score", "favorites", "num_scoring_users", "rank", "popularity",
];

export const METRIC_LABELS = {
  num_list_users: "Members", watching: "Watching", completed: "Completed",
  watching_completed: "Watching + Completed", plan_to_watch: "Plan to watch",
  on_hold: "On hold", dropped: "Dropped", score: "Score", favorites: "Favorites",
  num_scoring_users: "Scoring users", rank: "Rank", popularity: "Popularity",
};

// The subset shown in dense side-by-side tables -- "watching_completed" is
// omitted there since it's a derived convenience for the chart, not a raw
// tracked field.
export const SUMMARY_METRICS = [
  "num_list_users", "watching", "plan_to_watch", "completed", "dropped", "score", "favorites", "rank", "popularity",
];

// Lower is "better" for these -- flips default sort direction / color coding
// so the meaningful direction reads as "good" (pine) rather than "bad" (rust).
export const LOWER_IS_BETTER = new Set(["rank", "popularity", "dropped"]);

export const PALETTE = ["#3A6B5C", "#B5541F", "#35618C", "#8A6D00", "#7A4FA3", "#C23B6E", "#4A8C6B", "#5C7A99", "#9C4221", "#2F5233"];

export function withDerived(snapshot) {
  if (!snapshot) return snapshot;
  return { ...snapshot, watching_completed: (snapshot.watching ?? 0) + (snapshot.completed ?? 0) };
}

export function fmt(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (typeof v !== "number") return v;
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : (Math.round(v * 100) / 100).toLocaleString();
}

export function fmtSigned(v) {
  const formatted = fmt(v);
  if (v === null || v === undefined || Number.isNaN(v) || v <= 0) return formatted;
  return `+${formatted}`;
}

// "YYYY-MM-DDTHH" -> "YYYY-MM-DD HH:00"
export function formatHourKey(hk) {
  if (!hk) return "—";
  const [date, hour] = hk.split("T");
  return `${date} ${hour}:00`;
}

export function formatTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function defaultDirFor(key) {
  if (key === "snapshot_at") return "desc";
  if (key === "title") return "asc";
  return LOWER_IS_BETTER.has(key) ? "asc" : "desc";
}

// hourKey-bounded range (Explorer's Brush-driven period; both bounds inclusive).
export function rowsInHourRange(rows, startLabel, endLabel) {
  if (!startLabel || !endLabel) return rows;
  return rows.filter((r) => {
    const hk = r.snapshot_at.slice(0, 13);
    return hk >= startLabel && hk <= endLabel;
  });
}

// Full-timestamp-bounded range (Tables' week/preseason windows). `end` is
// exclusive so consecutive weeks never double-count a boundary snapshot.
export function rowsInDateRange(rows, startISO, endISO) {
  return rows.filter((r) => {
    if (startISO && r.snapshot_at < startISO) return false;
    if (endISO && r.snapshot_at >= endISO) return false;
    return true;
  });
}

// Plain "YYYY-MM-DD" date-only arithmetic, used for season-start/week math.
export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Gain of `metric` across a set of (chronologically ascending) rows -- last
// in-range value minus first in-range value. Returns null when there's
// nothing to compare (no data, or a single point) so callers can tell
// "no movement" apart from "no data for this window".
export function periodGain(rows, metric) {
  const withValue = rows.filter((r) => r[metric] != null);
  if (withValue.length < 2) return null;
  return withValue[withValue.length - 1][metric] - withValue[0][metric];
}

// A week's points can come from more than one metric (e.g. "score + watching_completed").
// Sums whatever metrics have data; returns null only when NONE of them do,
// so "no data at all" reads differently from "this metric didn't move".
export function sumPeriodGain(rows, metricKeys) {
  if (!metricKeys || metricKeys.length === 0) return null;
  const gains = metricKeys.map((m) => periodGain(rows, m));
  if (gains.every((g) => g == null)) return null;
  return gains.reduce((sum, g) => sum + (g ?? 0), 0);
}
