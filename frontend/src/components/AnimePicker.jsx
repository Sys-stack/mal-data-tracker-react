import { useMemo, useState } from "react";
import { Search, Plus } from "lucide-react";
import { Thumb } from "./Common.jsx";

// A search box + scrollable result list with one-click "add" actions per
// row. Used by the Team Draft page so picking a show from a catalog of
// hundreds of titles doesn't mean scrolling a giant <select>.
export default function AnimePicker({ options, onPick, actions }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.title.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div className="border border-line rounded-lg bg-panel-alt">
      <div className="relative p-2 border-b border-line">
        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shows to draft…"
          className="field w-full pl-8 text-sm bg-panel"
          autoFocus
        />
      </div>
      <div className="max-h-64 overflow-y-auto p-1.5">
        {filtered.length === 0 && (
          <div className="text-xs text-ink-faint px-3 py-4 text-center">
            {options.length === 0 ? "Nothing left to draft — everything's on a roster or the catalog is empty." : "No matches."}
          </div>
        )}
        {filtered.map((o) => (
          <div key={o.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-panel">
            <Thumb src={o.image_url} className="w-7 h-9 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate">{o.title}</div>
              <div className="text-[10.5px] text-ink-faint font-mono truncate">{o.studios || "studio unknown"}</div>
            </div>
            <div className="flex gap-1 shrink-0">
              {(actions ?? [{ slot: "active", label: "Active" }, { slot: "bench", label: "Bench" }]).map((act) => (
                <button
                  key={act.slot}
                  onClick={() => onPick(o.id, act.slot)}
                  className="btn text-[10.5px] py-1 px-2"
                  title={`Draft to ${act.label}`}
                >
                  <Plus size={11} /> {act.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
