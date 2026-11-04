import { useId } from "react";
import type { PulseScore as Pulse } from "@/lib/ai/pulse";

const LEVEL = {
  normal: { from: "#10B981", to: "#14B8A6", label: "Sehat" },
  warning: { from: "#FBBF24", to: "#F97316", label: "Waspada" },
  critical: { from: "#F97316", to: "#EF4444", label: "Kritis" },
} as const;

const ECG = "M0 20h22l4-7 5 7h6l3 5 5-22 5 26 4-9h8l4-5 5 5h49l4-7 5 7h6l3 5 5-22 5 26 4-9h8l4-5 5 5h26";

/** The heartbeat line, which runs faster and changes color as cluster health degrades. */
export function PulseLine({ bpm, color, className }: { bpm: number; color: string; className?: string }) {
  return (
    <svg viewBox="0 0 200 32" preserveAspectRatio="none" className={className} aria-hidden>
      <path d={ECG} fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="1.5" />
      <path d={ECG} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength={100} className="ecg-trace" style={{ animationDuration: `${(60 / bpm) * 3}s` }} />
    </svg>
  );
}

export function PulseScoreRing({ pulse, size = 148 }: { pulse: Pulse; size?: number }) {
  const id = useId();
  const stroke = 11;
  const r = (size - stroke) / 2 - 8;
  const c = 2 * Math.PI * r;
  const style = LEVEL[pulse.level];
  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Pulse Score klaster ${pulse.score} dari 100, status ${style.label}`}>
        <span className="pulse-halo absolute inset-3 rounded-full" style={{ background: style.from, animationDuration: `${60 / pulse.bpm}s` }} aria-hidden />
        <svg width={size} height={size} className="relative -rotate-90" aria-hidden>
          <defs>
            <linearGradient id={id}><stop stopColor={style.from} /><stop offset="1" stopColor={style.to} /></linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pulse.score / 100)} className="transition-[stroke-dashoffset] duration-700" />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="display text-5xl font-semibold leading-none tracking-tight text-white">{pulse.score}</span>
          <span className="mt-1 text-[11px] text-slate-400">dari 100</span>
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-sm text-slate-400">Pulse Score klaster</p>
        <p className="display text-2xl font-semibold tracking-tight text-white">{style.label}</p>
        <PulseLine bpm={pulse.bpm} color={style.from} className="mt-2 h-8 w-36" />
      </div>
    </div>
  );
}
