import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Search, ArrowUpDown, RefreshCw, AlertCircle, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import {
  METRICS, METRIC_LABELS, SUMMARY_METRICS,
  withDerived, fmt, formatTimestamp, formatDate, defaultDirFor,
  rowsInDateRange, addDays, periodGain, sumPeriodGain,
} from "../lib/metrics.js";
import { PageShell, Thumb, EmptyState } from "../components/Common.jsx";

const TABS = [
  { id: "points", label: "Weekly points" },
  { id: "preseason", label: "Preseason" },
  { id: "history", label: "Raw history" },
];

// Tables is a dense analysis view, not a chart legend -- no real reason to
// cap this as tightly as Explorer's chart does.
const MAX_SELECTED = 40;

let nextStatId = 1;
function defaultPreseasonStat() {
  return { id: nextStatId++, label: "PTW gain (pre-season)", metric: "plan_to_watch", days: 14 };
}

export default function Tables() {
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [growthById, setGrowthById] = useState({});
  const [loadingIds, setLoadingIds] = useState(new Set());
  const [growthErrors, setGrowthErrors] = useState({});

  const [seasonWeeks, setSeasonWeeks] = useState(13); // overwritten once /config loads
  const [configError, setConfigError] = useState("");
  const [seasonStart, setSeasonStart] = useState("");
  const [weekRules, setWeekRules] = useState(() => Array.from({ length: 13 }, () => []));
  const [bulkOdd, setBulkOdd] = useState("");
  const [bulkEven, setBulkEven] = useState("");
  const [pointsSortDir, setPointsSortDir] = useState("desc");

  const [preseasonStats, setPreseasonStats] = useState(() => [defaultPreseasonStat()]);

  const [activeTab, setActiveTab] = useState("points");
  const [historySortKey, setHistorySortKey] = useState("snapshot_at");
  const [historySortDir, setHistorySortDir] = useState("desc");

  useEffect(() => {
    api.listCatalog().then(setCatalog).catch((error) => setCatalogError(error.message));
    api.getConfig()
      .then((cfg) => {
        if (cfg?.season_weeks) {
          setSeasonWeeks(cfg.season_weeks);
          // Week 1 is Watching per the league rules given so far; every other
          // week is left unset until you tell me what the rest are.
          setWeekRules((cur) =>
            Array.from({ length: cfg.season_weeks }, (_, i) => cur[i] ?? (i === 0 ? ["watching"] : []))
          );
        }
      })
      .catch((error) => setConfigError(error.message));
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
    if (selectedIds.length >= MAX_SELECTED) return;
    setSelectedIds((cur) => [...cur, id]);
    if (!growthById[id]) fetchGrowth(id);
  }

  function clearAll() {
    setSelectedIds([]);
  }

  // --- Weekly points -------------------------------------------------

  function addMetricToWeek(weekIdx, metric) {
    setWeekRules((cur) => {
      const next = [...cur];
      const existing = next[weekIdx] || [];
      if (!existing.includes(metric)) next[weekIdx] = [...existing, metric];
      return next;
    });
  }

  function removeMetricFromWeek(weekIdx, metric) {
    setWeekRules((cur) => {
      const next = [...cur];
      next[weekIdx] = (next[weekIdx] || []).filter((m) => m !== metric);
      return next;
    });
  }

  function applyBulk(parity, metricValue) {
    if (!metricValue) return;
    setWeekRules((cur) =>
      cur.map((v, i) => {
        const weekNum = i + 1;
        const isOdd = weekNum % 2 === 1;
        return (parity === "odd") === isOdd ? [metricValue] : v;
      })
    );
  }

  const weekRanges = useMemo(() => {
    if (!seasonStart) return [];
    const weeks = [];
    for (let w = 1; w <= seasonWeeks; w++) {
      weeks.push({ week: w, start: addDays(seasonStart, (w - 1) * 7), end: addDays(seasonStart, w * 7) });
    }
    return weeks;
  }, [seasonStart, seasonWeeks]);

  const weeklyPointsRows = useMemo(() => {
    return selected.map((anime) => {
      const rows = (growthById[anime.id] || []).map(withDerived);
      const weekly = weekRanges.map((w, i) => {
        const metrics = weekRules[i] || [];
        if (metrics.length === 0) return { week: w.week, metrics: [], gain: null };
        const windowed = rowsInDateRange(rows, `${w.start}T00:00:00`, `${w.end}T00:00:00`);
        return { week: w.week, metrics, gain: sumPeriodGain(windowed, metrics) };
      });
      const total = weekly.reduce((sum, w) => sum + (w.gain ?? 0), 0);
      return { anime, weekly, total };
    });
  }, [selected, growthById, weekRanges, weekRules]);

  const sortedPointsRows = useMemo(() => {
    const dir = pointsSortDir === "asc" ? 1 : -1;
    return [...weeklyPointsRows].sort((a, b) => (a.total < b.total ? -1 * dir : a.total > b.total ? 1 * dir : 0));
  }, [weeklyPointsRows, pointsSortDir]);

  // --- Preseason -------------------------------------------------------

  const preseasonResults = useMemo(() => {
    if (!seasonStart) return [];
    return preseasonStats.map((stat) => {
      const windowStart = addDays(seasonStart, -stat.days);
      const rows = selected
        .map((anime) => {
          const animeRows = (growthById[anime.id] || []).map(withDerived);
          const windowed = rowsInDateRange(animeRows, `${windowStart}T00:00:00`, `${seasonStart}T00:00:00`);
          return { anime, gain: periodGain(windowed, stat.metric) };
        })
        .sort((a, b) => (b.gain ?? -Infinity) - (a.gain ?? -Infinity));
      return { stat, windowStart, rows };
    });
  }, [preseasonStats, selected, growthById, seasonStart]);

  function updateStat(id, patch) {
    setPreseasonStats((cur) => cur.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function removeStat(id) {
    setPreseasonStats((cur) => cur.filter((s) => s.id !== id));
  }
  function addStat() {
    setPreseasonStats((cur) => [...cur, defaultPreseasonStat()]);
  }

  // --- Raw history -------------------------------------------------------

  const historyRows = useMemo(() => {
    const out = [];
    for (const anime of selected) {
      for (const row of (growthById[anime.id] || []).map(withDerived)) out.push({ anime, row });
    }
    return out;
  }, [selected, growthById]);

  const sortedHistoryRows = useMemo(() => {
    const dir = historySortDir === "asc" ? 1 : -1;
    return [...historyRows].sort((a, b) => {
      let v1, v2;
      if (historySortKey === "snapshot_at") { v1 = a.row.snapshot_at; v2 = b.row.snapshot_at; }
      else if (historySortKey === "title") { v1 = a.anime.title; v2 = b.anime.title; }
      else { v1 = a.row[historySortKey]; v2 = b.row[historySortKey]; }
      if (v1 == null && v2 == null) return 0;
      if (v1 == null) return 1;
      if (v2 == null) return -1;
      return v1 < v2 ? -1 * dir : v1 > v2 ? 1 * dir : 0;
    });
  }, [historyRows, historySortKey, historySortDir]);

  function onHistorySort(key) {
    if (historySortKey === key) {
      setHistorySortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setHistorySortKey(key);
      setHistorySortDir(defaultDirFor(key));
    }
  }

  const needsSeasonStart = activeTab !== "history" && !seasonStart;

  return (
    <PageShell
      title="Tables"
      subtitle="Full history, weekly FAL points, and preseason stats for your tracked shows."
      wide
    >
      {catalogError && (
        <div className="panel border-rust text-sm text-rust mb-6 p-4">
          Could not load the catalog: {catalogError}
        </div>
      )}
      {configError && (
        <div className="panel border-rust text-sm text-rust mb-6 p-4">
          Could not load league config ({configError}) — using a default of {seasonWeeks} weeks.
        </div>
      )}
      <div className="grid grid-cols-[280px_1fr] gap-6">
        {/* Picker -- same behavior as Explorer's, kept local to this page */}
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
              <span className="text-[10.5px] text-ink-faint font-mono">{selected.length}/{MAX_SELECTED} selected</span>
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
                  disabled={!isOn && selectedIds.length >= MAX_SELECTED}
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

        {/* Tables */}
        <div className="flex flex-col gap-5 min-w-0">
          {selected.length === 0 ? (
            <EmptyState title="Pick a few shows">Select anime on the left to see their points and history.</EmptyState>
          ) : (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1 rounded-lg border border-line p-0.5">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setActiveTab(t.id)}
                      className={`chip ${activeTab === t.id ? "bg-pine text-white" : "text-ink-faint hover:bg-panel-alt"}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <Link to="/explorer" className="text-xs text-pine hover:underline">← Back to Explorer</Link>
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

              {activeTab !== "history" && (
                <div className="panel p-4 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-ink-soft">
                    Season start
                    <input
                      type="date"
                      value={seasonStart}
                      onChange={(e) => setSeasonStart(e.target.value)}
                      className="field text-xs py-1"
                    />
                  </label>
                  <span className="text-[10.5px] text-ink-faint font-mono">{seasonWeeks} week season</span>
                </div>
              )}

              {needsSeasonStart ? (
                <EmptyState title="Set a season start date">
                  Weekly points and preseason stats are both measured against your league's season-start date — pick one above.
                </EmptyState>
              ) : activeTab === "points" ? (
                <div className="panel p-5 overflow-x-auto">
                  <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-ink-soft">
                    <span className="text-ink-faint">Quick fill:</span>
                    <span>Odd weeks (1, 3, 5…) →</span>
                    <select value={bulkOdd} onChange={(e) => setBulkOdd(e.target.value)} className="field text-xs py-1 w-auto">
                      <option value="">choose metric</option>
                      {METRICS.map((m) => (
                        <option key={m} value={m}>{METRIC_LABELS[m]}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => applyBulk("odd", bulkOdd)}
                      disabled={!bulkOdd}
                      className="chip border border-line text-ink-faint disabled:opacity-40"
                    >
                      Apply
                    </button>
                    <span>Even weeks (2, 4, 6…) →</span>
                    <select value={bulkEven} onChange={(e) => setBulkEven(e.target.value)} className="field text-xs py-1 w-auto">
                      <option value="">choose metric</option>
                      {METRICS.map((m) => (
                        <option key={m} value={m}>{METRIC_LABELS[m]}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => applyBulk("even", bulkEven)}
                      disabled={!bulkEven}
                      className="chip border border-line text-ink-faint disabled:opacity-40"
                    >
                      Apply
                    </button>
                  </div>

                  <table className="text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-faint border-b border-line">
                        <th className="py-1.5 pr-4 sticky left-0 bg-white">Show</th>
                        {weekRanges.map((w, i) => (
                          <th key={w.week} className="pr-4 align-bottom pt-1 min-w-[130px]">
                            <div className="flex flex-col items-start gap-1">
                              <span>Wk {w.week}</span>
                              <div className="flex flex-wrap gap-1 max-w-[130px]">
                                {(weekRules[i] || []).map((m) => (
                                  <span key={m} className="chip bg-pine-soft text-pine-dark text-[9px] py-0 px-1.5 flex items-center gap-1">
                                    {METRIC_LABELS[m]}
                                    <button onClick={() => removeMetricFromWeek(i, m)} className="hover:text-rust leading-none">×</button>
                                  </span>
                                ))}
                              </div>
                              <select
                                value=""
                                onChange={(e) => { if (e.target.value) addMetricToWeek(i, e.target.value); }}
                                className="field text-[10px] py-0.5 px-1 w-[110px]"
                              >
                                <option value="">+ add metric</option>
                                {METRICS.filter((m) => !(weekRules[i] || []).includes(m)).map((m) => (
                                  <option key={m} value={m}>{METRIC_LABELS[m]}</option>
                                ))}
                              </select>
                            </div>
                          </th>
                        ))}
                        <th className="pr-4 align-bottom">
                          <button
                            onClick={() => setPointsSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                            className="flex items-center gap-1 hover:text-pine"
                          >
                            Total
                            <ArrowUpDown size={11} className="text-pine" />
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPointsRows.map(({ anime, weekly, total }) => (
                        <tr key={anime.id} className="border-b border-line last:border-0">
                          <td className="py-2 pr-4 sticky left-0 bg-white">
                            <Link to={`/anime/${anime.id}`} className="flex items-center gap-2 hover:text-pine">
                              <Thumb src={anime.image_url} className="w-6 h-8 shrink-0" />
                              <span className="font-medium truncate max-w-[160px]">{anime.title}</span>
                            </Link>
                          </td>
                          {weekly.map((w) => (
                            <td
                              key={w.week}
                              className="pr-4 font-mono text-center"
                              title={w.metrics.length ? w.metrics.map((m) => METRIC_LABELS[m]).join(" + ") : undefined}
                            >
                              {w.metrics.length === 0 ? (
                                <span className="text-ink-faint">—</span>
                              ) : w.gain == null ? (
                                <span className="text-ink-faint">no data</span>
                              ) : (
                                <span className={w.gain > 0 ? "text-pine" : w.gain < 0 ? "text-rust" : "text-ink-faint"}>
                                  {w.gain > 0 ? "+" : ""}{fmt(w.gain)}
                                </span>
                              )}
                            </td>
                          ))}
                          <td className="pr-4 font-mono font-semibold">{fmt(total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[10.5px] text-ink-faint mt-3">
                    Points shown here are the raw gain of each week's assigned metric. Roster-level modifiers (Ace
                    bonus/penalty, wildcards) aren't included — those already run through the Planner's Simulate view.
                  </p>
                </div>
              ) : activeTab === "preseason" ? (
                <div className="flex flex-col gap-4">
                  {preseasonResults.map(({ stat, windowStart, rows }) => (
                    <div key={stat.id} className="panel p-5">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <input
                          value={stat.label}
                          onChange={(e) => updateStat(stat.id, { label: e.target.value })}
                          className="field text-sm py-1 flex-1 min-w-[160px] font-medium"
                        />
                        <select
                          value={stat.metric}
                          onChange={(e) => updateStat(stat.id, { metric: e.target.value })}
                          className="field text-xs py-1 w-auto"
                        >
                          {METRICS.map((m) => (
                            <option key={m} value={m}>{METRIC_LABELS[m]}</option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1 text-xs text-ink-soft">
                          <input
                            type="number"
                            min={1}
                            value={stat.days}
                            onChange={(e) => updateStat(stat.id, { days: Math.max(1, Number(e.target.value) || 1) })}
                            className="field text-xs py-1 w-16"
                          />
                          days before season start
                        </label>
                        <button onClick={() => removeStat(stat.id)} className="text-ink-faint hover:text-rust ml-auto">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <p className="text-[10.5px] text-ink-faint mb-3">
                        Window: {formatDate(windowStart)} – {formatDate(seasonStart)}
                      </p>
                      <table className="w-full text-sm whitespace-nowrap">
                        <thead>
                          <tr className="text-left text-xs text-ink-faint border-b border-line">
                            <th className="py-1.5 pr-4">Show</th>
                            <th className="pr-4">Gain</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(({ anime, gain }) => (
                            <tr key={anime.id} className="border-b border-line last:border-0">
                              <td className="py-1.5 pr-4">
                                <Link to={`/anime/${anime.id}`} className="flex items-center gap-2 hover:text-pine">
                                  <Thumb src={anime.image_url} className="w-5 h-7 shrink-0" />
                                  <span className="font-medium truncate max-w-[220px]">{anime.title}</span>
                                </Link>
                              </td>
                              <td className="pr-4 font-mono">
                                {gain == null ? <span className="text-ink-faint">no data</span> : (
                                  <span className={gain > 0 ? "text-pine" : gain < 0 ? "text-rust" : "text-ink-faint"}>
                                    {gain > 0 ? "+" : ""}{fmt(gain)}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  <button
                    onClick={addStat}
                    className="chip border border-line text-ink-faint self-start flex items-center gap-1"
                  >
                    <Plus size={12} /> Add preseason stat
                  </button>
                </div>
              ) : (
                <div className="panel p-5 overflow-x-auto">
                  <h4 className="text-sm mb-3">Historical snapshots</h4>
                  <div className="max-h-[600px] overflow-y-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead>
                        <tr className="text-left text-xs text-ink-faint border-b border-line">
                          <th className="py-1.5 pr-4">
                            <button onClick={() => onHistorySort("title")} className="flex items-center gap-1 hover:text-pine">
                              Show
                              <ArrowUpDown size={11} className={historySortKey === "title" ? "text-pine" : "text-ink-faint"} />
                            </button>
                          </th>
                          <th className="pr-4">
                            <button onClick={() => onHistorySort("snapshot_at")} className="flex items-center gap-1 hover:text-pine">
                              Date
                              <ArrowUpDown size={11} className={historySortKey === "snapshot_at" ? "text-pine" : "text-ink-faint"} />
                            </button>
                          </th>
                          {SUMMARY_METRICS.map((col) => (
                            <th key={col} className="pr-4">
                              <button onClick={() => onHistorySort(col)} className="flex items-center gap-1 hover:text-pine">
                                {METRIC_LABELS[col]}
                                <ArrowUpDown size={11} className={historySortKey === col ? "text-pine" : "text-ink-faint"} />
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedHistoryRows.map(({ anime, row }) => (
                          <tr key={`${anime.id}-${row.snapshot_at}`} className="border-b border-line last:border-0">
                            <td className="py-1.5 pr-4">
                              <Link to={`/anime/${anime.id}`} className="flex items-center gap-2 hover:text-pine">
                                <Thumb src={anime.image_url} className="w-5 h-7 shrink-0" />
                                <span className="font-medium truncate max-w-[160px]">{anime.title}</span>
                              </Link>
                            </td>
                            <td className="pr-4 font-mono text-ink-soft">{formatTimestamp(row.snapshot_at)}</td>
                            {SUMMARY_METRICS.map((col) => (
                              <td key={col} className="pr-4 font-mono">{fmt(row[col])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
