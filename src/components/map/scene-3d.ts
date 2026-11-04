import type { Feature, FeatureCollection, LineString, Point, Polygon } from "geojson";
import type { AssetStatus } from "@/lib/types";

/** The generated street grid runs at this angle, so buildings line up with their road. */
const ROTATION = (14 * Math.PI) / 180;

export const ROOF_COLOR: Record<AssetStatus, string> = {
  normal: "#0f9f76",
  warning: "#e8960c",
  critical: "#e5312f",
  offline: "#6b7a8c",
  maintenance: "#8257e6",
};

export interface SceneHouse {
  id: string;
  lat: number;
  lng: number;
  kind: "rumah" | "musala" | "balai" | "sekolah";
  status: AssetStatus;
  /** Output against expectation. Dims the panels on a dead system. */
  ratio: number;
}
export interface SceneBattery {
  id: string;
  lat: number;
  lng: number;
  status: AssetStatus;
}
export interface SceneGateway {
  id: string;
  lat: number;
  lng: number;
  status: AssetStatus;
}

export interface SunLight {
  azimuth: number;
  polar: number;
  intensity: number;
  color: string;
  /** 0 at night, 1 in full clear daylight. */
  daylight: number;
  up: boolean;
}

/** Sun position and brightness from the hour of day. Surakarta is near the equator, so it rises high. */
export function sunLight(hour: number, clearFraction = 1): SunLight {
  const t = (hour - 5.5) / 12.25;
  const up = t > 0 && t < 1;
  const elevation = up ? Math.sin(Math.PI * t) * 78 : 0;
  const sun = up ? Math.min(1, elevation / 25) : 0;
  const daylight = sun * (0.5 + 0.5 * Math.max(0, Math.min(1, clearFraction)));
  return {
    azimuth: up ? 90 + 180 * t : 180,
    polar: up ? Math.min(80, 90 - elevation) : 40,
    intensity: 0.22 + 0.33 * daylight,
    color: !up ? "#8ea6d8" : elevation < 15 ? "#ffb27a" : clearFraction < 0.7 ? "#dfe6ee" : "#fff6e6",
    daylight,
    up,
  };
}

export function dim(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (shift: number) => Math.round(((n >> shift) & 255) * factor);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

function rect(lng: number, lat: number, w: number, d: number, ox = 0, oy = 0): [number, number][] {
  const mLat = 1 / 111320;
  const mLng = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
  const corner = (x: number, y: number): [number, number] => {
    const rx = (x + ox) * Math.cos(ROTATION) - (y + oy) * Math.sin(ROTATION);
    const ry = (x + ox) * Math.sin(ROTATION) + (y + oy) * Math.cos(ROTATION);
    return [lng + rx * mLng, lat + ry * mLat];
  };
  return [corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2), corner(-w / 2, -d / 2)];
}

type Props = { id: string; kind: "house" | "battery" | "gateway" | "pln"; base: number; top: number; color: string };
const block = (ring: [number, number][], props: Props): Feature<Polygon, Props> => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: props });

const SIZE = {
  rumah: { w: 9, d: 7, h: 3.6 },
  musala: { w: 10, d: 10, h: 4.4 },
  balai: { w: 14, d: 8.5, h: 4.6 },
  sekolah: { w: 16, d: 8, h: 6.6 },
} as const;

export interface Scene {
  structures: FeatureCollection<Polygon, Props>;
  halos: FeatureCollection<Point, { id: string; kind: string; color: string }>;
  lamps: FeatureCollection<Point>;
}

