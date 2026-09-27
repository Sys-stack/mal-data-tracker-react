import { useMemo, useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Search, X, ArrowUpDown, RefreshCw, AlertCircle } from "lucide-react";
import { api } from "../lib/api.js";
import {
  METRICS, METRIC_LABELS, LOWER_IS_BETTER, SUMMARY_METRICS, PALETTE,
  withDerived, fmt, fmtSigned, formatHourKey, defaultDirFor, rowsInHourRange,
} from "../lib/metrics.js";
import { PageShell, Thumb, EmptyState } from "../components/Common.jsx";
import { ExplorerGrowthChart } from "../components/Charts.jsx";

const CHART_MODES = [
  { id: "absolute", label: "Absolute" },
  { id: "percent", label: "% change" },
  { id: "net", label: "Net gain" },
];

// Every hourly bucket (label) that exists for `metric` across the selected
// shows. Deliberately independent of chart mode / baseline, since the Brush
// (and the zero-point picker) needs a stable set of points to work with
// regardless of how values are currently being displayed.
function getBucketLabels(selected, growthById, metric) {
  const labels = new Set();
  for (const anime of selected) {
    for (const row of growthById[anime.id] || []) {
      if (row[metric] === null || row[metric] === undefined) continue;
      labels.add(row.snapshot_at.slice(0, 13)); // YYYY-MM-DDTHH
    }
  }
  return Array.from(labels).sort();
}

