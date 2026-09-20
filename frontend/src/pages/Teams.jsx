import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, X, ArrowRight, Trash2, ChevronDown } from "lucide-react";
import { api } from "../lib/api.js";
import { PageShell, Thumb, EmptyState, Chip } from "../components/Common.jsx";
import AnimePicker from "../components/AnimePicker.jsx";
import { CompareChart } from "../components/Charts.jsx";
import { METRICS, METRIC_LABELS } from "../lib/curve.js";

export default function Teams() {
  const [teams, setTeams] = useState(null);
  const [newName, setNewName] = useState("");

  const load = () => api.listTeams().then(setTeams);
  useEffect(() => { load(); }, []);

  async function createTeam() {
    if (!newName.trim()) return;
    await api.createTeam(newName.trim());
    setNewName("");
    load();
  }

  async function deleteTeam(id) {
    if (!confirm("Delete this team? This also clears its planner moves.")) return;
    await api.deleteTeam(id);
    load();
  }

  return (
    <PageShell title="Team draft" subtitle="FAL rosters are 5 active + 3 bench. Draft from the catalog, compare set predictions, then head to the Planner once a roster is exactly 5+3." wide>
      <div className="panel p-4 mb-6 flex items-center gap-3">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New team name" className="field flex-1 max-w-xs" onKeyDown={(e) => e.key === "Enter" && createTeam()} />
        <button onClick={createTeam} className="btn btn-primary"><Plus size={15} /> Create team</button>
      </div>

      {teams === null ? (
        <div className="text-sm text-ink-faint">Loading…</div>
      ) : teams.length === 0 ? (
        <EmptyState title="No teams yet">Create one above, then draft from the catalog.</EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          {teams.map((team) => <TeamCard key={team.id} team={team} onChange={load} onDelete={() => deleteTeam(team.id)} />)}
        </div>
      )}
    </PageShell>
  );
}

function TeamCard({ team, onChange, onDelete }) {
  const active = team.roster.filter((r) => r.slot === "active");
  const bench = team.roster.filter((r) => r.slot === "bench");
  const ready = active.length === 5 && bench.length === 3;

  const [available, setAvailable] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [metric, setMetric] = useState("num_list_users");
  const [compareData, setCompareData] = useState(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    api.getAvailable(team.id).then(setAvailable);
  }, [team]);

  async function draftPick(animeId, slot) {
    setDraftError("");
    const limit = slot === "active" ? 5 : 3;
    const current = slot === "active" ? active.length : bench.length;
    if (current >= limit) {
      setDraftError(`${slot === "active" ? "Active" : "Bench"} is already full (${limit} max).`);
      return;
    }
    try {
      await api.draft(team.id, animeId, slot);
      onChange();
    } catch (e) {
      setDraftError(e.message);
    }
  }

  async function undraft(animeId) {
    await api.undraft(team.id, animeId);
    onChange();
  }

  async function loadCompare() {
    const series = await api.compare(team.id, metric);
    const withCurves = series.filter((s) => s.set).map((s) => ({ title: s.title, points: s.points.map((p) => ({ week: p.week, v: p.v })) }));
    setCompareData(withCurves);
    setNote(withCurves.length < series.length ? `${series.length - withCurves.length} show(s) have no set prediction for this metric yet.` : "");
  }

  return (
    <div className="panel p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
        <div className="flex items-center gap-3">
          <h3 className="text-lg">{team.name}</h3>
          {ready
            ? <Chip tone="pine">ready</Chip>
            : <Chip tone="mustard">{active.length}/5 active · {bench.length}/3 bench</Chip>}
        </div>
        <div className="flex items-center gap-2">
          {ready && <Link to={`/planner/${team.id}`} className="btn btn-primary text-xs">Open Planner <ArrowRight size={13} /></Link>}
          <button onClick={onDelete} className="btn btn-danger text-xs"><Trash2 size={13} /></button>
        </div>
      </div>

      {/* Roster */}
      <div className="grid sm:grid-cols-2 gap-5 mb-5">
        <RosterCol label={`Active (${active.length}/5)`} rows={active} onRemove={undraft} />
        <RosterCol label={`Bench (${bench.length}/3)`} rows={bench} onRemove={undraft} />
      </div>

      {/* Draft picker */}
      <div className="border-t border-line pt-4">
        <button onClick={() => setPickerOpen((v) => !v)} className="btn text-sm w-full justify-between">
          <span className="flex items-center gap-1.5"><Plus size={14} /> Draft a show</span>
          <ChevronDown size={14} className={`transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
        </button>
        {pickerOpen && (
          <div className="mt-3">
            <AnimePicker options={available} onPick={(id, slot) => draftPick(id, slot)} />
          </div>
        )}
        {draftError && <p className="text-xs text-rust mt-2">{draftError}</p>}
      </div>

      {/* Compare */}
      <div className="border-t border-line pt-4 mt-5">
        <button onClick={() => setCompareOpen((v) => !v)} className="text-sm font-medium flex items-center gap-1.5">
          Compare predicted growth <ChevronDown size={14} className={`transition-transform ${compareOpen ? "rotate-180" : ""}`} />
        </button>
        {compareOpen && (
          <div className="mt-3">
            <div className="flex items-center gap-2 mb-3">
              <select value={metric} onChange={(e) => setMetric(e.target.value)} className="field text-xs">
                {METRICS.map((m) => <option key={m} value={m}>{METRIC_LABELS[m]}</option>)}
              </select>
              <button onClick={loadCompare} className="btn text-xs">Load comparison</button>
            </div>
            {compareData && compareData.length > 0 && (
              <div className="h-56"><CompareChart series={compareData} /></div>
            )}
            {note && <p className="text-xs text-ink-faint mt-1">{note}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function RosterCol({ label, rows, onRemove }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-ink-faint mb-2">{label}</div>
      <div className="flex flex-col gap-1.5 min-h-[44px]">
        {rows.length === 0 && <div className="text-xs text-ink-faint border border-dashed border-line rounded-lg px-3 py-3 text-center">Empty</div>}
        {rows.map((r) => (
          <div key={r.anime_id} className="flex items-center gap-2 bg-panel-alt border border-line rounded-lg px-2.5 py-1.5">
            <Thumb src={r.image_url} className="w-6 h-8 shrink-0" />
            <Link to={`/anime/${r.anime_id}`} className="text-xs font-medium flex-1 truncate hover:text-pine">{r.title}</Link>
            <button onClick={() => onRemove(r.anime_id)} className="text-ink-faint hover:text-rust shrink-0"><X size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
