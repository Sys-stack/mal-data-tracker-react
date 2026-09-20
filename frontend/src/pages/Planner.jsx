import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Trash2, BarChart3 } from "lucide-react";
import { api } from "../lib/api.js";
import { PageShell, Thumb, Chip } from "../components/Common.jsx";

const FREE_SWAP_LIMIT_FALLBACK = 4;
const WILDCARD_MIN_WEEK_FALLBACK = 10;
const SEASON_WEEKS_FALLBACK = 13;
const WILDCARDS = [
  { key: "booster", label: "Booster", desc: "+10,000 flat this week." },
  { key: "extra_swap", label: "Extra Swap", desc: `−5,000, grants 1 swap beyond the free-swap budget.` },
  { key: "bomber_up", label: "Bomber (up)", desc: "−5,000 self, −20,000 to a team you choose." },
  { key: "bomber_down", label: "Bomber (down)", desc: "−5,000 self, −20,000 to a team you choose." },
];

export default function Planner() {
  const { teamId } = useParams();
  const [config, setConfig] = useState(null);
  const [team, setTeam] = useState(null);
  const [roster, setRoster] = useState([]);
  const [otherTeams, setOtherTeams] = useState([]);
  const [actions, setActions] = useState([]);

  const [week, setWeek] = useState(1);
  const [moveType, setMoveType] = useState("swap");
  const [swapIn, setSwapIn] = useState("");
  const [swapOut, setSwapOut] = useState("");
  const [aceAnime, setAceAnime] = useState("");
  const [wcType, setWcType] = useState("");
  const [wcTarget, setWcTarget] = useState("");
  const [moveStatus, setMoveStatus] = useState("");

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => setConfig(null));
    (async () => {
      const teams = await api.listTeams();
      const t = teams.find((x) => String(x.id) === teamId);
      setTeam(t);
      setOtherTeams(teams.filter((x) => String(x.id) !== teamId));
      const r = await api.getRoster(teamId);
      setRoster(r);
      const bench = r.filter((x) => x.slot === "bench");
      const act = r.filter((x) => x.slot === "active");
      setSwapIn(bench[0]?.anime_id ?? "");
      setSwapOut(act[0]?.anime_id ?? "");
      setAceAnime(act[0]?.anime_id ?? "");
      loadActions();
    })();
  }, [teamId]);

  async function loadActions() {
    setActions(await api.listActions(teamId));
  }

  async function addMove() {
    setMoveStatus("");
    try {
      if (moveType === "swap") {
        if (!swapIn || !swapOut) return setMoveStatus("Pick both shows.");
        await api.scheduleSwap(teamId, week, swapIn, swapOut);
      } else if (moveType === "ace") {
        await api.scheduleAce(teamId, week, aceAnime);
      } else {
        if (!wcType) return setMoveStatus("Pick a wildcard type.");
        if (week < (config?.wildcard_min_week ?? WILDCARD_MIN_WEEK_FALLBACK)) return setMoveStatus(`Wildcards start week ${config?.wildcard_min_week ?? WILDCARD_MIN_WEEK_FALLBACK}.`);
        const targetSel = wcTarget;
        await api.scheduleWildcard(teamId, week, wcType, targetSel || null);
      }
      setMoveStatus("Scheduled ✓");
      loadActions();
    } catch (e) {
      setMoveStatus(e.message);
    }
  }

  async function removeAction(id) {
    await api.deleteAction(teamId, id);
    loadActions();
  }

  async function resetMoves() {
    if (!confirm("Clear every scheduled move for this team?")) return;
    await api.resetActions(teamId);
    loadActions();
  }

  if (!team) return <PageShell title="Planner"><div className="text-sm text-ink-faint">Loading…</div></PageShell>;

  const SEASON_WEEKS = config?.season_weeks ?? SEASON_WEEKS_FALLBACK;
  const WILDCARD_MIN_WEEK = config?.wildcard_min_week ?? WILDCARD_MIN_WEEK_FALLBACK;
  const FREE_SWAP_LIMIT = config?.free_swap_limit ?? FREE_SWAP_LIMIT_FALLBACK;

  const active = roster.filter((r) => r.slot === "active");
  const bench = roster.filter((r) => r.slot === "bench");
  const swapsUsed = actions.filter((a) => a.action_type === "swap").length;
  const wildcard = actions.find((a) => a.action_type === "wildcard");
  const swapBudget = FREE_SWAP_LIMIT + (wildcard?.payload.type === "extra_swap" ? 1 : 0);
  const ready = active.length === 5 && bench.length === 3;

  return (
    <PageShell
      title={`Planner — ${team.name}`}
      subtitle={`Schedule swaps, one Ace per anime, and your one-time wildcard (from week ${WILDCARD_MIN_WEEK}), across the ${SEASON_WEEKS}-week season.`}
      action={<Link to="/teams" className="btn"><ArrowLeft size={15} /> Team Draft</Link>}
      wide
    >
      <div className="grid grid-cols-2 gap-5 mb-6">
        <div className="panel p-4">
          <h4 className="text-sm mb-3">Draft-day roster</h4>
          <div className="grid grid-cols-2 gap-4">
            <RosterList label="Active" rows={active} />
            <RosterList label="Bench" rows={bench} />
          </div>
        </div>
        <div className="panel p-4">
          <h4 className="text-sm mb-3">Cap &amp; budget</h4>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-line"><td className="py-1.5 text-ink-faint">Ace members cap</td><td className="py-1.5 font-mono text-right">{team.ace_threshold.toLocaleString()}</td></tr>
              <tr className="border-b border-line"><td className="py-1.5 text-ink-faint">Swaps used / budget</td><td className="py-1.5 font-mono text-right">{swapsUsed} / {swapBudget}</td></tr>
              <tr><td className="py-1.5 text-ink-faint">Wildcard</td><td className="py-1.5 font-mono text-right">{wildcard ? `${wildcard.payload.type} (wk ${wildcard.week})` : "not played"}</td></tr>
            </tbody>
          </table>
          <p className="text-xs text-ink-faint mt-3 leading-relaxed">An Ace only pays out (+75,000) if that show's predicted Watching+Completed stays under the cap <i>and</i> it's your top scorer that week — otherwise it costs −5,000.</p>
        </div>
      </div>

      <div className="panel p-4 mb-6">
        <h4 className="text-sm mb-3">Schedule a move</h4>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <label className="text-xs text-ink-faint">Week</label>
          <input type="number" min={1} max={SEASON_WEEKS} value={week} onChange={(e) => setWeek(Number(e.target.value))} className="field w-16" />
          <label className="text-xs text-ink-faint">Type</label>
          <select value={moveType} onChange={(e) => setMoveType(e.target.value)} className="field text-sm">
            <option value="swap">Swap</option>
            <option value="ace">Declare Ace</option>
            <option value="wildcard">Wildcard</option>
          </select>
        </div>

        {moveType === "swap" && (
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <label className="text-xs text-ink-faint">Bench → Active</label>
            <select value={swapIn} onChange={(e) => setSwapIn(e.target.value)} className="field text-sm">
              {bench.map((r) => <option key={r.anime_id} value={r.anime_id}>{r.title}</option>)}
            </select>
            <label className="text-xs text-ink-faint">Active → Bench</label>
            <select value={swapOut} onChange={(e) => setSwapOut(e.target.value)} className="field text-sm">
              {active.map((r) => <option key={r.anime_id} value={r.anime_id}>{r.title}</option>)}
            </select>
          </div>
        )}

        {moveType === "ace" && (
          <div className="flex items-center gap-3 mb-3">
            <label className="text-xs text-ink-faint">Anime</label>
            <select value={aceAnime} onChange={(e) => setAceAnime(e.target.value)} className="field text-sm">
              {roster.map((r) => <option key={r.anime_id} value={r.anime_id}>{r.title}</option>)}
            </select>
          </div>
        )}

        {moveType === "wildcard" && (
          <div className="mb-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {WILDCARDS.map((w) => {
                const disabled = (w.key === "bomber_up" || w.key === "bomber_down") && otherTeams.length === 0;
                return (
                  <button key={w.key} disabled={disabled} onClick={() => setWcType(w.key)}
                          className={`text-left rounded-lg border px-3 py-2.5 text-xs transition-colors ${
                            wcType === w.key ? "border-pine bg-pine-soft" : "border-line"
                          } ${disabled ? "opacity-40 cursor-not-allowed" : "hover:border-pine"}`}>
                    <div className="font-medium mb-0.5">{w.label}</div>
                    <div className="text-ink-faint">{w.desc}{disabled ? " No other teams yet." : ""}</div>
                  </button>
                );
              })}
            </div>
            {otherTeams.length > 0 && (wcType === "bomber_up" || wcType === "bomber_down") && (
              <div className="flex items-center gap-2 mt-2">
                <label className="text-xs text-ink-faint">Target team</label>
                <select value={wcTarget} onChange={(e) => setWcTarget(e.target.value)} className="field text-sm">
                  {otherTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button onClick={addMove} className="btn btn-primary text-sm">Schedule move</button>
          <button onClick={resetMoves} className="btn btn-danger text-sm"><Trash2 size={13} /> Reset all moves</button>
          <span className="text-xs text-ink-faint">{moveStatus}</span>
        </div>
      </div>

      <div className="panel p-4 mb-6">
        <h4 className="text-sm mb-3">Scheduled moves</h4>
        {actions.length === 0 ? (
          <p className="text-xs text-ink-faint">No moves scheduled yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-faint border-b border-line"><th className="py-1.5">Week</th><th>Type</th><th>Details</th><th></th></tr></thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="py-1.5 font-mono">{a.week}</td>
                  <td className="capitalize">{a.action_type}</td>
                  <td className="text-ink-faint">{describePayload(a)}</td>
                  <td><button onClick={() => removeAction(a.id)} className="text-ink-faint hover:text-rust"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Link
        to={`/planner/${teamId}/simulate`}
        className={`panel p-5 flex items-center justify-between transition-colors ${ready ? "hover:border-pine" : "opacity-60 pointer-events-none"}`}
      >
        <div className="flex items-center gap-3">
          <BarChart3 size={20} className="text-pine" />
          <div>
            <div className="text-sm font-medium">Run the season simulator</div>
            <div className="text-xs text-ink-faint">{ready ? "Weekly rundown, per-anime stats, and the running point total." : "Needs exactly 5 active + 3 bench first."}</div>
          </div>
        </div>
        <ArrowLeft size={16} className="rotate-180 text-ink-faint" />
      </Link>
    </PageShell>
  );
}

function RosterList({ label, rows }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-ink-faint mb-2">{label}</div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.anime_id} className="flex items-center gap-2">
            <Thumb src={r.image_url} className="w-6 h-8 shrink-0" />
            <span className="text-xs font-medium truncate">{r.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function describePayload(a) {
  const p = a.payload;
  if (a.action_type === "swap") return `#${p.bench_to_active} in ↔ #${p.active_to_bench} out`;
  if (a.action_type === "ace") return `Ace: anime #${p.anime_id}`;
  if (a.action_type === "wildcard") return `${p.type}${p.target_team ? " → team #" + p.target_team : ""}`;
  return JSON.stringify(p);
}