// Buckets every selected anime's hourly snapshots onto the shared hourly
// timeline. When `baselineLabel` is set, each show is re-based to its own
// first value at or after that label -- so "percent"/"net" always measure
// from wherever the zero point is, per show (rather than a single shared
// bucket index, since shows can have gaps in their history).
function buildSeries(selected, growthById, metric, mode, baselineLabel) {
  const buckets = new Map(); // hourKey -> { label, [title]: value }

  for (const anime of selected) {
    const rows = (growthById[anime.id] || []).map(withDerived).filter((r) => r[metric] != null);
    if (rows.length === 0) continue;

    let baseline = rows[0][metric];
    if (baselineLabel) {
      const atOrAfter = rows.find((r) => r.snapshot_at.slice(0, 13) >= baselineLabel);
      if (atOrAfter) baseline = atOrAfter[metric];
    }

    for (const row of rows) {
      const raw = row[metric];
      const hourKey = row.snapshot_at.slice(0, 13);
      let value = raw;
      if (mode === "percent") {
        value = baseline ? ((raw - baseline) / Math.abs(baseline)) * 100 : 0;
      } else if (mode === "net") {
        value = raw - baseline;
      }
      if (!buckets.has(hourKey)) buckets.set(hourKey, { label: hourKey });
      buckets.get(hourKey)[anime.title] = value;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => (a.label < b.label ? -1 : 1));
}

export default function Explorer() {
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [growthById, setGrowthById] = useState({});
  const [metric, setMetric] = useState("num_list_users");
  const [chartMode, setChartMode] = useState("absolute");
  const [manualBaseline, setManualBaseline] = useState(null); // hourKey | null
  const [sortKey, setSortKey] = useState("num_list_users");
  const [sortDir, setSortDir] = useState("desc");
  const [loadingIds, setLoadingIds] = useState(new Set());
  const [growthErrors, setGrowthErrors] = useState({});
  const [brushRange, setBrushRange] = useState(null); // {startIndex, endIndex} | null == full range
  const [resetToken, setResetToken] = useState(0);

  useEffect(() => {
    api.listCatalog().then(setCatalog).catch((error) => setCatalogError(error.message));
  }, []);

  async function fetchGrowth(id) {
    setLoadingIds((s) => new Set(s).add(id));
    setGrowthErrors((cur) => {
      const { [id]: _drop, ...rest } = cur;
      return rest;
    });
    try {
      const rows = await api.getGrowth(id);
      setGrowthById((cur) => ({ ...cur, [id]: rows }));
    } catch (error) {
      setGrowthErrors((cur) => ({ ...cur, [id]: error.message }));
    } finally {
      setLoadingIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  const filteredCatalog = useMemo(() => {
    if (!catalog) return [];
    if (!query.trim()) return catalog;
    const q = query.toLowerCase();
    return catalog.filter((c) => c.title.toLowerCase().includes(q));
  }, [catalog, query]);

  const selected = useMemo(
    () => (catalog || []).filter((c) => selectedIds.includes(c.id)),
    [catalog, selectedIds]
  );

  function toggle(id) {
    if (selectedIds.includes(id)) {
      setSelectedIds((cur) => cur.filter((x) => x !== id));
      return;
    }
    if (selectedIds.length >= 10) return; // keep the chart/legend readable
    setSelectedIds((cur) => [...cur, id]);
    if (!growthById[id]) {
      fetchGrowth(id);
    }
  }

  function clearAll() {
    setSelectedIds([]);
  }

  // --- Time period (driven by the chart's Brush) ------------------------

  const bucketLabels = useMemo(
    () => getBucketLabels(selected, growthById, metric),
    [selected, growthById, metric]
  );
  const hasBuckets = bucketLabels.length > 0;

  const effectiveBrush = useMemo(() => {
    const len = bucketLabels.length;
    if (!len) return { startIndex: 0, endIndex: 0 };
    const start = brushRange ? Math.min(brushRange.startIndex, len - 1) : 0;
    const end = brushRange ? Math.min(brushRange.endIndex, len - 1) : len - 1;
    return { startIndex: Math.min(start, end), endIndex: Math.max(start, end) };
  }, [brushRange, bucketLabels.length]);

  // What we actually feed the Brush as its startIndex/endIndex props. This
  // deliberately only recomputes on an explicit reset or when data first
  // becomes available -- NOT on every drag tick. Recharts' Brush fights
  // back (jumps/stutters) if you keep re-feeding it a "live" index while
  // the user is mid-drag; it needs to own its position during a drag and
  // only be repositioned by us when we deliberately want to move it.
  const brushSeed = useMemo(() => {
    const len = bucketLabels.length;
    if (!len) return { startIndex: 0, endIndex: 0 };
    const start = brushRange ? Math.min(brushRange.startIndex, len - 1) : 0;
    const end = brushRange ? Math.min(brushRange.endIndex, len - 1) : len - 1;
    return { startIndex: Math.min(start, end), endIndex: Math.max(start, end) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken, hasBuckets]);
  const brushKey = `${resetToken}-${hasBuckets}`;

  const periodStartLabel = bucketLabels[effectiveBrush.startIndex];
  const periodEndLabel = bucketLabels[effectiveBrush.endIndex];
  const isPeriodNarrowed = brushRange != null && bucketLabels.length > 0
    && (effectiveBrush.startIndex > 0 || effectiveBrush.endIndex < bucketLabels.length - 1);
  const periodLabel = isPeriodNarrowed
    ? `${formatHourKey(periodStartLabel)} — ${formatHourKey(periodEndLabel)}`
    : "Full history";

  function resetZoom() {
    setBrushRange(null);
    setResetToken((t) => t + 1);
  }

  // Recharts calls onChange on every intermediate step of a drag, not just
  // on release. Committing straight to state each time reruns the whole
  // chart-data/period-table recompute per pixel, which is what made
  // dragging feel laggy -- so we debounce the commit a touch instead.
  const brushChangeTimer = useRef(null);
  useEffect(() => () => clearTimeout(brushChangeTimer.current), []);
  function handleBrushChange(range) {
    clearTimeout(brushChangeTimer.current);
    brushChangeTimer.current = setTimeout(() => setBrushRange(range), 60);
  }

  // --- Chart data (Absolute / % change / Net gain) -----------------------
  // The zero point defaults to the start of whatever period the Brush has
  // selected, but a manually-picked timestamp (click on the chart, or the
  // dropdown below) always wins.

  const effectiveBaselineLabel = manualBaseline || (isPeriodNarrowed ? periodStartLabel : undefined);

  const chartData = useMemo(
    () => buildSeries(selected, growthById, metric, chartMode, effectiveBaselineLabel),
    [selected, growthById, metric, chartMode, effectiveBaselineLabel]
  );

  const chartSeries = useMemo(
    () => selected.map((anime, i) => ({ key: anime.title, color: PALETTE[i % PALETTE.length] })),
    [selected]
  );

  // --- Period summary (value at period end + gain since period start) ---

  const periodRows = useMemo(() => {
    return selected.map((anime) => {
      const rows = (growthById[anime.id] || []).map(withDerived);
      const windowed = isPeriodNarrowed ? rowsInHourRange(rows, periodStartLabel, periodEndLabel) : rows;
      const periodStart = windowed[0] ?? rows[0];
      const periodEnd = windowed[windowed.length - 1] ?? rows[rows.length - 1];
      return { anime, periodStart, periodEnd };
    });
  }, [selected, growthById, isPeriodNarrowed, periodStartLabel, periodEndLabel]);

  const sortedPeriodRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...periodRows].sort((r1, r2) => {
      const v1 = r1.periodEnd?.[sortKey];
      const v2 = r2.periodEnd?.[sortKey];
      if (v1 == null && v2 == null) return 0;
      if (v1 == null) return 1;
      if (v2 == null) return -1;
      return v1 < v2 ? -1 * dir : v1 > v2 ? 1 * dir : 0;
    });
  }, [periodRows, sortKey, sortDir]);

  function onSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultDirFor(key));
    }
  }

  // Duration of the summary period in days, for the "avg/day" rate. Floored
  // at an hour so a razor-thin Brush selection can't divide-by-near-zero.
  const periodDays = useMemo(() => {
    if (!periodStartLabel || !periodEndLabel) return null;
    const start = new Date(`${periodStartLabel}:00:00`);
    const end = new Date(`${periodEndLabel}:00:00`);
    return Math.max((end - start) / (1000 * 60 * 60 * 24), 1 / 24);
  }, [periodStartLabel, periodEndLabel]);

  // Which selected show moved the most (either direction) on the currently
  // charted metric, over the summary period.
  const biggestMover = useMemo(() => {
    let best = null;
    for (const { anime, periodStart, periodEnd } of periodRows) {
      const v1 = periodStart?.[metric];
      const v2 = periodEnd?.[metric];
      if (v1 == null || v2 == null) continue;
      const gain = v2 - v1;
      if (!best || Math.abs(gain) > Math.abs(best.gain)) best = { anime, gain };
    }
    return best;
  }, [periodRows, metric]);

  return (
    <PageShell
      title="Explorer"
      subtitle="Pick a handful of shows, pick a metric, and compare their growth curves side by side. Drag the strip under the chart to zoom into a time period, or drag the selected window to pan."
      wide
    >
      {catalogError && (
        <div className="panel border-rust text-sm text-rust mb-6 p-4">
          Could not load the catalog: {catalogError}
        </div>
      )}
      <div className="grid grid-cols-[280px_1fr] gap-6">
        {/* Picker */}
        <div className="panel p-3 h-fit">
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search catalog…"
              className="field w-full pl-8 text-sm"
            />
          </div>
          {selected.length > 0 && (
            <div className="flex items-center justify-between mb-2 px-0.5">
              <span className="text-[10.5px] text-ink-faint font-mono">{selected.length}/10 selected</span>
              <button onClick={clearAll} className="text-[10.5px] text-rust hover:underline">clear</button>
            </div>
          )}
          <div className="max-h-[520px] overflow-y-auto flex flex-col gap-1">
            {catalog === null && <div className="text-xs text-ink-faint px-2 py-4">Loading…</div>}
            {catalog?.length === 0 && <div className="text-xs text-ink-faint px-2 py-4">Catalog is empty — visit Browse first.</div>}
            {filteredCatalog.map((c) => {
              const isOn = selectedIds.includes(c.id);
              const isLoading = loadingIds.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  disabled={!isOn && selectedIds.length >= 10}
                  className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors disabled:opacity-40 ${
                    isOn ? "bg-pine-soft" : "hover:bg-panel-alt"
                  }`}
                >
                  <Thumb src={c.image_url} className="w-6 h-8 shrink-0" />
                  <span className="text-xs font-medium truncate flex-1">{c.title}</span>
                  {isLoading && <RefreshCw size={11} className="animate-spin text-ink-faint shrink-0" />}
                  {!isLoading && growthErrors[c.id] && (
                    <AlertCircle size={11} className="text-rust shrink-0" title={`Couldn't load growth data: ${growthErrors[c.id]}`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Chart + table */}
        <div className="flex flex-col gap-5 min-w-0">
          {selected.length === 0 ? (
            <EmptyState title="Pick a few shows">Select anime on the left to plot and compare their growth.</EmptyState>
          ) : (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <Link to="/tables" className="text-xs text-pine hover:underline">
                  Open full history &amp; FAL weekly points →
                </Link>
                <div className="flex items-center gap-3">
                  <span className="text-[10.5px] text-ink-faint font-mono">{periodLabel}</span>
                  {isPeriodNarrowed && (
                    <button onClick={resetZoom} className="text-[10.5px] text-rust hover:underline">reset zoom</button>
                  )}
                </div>
              </div>

              {selected.some((a) => growthErrors[a.id]) && (
                <div className="panel border-rust text-sm text-rust p-4 flex items-center justify-between gap-3">
                  <span>
                    Couldn't load growth data for{" "}
                    {selected.filter((a) => growthErrors[a.id]).map((a) => a.title).join(", ")}.
                  </span>
                  <button
                    onClick={() => selected.forEach((a) => growthErrors[a.id] && fetchGrowth(a.id))}
                    className="text-xs underline shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}

              <div className="panel p-5">
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  {METRICS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setMetric(m)}
                      className={`chip border ${metric === m ? "bg-pine text-white border-pine" : "border-line text-ink-faint"}`}
                    >
                      {METRIC_LABELS[m]}
                    </button>
                  ))}
                  <div className="ml-auto flex items-center gap-1 rounded-lg border border-line p-0.5">
                    {CHART_MODES.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setChartMode(m.id)}
                        className={`chip ${chartMode === m.id ? "bg-pine text-white" : "text-ink-faint hover:bg-panel-alt"}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {chartMode !== "absolute" && (
                  <div className="flex flex-wrap items-center gap-2 mb-3 text-xs text-ink-soft">
                    <span className="text-ink-faint">Zero point:</span>
                    <select
                      value={manualBaseline ?? ""}
                      onChange={(e) => setManualBaseline(e.target.value || null)}
                      className="field text-xs py-1 w-auto"
                    >
                      <option value="">
                        {isPeriodNarrowed ? `Start of selected period (${formatHourKey(periodStartLabel)})` : "First available point"}
                      </option>
                      {bucketLabels.map((hk) => (
                        <option key={hk} value={hk}>{formatHourKey(hk)}</option>
                      ))}
                    </select>
                    {manualBaseline && (
                      <button onClick={() => setManualBaseline(null)} className="text-rust hover:underline">clear</button>
                    )}
                    <span className="text-ink-faint">or click a point on the chart to zero it there</span>
                  </div>
                )}

                {biggestMover && (
                  <p className="text-[10.5px] text-ink-faint mb-2">
                    Biggest mover ({METRIC_LABELS[metric]}):{" "}
                    <span className="text-pine font-medium">{biggestMover.anime.title}</span>{" "}
                    {fmtSigned(biggestMover.gain)}
                  </p>
                )}

                {chartData.length === 0 ? (
                  <div className="text-sm text-ink-faint py-14 text-center">No snapshots yet for the selected shows.</div>
                ) : (
                  <div className="h-96">
                    <ExplorerGrowthChart
                      data={chartData}
                      series={chartSeries}
                      mode={chartMode}
                      valueFormatter={fmt}
                      brushKey={brushKey}
                      brushStartIndex={brushSeed.startIndex}
                      brushEndIndex={brushSeed.endIndex}
                      onBrushChange={handleBrushChange}
                      onPointClick={(label) => setManualBaseline(label)}
                    />
                  </div>
                )}
                <p className="text-[10.5px] text-ink-faint mt-2">
                  Drag the handles on the strip below the chart to zoom into a time period, or drag the selected
                  window to pan. In % change / Net gain mode, click a point on the chart to zero it there.
                </p>
              </div>

              <div className="panel p-5 overflow-x-auto">
                <h4 className="text-sm mb-3">
                  {isPeriodNarrowed ? "Selected period, side by side" : "Latest snapshot, side by side"}
                </h4>
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="text-left text-xs text-ink-faint border-b border-line">
                      <th className="py-1.5 pr-4">Show</th>
                      {SUMMARY_METRICS.map((col) => (
                        <th key={col} className="pr-4">
                          <button onClick={() => onSort(col)} className="flex items-center gap-1 hover:text-pine">
                            {METRIC_LABELS[col]}
                            <ArrowUpDown size={11} className={sortKey === col ? "text-pine" : "text-ink-faint"} />
                          </button>
                        </th>
                      ))}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPeriodRows.map(({ anime, periodEnd, periodStart }) => (
                      <tr key={anime.id} className="border-b border-line last:border-0">
                        <td className="py-2 pr-4">
                          <Link to={`/anime/${anime.id}`} className="flex items-center gap-2 hover:text-pine">
                            <Thumb src={anime.image_url} className="w-6 h-8 shrink-0" />
                            <span className="font-medium truncate max-w-[180px]">{anime.title}</span>
                          </Link>
                        </td>
                        {SUMMARY_METRICS.map((col) => {
                          const v = periodEnd?.[col];
                          const pv = periodStart?.[col];
                          const delta = v != null && pv != null ? v - pv : null;
                          const goodUp = !LOWER_IS_BETTER.has(col);
                          const deltaColor = delta == null || delta === 0 ? "text-ink-faint"
                            : (delta > 0) === goodUp ? "text-pine" : "text-rust";
                          const highlight = col === metric;
                          return (
                            <td key={col} className="pr-4 font-mono">
                              <span className={highlight ? "bg-pine-soft rounded px-1" : ""}>{fmt(v)}</span>
                              {delta != null && delta !== 0 && (
                                <span className={`ml-1 text-[10px] ${deltaColor}`}>
                                  {delta > 0 ? "+" : ""}{fmt(delta)}
                                </span>
                              )}
                              {highlight && delta != null && periodDays && (
                                <div className="text-[9px] text-ink-faint">~{fmt(delta / periodDays)}/day</div>
                              )}
                            </td>
                          );
                        })}
                        <td>
                          <button onClick={() => toggle(anime.id)} className="text-ink-faint hover:text-rust">
                            <X size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
