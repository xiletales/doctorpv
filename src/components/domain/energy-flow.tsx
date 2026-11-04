"use client";
import { num } from "@/lib/format";

function Node({ x, y, label, value, color, icon }: { x: number; y: number; label: string; value: string; color: string; icon: React.ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="27" fill="#12293f" stroke={color} strokeWidth="1.5" />
      <g fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{icon}</g>
      <text y="44" textAnchor="middle" fill="#cbd5e1" fontSize="11">{label}</text>
      <text y="60" textAnchor="middle" fill="#ffffff" fontSize="13" fontWeight="600" style={{ fontFamily: "var(--font-jetbrains)" }}>{value}</text>
    </g>
  );
}

function Flow({ d, w, color, reverse }: { d: string; w: number; color: string; reverse?: boolean }) {
  const active = w > 50;
  const width = active ? Math.min(5, 1.5 + w / 12000) : 1;
  const duration = active ? Math.max(0.5, 1.6 - w / 30000) : 0;
  return (
    <>
      <path d={d} fill="none" stroke={color} strokeOpacity="0.18" strokeWidth={width + 1} />
      {active ? (
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          className="flow-line"
          style={{ animationDuration: `${duration}s`, animationDirection: reverse ? "reverse" : "normal" }}
        />
      ) : null}
    </>
  );
}

const kw = (w: number) => `${num(w / 1000, 1)} kW`;

export interface FlowValues {
  pvW: number;
  loadW: number;
  plnW: number;
  chargeW: number;
  dischargeW: number;
  curtailW: number;
  soc: number;
}

/** Bus-level energy flow on the navy hero surface. Values come from meters M1 to M4. */
export function EnergyFlow({ v }: { v: FlowValues }) {
  const pvToLoad = Math.max(0, v.pvW - v.chargeW - v.curtailW);
  const batteryLabel = v.chargeW > 50 ? `+${kw(v.chargeW)}` : v.dischargeW > 50 ? `−${kw(v.dischargeW)}` : "0,0 kW";
  return (
    <svg viewBox="0 0 420 240" className="h-auto w-full" role="img" aria-label={`PV ${kw(v.pvW)}, beban ${kw(v.loadW)}, PLN ${kw(v.plnW)}, baterai ${batteryLabel}`}>
      <Flow d="M78 52 H 182" w={v.pvW} color="#f59e0b" />
      <Flow d="M238 52 H 342" w={pvToLoad + v.dischargeW + v.plnW} color="#34d399" />
      <Flow d="M210 80 V 138" w={v.chargeW || v.dischargeW} color="#10b981" reverse={v.chargeW <= 50} />
      <Flow d="M370 138 V 116" w={v.plnW} color="#38bdf8" />
      <circle cx="210" cy="52" r="5" fill="#94a3b8" />
      <path d="M187 52 H 233 M210 52 V 80" stroke="#334155" strokeWidth="1.5" />
      <Node x={50} y={52} label="PV" value={kw(v.pvW)} color="#f59e0b" icon={<><circle r="6" /><path d="M0-12v3M0 9v3M-12 0h3M9 0h3M-8.500-8.500l2 2M6.500 6.500l2 2M-8.500 8.500l2-2M6.500-6.500l2-2" /></>} />
      <Node x={370} y={52} label="Beban rumah" value={kw(v.loadW)} color="#34d399" icon={<path d="M-10 1 0-9 10 1M-7-1V10H7V-1" />} />
      <Node x={210} y={166} label={`Baterai, SoC ${num(v.soc, 0)}%`} value={batteryLabel} color="#10b981" icon={<><rect x="-11" y="-6" width="20" height="12" rx="2" /><path d="M11-2v4" /></>} />
      <Node x={370} y={166} label="PLN" value={kw(v.plnW)} color="#38bdf8" icon={<path d="M-6 12-1-11h2L6 12M-4 3H4M-2.500-4H2.500" />} />
    </svg>
  );
}
