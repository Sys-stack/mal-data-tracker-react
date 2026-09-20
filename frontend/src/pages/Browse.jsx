import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "../lib/api.js";
import { PageShell, Thumb, EmptyState } from "../components/Common.jsx";

const SEASONS = ["winter", "spring", "summer", "fall"];

export default function Browse() {
  const [catalog, setCatalog] = useState(null);
  const [season, setSeason] = useState("fall");
  const [year, setYear] = useState(2026);
  const [singleId, setSingleId] = useState("");
  const [status, setStatus] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = () => api.listCatalog().then(setCatalog);
  useEffect(() => { load(); }, []);

  async function refresh() {
    setRefreshing(true);
    setStatus("Pulling from MAL…");
    try {
      const res = await api.refreshCatalog(season, year);
      setStatus(`Added/updated ${res.added} shows.`);
      load();
    } catch (e) {
      setStatus(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  async function addSingle() {
    if (!singleId.trim()) return;
    try {
      await api.addAnime(singleId.trim());
      setSingleId("");
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function toggleTrack(a) {
    await api.setTracked(a.id, !a.tracked);
    load();
  }

  return (
    <PageShell
      title="Browse season lineup"
      subtitle="Pull a season's TV entries from MAL with cover art, then flip on hourly tracking for the shows you want on the Dashboard."
      wide
    >
      <div className="panel p-4 mb-6 flex flex-wrap items-center gap-3">
        <select value={season} onChange={(e) => setSeason(e.target.value)} className="field capitalize">
          {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="field w-24" />
        <button onClick={refresh} disabled={refreshing} className="btn btn-primary">
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Pull from MAL
        </button>
        <span className="text-xs text-ink-faint">{status}</span>

        <div className="ml-auto flex items-center gap-2">
          <input value={singleId} onChange={(e) => setSingleId(e.target.value)} placeholder="…or add one MAL ID" className="field w-48" />
          <button onClick={addSingle} className="btn">Add</button>
        </div>
      </div>

      {catalog === null ? (
        <div className="text-sm text-ink-faint">Loading…</div>
      ) : catalog.length === 0 ? (
        <EmptyState title="Catalog is empty">Pull a season above to get started.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {catalog.map((a) => (
            <div key={a.id} className="panel overflow-hidden flex flex-col">
              <Thumb src={a.image_url} className="w-full h-40 rounded-none border-0" />
              <div className="p-3 flex flex-col gap-2 flex-1">
                <div className="text-sm font-medium leading-snug">{a.title}</div>
                <div className="text-xs text-ink-faint font-mono">{a.studios || "studio unknown"}</div>
                <div className="mt-auto flex gap-1.5 pt-1">
                  <button onClick={() => toggleTrack(a)} className={`btn flex-1 justify-center text-xs ${a.tracked ? "btn-primary" : ""}`}>
                    {a.tracked ? "Tracking ✓" : "Track hourly"}
                  </button>
                  <Link to={`/predictor?anime_id=${a.id}`} className="btn text-xs">Predict</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
