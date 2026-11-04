import { DAY } from "./time";

export type FaultKind =
  | "soiling"
  | "shading"
  | "inverter_trip"
  | "sensor_stuck_zero"
  | "thermal"
  | "imbalance"
  | "device_offline";

export interface Fault {
  kind: FaultKind;
  assetId: string;
  from: number;
  to?: number;
  /** soiling: final performance factor. shading: factor. thermal: °C. imbalance: mV. */
  magnitude?: number;
  hours?: [number, number];
}

/** The default demo state relative to the start of today (WIB). */
export function defaultFaults(today: number): Fault[] {
  return [
    // Active: mostly normal, with these 4 issues the cluster overall reads Waspada.
    { kind: "soiling", assetId: "H07", from: today - 21 * DAY, magnitude: 0.68 },
    // The shaded hours cover 10:15, so that the case is visible while the clock is locked.
    { kind: "shading", assetId: "H13", from: today - 9 * DAY, magnitude: 0.35, hours: [9, 11.5] },
    { kind: "thermal", assetId: "B11", from: today - 3 * DAY, magnitude: 16 },
    { kind: "device_offline", assetId: "H26", from: today - DAY + 14 * 3600 },
    // History: already over, so they appear only as past anomalies.
    { kind: "inverter_trip", assetId: "H04", from: today - 24 * DAY, to: today - 22 * DAY },
    { kind: "soiling", assetId: "H23", from: today - 29 * DAY, to: today - 13 * DAY, magnitude: 0.7 },
    { kind: "sensor_stuck_zero", assetId: "H18", from: today - 9 * DAY, to: today - 8 * DAY + 6 * 3600 },
    { kind: "thermal", assetId: "B03", from: today - 20 * DAY, to: today - 19 * DAY, magnitude: 15 },
    { kind: "imbalance", assetId: "B13", from: today - 15 * DAY, to: today - 12 * DAY, magnitude: 150 },
  ];
}

export interface FaultIndex {
  byAsset: Map<string, Fault[]>;
}

export function indexFaults(faults: Fault[]): FaultIndex {
  const byAsset = new Map<string, Fault[]>();
  for (const f of faults) {
    const list = byAsset.get(f.assetId) ?? [];
    list.push(f);
    byAsset.set(f.assetId, list);
  }
  return { byAsset };
}

export function activeFaults(index: FaultIndex, assetId: string, ts: number): Fault[] {
  const list = index.byAsset.get(assetId);
  if (!list) return [];
  return list.filter((f) => ts >= f.from && (f.to === undefined || ts < f.to));
}
