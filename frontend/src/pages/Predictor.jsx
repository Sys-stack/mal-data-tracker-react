import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Wand2, Check } from "lucide-react";
import { api } from "../lib/api.js";
import { Thumb, EmptyState, Chip, SliderInput } from "../components/Common.jsx";
import { PredictorChart } from "../components/Charts.jsx";
import { curveSeries, METRICS, METRIC_LABELS, formatNumber, metricBounds, expandBounds } from "../lib/curve.js";

export default function Predictor() {
  const [params] = useSearchParams();
  const [catalog, setCatalog] = useState(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [metric, setMetric] = useState("num_list_users");
  const [baseline, setBaseline] = useState(0);
  const [a, setA] = useState(0);
  const [b, setB] = useState(1);
  const [bounds, setBounds] = useState(metricBounds(0, 0, "num_list_users"));
  const [isSet, setIsSet] = useState(false);
  const [savedMetrics, setSavedMetrics] = useState([]);
  const [saveStatus, setSaveStatus] = useState("");
  const [fitting, setFitting] = useState(false);

  useEffect(() => {
    api.listCatalog().then((c) => {
      setCatalog(c);
      const deepLinkId = params.get("anime_id");
      if (deepLinkId) {
        const found = c.find((x) => String(x.id) === deepLinkId);
        if (found) setSelected(found);
      }
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    loadMetric(metric);
  }, [selected]);

  async function loadMetric(m) {
    setMetric(m);
    setSaveStatus("");
    const existing = await api.listPredictions(selected.id);
    setSavedMetrics(existing.filter((p) => p.is_set).map((p) => p.metric));
    const row = existing.find((p) => p.metric === m);
    if (row) {
      setBounds(metricBounds(row.baseline, row.a, m));
      applyParams(row.baseline, row.a, row.b);
      setIsSet(!!row.is_set);
    } else {
      setIsSet(false);
      await fitFromHistory(m);
    }
  }

  async function fitFromHistory(m = metric) {
    setFitting(true);
    try {
      const data = await api.fitPrediction(selected.id, m, 0);
      setBounds({ a_min: data.a_min, a_max: data.a_max, baseline_min: data.baseline_min, baseline_max: data.baseline_max });
      applyParams(data.baseline, data.a, data.b);
    } finally {
      setFitting(false);
    }
  }

  function applyParams(bl, aa, bb) {
    setBaseline(bl); setA(aa); setB(bb);
  }

  async function saveSet() {
    setSaveStatus("Saving…");
    try {
      await api.setPrediction(selected.id, metric, baseline, a, b);
      setSaveStatus("Set ✓");
      setIsSet(true);
      setSavedMetrics((cur) => [...new Set([...cur, metric])]);
    } catch (e) {
      setSaveStatus(e.message);
    }
  }

  const chartData = useMemo(() => curveSeries(baseline, a, b, 13, 0.25), [baseline, a, b]);

  const filteredCatalog = useMemo(() => {
    if (!catalog) return [];
    return catalog.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()));
  }, [catalog, query]);

  return (
    <div className="flex h-screen">
      {/* Sources pane */}
      <div className="w-72 shrink-0 border-r border-line bg-panel-alt flex flex-col">
        <div className="p-4 border-b border-line">
          <h2 className="text-base mb-2">Sources</h2>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search catalog…" className="field w-full pl-8 text-sm" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {catalog === null && <div className="text-xs text-ink-faint px-2 py-4">Loading…</div>}
          {catalog?.length === 0 && <div className="text-xs text-ink-faint px-2 py-4">Catalog is empty — visit Browse first.</div>}
          {filteredCatalog.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left mb-1 transition-colors ${
                selected?.id === c.id ? "bg-pine-soft" : "hover:bg-panel"
              }`}
            >
              <Thumb src={c.image_url} className="w-7 h-9 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{c.title}</div>
                <div className="text-[10px] text-ink-faint font-mono">{c.tracked ? "tracked" : "not tracked"}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Workspace */}
      <div className="flex-1 overflow-y-auto px-10 py-8">
        <h1 className="text-2xl mb-1">Growth predictor</h1>
        <p className="text-sm text-ink-soft max-w-xl mb-6">
          <code className="font-mono text-xs bg-panel-alt px-1.5 py-0.5 rounded">value = baseline + a · ln(1 + b · week)</code>{" "}
          — drag a slider or type an exact number; the chart updates instantly either way. Then <b>Set</b> to lock it in for drafting and planning.
        </p>

        {!selected ? (
          <EmptyState title="Pick a show from Sources">Select any catalog title on the left to start shaping its prediction.</EmptyState>
        ) : (
          <div className="panel p-6">
            <div className="flex items-center gap-3 mb-5">
              <Thumb src={selected.image_url} className="w-12 h-16" />
              <div>
                <h3 className="text-lg leading-tight">{selected.title}</h3>
                <div className="text-xs text-ink-faint font-mono">{selected.studios || "—"}</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-5">
              {METRICS.map((m) => (
                <button key={m} onClick={() => loadMetric(m)}
                        className={`chip border ${metric === m ? "bg-pine text-white border-pine" : "border-line text-ink-faint"}`}>
                  {METRIC_LABELS[m]}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-5">
              <button onClick={() => fitFromHistory()} disabled={fitting} className="btn text-xs">
                <Wand2 size={13} /> {fitting ? "Fitting…" : "Auto-fit from history"}
              </button>
              {isSet && <Chip tone="pine"><Check size={11} /> set</Chip>}
              {metric !== "score" && <span className="text-[11px] text-ink-faint">Member-style metrics default to a range that reaches six figures — type any exact value if the slider isn't wide enough.</span>}
            </div>

            <SliderInput label="Scale (a)" value={a} min={bounds.a_min} max={bounds.a_max}
                         onChange={setA} onExpand={(v) => setBounds((cur) => expandBounds(cur, "a", v))}
                         format={formatNumber} />
            <SliderInput label="Rate (b) — higher front-loads growth sooner" value={b} min={0.01} max={10} step={0.01}
                         onChange={setB} />
            <SliderInput label="Baseline (week 0 value)" value={baseline} min={bounds.baseline_min} max={bounds.baseline_max}
                         onChange={setBaseline} onExpand={(v) => setBounds((cur) => expandBounds(cur, "baseline", v))}
                         format={formatNumber} />

            <div className="h-72 mt-4">
              <PredictorChart data={chartData} />
            </div>

            <div className="flex items-center gap-3 mt-4">
              <button onClick={saveSet} className="btn btn-primary">Set this prediction</button>
              <span className="text-xs text-ink-faint">{saveStatus}</span>
            </div>
          </div>
        )}
      </div>

      {/* Studio pane */}
      {selected && (
        <div className="w-64 shrink-0 border-l border-line bg-panel-alt p-4 overflow-y-auto">
          <h2 className="text-base mb-3">Studio</h2>
          <div className="panel p-3 mb-3">
            <div className="text-xs text-ink-faint mb-1">Predicted at week 13</div>
            <div className="font-mono text-lg font-semibold">{formatNumber(curveSeries(baseline, a, b, 13)[13]?.value)}</div>
          </div>
          <div className="panel p-3">
            <div className="text-xs text-ink-faint mb-2">Set metrics for this show</div>
            {savedMetrics.length === 0 ? (
              <p className="text-xs text-ink-faint">None yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {savedMetrics.map((m) => <Chip key={m} tone="pine">{METRIC_LABELS[m]}</Chip>)}
              </div>
            )}
          </div>
          <p className="text-[11px] text-ink-faint leading-relaxed mt-3">
            Only <b>set</b> predictions feed the Team Draft comparison chart and the Planner's weekly scoring.
          </p>
        </div>
      )}
    </div>
  );
}
