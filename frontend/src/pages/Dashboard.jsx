import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { api } from "../lib/api.js";
import { Thumb, EmptyState, StatBlock, PageShell, Chip } from "../components/Common.jsx";

function titleCase(s) {
  if (!s) return null;
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Dashboard() {
  const [rows, setRows] = useState(null);
  const [latestById, setLatestById] = useState({});

  useEffect(() => {
    (async () => {
      const catalog = await api.listCatalog({ tracked_only: "1" });
      setRows(catalog);
      const results = await Promise.all(
        catalog.map((a) => api.getGrowth(a.id).then((g) => [a.id, g]).catch(() => [a.id, []]))
      );
      setLatestById(Object.fromEntries(results.map(([id, g]) => [id, g])));
    })();
  }, []);

  if (rows === null) return <PageShell title="Dashboard"><div className="text-sm text-ink-faint px-1">Loading…</div></PageShell>;

  return (
    <PageShell
      title="Tracked shows"
      subtitle="Latest hourly snapshot per title, pulled from Supabase."
      action={<Link to="/browse" className="btn btn-primary"><Plus size={15} /> Track a show</Link>}
      wide
    >
      {rows.length === 0 ? (
        <EmptyState title="Nothing tracked yet" action={<Link to="/browse" className="btn btn-primary mt-2">Go to Browse</Link>}>
          Browse a season's lineup and turn on hourly tracking for the shows you care about.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((a) => {
            const growth = latestById[a.id] || [];
            const latest = growth[growth.length - 1];
            const prev = growth[growth.length - 2];
            const delta = latest && prev ? (latest.num_list_users ?? 0) - (prev.num_list_users ?? 0) : 0;
            const TrendIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
            const trendColor = delta > 0 ? "text-pine" : delta < 0 ? "text-rust" : "text-ink-faint";

            return (
              <Link key={a.id} to={`/anime/${a.id}`} className="panel flex flex-col gap-3 px-4 py-3 hover:border-pine transition-colors">
                <div className="flex items-center gap-4">
                  <Thumb src={a.image_url} className="w-9 h-12" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{a.title}</div>
                    <div className="text-xs text-ink-faint font-mono">
                      #{a.id} · {a.media_type || "—"} · {a.studios || "studio unknown"}
                      {a.num_episodes ? ` · ${a.num_episodes} ep` : ""}
                    </div>
                  </div>
                  <StatBlock label="Members" value={latest ? Math.round(latest.num_list_users).toLocaleString() : "—"} />
                  <StatBlock label="Watching" value={latest ? Math.round(latest.watching).toLocaleString() : "—"} />
                  <StatBlock label="Completed" value={latest ? Math.round(latest.completed).toLocaleString() : "—"} />
                  <StatBlock label="Score" value={latest?.score ? latest.score.toFixed(2) : "—"} />
                  <StatBlock label="Rank" value={latest?.rank ?? "—"} />
                  <StatBlock label="Popularity" value={latest?.popularity ?? "—"} />
                  <TrendIcon size={18} className={trendColor} />
                </div>
                {(a.genres || a.status) && (
                  <div className="flex flex-wrap gap-1.5 pl-[52px]">
                    {a.status && <Chip tone="steel">{titleCase(a.status)}</Chip>}
                    {a.genres && a.genres.split(",").slice(0, 5).map((g) => <Chip key={g} tone="mustard">{g.trim()}</Chip>)}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