/** Everything extruded, as data. MapLibre extrusions are vertical prisms, so panels are flat slabs on the roof. */
export function buildScene(input: { houses: SceneHouse[]; batteries: SceneBattery[]; gateways: SceneGateway[]; roads: [number, number][][]; pln?: { lng: number; lat: number } | null }, light: SunLight): Scene {
  const shade = 0.42 + 0.58 * light.daylight;
  const features: Feature<Polygon, Props>[] = [];
  for (const h of input.houses) {
    const s = SIZE[h.kind];
    const wall = h.kind === "rumah" ? "#c8c0b0" : h.kind === "sekolah" ? "#d6dbe6" : "#dcd3ee";
    const id = h.id;
    features.push(block(rect(h.lng, h.lat, s.w, s.d), { id, kind: "house", base: 0, top: s.h, color: dim(wall, shade) }));
    features.push(block(rect(h.lng, h.lat, s.w + 0.9, s.d + 0.9), { id, kind: "house", base: s.h, top: s.h + 0.5, color: dim(ROOF_COLOR[h.status], shade) }));
    // Rows of panels on the roof, brighter while the system is producing.
    const producing = h.status !== "offline" && h.ratio > 0.1;
    const panel = producing ? dim("#2563eb", 0.55 + 0.45 * light.daylight) : "#1a2333";
    // Panels leave a margin of roof showing, because the roof colour carries the status.
    for (const oy of [-1.2, 1.2]) {
      features.push(block(rect(h.lng, h.lat, s.w * 0.62, 1.7, 0, oy), { id, kind: "house", base: s.h + 0.5, top: s.h + 0.78, color: panel }));
    }
    if (h.kind === "musala") {
      // A small dome-like stack and a tower make the prayer facility recognisable from above.
      features.push(block(rect(h.lng, h.lat, 4.4, 4.4, -2.4, -2.3), { id, kind: "house", base: s.h + 0.5, top: s.h + 2.2, color: dim("#e9d48a", shade) }));
      features.push(block(rect(h.lng, h.lat, 1.5, 1.5, 6.4, 4.2), { id, kind: "house", base: 0, top: 11, color: dim("#e6e0d0", shade) }));
    }
    if (h.kind === "sekolah") {
      features.push(block(rect(h.lng, h.lat, 0.3, 0.3, -7, 5.4), { id, kind: "house", base: 0, top: 9, color: dim("#e2e8f0", shade) }));
      features.push(block(rect(h.lng, h.lat, 1.8, 0.2, -6.1, 5.4), { id, kind: "house", base: 8, top: 9, color: dim("#dc2626", shade) }));
    }
  }
  for (const b of input.batteries) {
    features.push(block(rect(b.lng, b.lat, 2.2, 2.2), { id: b.id, kind: "battery", base: 0, top: 2, color: dim(ROOF_COLOR[b.status], 0.6 + 0.4 * shade) }));
  }
  for (const g of input.gateways) {
    features.push(block(rect(g.lng, g.lat, 0.7, 0.7), { id: g.id, kind: "gateway", base: 0, top: 13, color: dim("#cbd5e1", 0.6 + 0.4 * shade) }));
    features.push(block(rect(g.lng, g.lat, 1.8, 1.8), { id: g.id, kind: "gateway", base: 13, top: 14, color: dim(ROOF_COLOR[g.status], 0.7 + 0.3 * shade) }));
  }
  if (input.pln) {
    features.push(block(rect(input.pln.lng, input.pln.lat, 5, 5), { id: "PLN", kind: "pln", base: 0, top: 3.2, color: dim("#38bdf8", 0.5 + 0.5 * shade) }));
    features.push(block(rect(input.pln.lng, input.pln.lat, 0.5, 0.5, 0, 0), { id: "PLN", kind: "pln", base: 3.2, top: 11, color: dim("#94a3b8", shade) }));
  }

  const lamps: Feature<Point>[] = [];
  for (const road of input.roads) {
    const [a, b] = [road[0], road[road.length - 1]];
    for (let i = 0; i <= 6; i++) {
      const f = i / 6;
      lamps.push({ type: "Feature", geometry: { type: "Point", coordinates: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] }, properties: {} });
    }
  }
  return {
    structures: { type: "FeatureCollection", features },
    halos: {
      type: "FeatureCollection",
      features: [
        ...input.batteries.map((b): Feature<Point, { id: string; kind: string; color: string }> => ({ type: "Feature", geometry: { type: "Point", coordinates: [b.lng, b.lat] }, properties: { id: b.id, kind: "battery", color: ROOF_COLOR[b.status] } })),
        ...input.gateways.map((g): Feature<Point, { id: string; kind: string; color: string }> => ({ type: "Feature", geometry: { type: "Point", coordinates: [g.lng, g.lat] }, properties: { id: g.id, kind: "gateway", color: ROOF_COLOR[g.status] } })),
      ],
    },
    lamps: { type: "FeatureCollection", features: lamps },
  };
}

export interface FlowSegment {
  from: [number, number];
  to: [number, number];
  /** Watts along this segment. Particle speed and size scale with it. */
  power: number;
  color: string;
}

/** Positions for the moving energy dots at a moment in time. */
export function particlesAt(segments: FlowSegment[], seconds: number): FeatureCollection<Point, { color: string; r: number }> {
  const features: Feature<Point, { color: string; r: number }>[] = [];
  segments.forEach((s, index) => {
    if (s.power < 40) return;
    const speed = 0.12 + Math.min(0.9, s.power / 3000);
    const r = 1.6 + Math.min(2.6, s.power / 1500);
    for (let k = 0; k < 3; k++) {
      const f = (seconds * speed + k / 3 + index * 0.137) % 1;
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: [s.from[0] + (s.to[0] - s.from[0]) * f, s.from[1] + (s.to[1] - s.from[1]) * f] }, properties: { color: s.color, r } });
    }
  });
  return { type: "FeatureCollection", features };
}

export function flowLines(segments: FlowSegment[]): FeatureCollection<LineString, { color: string }> {
  return { type: "FeatureCollection", features: segments.map((s) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [s.from, s.to] }, properties: { color: s.color } })) };
}
