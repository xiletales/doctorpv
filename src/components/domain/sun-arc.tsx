import { clockTime } from "@/lib/format";
import { hourOfDay } from "@/lib/sim/time";

const RISE = 5.5;
const SET = 17.75;
const W = 560;
const H = 118;
const R = 240;
const CX = W / 2;
const CY = 112;

/** The day's sun path, with the sun placed at the simulated time. */
export function SunArc({ ts, irradiance }: { ts: number; irradiance: number }) {
  const h = hourOfDay(ts);
  const up = h > RISE && h < SET;
  const x = Math.min(1, Math.max(0, (h - RISE) / (SET - RISE)));
  const angle = Math.PI * (1 - x);
  const rx = R;
  const ry = 96;
  const sx = CX + rx * Math.cos(angle);
  const sy = CY - ry * Math.sin(angle);
  const arc = `M${CX - rx} ${CY} A ${rx} ${ry} 0 0 1 ${CX + rx} ${CY}`;
  const passedSweep = `M${CX - rx} ${CY} A ${rx} ${ry} 0 0 1 ${sx} ${sy}`;
  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} className="h-auto w-full" role="img" aria-label={`Posisi matahari pukul ${clockTime(ts)} WIB, iradiasi ${Math.round(irradiance)} watt per meter persegi`}>
      <path d={arc} fill="none" stroke="#335069" strokeWidth="1.5" strokeDasharray="2 6" />
      {up ? <path d={passedSweep} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" /> : null}
      <line x1={CX - rx - 18} x2={CX + rx + 18} y1={CY} y2={CY} stroke="#335069" />
      <text x={CX - rx} y={H + 12} textAnchor="middle" fill="#8ea3b8" fontSize="11">05.30</text>
      <text x={CX} y={H + 12} textAnchor="middle" fill="#8ea3b8" fontSize="11">Tengah hari</text>
      <text x={CX + rx} y={H + 12} textAnchor="middle" fill="#8ea3b8" fontSize="11">17.45</text>
      {up ? (
        <g transform={`translate(${sx} ${sy})`}>
          <circle r="22" fill="#f59e0b" opacity="0.16" />
          <circle r="13" fill="#f59e0b" opacity="0.32" />
          <circle r="8" fill="#fbbf24" />
        </g>
      ) : null}
    </svg>
  );
}
