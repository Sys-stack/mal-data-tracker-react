export function Thumb({ src, alt = "", className = "" }) {
  if (!src) {
    return <div className={`bg-panel-alt border border-line rounded-md ${className}`} />;
  }
  return <img src={src} alt={alt} className={`object-cover rounded-md ${className}`} />;
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="panel border-dashed flex flex-col items-center text-center gap-2 px-8 py-14">
      <h3 className="text-base">{title}</h3>
      {children && <p className="text-sm text-ink-soft max-w-sm">{children}</p>}
      {action}
    </div>
  );
}

export function StatBlock({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] text-ink-faint">{label}</span>
      <span className="font-mono text-sm font-semibold">{value}</span>
    </div>
  );
}

export function Chip({ tone = "pine", children }) {
  const tones = {
    pine: "bg-pine-soft text-pine-dark",
    rust: "bg-rust-soft text-rust",
    steel: "bg-steel-soft text-steel",
    mustard: "bg-mustard-soft text-mustard",
    neutral: "bg-panel-alt text-ink-faint",
  };
  return <span className={`chip ${tones[tone]}`}>{children}</span>;
}

export function PageShell({ title, subtitle, action, children, wide = false }) {
  return (
    <div className={`${wide ? "max-w-none" : "max-w-5xl"} mx-auto px-10 py-10`}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-6 mb-6 flex-wrap">
          <div>
            {title && <h1 className="text-2xl">{title}</h1>}
            {subtitle && <p className="text-sm text-ink-soft mt-1 max-w-lg">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// A range slider paired with a synced number input -- typing a value
// outside the current [min, max] calls onExpand so the caller can widen the
// slider's range instead of the input silently clamping.
export function SliderInput({ label, value, min, max, step = "any", onChange, onExpand, format }) {
  const display = format ? format(value) : value;
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-xs text-ink-soft">{label}</span>
        <input
          type="number"
          value={Number.isFinite(value) ? value : ""}
          step={step === "any" ? "any" : step}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isNaN(v)) return;
            if (onExpand && (v < min || v > max)) onExpand(v);
            onChange(v);
          }}
          className="field w-28 text-right font-mono text-xs py-1"
        />
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
             onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full" />
      {format && <div className="text-right text-[10.5px] text-ink-faint font-mono mt-0.5">{display}</div>}
    </div>
  );
}
