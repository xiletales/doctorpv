"use client";
import { useMemo } from "react";
import type { AssetStatus } from "@/lib/types";

const COLOR: Record<AssetStatus, string> = { normal: "#10B981", warning: "#FBBF24", critical: "#EF4444", offline: "#64748B", maintenance: "#A78BFA" };

const TILE = 17;
const iso = (x: number, y: number, z = 0): [number, number] => [(x - y) * TILE * 0.87, (x + y) * TILE * 0.5 - z * TILE];
const pts = (list: [number, number][]) => list.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ");
const id2 = (prefix: string, n: number) => `${prefix}${String(n).padStart(2, "0")}`;

interface Item {
  depth: number;
  key: string;
  node: React.ReactNode;
}

export interface ClusterIsometricProps {
  statuses?: Record<string, AssetStatus>;
  /** Hour of day (WIB). Moves the sun and dims the panels at night. */
  hour?: number;
  onSelect?: (id: string) => void;
  className?: string;
}

/** 30 houses, 15 shared batteries and 3 gateways, in the same pairing as the real cluster layout. */
export function ClusterIsometric({ statuses = {}, hour = 10.25, onSelect, className }: ClusterIsometricProps) {
  const up = hour > 5.5 && hour < 17.75;
  const items = useMemo(() => {
    const out: Item[] = [];
    const interactive = (id: string) =>
      onSelect
        ? { role: "button", tabIndex: 0, "aria-label": id, style: { cursor: "pointer" }, onClick: () => onSelect(id), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(id); } } }
        : {};

    const house = (id: string, x: number, y: number) => {
      const color = COLOR[statuses[id] ?? "normal"];
      const w = 1.5;
      const d = 1.25;
      const h = 0.75;
      const a = iso(x, y, h);
      const b = iso(x + w, y, h);
      const c = iso(x + w, y + d, h);
      const e = iso(x, y + d, h);
      const ridgeA = iso(x, y + d / 2, h + 0.55);
      const ridgeB = iso(x + w, y + d / 2, h + 0.55);
      const panel: [number, number][] = [iso(x + 0.2, y + d * 0.62, h + 0.36), iso(x + w - 0.2, y + d * 0.62, h + 0.36), iso(x + w - 0.2, y + d * 0.93, h + 0.08), iso(x + 0.2, y + d * 0.93, h + 0.08)];
      out.push({
        depth: x + y,
        key: id,
        node: (
          <g {...interactive(id)}>
            <title>{id}</title>
            <polygon points={pts([c, b, iso(x + w, y, 0), iso(x + w, y + d, 0)])} fill="#172338" />
            <polygon points={pts([e, c, iso(x + w, y + d, 0), iso(x, y + d, 0)])} fill="#1E2C45" />
            <polygon points={pts([ridgeA, ridgeB, b, a])} fill="#26364F" />
            <polygon points={pts([ridgeA, ridgeB, c, e])} fill="#31435F" />
            <polygon points={pts([ridgeA, e, a])} fill="#1B2840" />
            <polygon points={pts(panel)} fill={up ? color : "#334155"} fillOpacity={up ? 0.95 : 0.7} stroke={color} strokeOpacity="0.5" strokeWidth="0.6" />
            {statuses[id] === "critical" || statuses[id] === "warning" ? (
              <circle cx={iso(x + w / 2, y + d / 2, h + 0.9)[0]} cy={iso(x + w / 2, y + d / 2, h + 0.9)[1]} r="7" fill="none" stroke={color} strokeWidth="1.5" className="pulse-ring" style={{ transformBox: "fill-box", transformOrigin: "center" }} />
            ) : null}
          </g>
        ),
      });
    };

    const battery = (id: string, x: number, y: number) => {
      const color = COLOR[statuses[id] ?? "normal"];
      const [cx, cy] = iso(x, y, 0.35);
      out.push({
        depth: x + y + 0.2,
        key: id,
        node: (
          <g {...interactive(id)}>
            <title>{id}</title>
            <polygon points={pts([iso(x - 0.24, y - 0.24, 0.5), iso(x + 0.24, y - 0.24, 0.5), iso(x + 0.24, y + 0.24, 0.5), iso(x - 0.24, y + 0.24, 0.5)])} fill={color} />
            <polygon points={pts([iso(x + 0.24, y - 0.24, 0.5), iso(x + 0.24, y + 0.24, 0.5), iso(x + 0.24, y + 0.24, 0), iso(x + 0.24, y - 0.24, 0)])} fill={color} fillOpacity="0.55" />
            <polygon points={pts([iso(x - 0.24, y + 0.24, 0.5), iso(x + 0.24, y + 0.24, 0.5), iso(x + 0.24, y + 0.24, 0), iso(x - 0.24, y + 0.24, 0)])} fill={color} fillOpacity="0.75" />
            <circle cx={cx} cy={cy} r="11" fill={color} opacity="0.13" />
          </g>
        ),
      });
    };

    for (let z = 0; z < 3; z++) {
      const baseY = z * 7.2;
      for (let col = 0; col < 5; col++) {
        const x = col * 2.6;
        const first = z * 10 + col * 2 + 1;
        house(id2("H", first), x, baseY);
        house(id2("H", first + 1), x, baseY + 3.3);
        battery(id2("B", z * 5 + col + 1), x + 2, baseY + 2.45);
      }
      const gwId = `GW-${z + 1}`;
      const [gx, gy] = iso(13.6, baseY + 2.45, 0);
      const [tx, ty] = iso(13.6, baseY + 2.45, 1.7);
      const gwColor = COLOR[statuses[gwId] ?? "normal"];
      out.push({
        depth: 13.6 + baseY + 2.45,
        key: gwId,
        node: (
          <g {...interactive(gwId)}>
            <title>{gwId}</title>
            <line x1={gx} y1={gy} x2={tx} y2={ty} stroke="#94A3B8" strokeWidth="2" />
            <circle cx={tx} cy={ty} r="3" fill={gwColor} />
            <circle cx={tx} cy={ty} r="9" fill="none" stroke={gwColor} strokeWidth="1" className="pulse-ring" style={{ transformBox: "fill-box", transformOrigin: "center" }} />
          </g>
        ),
      });
    }
    return out.sort((p, q) => p.depth - q.depth);
  }, [statuses, onSelect, up]);

  const roads = [0, 1, 2].map((z) => {
    const y = z * 7.2 + 2.45;
    const [x1, y1] = iso(-0.6, y);
    const [x2, y2] = iso(14, y);
    return { z, x1, y1, x2, y2 };
  });
  const ground = pts([iso(-1.2, -1.2), iso(14.8, -1.2), iso(14.8, 20.2), iso(-1.2, 20.2)]);

  const t = Math.max(0, Math.min(1, (hour - 5.5) / 12.25));
  const sunX = -255 + 430 * t;
  const sunY = -35 - 70 * Math.sin(Math.PI * t);

  return (
    <svg viewBox="-325 -150 570 455" className={className} role={onSelect ? "group" : "img"} aria-label="Ilustrasi klaster: 30 rumah berpanel surya, 15 baterai bersama, dan 3 gateway">
      {up ? (
        <g aria-hidden>
          <circle cx={sunX} cy={sunY} r="46" fill="#F97316" opacity="0.14" />
          <circle cx={sunX} cy={sunY} r="28" fill="#FBBF24" opacity="0.28" />
          <circle cx={sunX} cy={sunY} r="15" fill="#FBBF24" />
        </g>
      ) : null}
      <polygon points={ground} fill="#0E1729" stroke="rgba(255,255,255,0.07)" />
      {roads.map((r) => (
        <g key={r.z} aria-hidden>
          <line x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} stroke="#1E2C45" strokeWidth="13" strokeLinecap="round" />
          <line x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} stroke={up ? "#FBBF24" : "#38BDF8"} strokeWidth="2" strokeLinecap="round" className="flow-line" style={{ animationDelay: `${r.z * 0.25}s` }} />
        </g>
      ))}
      {items.map((i) => <g key={i.key}>{i.node}</g>)}
    </svg>
  );
}
