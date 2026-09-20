import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, ChevronDown, TrendingUp, TrendingDown } from "lucide-react";
import { api } from "../lib/api.js";
import { PageShell, Chip } from "../components/Common.jsx";
import { RunningTotalChart } from "../components/Charts.jsx";

const COMPONENT_LABELS = { watching: "Watching", score: "Score", dropped: "Dropped", favorites: "Favorites" };
const COMPONENT_TONES = { watching: "pine", score: "mustard", dropped: "rust", favorites: "steel" };

export default function Simulator() {
  const { teamId } = useParams();
  const [team, setTeam] = useState(null);
  const [sim, setSim] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openWeek, setOpenWeek] = useState(null);

  useEffect(() => {
    api.listTeams().then((teams) => setTeam(teams.find((t) => String(t.id) === teamId)));
    run();
  }, [teamId]);

  async function run() {
    setLoading(true);
    setError("");
    try {
      const data = await api.simulate(teamId);
      setSim(data);
      setOpenWeek(data.weeks[0]?.week ?? null);
    } catch (e) {
      setSim(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const animeSeasonStats = useMemo(() => {
    if (!sim) return [];
    const stats = {};
    for (const w of sim.weeks) {
      for (const [aid, info] of Object.entries(w.per_anime)) {
        if (!stats[aid]) {
          stats[aid] = { anime_id: aid, title: info.title, weeksActive: 0, total: 0, watching: 0, score: 0, dropped: 0, favorites: 0, aceWeeks: [] };
        }
        const s = stats[aid];
        s.weeksActive += 1;
        s.total += info.total;
        s.watching += info.breakdown.watching;
        s.score += info.breakdown.score;
        s.dropped += info.breakdown.dropped;
        s.favorites += info.breakdown.favorites;
      }
      for (const note of w.notes) {
        const match = note.match(/Ace on (.+?) (succeeded|failed)/);
        if (match) {
          const target = Object.values(w.per_anime).find((a) => a.title === match[1]);
          if (target) {
            const key = Object.keys(w.per_anime).find((k) => w.per_anime[k] === target);
            if (stats[key]) stats[key].aceWeeks.push({ week: w.week, outcome: match[2] });
          }
        }
      }
    }
    return Object.values(stats).sort((a, b) => b.total - a.total);
  }, [sim]);

  const bestWeek = useMemo(() => sim?.weeks.reduce((b, w) => (w.team_total > (b?.team_total ?? -Infinity) ? w : b), null), [sim]);
  const worstWeek = useMemo(() => sim?.weeks.reduce((b, w) => (w.team_total < (b?.team_total ?? Infinity) ? w : b), null), [sim]);

  if (!team) return <PageShell title="Simulator"><div className="text-sm text-ink-faint">Loading…</div></PageShell>;

  return (
    <PageShell
      title={`Simulator — ${team.name}`}
      subtitle="Weekly point rundown and per-anime season statistics, computed from your set predictions and scheduled moves. Episode Discussion points aren't simulated — no forum data source exists here."
      action={<Link to={`/planner/${teamId}`} className="btn"><ArrowLeft size={15} /> Planner</Link>}
      wide
    >
      <div className="flex items-center gap-3 mb-6">
        <button onClick={run} disabled={loading} className="btn btn-primary text-sm">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> {loading ? "Simulating…" : "Re-run simulation"}
        </button>
        <span className="text-xs text-ink-faint">Re-run after changing predictions or planner moves.</span>
      </div>

      {error && <div className="text-sm text-rust border border-rust/30 bg-rust-soft rounded-lg px-3 py-2 mb-6">{error}</div>}

      {sim && (
        <>
          {sim.warnings.length > 0 && (
            <div className="flex flex-col gap-1 mb-6">
              {sim.warnings.map((w, i) => <div key={i} className="text-xs text-mustard">⚠ {w}</div>)}
            </div>
          )}

          {/* Season summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <SummaryCard label="Season total" value={`${Math.round(sim.season_total).toLocaleString()} pts`} />
            <SummaryCard label="Swaps used" value={`${sim.swaps_used} / ${sim.swap_budget}`} />
            <SummaryCard label="Wildcard" value={sim.wildcard ? `${sim.wildcard.type} (wk ${sim.wildcard.week})` : "not played"} />
            <SummaryCard
              label="Best / worst week"
              value={bestWeek && worstWeek ? (
                <span className="flex items-center gap-2 text-sm">
                  <span className="flex items-center gap-1 text-pine"><TrendingUp size={13} /> wk {bestWeek.week}</span>
                  <span className="flex items-center gap-1 text-rust"><TrendingDown size={13} /> wk {worstWeek.week}</span>
                </span>
              ) : "—"}
            />
          </div>

          <div className="panel p-5 mb-6">
            <h4 className="text-sm mb-3">Running point total</h4>
            <div className="h-64"><RunningTotalChart weeks={sim.weeks} /></div>
          </div>

          {/* Per-anime season stats */}
          <div className="panel p-5 mb-6">
            <h4 className="text-sm mb-3">Per-anime season statistics</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-faint border-b border-line">
                  <th className="py-1.5">Show</th><th>Weeks active</th><th>Watching pts</th><th>Score pts</th><th>Dropped pts</th><th>Favorites pts</th><th>Total</th><th>Ace</th>
                </tr>
              </thead>
              <tbody>
                {animeSeasonStats.map((s) => (
                  <tr key={s.anime_id} className="border-b border-line last:border-0">
                    <td className="py-1.5"><Link to={`/anime/${s.anime_id}`} className="hover:text-pine font-medium">{s.title}</Link></td>
                    <td className="font-mono">{s.weeksActive}</td>
                    <td className="font-mono">{Math.round(s.watching).toLocaleString()}</td>
                    <td className={`font-mono ${s.score < 0 ? "text-rust" : ""}`}>{Math.round(s.score).toLocaleString()}</td>
                    <td className={`font-mono ${s.dropped < 0 ? "text-rust" : ""}`}>{Math.round(s.dropped).toLocaleString()}</td>
                    <td className="font-mono">{Math.round(s.favorites).toLocaleString()}</td>
                    <td className="font-mono font-semibold">{Math.round(s.total).toLocaleString()}</td>
                    <td>{s.aceWeeks.length > 0
                      ? s.aceWeeks.map((a) => <Chip key={a.week} tone={a.outcome === "succeeded" ? "pine" : "rust"}>wk{a.week} {a.outcome === "succeeded" ? "✓" : "✕"}</Chip>)
                      : <span className="text-ink-faint">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Weekly rundown */}
          <div className="panel p-5">
            <h4 className="text-sm mb-3">Weekly rundown</h4>
            <div className="flex flex-col gap-2">
              {sim.weeks.map((w) => (
                <div key={w.week} className="border border-line rounded-lg overflow-hidden">
                  <button
                    onClick={() => setOpenWeek((cur) => (cur === w.week ? null : w.week))}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-panel-alt text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-ink-faint w-14">Week {w.week}</span>
                      <span className="text-sm font-medium font-mono">{Math.round(w.team_total).toLocaleString()} pts</span>
                      {w.notes.length > 0 && <span className="text-xs text-mustard hidden sm:inline">{w.notes.join(" · ")}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-ink-faint font-mono">running: {Math.round(w.running_total).toLocaleString()}</span>
                      <ChevronDown size={14} className={`transition-transform ${openWeek === w.week ? "rotate-180" : ""}`} />
                    </div>
                  </button>
                  {openWeek === w.week && (
                    <div className="p-4">
                      {w.notes.length > 0 && (
                        <div className="flex flex-col gap-1 mb-3">
                          {w.notes.map((n, i) => <div key={i} className="text-xs text-mustard">• {n}</div>)}
                        </div>
                      )}
                      {Object.keys(w.per_anime).length === 0 ? (
                        <p className="text-xs text-ink-faint">No active shows scored this week.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-ink-faint border-b border-line">
                              <th className="py-1.5">Show</th><th>Members</th>
                              {Object.keys(COMPONENT_LABELS).map((c) => <th key={c}>{COMPONENT_LABELS[c]}</th>)}
                              <th>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(w.per_anime).map(([aid, info]) => (
                              <tr key={aid} className="border-b border-line last:border-0">
                                <td className="py-1.5"><Link to={`/anime/${aid}`} className="hover:text-pine font-medium">{info.title}</Link></td>
                                <td className="font-mono">{Math.round(info.breakdown.members_watching_completed).toLocaleString()}</td>
                                {Object.keys(COMPONENT_LABELS).map((c) => (
                                  <td key={c} className={`font-mono ${info.breakdown[c] < 0 ? "text-rust" : ""}`}>
                                    {info.breakdown[c] ? Math.round(info.breakdown[c]).toLocaleString() : "—"}
                                  </td>
                                ))}
                                <td className="font-mono font-semibold">{Math.round(info.total).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div className="panel p-4">
      <div className="text-[10.5px] text-ink-faint mb-1">{label}</div>
      <div className="text-lg font-mono font-semibold">{value}</div>
    </div>
  );
}
