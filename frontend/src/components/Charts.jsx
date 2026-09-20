import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
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
