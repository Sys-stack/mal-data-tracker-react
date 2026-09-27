import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, Brush,
} from "recharts";

const AXIS_STYLE = { fontSize: 11, fill: "#8B9088", fontFamily: "'IBM Plex Mono', monospace" };
const GRID_STYLE = { stroke: "#DEE2D9" };
const TOOLTIP_STYLE = {
  background: "#FFFFFF", border: "1px solid #DEE2D9", borderRadius: 10, fontSize: 12,
  fontFamily: "'IBM Plex Sans', sans-serif",
};

// Single editable prediction curve -- re-renders instantly as slider props change (no fetch).
export function PredictorChart({ data, color = "#3A6B5C" }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
        <XAxis dataKey="week" tick={AXIS_STYLE} axisLine={{ stroke: "#DEE2D9" }} tickLine={false}
               label={{ value: "week", position: "insideBottomRight", offset: -4, fontSize: 10, fill: "#8B9088" }} />
        <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={60} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(w) => `Week ${w}`}
                 formatter={(v) => [Math.round(v * 100) / 100, "predicted"]} />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

const PALETTE = ["#3A6B5C", "#B5541F", "#35618C", "#8A6D00", "#7A4FA3", "#C23B6E", "#4A8C6B", "#5C7A99"];

// Overlays every roster show's set prediction for one metric.
export function CompareChart({ series }) {
  // series: [{ title, points: [{week, v}] }]
  const weeks = series[0]?.points?.map((p) => p.week) ?? [];
  const merged = weeks.map((week, i) => {
    const row = { week };
    series.forEach((s) => { row[s.title] = s.points[i]?.v; });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={merged} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
        <XAxis dataKey="week" tick={AXIS_STYLE} axisLine={{ stroke: "#DEE2D9" }} tickLine={false} />
        <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={60} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(w) => `Week ${w}`} />
        <Legend wrapperStyle={{ fontSize: 11, fontFamily: "'IBM Plex Sans', sans-serif" }} />
        {series.map((s, i) => (
          <Line key={s.title} type="monotone" dataKey={s.title} stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={2} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// Explorer: hourly growth comparison across several shows at once, with a
// draggable Brush for zoom/pan and three read modes (see Explorer.jsx for
// how `data` gets baselined for "percent"/"net").
// - data: [{ label, [animeTitle]: value }, ...] sorted by label ascending
// - series: [{ key: animeTitle, color }]
// - mode: "absolute" | "percent" | "net"
// - valueFormatter: (v) => string, used for absolute values and net deltas
// - brushStartIndex/brushEndIndex: controlled Brush window into `data`
// - onBrushChange: ({ startIndex, endIndex }) => void
// - onPointClick: (label) => void -- fires with the clicked bucket's label,
//   used by Explorer to let the user zero a metric at a point they pick
// - resetToken: bump this to force the Brush to snap back to the controlled
//   indices (recharts' Brush otherwise ignores prop updates after mount)
export function ExplorerGrowthChart({
  data, series, mode = "absolute", valueFormatter = (v) => v,
  brushStartIndex, brushEndIndex, onBrushChange, onPointClick, resetToken = 0,
}) {
  const yTick = (v) => {
    if (mode === "percent") return `${v > 0 ? "+" : ""}${v}%`;
    if (mode === "net") return `${v > 0 ? "+" : ""}${valueFormatter(v)}`;
    return valueFormatter(v);
  };
  const tooltipFmt = (v) => {
    if (mode === "percent") return `${v > 0 ? "+" : ""}${Math.round(v * 10) / 10}%`;
    if (mode === "net") return `${v > 0 ? "+" : ""}${valueFormatter(v)}`;
    return valueFormatter(v);
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data}
        margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
        onClick={(e) => e?.activeLabel && onPointClick?.(e.activeLabel)}
        style={onPointClick ? { cursor: "pointer" } : undefined}
      >
        <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_STYLE} axisLine={{ stroke: "#DEE2D9" }} tickLine={false} minTickGap={40} />
        <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={64} tickFormatter={yTick} />
        {mode !== "absolute" && <ReferenceLine y={0} stroke="#DEE2D9" />}
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFmt} />
        <Legend wrapperStyle={{ fontSize: 11, fontFamily: "'IBM Plex Sans', sans-serif" }} />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        ))}
        <Brush
          key={`${resetToken}-${data.length}`}
          dataKey="label"
          height={26}
          stroke="#3A6B5C"
          travellerWidth={8}
          startIndex={brushStartIndex}
          endIndex={brushEndIndex}
          onChange={onBrushChange}
          tickFormatter={(i) => (data[i]?.label || "").replace("T", " ") + "h"}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Planner: running season-total points across the 13 weeks.
export function RunningTotalChart({ weeks }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={weeks} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
        <XAxis dataKey="week" tick={AXIS_STYLE} axisLine={{ stroke: "#DEE2D9" }} tickLine={false} />
        <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={70} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(w) => `Week ${w}`}
                 formatter={(v) => [Math.round(v).toLocaleString(), "running total"]} />
        <ReferenceLine y={0} stroke="#DEE2D9" />
        <Line type="monotone" dataKey="running_total" stroke="#3A6B5C" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
