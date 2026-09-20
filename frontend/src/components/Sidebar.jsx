import { NavLink } from "react-router-dom";
import { LayoutGrid, Compass, LineChart, Users, RefreshCw } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api.js";

const LINKS = [
  { to: "/", label: "Dashboard", icon: LayoutGrid, end: true },
  { to: "/browse", label: "Browse", icon: Compass },
  { to: "/predictor", label: "Predictor", icon: LineChart },
  { to: "/teams", label: "Team Draft", icon: Users },
];

export default function Sidebar() {
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState("");

  async function runSync() {
    setSyncing(true);
    setStatus("");
    try {
      const res = await api.manualSync();
      setStatus(`Synced ${res.ok.length} · failed ${res.failed.length}`);
    } catch (e) {
      setStatus("Sync failed");
    } finally {
      setSyncing(false);
      setTimeout(() => setStatus(""), 3500);
    }
  }

  return (
    <aside className="w-56 shrink-0 h-screen sticky top-0 flex flex-col gap-6 border-r border-line bg-panel px-4 py-6">
      <div className="flex items-baseline gap-1 px-1">
        <span className="font-display text-lg font-semibold">FAL</span>
        <span className="font-display text-lg text-pine">Tracker</span>
      </div>

      <nav className="flex flex-col gap-1">
        {LINKS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive ? "bg-pine-soft text-pine-dark" : "text-ink-soft hover:bg-panel-alt"
              }`
            }
          >
            <Icon size={17} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 px-1">
        <button
          onClick={runSync}
          disabled={syncing}
          className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-soft hover:border-pine hover:text-pine disabled:opacity-50"
        >
          <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing…" : status || "Sync now"}
        </button>
        <p className="px-1 font-mono text-[10.5px] leading-relaxed text-ink-faint">
          Hourly sync runs via GitHub Action
        </p>
      </div>
    </aside>
  );
}
