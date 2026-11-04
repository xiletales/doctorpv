export function ConfidenceBar({ label, probability, top }: { label: string; probability: number; top?: boolean }) {
  const pct = Math.round(probability * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={top ? "font-medium text-ink" : "text-ink-2"}>{label}</span>
        <span className="num text-ink">{pct}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-label={`Estimasi peluang ${label}`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={top ? "h-full rounded-full bg-primary transition-[width] duration-500" : "h-full rounded-full bg-ink-3 opacity-60 transition-[width] duration-500"} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
    </div>
  );
}
