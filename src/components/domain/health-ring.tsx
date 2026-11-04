import { bandOf, BAND_LABEL } from "@/lib/ai/health";
import { cn } from "@/lib/utils";

const BAND_COLOR = {
  sangat_baik: "text-st-normal",
  baik: "text-st-normal",
  perhatian: "text-st-warning",
  prioritas: "text-st-critical",
} as const;

export function HealthScoreRing({ score, size = 72, showBand = true }: { score: number; size?: number; showBand?: boolean }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const band = bandOf(score);
  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} className={cn(BAND_COLOR[band], "transition-[stroke-dashoffset] duration-500")} />
        </svg>
        <span className="num absolute inset-0 flex items-center justify-center text-lg font-semibold text-ink">{score}</span>
      </div>
      {showBand ? (
        <div>
          <p className="text-xs text-ink-3">Skor kesehatan</p>
          <p className={cn("text-sm font-medium", BAND_COLOR[band])}>{BAND_LABEL[band]}</p>
        </div>
      ) : null}
    </div>
  );
}

/** className colors the fill only. Put spacing on a wrapper, since a margin here would push the fill out of the track. */
export function LevelBar({ value, className, label }: { value: number; className?: string; label: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="meter" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", className ?? "bg-st-normal")} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
