import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ArrowLeft, LineChart as LineChartIcon, Calendar, Clapperboard, Users2 } from "lucide-react";
import { api } from "../lib/api.js";
import { PageShell, Thumb, Chip } from "../components/Common.jsx";
import { METRIC_LABELS, METRICS } from "../lib/curve.js";

const COLORS = {
  num_list_users: "#3A6B5C", watching: "#35618C", completed: "#8A6D00", plan_to_watch: "#7A4FA3",
  on_hold: "#C23B6E", dropped: "#B5541F", score: "#20241F", favorites: "#4A8C6B",
  rank: "#5C7A99", popularity: "#B08900",
};
const CHART_METRICS = [...METRICS.filter((m) => m !== "num_scoring_users"), "rank", "popularity"];
const CHART_LABELS = { ...METRIC_LABELS, rank: "Rank", popularity: "Popularity" };

function formatDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return iso; }
}
function formatDuration(seconds) {
  if (!seconds) return "—";
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
}
function titleCase(s) {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AnimeDetail() {
  const { id } = useParams();
  const [anime, setAnime] = useState(null);
  const [growth, setGrowth] = useState(null);
  const [teams, setTeams] = useState([]);
  const [active, setActive] = useState(["num_list_users"]);
  const [range, setRange] = useState(0);
  const [synopsisOpen, setSynopsisOpen] = useState(false);

  useEffect(() => {
    api.getAnime(id).then(setAnime).catch(() => setAnime(null));
    api.getGrowth(id).then(setGrowth).catch(() => setGrowth([]));
    api.getAnimeTeams(id).then(setTeams).catch(() => setTeams([]));
  }, [id]);

  const filtered = useMemo(() => {
    if (!growth || growth.length === 0) return [];
    const cut = Math.floor((range / 100) * (growth.length - 1));
    return growth.slice(cut);
  }, [growth, range]);

  const chartData = filtered.map((r) => ({ ...r, label: new Date(r.snapshot_at).toLocaleDateString() }));
  const latest = growth && growth.length ? growth[growth.length - 1] : null;

  return (
    <PageShell action={<Link to="/" className="btn"><ArrowLeft size={15} /> Dashboard</Link>} wide>
      {!anime ? (
        <div className="text-sm text-ink-faint">Loading…</div>
      ) : (
        <div className="grid grid-cols-[220px_1fr] gap-8">
          <div>
            <Thumb src={anime.image_url} className="w-full h-72" />
            {teams.length > 0 && (
              <div className="panel p-3 mt-4">
                <div className="text-xs text-ink-faint mb-2 flex items-center gap-1.5"><Users2 size={13} /> Drafted by</div>
                <div className="flex flex-col gap-1.5">
                  {teams.map((t) => (
                    <Link key={t.team_id} to={`/planner/${t.team_id}`} className="text-xs font-medium hover:text-pine flex items-center justify-between">
                      {t.team_name}
                      <Chip tone={t.slot === "active" ? "pine" : "neutral"}>{t.slot}</Chip>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <Link to={`/predictor?anime_id=${anime.id}`} className="btn btn-primary w-full justify-center mt-4">
              <LineChartIcon size={14} /> Predict this show
            </Link>
          </div>

          <div>
            <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
              <h1 className="text-2xl leading-tight">{anime.title}</h1>
              <div className="flex gap-1.5 flex-wrap">
                {anime.tracked ? <Chip tone="pine">tracking</Chip> : <Chip tone="neutral">not tracked</Chip>}
                {anime.status && <Chip tone="steel">{titleCase(anime.status)}</Chip>}
              </div>
            </div>
            <div className="text-sm text-ink-faint font-mono mb-4">#{anime.id} · {anime.studios || "studio unknown"}</div>

            {anime.genres && (
              <div className="flex flex-wrap gap-1.5 mb-5">
                {anime.genres.split(",").map((g) => <Chip key={g} tone="mustard">{g.trim()}</Chip>)}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <Field label="Media type" value={titleCase(anime.media_type)} />
              <Field label="Episodes" value={anime.num_episodes || "—"} />
              <Field label="Episode length" value={formatDuration(anime.average_episode_duration)} />
              <Field label="Source" value={titleCase(anime.source)} />
              <Field label="Rating" value={titleCase(anime.rating)} />
              <Field label="Broadcast" value={anime.broadcast_day ? `${titleCase(anime.broadcast_day)} ${anime.broadcast_time || ""}` : "—"} />
              <Field label="Aired" value={`${formatDate(anime.start_date)} → ${anime.end_date ? formatDate(anime.end_date) : "ongoing"}`} />
              <Field label="Season" value={anime.season ? `${titleCase(anime.season)} ${anime.year}` : "—"} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 panel p-4">
              <Field label="Latest rank" value={latest?.rank ?? "—"} mono />
              <Field label="Latest popularity" value={latest?.popularity ?? "—"} mono />
              <Field label="Latest score" value={latest?.score ? latest.score.toFixed(2) : "—"} mono />
              <Field label="Members" value={latest ? Math.round(latest.num_list_users).toLocaleString() : "—"} mono />
            </div>

            {anime.synopsis && (
              <div className="mb-6">
                <button onClick={() => setSynopsisOpen((v) => !v)} className="text-xs font-medium text-pine mb-1.5">
                  {synopsisOpen ? "Hide synopsis" : "Show synopsis"}
                </button>
                {synopsisOpen && <p className="text-sm text-ink-soft leading-relaxed whitespace-pre-line">{anime.synopsis}</p>}
              </div>
            )}

            <div className="flex items-center gap-4 text-[11px] text-ink-faint font-mono mb-6">
              <span className="flex items-center gap-1"><Calendar size={12} /> MAL added {formatDate(anime.mal_created_at)}</span>
              <span className="flex items-center gap-1"><Clapperboard size={12} /> MAL updated {formatDate(anime.mal_updated_at)}</span>
            </div>

            <h3 className="text-base mb-3">Growth history</h3>
            {growth === null ? (
              <div className="text-sm text-ink-faint">Loading…</div>
            ) : growth.length === 0 ? (
              <div className="panel px-8 py-14 text-center text-sm text-ink-soft">No snapshots yet — wait for the next hourly sync, or track this show from Browse.</div>
            ) : (
              <div className="panel p-5">
                <div className="flex flex-wrap gap-2 mb-4">
                  {CHART_METRICS.map((m) => (
                    <button key={m}
                            onClick={() => setActive((cur) => cur.includes(m) ? (cur.length > 1 ? cur.filter((x) => x !== m) : cur) : [...cur, m])}
                            className={`chip border ${active.includes(m) ? "bg-pine text-white border-pine" : "border-line text-ink-faint"}`}>
                      {CHART_LABELS[m]}
                    </button>
                  ))}
                </div>

                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#DEE2D9" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#8B9088" }} minTickGap={30} />
                      <YAxis tick={{ fontSize: 11, fill: "#8B9088" }} width={60} />
                      <Tooltip contentStyle={{ background: "#fff", border: "1px solid #DEE2D9", borderRadius: 10, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {active.map((m) => (
                        <Line key={m} type="monotone" dataKey={m} name={CHART_LABELS[m]} stroke={COLORS[m] || "#3A6B5C"} strokeWidth={2} dot={false} isAnimationActive={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex items-center gap-3 mt-4">
                  <span className="text-xs text-ink-faint w-24">Date range</span>
                  <input type="range" min={0} max={100} value={range} onChange={(e) => setRange(Number(e.target.value))} className="flex-1" />
                  <span className="text-xs font-mono text-ink-faint whitespace-nowrap">{filtered.length} of {growth.length} snapshots</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}

function Field({ label, value, mono = false }) {
  return (
    <div>
      <div className="text-[10.5px] text-ink-faint mb-0.5">{label}</div>
      <div className={`text-sm ${mono ? "font-mono font-semibold" : ""}`}>{value}</div>
    </div>
  );
}
